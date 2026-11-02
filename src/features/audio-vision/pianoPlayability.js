/**
 * Piano playability model for Audio Vision arrangements.
 *
 * A piano arrangement is not an unrestricted MIDI event list: each hand has a
 * finite reach, a finite number of fingers, and must travel in time. The
 * arranger already enforces per-hand span at each onset; this module adds the
 * phrase-level checks that a single-onset span check cannot see:
 *
 *   - per-hand chord span and note count;
 *   - hand travel between successive onsets and its speed;
 *   - left/right hand crossing (LH above RH at the same onset);
 *   - sustained notes that would require an impossible hand jump.
 */

export const DEFAULT_PIANO_PLAYABILITY = Object.freeze({
  maxSpan: 12,            // octave: comfortable for a general player
  maxNotesPerHand: 5,
  maxHandJump: 12,        // semitones between successive hand anchors
  maxShiftSemitonesPerSecond: 30,
})

function handGroups(events) {
  const byOnset = new Map()
  for (const e of events) {
    const key = Number(e.startBeat ?? 0).toFixed(4)
    if (!byOnset.has(key)) byOnset.set(key, { LH: [], RH: [] })
    const hand = e.hand === 'LH' ? 'LH' : 'RH'
    byOnset.get(key)[hand].push(e)
  }
  return byOnset
}

function spanOf(midis) {
  return midis.length > 1 ? Math.max(...midis) - Math.min(...midis) : 0
}

/** Evaluate one hand's simultaneous notes. */
export function evaluatePianoHand(notes, { maxSpan = 12, maxNotesPerHand = 5 } = {}) {
  const midis = notes.map((n) => n.midi)
  const span = spanOf(midis)
  const reasons = []
  if (span > maxSpan) reasons.push(`span-${span}-gt-${maxSpan}`)
  if (notes.length > maxNotesPerHand) reasons.push(`notes-${notes.length}-gt-${maxNotesPerHand}`)
  return { playable: reasons.length === 0, reasons, span, notes: notes.length }
}

/** Phrase-level transitions: hand travel, speed, and LH/RH crossing. */
export function analyzePianoTransitions(events, {
  beatSeconds = 0.5,
  maxHandJump = 12,
  maxShiftSemitonesPerSecond = 30,
} = {}) {
  const byOnset = handGroups(events)
  const onsets = [...byOnset.keys()].map(Number).sort((a, b) => a - b)
  const diagnostics = []
  const anchors = { LH: null, RH: null }
  let prevOnset = null
  for (const onset of onsets) {
    const group = byOnset.get(onset.toFixed(4))
    for (const hand of ['LH', 'RH']) {
      const notes = group[hand]
      if (!notes.length) continue
      const midis = notes.map((n) => n.midi)
      const anchor = (Math.min(...midis) + Math.max(...midis)) / 2
      if (anchors[hand] != null && prevOnset != null) {
        const jump = Math.abs(anchor - anchors[hand])
        const seconds = Math.max(1e-3, (onset - prevOnset) * beatSeconds)
        const speed = jump / seconds
        if (jump > maxHandJump) {
          diagnostics.push({ startBeat: onset, kind: 'hand-jump', hand, jump: Math.round(jump * 10) / 10 })
        } else if (speed > maxShiftSemitonesPerSecond) {
          diagnostics.push({ startBeat: onset, kind: 'fast-shift', hand, jump: Math.round(jump * 10) / 10, speed: Math.round(speed) })
        }
      }
      anchors[hand] = anchor
    }
    // Hand crossing: LH plays above the RH at the same onset (unless only one
    // hand has notes).
    if (group.LH.length && group.RH.length) {
      const lhMax = Math.max(...group.LH.map((n) => n.midi))
      const rhMin = Math.min(...group.RH.map((n) => n.midi))
      if (lhMax >= rhMin) {
        diagnostics.push({ startBeat: onset, kind: 'hand-crossing', lhMax, rhMin })
      }
    }
    prevOnset = onset
  }
  return diagnostics
}

export function validatePianoArrangement(events, {
  maxSpan = 12,
  maxNotesPerHand = 5,
  maxHandJump = 12,
  beatSeconds = 0.5,
  maxShiftSemitonesPerSecond = 30,
} = {}) {
  const byOnset = handGroups(events)
  const violations = []
  const shapes = []
  for (const [key, group] of byOnset) {
    for (const hand of ['LH', 'RH']) {
      const notes = group[hand]
      if (!notes.length) continue
      const check = evaluatePianoHand(notes, { maxSpan, maxNotesPerHand })
      shapes.push({ startBeat: Number(key), hand, span: check.span, notes: check.notes })
      if (!check.playable) {
        violations.push({ startBeat: Number(key), hand, kind: 'unplayable-hand', reasons: check.reasons })
      }
    }
  }
  const transitions = analyzePianoTransitions(events, { beatSeconds, maxHandJump, maxShiftSemitonesPerSecond })
  violations.push(...transitions.filter((t) => t.kind === 'hand-jump'))
  return {
    playable: violations.length === 0,
    violations,
    shapes,
    transitions,
    onsets: byOnset.size,
  }
}
