/**
 * Mic Engine V2 — offline score-informed polyphony replay harness.
 * Parallel to V1 monophonic replay; does not touch live mic behavior.
 */

import {
  MIC_REPLAY_CALIBRATION_PRELUDE_SECONDS,
  frameHopSamples,
} from '../micReplayHarness.js'
import {
  aggregateScoreInformedTracks,
  shiftClipRelativeDetections,
  shiftClipRelativeFrames,
  shiftClipRelativeTracks,
} from './micScoreInformedAggregation.js'
import { SCORE_INFORMED_DEFAULTS, scoreBlindPianoRange, scoreInformedChordWindow } from './scoreInformedChordScorer.js'
import { DEFAULT_FFT_SIZE, hannWindow } from './micSpectralAnalysis.js'

const ENGINE_ID = 'v2-score-informed-phase-2b'

function fillCalibrationPrelude(buffer, length, seed = 17) {
  let state = seed >>> 0
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    buffer[index] = ((state / 0x7fffffff) * 2 - 1) * 0.0035
  }
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

/**
 * Offline replay through score-informed chord scorer.
 * Output shape mirrors V1 replay for shared polyphony evaluation.
 */
export function replayScoreInformedPolyphonySamples(samples, sampleRate, options = {}) {
  const {
    expectedMidis = [],
    fftSize = SCORE_INFORMED_DEFAULTS.fftSize,
    frameHopMs = SCORE_INFORMED_DEFAULTS.frameHopMs,
    stableFrameThreshold = SCORE_INFORMED_DEFAULTS.stableFrameThreshold,
    chordType = null,
    rollMs = null,
    expectedOnsetMs = 0,
    minAnalysisTimeMs = 0,
    scorerOptions = {},
  } = options

  if (!samples?.length || !sampleRate) {
    return {
      sampleRate,
      frameHopMs,
      fftSize,
      engine: ENGINE_ID,
      scorerVersion: SCORE_INFORMED_DEFAULTS.scorerVersion,
      frames: [],
      stableDetections: [],
      perNoteTracks: [],
    }
  }

  const hop = frameHopSamples(sampleRate, frameHopMs)
  const window = hannWindow(fftSize)
  const frames = []
  const perNoteTracks = new Map()

  for (let end = fftSize; end <= samples.length; end += hop) {
    const timeMs = ((end - fftSize) / sampleRate) * 1000
    if (timeMs < minAnalysisTimeMs) {
      continue
    }
    const slice = samples.subarray(end - fftSize, end)

    let frameResult
    if (expectedMidis?.length) {
      frameResult = scoreInformedChordWindow(slice, sampleRate, expectedMidis, {
        fftSize,
        window,
        ...scorerOptions,
      })
    } else {
      const blindNotes = scoreBlindPianoRange(slice, sampleRate, { fftSize, window, ...scorerOptions })
      frameResult = {
        notes: blindNotes,
        detectedMidis: blindNotes.map((note) => note.midi),
        noiseFloor: blindNotes[0]?.noiseFloor ?? 0,
        meanConfidence: blindNotes.length
          ? blindNotes.reduce((sum, note) => sum + note.confidence, 0) / blindNotes.length
          : 0,
        chordDetected: false,
      }
    }

    frames.push({
      timeMs,
      detectedMidis: frameResult.detectedMidis,
      meanConfidence: frameResult.meanConfidence,
      noiseFloor: frameResult.noiseFloor,
      notes: frameResult.notes.map((note) => ({
        midi: note.midi,
        confidence: note.confidence,
        detected: note.detected,
        ratio: note.ratio,
        bassBoosted: note.bassBoosted ?? false,
      })),
    })

    for (const note of frameResult.notes) {
      updateNoteTrack(perNoteTracks, note, timeMs)
    }
  }

  const stableDetections = aggregateScoreInformedTracks([...perNoteTracks.values()], {
    stableFrameThreshold,
    chordType,
    rollMs,
    expectedOnsetMs,
    expectedMidis,
  })

  return {
    sampleRate,
    frameHopMs,
    fftSize,
    engine: ENGINE_ID,
    scorerVersion: SCORE_INFORMED_DEFAULTS.scorerVersion,
    frames,
    stableDetections,
    perNoteTracks: [...perNoteTracks.values()],
  }
}

/**
 * Replay a labeled clip with optional calibration prelude (timing shifted like V1).
 */
export function replayScoreInformedPolyphonyClip(samples, sampleRate, options = {}) {
  const {
    prependCalibrationPrelude = true,
    expectedMidis = [],
    chordType = null,
    rollMs = null,
    expectedOnsetMs = 0,
    ...replayOptions
  } = options

  if (!prependCalibrationPrelude || !samples?.length) {
    return {
      ...replayScoreInformedPolyphonySamples(samples, sampleRate, {
        expectedMidis,
        chordType,
        rollMs,
        expectedOnsetMs,
        ...replayOptions,
      }),
      clipStartMs: 0,
    }
  }

  const preludeLength = Math.floor(sampleRate * MIC_REPLAY_CALIBRATION_PRELUDE_SECONDS)
  const combined = new Float32Array(preludeLength + samples.length)
  fillCalibrationPrelude(combined, preludeLength)
  combined.set(samples, preludeLength)
  const clipStartMs = (preludeLength / sampleRate) * 1000

  const replay = replayScoreInformedPolyphonySamples(combined, sampleRate, {
    expectedMidis,
    chordType,
    rollMs,
    expectedOnsetMs,
    minAnalysisTimeMs: clipStartMs,
    ...replayOptions,
  })

  return {
    ...replay,
    clipStartMs,
    frames: shiftClipRelativeFrames(replay.frames, clipStartMs, replay.frameHopMs),
    stableDetections: shiftClipRelativeDetections(
      replay.stableDetections,
      clipStartMs,
      replay.frameHopMs,
    ),
    perNoteTracks: shiftClipRelativeTracks(replay.perNoteTracks, clipStartMs, replay.frameHopMs),
  }
}
