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
function highPassInPlace(samples, strength = 0.965) {
  let previous = 0
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]
    const filtered = value - previous * strength
    previous = value
    samples[index] = filtered
  }
}

/**
 * Analyze one analyser frame for pitch, level, and user-facing quality.
 */
export function analyzeMicFrame(samples, sampleRate, noiseFloorTracker) {
  if (!samples?.length || !sampleRate) {
    return null
  }

  highPassInPlace(samples)

  let rms = 0
  for (let index = 0; index < samples.length; index += 1) {
    rms += samples[index] * samples[index]
  }
  rms = Math.sqrt(rms / samples.length)

  const pitch = detectPitchAutocorrelation(samples, sampleRate)
  const note = pitchToMidiNote(pitch)
  const hasPitch = note?.midi != null

  const isQuietFrame = !hasPitch && rms < (noiseFloorTracker?.floor ?? 0.006) * 4
  const noiseFloor = updateNoiseFloor(noiseFloorTracker, rms, isQuietFrame)
  const gateOpen = passesNoiseGate(rms, noiseFloor)

  const signalQuality = classifyMicSignalQuality({
    rms,
    clarity: note?.clarity ?? pitch?.clarity ?? 0,
    passesGate: gateOpen,
    hasPitch,
  })

  const level = Math.min(1, rms / 0.22)

  return {
    rms,
    level,
    noiseFloor,
    gateOpen,
    pitch,
    midi: note?.midi ?? null,
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
