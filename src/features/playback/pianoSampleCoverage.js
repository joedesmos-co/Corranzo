/**
 * Salamander-lite keyboard coverage helpers (Audio Rendering Sprint 1).
 * Reports nearest-sample selection and transposition distance — does not
 * change how Tone.Sampler maps pitches at runtime.
 */

import { PIANO_SAMPLE_URLS } from './pianoInstrument.js'

const NOTE_TO_PC = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
}

/** Reasonable pitch-shift limit for natural-sounding piano samples (semitones). */
export const MAX_REASONABLE_TRANSPOSE_SEMITONES = 1.5

export function midiFromNoteName(name) {
  const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(String(name ?? '').trim())
  if (!match) {
    return null
  }
  const pc = NOTE_TO_PC[match[1]]
  if (pc == null) {
    return null
  }
  const octave = Number(match[2])
  return (octave + 1) * 12 + pc
}

export function noteNameFromMidi(midi) {
  if (!Number.isFinite(midi)) {
    return null
  }
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const rounded = Math.round(midi)
  const octave = Math.floor(rounded / 12) - 1
  return `${names[((rounded % 12) + 12) % 12]}${octave}`
}

export function listPianoSampleMidiPitches(urls = PIANO_SAMPLE_URLS) {
  return Object.keys(urls)
    .map((name) => ({ name, midi: midiFromNoteName(name) }))
    .filter((entry) => entry.midi != null)
    .sort((a, b) => a.midi - b.midi)
}

/**
 * Nearest recorded sample for a MIDI pitch (mirrors Tone.Sampler key selection).
 */
export function nearestPianoSample(midi, urls = PIANO_SAMPLE_URLS) {
  const samples = listPianoSampleMidiPitches(urls)
  if (!samples.length || !Number.isFinite(midi)) {
    return null
  }
  let best = samples[0]
  let bestDist = Math.abs(samples[0].midi - midi)
  for (const sample of samples.slice(1)) {
    const dist = Math.abs(sample.midi - midi)
    if (dist < bestDist) {
      best = sample
      bestDist = dist
    }
  }
  return {
    sampleName: best.name,
    sampleMidi: best.midi,
    targetMidi: midi,
    transposeSemitones: midi - best.midi,
    withinReasonableLimit: bestDist <= MAX_REASONABLE_TRANSPOSE_SEMITONES + 1e-9,
  }
}

/** Full 88-key piano (A0–C8) coverage report for the lite sample map. */
export function reportPianoKeyboardCoverage(urls = PIANO_SAMPLE_URLS) {
  const missing = []
  const extremeTranspose = []
  let covered = 0
  for (let midi = 21; midi <= 108; midi += 1) {
    const nearest = nearestPianoSample(midi, urls)
    if (!nearest) {
      missing.push(midi)
      continue
    }
    covered += 1
    if (!nearest.withinReasonableLimit) {
      extremeTranspose.push(nearest)
    }
  }
  return {
    sampleCount: Object.keys(urls).length,
    midiLow: 21,
    midiHigh: 108,
    coveredCount: covered,
    missingMidi: missing,
    extremeTranspose,
    maxTransposeSemitones: MAX_REASONABLE_TRANSPOSE_SEMITONES,
  }
}
