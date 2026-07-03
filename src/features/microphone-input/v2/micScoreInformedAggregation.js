/**
 * Mic Engine V2 Phase 2B — temporal aggregation and rolled-chord onset tracking.
 * Offline prototype only.
 */

import { SCORE_INFORMED_DEFAULTS } from './scoreInformedChordScorer.js'

export const AGGREGATION_DEFAULTS = {
  peakConfidenceThreshold: 0.26,
  rolledPeakConfidenceThreshold: 0.24,
  rolledStableFrameThreshold: 1,
  clipBoundaryHopTolerance: 3,
}

export function isBassMidi(midi) {
  return midi < 60
}

/**
 * Build per-note onset windows for rolled chords (ms from clip start).
 */
export function rolledOnsetWindows(expectedMidis = [], rollMs = 80, expectedOnsetMs = 0) {
  const windows = new Map()
  for (let index = 0; index < expectedMidis.length; index += 1) {
    const startMs = expectedOnsetMs + index * rollMs
    windows.set(expectedMidis[index], {
      midi: expectedMidis[index],
      startMs,
      endMs: null,
    })
  }
  return windows
}

/**
 * Merge per-frame note tracks into stable detections with peak aggregation.
 */
export function aggregateScoreInformedTracks(perNoteTracks = [], options = {}) {
  const {
    stableFrameThreshold = SCORE_INFORMED_DEFAULTS.stableFrameThreshold,
    peakConfidenceThreshold = AGGREGATION_DEFAULTS.peakConfidenceThreshold,
    chordType = null,
    rollMs = null,
    expectedOnsetMs = 0,
    expectedMidis = [],
  } = options

  const isRolled = chordType === 'rolled'
  const frameThreshold = isRolled
    ? AGGREGATION_DEFAULTS.rolledStableFrameThreshold
    : stableFrameThreshold
  const peakThreshold = isRolled
    ? AGGREGATION_DEFAULTS.rolledPeakConfidenceThreshold
    : peakConfidenceThreshold
  const onsetWindows = isRolled ? rolledOnsetWindows(expectedMidis, rollMs ?? 80, expectedOnsetMs) : null

  const stable = []
  for (const track of perNoteTracks) {
    const onsetWindow = onsetWindows?.get(track.midi)
    const firstTimeMs =
      onsetWindow && track.firstTimeMs < onsetWindow.startMs - 40
        ? onsetWindow.startMs
        : track.firstTimeMs

    const passesFrames = track.stableFrames >= frameThreshold
    const passesPeak = track.maxConfidence >= peakThreshold
    if (!passesFrames && !passesPeak) {
      continue
    }

    stable.push({
      midi: track.midi,
      timeMs: firstTimeMs,
      clarity: track.maxConfidence,
      confidence: track.maxConfidence,
      peakRatio: track.peakRatio,
      stableFrames: track.stableFrames,
      aggregated: true,
      bassBoosted: isBassMidi(track.midi),
    })
  }

  return stable.sort((left, right) => left.timeMs - right.timeMs)
}

export function clipBoundaryToleranceMs(frameHopMs, hopTolerance = AGGREGATION_DEFAULTS.clipBoundaryHopTolerance) {
  return frameHopMs * hopTolerance
}

export function shiftClipRelativeDetections(detections = [], clipStartMs, frameHopMs) {
  const tolerance = clipBoundaryToleranceMs(frameHopMs)
  return detections
    .filter((detection) => detection.timeMs >= clipStartMs - tolerance)
    .map((detection) => ({
      ...detection,
      timeMs: Math.max(0, detection.timeMs - clipStartMs),
    }))
}

export function shiftClipRelativeFrames(frames = [], clipStartMs, frameHopMs) {
  const tolerance = clipBoundaryToleranceMs(frameHopMs)
  return frames
    .filter((frame) => frame.timeMs >= clipStartMs - tolerance)
    .map((frame) => ({ ...frame, timeMs: Math.max(0, frame.timeMs - clipStartMs) }))
}

export function shiftClipRelativeTracks(tracks = [], clipStartMs, frameHopMs) {
  const tolerance = clipBoundaryToleranceMs(frameHopMs)
  return tracks
    .filter((track) => (track.lastTimeMs ?? track.firstTimeMs) >= clipStartMs - tolerance)
    .map((track) => ({
      ...track,
      firstTimeMs: Math.max(0, track.firstTimeMs - clipStartMs),
      lastTimeMs: track.lastTimeMs != null ? track.lastTimeMs - clipStartMs : undefined,
    }))
}
