/**
 * Mic Engine V2 — live browser frame processor (score-informed).
 * Offline scorer adapted for AnalyserNode-sized windows; no WFY coupling.
 */

import { analyzeMicFrame } from '../micFrameAnalysis.js'
import { matchesAnyExpected } from '../../practice/midiPitchMatch.js'
import { aggregateScoreInformedTracks } from './micScoreInformedAggregation.js'
import {
  SCORE_INFORMED_DEFAULTS,
  scoreInformedChordWindow,
} from './scoreInformedChordScorer.js'
import { DEFAULT_FFT_SIZE, hannWindow } from './micSpectralAnalysis.js'

export const MIC_ENGINE_V2_LIVE_DEFAULTS = {
  stableFrameThreshold: SCORE_INFORMED_DEFAULTS.stableFrameThreshold,
  peakConfidenceThreshold: 0.26,
}

export function createMicEngineV2RuntimeState() {
  return {
    fftSize: DEFAULT_FFT_SIZE,
    window: hannWindow(DEFAULT_FFT_SIZE),
    perNoteTracks: new Map(),
    lastDetectedMidis: [],
    v2Unavailable: false,
    v2UnavailableReason: null,
  }
}

export function resetMicEngineV2RuntimeState(state) {
  if (!state) {
    return createMicEngineV2RuntimeState()
  }
  state.perNoteTracks.clear()
  state.lastDetectedMidis = []
  state.v2Unavailable = false
  state.v2UnavailableReason = null
  return state
}

function updateNoteTrack(perNoteTracks, note, timeMs) {
  const track = perNoteTracks.get(note.midi) ?? {
    midi: note.midi,
    maxConfidence: 0,
    peakFrameConfidence: 0,
    firstTimeMs: timeMs,
    stableFrames: 0,
    peakRatio: 0,
    bassBoosted: Boolean(note.bassBoosted),
  }
  track.maxConfidence = Math.max(track.maxConfidence, note.confidence ?? 0)
  track.peakFrameConfidence = Math.max(track.peakFrameConfidence, note.confidence ?? 0)
  track.peakRatio = Math.max(track.peakRatio, note.ratio ?? 0)
  if (note.detected) {
    track.stableFrames += 1
    if (track.firstTimeMs > timeMs) {
      track.firstTimeMs = timeMs
    }
  }
  track.lastTimeMs = timeMs
  perNoteTracks.set(note.midi, track)
}

function pickPrimaryMidi(notes = [], detectedMidis = []) {
  if (!detectedMidis.length) {
    return null
  }
  const detectedSet = new Set(detectedMidis)
  const ranked = notes
    .filter((note) => detectedSet.has(note.midi))
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
  return ranked[0]?.midi ?? detectedMidis[0] ?? null
}

/**
 * Process one live audio buffer tick. Returns V1-compatible frame fields plus V2 metadata.
 */
export function processMicEngineV2Tick({
  buffer,
  sampleRate,
  expectedMidis = [],
  noiseFloor = null,
  state,
  centsTolerance = 35,
  timeMs = 0,
  stableFrameThreshold = MIC_ENGINE_V2_LIVE_DEFAULTS.stableFrameThreshold,
  peakConfidenceThreshold = MIC_ENGINE_V2_LIVE_DEFAULTS.peakConfidenceThreshold,
} = {}) {
  const runtimeState = state ?? createMicEngineV2RuntimeState()

  if (!buffer?.length || !sampleRate) {
    runtimeState.v2Unavailable = true
    runtimeState.v2UnavailableReason = 'missing-buffer'
    return {
      state: runtimeState,
      v1Frame: null,
      frame: null,
      stableMidi: null,
      stableMidis: [],
      usedV2: false,
      usedV1Fallback: false,
    }
  }

  const v1Frame = analyzeMicFrame(buffer, sampleRate, noiseFloor, { centsTolerance })
  if (!v1Frame) {
    return {
      state: runtimeState,
      v1Frame: null,
      frame: null,
      stableMidi: null,
      stableMidis: [],
      usedV2: false,
      usedV1Fallback: false,
    }
  }

  let detectedMidis = []
  let v2Notes = []
  let meanConfidence = 0
  let usedV2 = false

  if (expectedMidis.length > 0) {
    try {
      const scored = scoreInformedChordWindow(buffer, sampleRate, expectedMidis, {
        fftSize: runtimeState.fftSize,
        window: runtimeState.window,
      })
      v2Notes = scored.notes ?? []
      detectedMidis = scored.detectedMidis ?? []
      meanConfidence = scored.meanConfidence ?? 0
      usedV2 = true
      for (const note of v2Notes) {
        updateNoteTrack(runtimeState.perNoteTracks, note, timeMs)
      }
      runtimeState.lastDetectedMidis = detectedMidis
    } catch (error) {
      runtimeState.v2Unavailable = true
      runtimeState.v2UnavailableReason = error?.message ?? 'v2-scorer-error'
    }
  }

  const stableTracks = aggregateScoreInformedTracks(
    [...runtimeState.perNoteTracks.values()],
    {
      stableFrameThreshold,
      peakConfidenceThreshold,
      expectedMidis,
    },
  )
  const stableMidis = stableTracks.map((track) => track.midi)

  const primaryMidi = pickPrimaryMidi(v2Notes, detectedMidis) ?? v1Frame.midi
  const frame = {
    ...v1Frame,
    midi: primaryMidi,
    clarity: usedV2 && meanConfidence > 0 ? meanConfidence : v1Frame.clarity,
    v2DetectedMidis: detectedMidis,
    v2Notes,
    v2MeanConfidence: meanConfidence,
    v2Active: usedV2 && !runtimeState.v2Unavailable,
    v2Unavailable: runtimeState.v2Unavailable,
  }

  let stableMidi = null
  let usedV1Fallback = false

  if (expectedMidis.length === 1) {
    const expected = expectedMidis[0]
    if (stableMidis.some((midi) => matchesAnyExpected(midi, [expected], { micCentsTolerance: centsTolerance }))) {
      stableMidi = expected
    } else if (
      v1Frame.midi != null &&
      v1Frame.gateOpen &&
      matchesAnyExpected(v1Frame.midi, [expected], { micCentsTolerance: centsTolerance })
    ) {
      stableMidi = v1Frame.midi
      usedV1Fallback = true
    }
  }

  const stableChordMidis =
    expectedMidis.length > 1 &&
    expectedMidis.every((expected) =>
      stableMidis.some((midi) => matchesAnyExpected(midi, [expected], { micCentsTolerance: centsTolerance })),
    )
      ? expectedMidis
      : []

  return {
    state: runtimeState,
    v1Frame,
    frame,
    stableMidi,
    stableMidis: stableChordMidis,
    usedV2,
    usedV1Fallback,
  }
}
