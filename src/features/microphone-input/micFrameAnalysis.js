import {
  detectPitchAutocorrelation,
  frequencyToMidi,
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
import { classifyMicSignalShape } from './micSignalShape.js'
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
  const { centsTolerance = 35, gateOptions = null } = options

  // Single pass over the raw window: energy, peak, zero crossings, and a
  // high-frequency energy proxy (first-difference energy). Cheap features that
  // let us tell a sustained tone from a plucky attack or a bright/distorted or
  // broadband-noisy signal without an FFT.
  let sumSquares = 0
  let peak = 0
  let zeroCrossings = 0
  let diffSquares = 0
  let previous = samples[0] ?? 0
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]
    sumSquares += value * value
    const magnitude = value < 0 ? -value : value
    if (magnitude > peak) {
      peak = magnitude
    }
    if (index > 0) {
      if ((value >= 0) !== (previous >= 0)) {
        zeroCrossings += 1
      }
      const delta = value - previous
      diffSquares += delta * delta
    }
    previous = value
  }
  const rms = Math.sqrt(sumSquares / samples.length)
  const crestFactor = rms > 0 ? peak / rms : 0
  const zeroCrossingRate = samples.length > 1 ? zeroCrossings / (samples.length - 1) : 0
  const spectralEnergy = sumSquares > 0 ? diffSquares / sumSquares : 0

  const filtered = new Float32Array(samples)
  highPassInPlace(filtered)

  let filteredRms = 0
  for (let index = 0; index < filtered.length; index += 1) {
    filteredRms += filtered[index] * filtered[index]
  }
  filteredRms = Math.sqrt(filteredRms / filtered.length)

  const pitch = detectPitchAutocorrelation(samples, sampleRate)
  const note = pitchToMidiNote(pitch, { centsTolerance })
  const midiFloat = note?.midiFloat ?? frequencyToMidi(pitch?.frequency)
  const hasPitch = note?.midi != null
  const clarity = note?.clarity ?? pitch?.clarity ?? 0

  const isQuietFrame = !hasPitch && filteredRms < (noiseFloorTracker?.floor ?? 0.006) * 4
  const noiseFloor = updateNoiseFloor(noiseFloorTracker, filteredRms, isQuietFrame)
  const gateOpen = passesNoiseGate(filteredRms, noiseFloor, gateOptions)

  const signalShape = classifyMicSignalShape({
    rms,
    clarity,
    hasPitch,
    crestFactor,
    zeroCrossingRate,
    spectralEnergy,
  })

  const signalQuality = classifyMicSignalQuality({
    rms,
    clarity,
    passesGate: gateOpen,
    hasPitch,
    stabilizerPending: options.stabilizerPending ?? false,
    signalShape,
  })

  const level = Math.min(1, rms / 0.22)

  return {
    rms,
    filteredRms,
    level,
    noiseFloor,
    gateOpen,
    peak,
    crestFactor,
    zeroCrossingRate,
    spectralEnergy,
    signalShape,
    pitch,
    frequency: pitch?.frequency ?? null,
    midiFloat: midiFloat ?? null,
    midi: note?.midi ?? null,
    centsOffset: note?.centsOffset ?? null,
    noteLabel: note?.midi != null ? midiToNoteLabel(note.midi) : null,
    clarity,
    clarityPercent: clarityPercent(clarity),
    signalQuality,
    signalLabel: MIC_SIGNAL_QUALITY_LABELS[signalQuality] ?? 'Listening…',
  }
}

export function createMicFrameAnalyzer() {
  return {
    noiseFloor: createNoiseFloorTracker(),
  }
}
