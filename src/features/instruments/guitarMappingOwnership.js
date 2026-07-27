/**
 * Guitar-derived state ownership.
 *
 * Fret maps / tab positions must belong to the same active score generation as
 * authoritative MusicXML and playback. A mismatch means discard and rebuild.
 */

import { getActiveScoreSourceGeneration } from '../library/scoreSourceGenerationGate.js'

export function resolveGuitarMappingOwner(timingMap, ownership = {}) {
  const generation = getActiveScoreSourceGeneration()
  const activeScore =
    typeof window !== 'undefined' ? window.__SCOREFLOW_ACTIVE_SCORE__ : null
  return {
    ownerScoreId:
      ownership.ownerScoreId ??
      timingMap?.ownerScoreId ??
      activeScore?.scoreId ??
      generation.activeScoreId ??
      null,
    ownerPdfIdentity:
      ownership.ownerPdfIdentity ??
      ownership.activePdfIdentity ??
      generation.activePdfIdentity ??
      null,
    contentHash: ownership.contentHash ?? timingMap?.contentHash ?? null,
    epoch:
      ownership.epoch ??
      ownership.activeEpoch ??
      generation.activeEpoch ??
      0,
  }
}

export function guitarMappingOwnersMatch(a, b) {
  if (!a || !b) {
    return false
  }
  if (a.ownerScoreId || b.ownerScoreId) {
    return (
      a.ownerScoreId === b.ownerScoreId &&
      a.contentHash === b.contentHash &&
      a.epoch === b.epoch
    )
  }
  return (
    a.ownerPdfIdentity === b.ownerPdfIdentity &&
    a.contentHash === b.contentHash &&
    a.epoch === b.epoch
  )
}

/**
 * Publish the cross-pipeline ownership invariant for browser / E2E asserts.
 * All owners should equal the same active score identity when healthy.
 */
export function publishSourceOwnershipParity({
  activeScoreIdentity = null,
  authoritativeMusicXmlOwner = null,
  playbackTimelineOwner = null,
  guitarMappingOwner = null,
  practicePromptOwner = null,
  contentHash = null,
} = {}) {
  if (typeof window === 'undefined') {
    return null
  }
  const snapshot = {
    activeScoreIdentity,
    authoritativeMusicXmlOwner,
    playbackTimelineOwner,
    guitarMappingOwner,
    practicePromptOwner,
    contentHash,
    aligned:
      activeScoreIdentity != null &&
      activeScoreIdentity === authoritativeMusicXmlOwner &&
      activeScoreIdentity === playbackTimelineOwner &&
      activeScoreIdentity === guitarMappingOwner &&
      activeScoreIdentity === practicePromptOwner,
    at: Date.now(),
  }
  window.__SCOREFLOW_SOURCE_OWNERS__ = snapshot
  return snapshot
}
