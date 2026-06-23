/**
 * Run: node scripts/test-pitch-detection.mjs
 */
import {
  detectPitchAutocorrelation,
  pitchToMidiNote,
  quantizeMidi,
} from '../src/features/microphone-input/pitchDetection.js'
import { pushStableNote, createNoteStabilizer } from '../src/features/microphone-input/noteStabilizer.js'
import {
  evaluateMicNoteInput,
  getMicChordMatchTargets,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { MIC_CHORD_MODES, normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { passesNoiseGate } from '../src/features/microphone-input/micNoiseGate.js'
import {
  createMicCalibration,
  pushCalibrationSample,
  finalizeMicCalibration,
  MIC_CALIBRATION_STATUS,
} from '../src/features/microphone-input/micCalibration.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function synthSine(frequency, sampleRate, durationSeconds) {
  const length = Math.floor(sampleRate * durationSeconds)
  const buffer = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    buffer[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.35
  }
  return buffer
}

function synthHarmonicTone(fundamental, harmonics, sampleRate, durationSeconds) {
  const length = Math.floor(sampleRate * durationSeconds)
  const buffer = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    let sample = 0
    for (const { multiple, amplitude } of harmonics) {
      sample +=
        Math.sin((2 * Math.PI * fundamental * multiple * index) / sampleRate) *
        amplitude
    }
    buffer[index] = sample
  }
  return buffer
}

function synthSilence(sampleRate, durationSeconds) {
  return new Float32Array(Math.floor(sampleRate * durationSeconds))
}

const sampleRate = 44100
const a4 = synthSine(440, sampleRate, 0.25)
const pitch = detectPitchAutocorrelation(a4, sampleRate)
assert(pitch, 'should detect A4')
const note = pitchToMidiNote(pitch)
assert(note?.midi === 69, `expected A4 midi 69 got ${note?.midi}`)

const harmonicA3 = synthHarmonicTone(
  220,
  [
    { multiple: 1, amplitude: 0.12 },
    { multiple: 2, amplitude: 0.35 },
  ],
  sampleRate,
  0.25,
)
const harmonicPitch = detectPitchAutocorrelation(harmonicA3, sampleRate)
const harmonicNote = pitchToMidiNote(harmonicPitch, { minClarity: 0.12, centsTolerance: 50 })
assert(harmonicNote?.midi === 57, `expected harmonic-heavy A3 midi 57 got ${harmonicNote?.midi}`)

const stabilizer = createNoteStabilizer({
  holdFrames: 4,
  minClarity: 0.35,
  minSilenceFrames: 4,
  minSameNoteGapMs: 0,
  minRms: 0.005,
})
let emitted = null
for (let frame = 0; frame < 8; frame += 1) {
  const value = pushStableNote(stabilizer, { midi: 60, clarity: 0.9, rms: 0.1 })
  if (value != null) {
    emitted = value
  }
}
assert(emitted === 60, 'stabilizer should emit after hold frames')

const stabilizer2 = createNoteStabilizer({
  holdFrames: 3,
  minClarity: 0.35,
  minSilenceFrames: 3,
  minSameNoteGapMs: 0,
  minRms: 0.005,
})
let first = null
let second = null
for (let frame = 0; frame < 6; frame += 1) {
  const v = pushStableNote(stabilizer2, { midi: 60, clarity: 0.9, rms: 0.1 })
  if (v != null) first = v
}
for (let frame = 0; frame < 4; frame += 1) {
  pushStableNote(stabilizer2, { midi: null, clarity: 0, rms: 0 })
}
for (let frame = 0; frame < 6; frame += 1) {
  const v = pushStableNote(stabilizer2, { midi: 60, clarity: 0.9, rms: 0.1 })
  if (v != null) second = v
}
assert(first === 60 && second === 60, 'same note should re-emit after silence gap')

const checkpoint = {
  isChord: true,
  expectedMidis: [60, 64, 67],
}
const match = evaluateMicNoteInput(checkpoint, 64, {
  transpositionOffset: 0,
  allowOctaveMistakes: false,
  micChordMode: MIC_CHORD_MODES.ANY_TONE,
})
assert(match.outcome === MATCH_OUTCOME.COMPLETE, 'mic chord accepts one matching pitch')

const bassTargets = getMicChordMatchTargets(checkpoint, { micChordMode: MIC_CHORD_MODES.BASS })
assert(bassTargets.expected[0] === 60, 'bass mode picks lowest tone')

assert(passesNoiseGate(0.02, 0.006), 'noise gate opens for strong signal')

// Cents tolerance: 40 cents sharp is rejected at ±30, accepted at ±50.
assert(quantizeMidi(60.4, 30) === null, 'cents tolerance rejects 40c at ±30')
assert(quantizeMidi(60.4, 50) === 60, 'cents tolerance accepts 40c at ±50')
assert(normalizeMatchSettings({}).micCentsTolerance === 30, 'default mic cents tolerance is 30')

// Unstable jumping pitch is rejected (never holds a single pitch).
const unstable = createNoteStabilizer({ holdFrames: 4, minClarity: 0.35, minRms: 0.005, attackFrames: 1 })
let unstableEmitted = null
for (let frame = 0; frame < 12; frame += 1) {
  const v = pushStableNote(unstable, { midi: frame % 2 === 0 ? 60 : 67, clarity: 0.9, rms: 0.1 })
  if (v != null) unstableEmitted = v
}
assert(unstableEmitted === null, 'unstable pitch must not emit a note')

// A transient octave glitch on a building candidate is suppressed.
const octave = createNoteStabilizer({ holdFrames: 5, minClarity: 0.35, minRms: 0.005, attackFrames: 1 })
let octaveEmitted = null
for (const midi of [60, 60, 72, 60, 60, 60, 60]) {
  const v = pushStableNote(octave, { midi, clarity: 0.9, rms: 0.1 })
  if (v != null) octaveEmitted = v
}
assert(octaveEmitted === 60, 'octave glitch suppressed; candidate stays 60')

// Octave error is rejected by matching when octave mistakes are off.
const octaveMatch = evaluateMicNoteInput({ expectedMidi: 60 }, 72, normalizeMatchSettings({}))
assert(octaveMatch.outcome === MATCH_OUTCOME.WRONG, 'octave error rejected by matching')

// Calibration: quiet room ready; noisy room flagged with a higher gate.
function calibrate(value, n = 45) {
  const state = createMicCalibration({ frames: n })
  for (let i = 0; i < n; i += 1) pushCalibrationSample(state, value)
  return finalizeMicCalibration(state)
}
const quietCal = calibrate(0.004)
const noisyCal = calibrate(0.05)
assert(quietCal.status === MIC_CALIBRATION_STATUS.READY, 'quiet room calibrates ready')
assert(quietCal.gateThreshold > quietCal.noiseFloor, 'gate sits above the noise floor')
assert(noisyCal.status === MIC_CALIBRATION_STATUS.ROOM_NOISY, 'noisy room flagged')
assert(noisyCal.gateThreshold > quietCal.gateThreshold, 'noisy room raises the gate')
assert(calibrate(0).status === MIC_CALIBRATION_STATUS.NO_INPUT, 'dead mic reports no input')

console.log('pitch-detection: all checks passed')
