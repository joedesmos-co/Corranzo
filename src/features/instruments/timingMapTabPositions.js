/**
 * Tab positions for a whole timing map.
 *
 * Explicit MusicXML/OMR positions always win; the rest are derived once, in
 * time order, so the hand-position heuristic sees real musical context.
 * Returns a Map note.id → { string, fret, derived } for instant lookup by
 * checkpoints, visual lanes, and labels. Instruments without strings (piano)
 * return an empty map — callers can treat that as "no tab concept".
 */

import { deriveTabPositions } from './fretboard.js'

/** Effective string config: score-declared tuning overrides the default. */
export function resolveStringsForTimingMap(timingMap, instrument) {
  const strings = instrument?.strings ?? null
  if (!strings) {
    return null
  }
  const declaredTuning = timingMap?.parts
    ?.map((part) => part.tuning)
    .find((tuning) => Array.isArray(tuning) && tuning.length > 0)
  if (!declaredTuning) {
    return strings
  }
  return {
    ...strings,
    count: declaredTuning.length,
    tuning: declaredTuning,
  }
}

const positionCache = new WeakMap() // timingMap → Map(instrumentId → positions)

export function getTabPositionsForTimingMap(timingMap, instrument) {
  const strings = resolveStringsForTimingMap(timingMap, instrument)
  if (!strings || !timingMap?.notes?.length) {
    return new Map()
  }

  let byInstrument = positionCache.get(timingMap)
  if (!byInstrument) {
    byInstrument = new Map()
    positionCache.set(timingMap, byInstrument)
  }
  const cached = byInstrument.get(instrument.id)
  if (cached) {
    return cached
  }

  // Mirrors already carry explicit positions; derive over sounding notes only
  // so the hand-position heuristic follows what the player actually plays.
  const sounding = timingMap.notes.filter(
    (note) => !note.isRest && note.midi != null && !note.isTabMirror,
  )
  const derived = deriveTabPositions(sounding, strings)

  const positions = new Map()
  for (const note of derived) {
    if (note.id != null && note.string != null && note.fret != null) {
      positions.set(note.id, {
        string: note.string,
        fret: note.fret,
        derived: Boolean(note.tabDerived),
      })
    }
  }

  byInstrument.set(instrument.id, positions)
  return positions
}
