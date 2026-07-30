/**
 * Tab positions for a whole timing map.
 *
 * Explicit MusicXML/OMR positions always win; the rest are derived once, in
 * time order, so the hand-position heuristic sees real musical context.
 * Returns a Map note.id → { string, fret, derived } for instant lookup by
 * checkpoints, visual lanes, and labels. Instruments without strings (piano)
 * return an empty map — callers can treat that as "no tab concept".
 *
 * Cache entries are owned by activePdfIdentity + epoch + contentHash. A source
 * change that leaves a stale WeakMap hit must rebuild, never reuse.
 */

import { deriveTabPositions } from './fretboard.js'
import {
  guitarMappingOwnersMatch,
  publishSourceOwnershipParity,
  resolveGuitarMappingOwner,
} from './guitarMappingOwnership.js'
import { getActiveScoreSourceGeneration } from '../library/scoreSourceGenerationGate.js'
import { assertDerivedBelongsToActiveScore } from '../score/activeScore.js'

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

const positionCache = new WeakMap() // timingMap → Map(instrumentId → { owner, positions })

export function getTabPositionsForTimingMap(timingMap, instrument, ownership = {}) {
  const strings = resolveStringsForTimingMap(timingMap, instrument)
  if (!strings || !timingMap?.notes?.length) {
    return new Map()
  }

  const owner = resolveGuitarMappingOwner(timingMap, ownership)
  const activeScore =
    typeof window !== 'undefined' ? window.__SCOREFLOW_ACTIVE_SCORE__ : null
  // Instrument switch re-renders Practice with the new instrument before the
  // App effect clears the live session. A hard ActiveScore assert would crash
  // the tree; return empty mapping until ownership matches again.
  if (
    activeScore?.scoreId &&
    owner.ownerScoreId &&
    owner.ownerScoreId !== activeScore.scoreId
  ) {
    return new Map()
  }

  let byInstrument = positionCache.get(timingMap)
  if (!byInstrument) {
    byInstrument = new Map()
    positionCache.set(timingMap, byInstrument)
  }
  const cached = byInstrument.get(instrument.id)
  if (cached && guitarMappingOwnersMatch(cached.owner, owner)) {
    publishGuitarOwners(owner)
    return cached.positions
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

  byInstrument.set(instrument.id, { owner, positions })
  publishGuitarOwners(owner)
  return positions
}

function publishGuitarOwners(owner) {
  const generation = getActiveScoreSourceGeneration()
  const auth = typeof window !== 'undefined' ? window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ : null
  const snap = typeof window !== 'undefined' ? window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ : null
  const activeScore =
    typeof window !== 'undefined' ? window.__SCOREFLOW_ACTIVE_SCORE__ : null
  const activeScoreIdentity =
    activeScore?.scoreId ?? generation.activeScoreId ?? owner.ownerPdfIdentity ?? null
  if (activeScore?.scoreId && owner.ownerScoreId) {
    assertDerivedBelongsToActiveScore(
      { ownerScoreId: owner.ownerScoreId },
      { scoreId: activeScore.scoreId },
      'guitar-mapping',
    )
  }
  publishSourceOwnershipParity({
    activeScoreIdentity,
    authoritativeMusicXmlOwner: auth?.ownerScoreId ?? auth?.ownerPdfIdentity ?? activeScoreIdentity,
    playbackTimelineOwner: snap?.ownerScoreId ?? auth?.ownerPdfIdentity ?? activeScoreIdentity,
    guitarMappingOwner: owner.ownerScoreId ?? owner.ownerPdfIdentity,
    practicePromptOwner: owner.ownerScoreId ?? owner.ownerPdfIdentity,
    contentHash: owner.contentHash ?? snap?.timingContentHash ?? auth?.musicXmlHash ?? null,
  })
}

/** Test helper: drop all cached fret maps for a timing map object. */
export function clearTabPositionCacheForTimingMap(timingMap) {
  if (timingMap) {
    positionCache.delete(timingMap)
  }
}
