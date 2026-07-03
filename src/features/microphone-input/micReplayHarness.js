import { analyzeMicFrame, createMicFrameAnalyzer } from './micFrameAnalysis.js'
import {
  applyMicCalibrationToStabilizer,
  createMicCalibration,
  finalizeMicCalibration,
  pushCalibrationSample,
  shouldAcceptCalibrationSample,
} from './micCalibration.js'
import { createNoteStabilizer, pushStableNote } from './noteStabilizer.js'

/** Matches live AnalyserNode configuration in useMicrophoneCapture. */
export const MIC_REPLAY_FFT_SIZE = 2048

/** Approximate browser rAF cadence used by usePitchDetector. */
export const MIC_REPLAY_FRAME_HOP_MS = 1000 / 60

export const MIC_REPLAY_CALIBRATION_FRAMES = 45

/** Quiet lead-in so all calibration frames finish before the labeled clip. */
export const MIC_REPLAY_CALIBRATION_PRELUDE_SECONDS = 0.95

function fillCalibrationPrelude(buffer, length, seed = 17) {
  let state = seed >>> 0
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    buffer[index] = ((state / 0x7fffffff) * 2 - 1) * 0.0035
  }
}

export function frameHopSamples(sampleRate, frameHopMs = MIC_REPLAY_FRAME_HOP_MS) {
  return Math.max(1, Math.round(sampleRate * (frameHopMs / 1000)))
}

/**
 * Offline replay of the live mic pipeline: calibration → analyzeMicFrame → stabilizer.
 * Does not touch Wait For You matching.
 */
export function replayMicSamples(samples, sampleRate, options = {}) {
  const {
    fftSize = MIC_REPLAY_FFT_SIZE,
    frameHopMs = MIC_REPLAY_FRAME_HOP_MS,
    centsTolerance = 35,
    calibrationFrames = MIC_REPLAY_CALIBRATION_FRAMES,
    skipCalibration = false,
  } = options

  if (!samples?.length || !sampleRate) {
    return {
      sampleRate,
      frameHopMs,
      fftSize,
      calibration: null,
      frames: [],
      stableDetections: [],
    }
  }

  const hop = frameHopSamples(sampleRate, frameHopMs)
  const analyzer = createMicFrameAnalyzer()
  const stabilizer = createNoteStabilizer()
  const calibration = skipCalibration ? null : createMicCalibration({ frames: calibrationFrames })
  let calibrationResult = null

  const frames = []
  const stableDetections = []

  for (let end = fftSize; end <= samples.length; end += hop) {
    const timeMs = ((end - fftSize) / sampleRate) * 1000
    const window = samples.subarray(end - fftSize, end)
    const frameBuffer = new Float32Array(window)
    const frame = analyzeMicFrame(frameBuffer, sampleRate, analyzer.noiseFloor, {
      centsTolerance,
    })

    if (!frame) {
      continue
    }

    if (calibration && !calibration.done) {
      const calibrationRms = frame.filteredRms ?? frame.rms
      const acceptSample = shouldAcceptCalibrationSample({
        rms: calibrationRms,
        gateOpen: frame.gateOpen,
        hasPitch: frame.midi != null,
      })
      const { done } = pushCalibrationSample(calibration, calibrationRms, { acceptSample })
      if (done) {
        calibrationResult = finalizeMicCalibration(calibration)
        analyzer.noiseFloor.floor = calibrationResult.noiseFloor
        applyMicCalibrationToStabilizer(stabilizer, calibrationResult)
      }
      continue
    }

    if (calibration && !calibrationResult) {
      continue
    }

    frames.push({
      timeMs,
      midi: frame.midi,
      clarity: frame.clarity,
      centsOffset: frame.centsOffset,
      rms: frame.rms,
      gateOpen: frame.gateOpen,
    })

    const stableMidi = pushStableNote(stabilizer, {
      midi: frame.midi,
      clarity: frame.clarity,
      rms: frame.rms,
      now: timeMs,
    })

    if (stableMidi != null) {
      stableDetections.push({
        midi: stableMidi,
        timeMs,
        clarity: frame.clarity,
        centsOffset: frame.centsOffset,
        rms: frame.rms,
      })
    }
  }

  return {
    sampleRate,
    frameHopMs,
    fftSize,
    calibration: calibrationResult,
    frames,
    stableDetections,
  }
}

/**
 * Replay a labeled clip with optional silent calibration prelude (default on).
 * Detection times are shifted so t=0 is the start of `samples`.
 */
export function replayMicClip(samples, sampleRate, options = {}) {
  const { prependCalibrationPrelude = true, ...replayOptions } = options

  if (!prependCalibrationPrelude || !samples?.length) {
    return { ...replayMicSamples(samples, sampleRate, replayOptions), clipStartMs: 0 }
  }

  const preludeLength = Math.floor(sampleRate * MIC_REPLAY_CALIBRATION_PRELUDE_SECONDS)
  const combined = new Float32Array(preludeLength + samples.length)
  fillCalibrationPrelude(combined, preludeLength)
  combined.set(samples, preludeLength)
  const clipStartMs = (preludeLength / sampleRate) * 1000

  const replay = replayMicSamples(combined, sampleRate, replayOptions)

  return {
    ...replay,
    clipStartMs,
    frames: replay.frames
      .filter((frame) => frame.timeMs >= clipStartMs)
      .map((frame) => ({ ...frame, timeMs: frame.timeMs - clipStartMs })),
    stableDetections: replay.stableDetections
      .filter((detection) => detection.timeMs >= clipStartMs)
      .map((detection) => ({ ...detection, timeMs: detection.timeMs - clipStartMs })),
  }
}
