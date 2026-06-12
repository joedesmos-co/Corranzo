/**
 * Run: node scripts/test-pitch-detection.mjs
 */
import {
  detectPitchAutocorrelation,
  pitchToMidiNote,
} from '../src/features/microphone-input/pitchDetection.js'
import { pushStableNote, createNoteStabilizer } from '../src/features/microphone-input/noteStabilizer.js'
import {
  evaluateMicNoteInput,
  getMicChordMatchTargets,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { MIC_CHORD_MODES } from '../src/features/practice/waitForYouMatchSettings.js'
import { passesNoiseGate } from '../src/features/microphone-input/micNoiseGate.js'

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

function synthSilence(sampleRate, durationSeconds) {
  return new Float32Array(Math.floor(sampleRate * durationSeconds))
}

const sampleRate = 44100
const a4 = synthSine(440, sampleRate, 0.25)
const pitch = detectPitchAutocorrelation(a4, sampleRate)
assert(pitch, 'should detect A4')
const note = pitchToMidiNote(pitch)
assert(note?.midi === 69, `expected A4 midi 69 got ${note?.midi}`)

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

console.log('pitch-detection: all checks passed')
