/**
 * Guitar Vision — playability validation (G6).
 *
 * Semantic checks over canonical GuitarEvents. This module never repairs:
 * every violation is quarantined/reported with a code and the offending event
 * id, so invalid source data stays visible instead of being silently fixed
 * into plausible-looking truth.
 */

import { soundingFromTab, tabPositionsForSounding } from './pitchContract.js'
import { STANDARD_GUITAR_TUNING } from '../../instruments/instruments.js'

export const PLAYABILITY_VERSION = 'guitar-playability/1.0'

export const PLAYABILITY_CODES = Object.freeze({
  STRING_OUT_OF_RANGE: 'string-out-of-range',
  FRET_OUT_OF_RANGE: 'fret-out-of-range',
  IMPOSSIBLE_POSITION: 'impossible-position',
  SAME_STRING_SIMULTANEOUS: 'same-string-simultaneous',
  TIE_PITCH_CHANGE: 'tie-pitch-change',
  HAMMER_PULL_NO_NEIGHBOUR: 'hammer-pull-no-neighbour',
  HAMMER_PULL_SAME_PITCH: 'hammer-pull-same-pitch',
  BEND_NO_PARAMETERS: 'bend-no-parameters',
  VOICE_OVERFLOW: 'voice-overflow',
  UNVERIFIED_PAIRING: 'unverified-pairing',
})

/**
 * @param {object} canonical  canonicalEventsFromParsed() output
 * @param {object} [options] { tuning, capoFret, maxFret }
 * @returns {{ version, ok, issues }}
 */
export function validatePlayability(canonical, options = {}) {
  const tuning = options.tuning ?? canonical.tuning ?? STANDARD_GUITAR_TUNING
  const capoFret = options.capoFret ?? canonical.capoFret ?? 0
  const maxFret = options.maxFret ?? 24
  const issues = []
  const events = canonical.events ?? []

  for (const event of events) {
    if (event.time?.isRest) continue
    const { string, fret } = event.tab ?? {}

    if (string != null && (!Number.isInteger(string) || string < 1 || string > tuning.length)) {
      issues.push(issue(event, PLAYABILITY_CODES.STRING_OUT_OF_RANGE, `string ${string} outside 1..${tuning.length}`))
    }
    if (fret != null && (!Number.isInteger(fret) || fret < 0 || fret > maxFret)) {
      issues.push(issue(event, PLAYABILITY_CODES.FRET_OUT_OF_RANGE, `fret ${fret} outside 0..${maxFret}`))
    }
    if (string != null && fret != null && Number.isFinite(event.pitch?.soundingMidi)) {
      const expected = soundingFromTab(string, fret, { tuning, capoFret })
      if (expected == null) {
        issues.push(issue(event, PLAYABILITY_CODES.IMPOSSIBLE_POSITION, `string ${string} fret ${fret} is unplayable`))
      } else if (expected !== event.pitch.soundingMidi) {
        issues.push(issue(event, PLAYABILITY_CODES.UNVERIFIED_PAIRING,
          `string ${string} fret ${fret} sounds ${expected} but event pitch is ${event.pitch.soundingMidi}; ` +
          `playable positions: ${tabPositionsForSounding(event.pitch.soundingMidi, { tuning, capoFret, maxFret }).map((p) => `${p.string}/${p.fret}`).join(', ') || 'none'}`))
      }
    }

    for (const technique of event.techniques ?? []) {
      if (technique.kind === 'bend' && technique.semitones == null) {
        issues.push(issue(event, PLAYABILITY_CODES.BEND_NO_PARAMETERS, 'bend without semitone amount cannot train a bend-amount head', 'info'))
      }
    }
  }

  // Simultaneous same-string conflicts: two fretted events, one string, one onset.
  const byOnset = new Map()
  for (const event of events) {
    if (event.time?.isRest || event.tab?.string == null) continue
    const key = `${event.time.onsetQuarters}|${event.time.staff}`
    if (!byOnset.has(key)) byOnset.set(key, [])
    byOnset.get(key).push(event)
  }
  for (const [, group] of byOnset) {
    const seen = new Map()
    for (const event of group) {
      if (seen.has(event.tab.string)) {
        issues.push(issue(event, PLAYABILITY_CODES.SAME_STRING_SIMULTANEOUS,
          `string ${event.tab.string} fretted twice at onset ${event.time.onsetQuarters} (${seen.get(event.tab.string)} and ${event.id})`))
      } else {
        seen.set(event.tab.string, event.id)
      }
    }
  }

  // Tie chains must preserve pitch across the chain (grouped by chain id when
  // the parser assigned one, pairwise otherwise).
  const chains = new Map()
  for (const event of events) {
    if (event.time.tieChainId) {
      if (!chains.has(event.time.tieChainId)) chains.set(event.time.tieChainId, [])
      chains.get(event.time.tieChainId).push(event)
    }
  }
  for (const [chainId, members] of chains) {
    const pitches = new Set(members.map((m) => m.pitch?.soundingMidi))
    if (pitches.size > 1) {
      issues.push({ eventId: members[members.length - 1].id ?? null, code: PLAYABILITY_CODES.TIE_PITCH_CHANGE, severity: 'error',
        detail: `tie chain ${chainId} changes pitch across [${[...pitches].join(', ')}]` })
    }
  }
  const sorted = [...events].sort((a, b) => a.time.onsetQuarters - b.time.onsetQuarters)
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const left = sorted[i]
    const right = sorted[i + 1]
    if (!left.time.tieChainId && !right.time.tieChainId && left.time.tie?.start && right.time.tie?.stop && left.pitch && right.pitch) {
      if (left.pitch.soundingMidi !== right.pitch.soundingMidi) {
        issues.push(issue(right, PLAYABILITY_CODES.TIE_PITCH_CHANGE,
          `tie chain changes pitch ${left.pitch.soundingMidi} -> ${right.pitch.soundingMidi}`))
      }
    }
    // Hammer/pull must connect two different pitches on adjacent events.
    for (const technique of left.techniques ?? []) {
      if ((technique.kind === 'hammer-on' || technique.kind === 'pull-off') && left.pitch && right.pitch) {
        if (left.pitch.soundingMidi === right.pitch.soundingMidi) {
          issues.push(issue(left, PLAYABILITY_CODES.HAMMER_PULL_SAME_PITCH, `${technique.kind} with no pitch change`))
        }
        break
      }
    }
  }
  // Trailing hammer/pull with no following event is structurally dangling.
  const last = sorted[sorted.length - 1]
  if (last && (last.techniques ?? []).some((t) => t.kind === 'hammer-on' || t.kind === 'pull-off')) {
    issues.push(issue(last, PLAYABILITY_CODES.HAMMER_PULL_NO_NEIGHBOUR, 'hammer-on/pull-off on the final event has no target', 'info'))
  }

  // Voice durations must fit their measures (reuses rhythm checks as playability).
  for (const check of canonical.rhythm?.measureChecks ?? []) {
    if (!check.ok) {
      issues.push({ eventId: null, code: PLAYABILITY_CODES.VOICE_OVERFLOW, severity: 'error',
        detail: `measure ${check.measure} voice ${check.voice}: ${check.soundedQuarters} vs ${check.expectedQuarters} quarters` })
    }
  }

  return { version: PLAYABILITY_VERSION, ok: !issues.some((item) => item.severity === 'error'), issues }
}

function issue(event, code, detail, severity = 'error') {
  return { eventId: event.id ?? null, code, severity, detail }
}
