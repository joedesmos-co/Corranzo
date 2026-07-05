/**
 * Mic Engine V2 — live browser frame processor (score-informed).
 * Offline scorer adapted for AnalyserNode-sized windows; no WFY coupling.
 */

import { analyzeMicFrame } from '../micFrameAnalysis.js'
import {
  passesSoftMusicalGate,
  softGateOpenThreshold,
} from '../micNoiseGate.js'
import { MIC_SIGNAL_QUALITY } from '../micSignalQuality.js'
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
  softGateMinConfidence: 0.55,
  softGateMinRatio: 2.2,
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

function hasSoftGateEvidence(notes = [], detectedMidis = [], options = {}) {
  const {
    minConfidence = MIC_ENGINE_V2_LIVE_DEFAULTS.softGateMinConfidence,
    minRatio = MIC_ENGINE_V2_LIVE_DEFAULTS.softGateMinRatio,
  } = options
  const detectedSet = new Set(detectedMidis)
  return notes.some((note) =>
    detectedSet.has(note.midi) &&
      (note.confidence ?? 0) >= minConfidence &&
      (note.ratio ?? 0) >= minRatio,
  )
}

/**
 * Process one live audio buffer tick. Returns signal-diagnostic frame fields plus V2 metadata.
 */
export function processMicEngineV2Tick({
  buffer,
  sampleRate,
  expectedMidis = [],
  noiseFloor = null,
  state,
  centsTolerance = 35,
  gateOptions = null,
  softGateOptions = null,
  timeMs = 0,
  stableFrameThreshold = MIC_ENGINE_V2_LIVE_DEFAULTS.stableFrameThreshold,
  peakConfidenceThreshold = MIC_ENGINE_V2_LIVE_DEFAULTS.peakConfidenceThreshold,
  softGateMinConfidence = MIC_ENGINE_V2_LIVE_DEFAULTS.softGateMinConfidence,
  softGateMinRatio = MIC_ENGINE_V2_LIVE_DEFAULTS.softGateMinRatio,
} = {}) {
  const runtimeState = state ?? createMicEngineV2RuntimeState()

  if (!buffer?.length || !sampleRate) {
    runtimeState.v2Unavailable = true
    runtimeState.v2UnavailableReason = 'missing-buffer'
    return {
      state: runtimeState,
      signalFrame: null,
      frame: null,
      stableMidi: null,
      stableMidis: [],
      usedV2: false,
    }
  }

  const signalFrame = analyzeMicFrame(buffer, sampleRate, noiseFloor, {
    centsTolerance,
    gateOptions,
  })
  if (!signalFrame) {
    return {
      state: runtimeState,
      signalFrame: null,
      frame: null,
      stableMidi: null,
      stableMidis: [],
      usedV2: false,
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

  const primaryMidi = pickPrimaryMidi(v2Notes, detectedMidis) ?? signalFrame.midi
  const rawGateOpen = Boolean(signalFrame.gateOpen)
  const softGateThreshold = softGateOpenThreshold(signalFrame.noiseFloor, softGateOptions)
  const softGateEvidence = expectedMidis.length > 0 &&
    detectedMidis.length > 0 &&
    hasSoftGateEvidence(v2Notes, detectedMidis, {
      minConfidence: softGateMinConfidence,
      minRatio: softGateMinRatio,
    })
  const softGateOpen = !rawGateOpen &&
    softGateEvidence &&
    passesSoftMusicalGate(signalFrame.filteredRms, signalFrame.noiseFloor, softGateOptions)
  const effectiveGateOpen = rawGateOpen || softGateOpen
  const signalQuality = softGateOpen && signalFrame.signalQuality === MIC_SIGNAL_QUALITY.TOO_QUIET
    ? MIC_SIGNAL_QUALITY.GOOD
    : signalFrame.signalQuality
  const frame = {
    ...signalFrame,
    gateOpen: effectiveGateOpen,
    rawGateOpen,
    softGateOpen,
    softGateThreshold,
    softGateEvidence,
    midi: primaryMidi,
    clarity: usedV2 && meanConfidence > 0 ? meanConfidence : signalFrame.clarity,
    signalQuality,
    v2DetectedMidis: detectedMidis,
    v2Notes,
    v2MeanConfidence: meanConfidence,
    v2Active: usedV2 && !runtimeState.v2Unavailable,
    v2Unavailable: runtimeState.v2Unavailable,
  }

  let stableMidi = null

  if (expectedMidis.length === 1) {
    const expected = expectedMidis[0]
    if (stableMidis.some((midi) => matchesAnyExpected(midi, [expected], { micCentsTolerance: centsTolerance }))) {
      stableMidi = expected
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
    signalFrame,
    frame,
    stableMidi,
    stableMidis: stableChordMidis,
    usedV2,
  }
}
