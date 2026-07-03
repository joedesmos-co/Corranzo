import {
  detectPitchAutocorrelation,
  pitchToMidiNote,
} from './pitchDetection.js'
import {
  createNoiseFloorTracker,
  passesNoiseGate,
  updateNoiseFloor,
} from './micNoiseGate.js'
import {
  classifyMicSignalQuality,
  clarityPercent,
  MIC_SIGNAL_QUALITY_LABELS,
} from './micSignalQuality.js'
import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'

/**
 * Light high-pass to reduce rumble / HVAC false triggers.
 */
function highPassInPlace(samples, coefficient = 0.995) {
  let previousInput = samples[0] ?? 0
  let previousOutput = 0
  for (let index = 0; index < samples.length; index += 1) {
    const input = samples[index]
    const output = coefficient * (previousOutput + input - previousInput)
    previousInput = input
    previousOutput = output
    samples[index] = output
  }
}

/**
 * Analyze one analyser frame for pitch, level, and user-facing quality.
 *
 * Pitch runs on the raw analyser window; a light high-pass copy is used only for
 * the noise floor and gate so rumble does not open the gate without affecting
 * autocorrelation on periodic tones.
 */
export function analyzeMicFrame(samples, sampleRate, noiseFloorTracker, options = {}) {
  if (!samples?.length || !sampleRate) {
    return null
  }
  const { centsTolerance = 35 } = options

  let rms = 0
  for (let index = 0; index < samples.length; index += 1) {
    rms += samples[index] * samples[index]
  }
  rms = Math.sqrt(rms / samples.length)

  const filtered = new Float32Array(samples)
  highPassInPlace(filtered)

  let filteredRms = 0
  for (let index = 0; index < filtered.length; index += 1) {
    filteredRms += filtered[index] * filtered[index]
  }
  filteredRms = Math.sqrt(filteredRms / filtered.length)

  const pitch = detectPitchAutocorrelation(samples, sampleRate)
  const note = pitchToMidiNote(pitch, { centsTolerance })
  const hasPitch = note?.midi != null

  const isQuietFrame = !hasPitch && filteredRms < (noiseFloorTracker?.floor ?? 0.006) * 4
  const noiseFloor = updateNoiseFloor(noiseFloorTracker, filteredRms, isQuietFrame)
  const gateOpen = passesNoiseGate(filteredRms, noiseFloor)

  const signalQuality = classifyMicSignalQuality({
    rms,
    clarity: note?.clarity ?? pitch?.clarity ?? 0,
    passesGate: gateOpen,
    hasPitch,
    stabilizerPending: options.stabilizerPending ?? false,
  })

  const level = Math.min(1, rms / 0.22)

  return {
    rms,
    filteredRms,
    level,
    noiseFloor,
    gateOpen,
    pitch,
    midi: note?.midi ?? null,
    centsOffset: note?.centsOffset ?? null,
    noteLabel: note?.midi != null ? midiToNoteLabel(note.midi) : null,
    clarity: note?.clarity ?? pitch?.clarity ?? 0,
    clarityPercent: clarityPercent(note?.clarity ?? pitch?.clarity ?? 0),
    signalQuality,
    signalLabel: MIC_SIGNAL_QUALITY_LABELS[signalQuality] ?? 'Listening…',
  }
}

export function createMicFrameAnalyzer() {
  return {
    noiseFloor: createNoiseFloorTracker(),
  }
}
