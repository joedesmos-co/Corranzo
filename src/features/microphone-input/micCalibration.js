/**
 * Quick automatic microphone calibration.
 *
 * When the mic starts the user is not yet playing, so we sample ~1s of the room
 * to measure the noise floor and overall input level, then derive an automatic
 * gate / minimum-RMS threshold and a plain-language status. Pure + testable —
 * no audio APIs here, just RMS numbers in, calibration out.
 */

export const MIC_CALIBRATION_STATUS = {
  IDLE: 'idle',
  MEASURING: 'measuring',
  READY: 'ready',
  ROOM_NOISY: 'room-noisy',
  NO_INPUT: 'no-input',
}

export const MIC_CALIBRATION_STATUS_LABELS = {
  [MIC_CALIBRATION_STATUS.IDLE]: 'Mic not calibrated',
  [MIC_CALIBRATION_STATUS.MEASURING]: 'Calibrating… (stay quiet a moment)',
  [MIC_CALIBRATION_STATUS.READY]: 'Mic ready',
  [MIC_CALIBRATION_STATUS.ROOM_NOISY]: 'Room is noisy — play a bit louder or move closer',
  [MIC_CALIBRATION_STATUS.NO_INPUT]: 'No input detected — check the mic is unmuted',
}

const ABS_MIN_GATE = 0.012
const ABS_MAX_GATE = 0.1
const NOISY_FLOOR = 0.03
const MODERATE_FLOOR = 0.012

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function percentile(sortedAscending, p) {
  if (sortedAscending.length === 0) {
    return 0
  }
  const index = clamp(Math.round((sortedAscending.length - 1) * p), 0, sortedAscending.length - 1)
  return sortedAscending[index]
}

/**
 * @param {number} frames  How many RMS samples to collect (~one per analyser
 *   frame). ~45 ≈ 0.75–1s at typical RAF rates.
 */
export function createMicCalibration({ frames = 45 } = {}) {
  return {
    samples: [],
    frames: Math.max(8, Math.round(frames)),
    done: false,
  }
}

/** Feed one frame's RMS. Returns { progress, done }. */
export function pushCalibrationSample(state, rms) {
  if (!state || state.done) {
    return { progress: 1, done: true }
  }
  if (Number.isFinite(rms) && rms >= 0) {
    state.samples.push(rms)
  }
  if (state.samples.length >= state.frames) {
    state.done = true
  }
  return { progress: clamp(state.samples.length / state.frames, 0, 1), done: state.done }
}

/**
 * Derive thresholds + status from the collected room samples.
 * - noiseFloor: median room RMS (robust to a stray sound during calibration)
 * - gateThreshold: a note must clearly exceed the floor to register
 * - recommendedMinRms: minimum RMS the stabilizer should require
 */
export function finalizeMicCalibration(state) {
  const samples = [...(state?.samples ?? [])].sort((a, b) => a - b)
  if (samples.length < 4) {
    return {
      noiseFloor: 0.006,
      loudness: 0,
      gateThreshold: ABS_MIN_GATE,
      recommendedMinRms: 0.01,
      roomQuality: 'unknown',
      status: MIC_CALIBRATION_STATUS.MEASURING,
      ready: false,
    }
  }

  const noiseFloor = percentile(samples, 0.5)
  const loudness = percentile(samples, 0.95)

  const gateThreshold = clamp(Math.max(noiseFloor * 3 + 0.004, ABS_MIN_GATE), ABS_MIN_GATE, ABS_MAX_GATE)
  const recommendedMinRms = clamp(Math.max(noiseFloor * 2, 0.008), 0.008, 0.08)

  let roomQuality = 'quiet'
  if (noiseFloor >= NOISY_FLOOR) {
    roomQuality = 'noisy'
  } else if (noiseFloor >= MODERATE_FLOOR) {
    roomQuality = 'moderate'
  }

  let status = MIC_CALIBRATION_STATUS.READY
  if (loudness < 0.0009) {
    // Essentially no signal across the whole window — mic likely muted/dead.
    status = MIC_CALIBRATION_STATUS.NO_INPUT
  } else if (roomQuality === 'noisy') {
    status = MIC_CALIBRATION_STATUS.ROOM_NOISY
  }

  return {
    noiseFloor,
    loudness,
    gateThreshold,
    recommendedMinRms,
    roomQuality,
    status,
    ready: status !== MIC_CALIBRATION_STATUS.NO_INPUT,
  }
}
