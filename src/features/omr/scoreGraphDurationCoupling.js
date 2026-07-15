/**
 * OMR Engine V2 Phase 7 — duration coupling after lane onset shifts.
 * Shadow-only: shortens overlapping durations to the next same-voice onset or
 * measure budget. Uses Phase 3 ScoreGraph IR hints when available.
 */

import { SCORE_GRAPH_NODE } from './scoreGraph.js'
import { RELEASE_SOURCE, TIE_SUSTAIN_SOURCE } from './scoreGraphDurationObservation.js'

function eventVoice(event) {
  if (event.type === 'rest') {
    return (event.clef ?? 'treble') === 'bass' ? 2 : 1
  }
  return (event.notes?.[0]?.clef ?? 'treble') === 'bass' ? 2 : 1
}

function noteKey(note) {
  return `${note.midi}|${note.clef ?? 'treble'}`
}

function cloneBeamMetadata(beams) {
  if (Array.isArray(beams)) {
    return beams.map((beam) => (beam && typeof beam === 'object' ? { ...beam } : beam))
  }
  if (beams && typeof beams === 'object') {
    return { ...beams }
  }
  return beams ?? undefined
}

function cloneEvents(events = []) {
  return events.map((event) => ({
    ...event,
    notes: event.notes ? event.notes.map((note) => ({ ...note })) : undefined,
    beams: cloneBeamMetadata(event.beams),
  }))
}

/**
 * Build Phase 3 duration hints keyed by midi|clef from measure graph nodes.
 */
export function buildDurationHintsFromMeasureGraph(measureGraph = {}) {
  const byNoteKey = new Map()
  for (const node of measureGraph.nodes ?? []) {
    if (node.kind !== SCORE_GRAPH_NODE.NOTEHEAD) {
      continue
    }
    if (node.midi == null) {
      continue
    }
    const key = noteKey({ midi: node.midi, clef: node.clef })
    byNoteKey.set(key, {
      writtenDurationDivisions: node.writtenDurationDivisions ?? node.durationDivisions ?? null,
      soundingReleaseDivision: node.soundingReleaseDivision ?? null,
      durationSource: node.durationSource ?? null,
      releaseSource: node.releaseSource ?? null,
      tieSustainSource: node.tieSustainSource ?? null,
      gapToNextOnset: node.gapToNextOnset ?? null,
      gapSpanDivisions: node.gapSpanDivisions ?? null,
    })
  }
  return byNoteKey
}

function minDurationForNote(notes = [], hints = new Map()) {
  let minWritten = null
  for (const note of notes) {
    const hint = hints.get(noteKey(note))
    if (hint?.tieSustainSource && hint.writtenDurationDivisions != null) {
      minWritten =
        minWritten == null
          ? hint.writtenDurationDivisions
          : Math.min(minWritten, hint.writtenDurationDivisions)
    }
  }
  return minWritten
}

function allowsLengthen(notes = [], hints = new Map()) {
  return notes.some((note) => {
    const hint = hints.get(noteKey(note))
    return (
      hint?.releaseSource === RELEASE_SOURCE.TIE_SUSTAIN ||
      hint?.tieSustainSource === TIE_SUSTAIN_SOURCE.TIE_START ||
      hint?.tieSustainSource === TIE_SUSTAIN_SOURCE.TIE_MIDDLE
    )
  })
}

/**
 * Shorten only overlapping durations per voice after a lane onset shift.
 * Never lengthens unless tie/sustain evidence explicitly allows it.
 */
export function coupleOverlappingDurations(
  events = [],
  totalDivisions = 16,
  { measureGraph = null, durationHints = null } = {},
) {
  const hints = durationHints ?? buildDurationHintsFromMeasureGraph(measureGraph ?? {})
  const cloned = cloneEvents(events)
  const byVoice = new Map()

  for (const event of cloned) {
    if (event.type !== 'note') {
      continue
    }
    const voice = eventVoice(event)
    if (!byVoice.has(voice)) {
      byVoice.set(voice, [])
    }
    byVoice.get(voice).push(event)
  }

  for (const voiceEvents of byVoice.values()) {
    voiceEvents.sort((left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0))

    for (let index = 0; index < voiceEvents.length; index += 1) {
      const event = voiceEvents[index]
      const start = event.startDivision ?? 0
      if (start >= totalDivisions) {
        return null
      }

      const nextStart =
        index + 1 < voiceEvents.length
          ? voiceEvents[index + 1].startDivision ?? totalDivisions
          : totalDivisions
      const budgetEnd = totalDivisions
      const maxEnd = Math.min(nextStart, budgetEnd)
      let maxDuration = Math.max(1, maxEnd - start)

      const tieFloor = minDurationForNote(event.notes ?? [], hints)
      if (tieFloor != null) {
        maxDuration = Math.max(maxDuration, tieFloor)
      }

      const current = event.durationDivisions ?? 0
      if (current > maxDuration) {
        event.durationDivisions = maxDuration
      }

      if (start + (event.durationDivisions ?? 0) > totalDivisions) {
        event.durationDivisions = Math.max(1, totalDivisions - start)
      }

      if (!allowsLengthen(event.notes ?? [], hints) && (event.durationDivisions ?? 0) > current) {
        event.durationDivisions = current
      }
    }
  }

  return cloned
}

export function summarizeDurationCoupling(baselineEvents = [], coupledEvents = []) {
  let shortened = 0
  let unchanged = 0
  const baselineByKey = new Map()
  for (const event of baselineEvents) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      baselineByKey.set(`${noteKey(note)}|${event.startDivision ?? 0}`, event.durationDivisions ?? 0)
    }
  }
  for (const event of coupledEvents) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      const before = baselineByKey.get(`${noteKey(note)}|${event.startDivision ?? 0}`)
      const after = event.durationDivisions ?? 0
      if (before == null) {
        continue
      }
      if (after < before) {
        shortened += 1
      } else {
        unchanged += 1
      }
    }
  }
  return { shortened, unchanged }
}
