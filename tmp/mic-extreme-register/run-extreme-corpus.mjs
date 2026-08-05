import fs from 'node:fs/promises'

import { analyzeMicFrame, createMicFrameAnalyzer } from '../../src/features/microphone-input/micFrameAnalysis.js'
import { getMicInstrumentProfile } from '../../src/features/microphone-input/micInstrumentProfiles.js'
import { midiToFrequency } from '../../src/features/microphone-input/micSyntheticClips.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
  resetMicEngineV2RuntimeState,
} from '../../src/features/microphone-input/v2/micEngineV2Live.js'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  getMicAttackRearmReason,
  markMicAttackConsumed,
  rearmMicAttackLatch,
  updateMicAttackRelease,
} from '../../src/features/practice/micAttackLatch.js'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  frameConfidentForMatch,
  frameCorroboratesSingleNote,
  micConfirmFramesForExpectedMidis,
  pitchCentsForMicConfirmation,
  resetMatchConfirmState,
} from '../../src/features/practice/micMatchConfirm.js'
import { isMusicalMicFrame, micMusicalRejectReason } from '../../src/features/practice/micMusicalAcceptance.js'
import { evaluateMicScoreInformedInput, MATCH_OUTCOME } from '../../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../../src/features/practice/waitForYouMatchSettings.js'

const SAMPLE_RATE = 44100
const FRAME_SIZE = 2048
const HOP_SAMPLES = Math.round(SAMPLE_RATE / 60)
const HOP_MS = HOP_SAMPLES / SAMPLE_RATE * 1000
const OUTPUT_DIR = new URL('./', import.meta.url)
const OUTPUT_NAME = process.env.MIC_CORPUS_OUTPUT ?? 'extreme_mic_baseline.json'
const CAPTURE_HISTORY_SIZE = 8192

const DEFAULT_HARMONICS = [1, 0.62, 0.36, 0.21, 0.13, 0.08]
const WEAK_H1_STRONG_H2 = [0.1, 1, 0.42, 0.22, 0.12, 0.07]
const WEAK_H1_STRONG_H3 = [0.09, 0.4, 1, 0.24, 0.13, 0.07]
const HIGH_WEAK_H1 = [0.16, 1, 0.52, 0.24, 0.1, 0.04]
const BRIGHT = [0.62, 1, 0.6, 0.35, 0.2, 0.12]

function round(value, digits = 5) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
}

function seededNoise(seed = 1) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

function registerForMidi(midi) {
  if (midi <= 32) return 'extreme-low'
  if (midi <= 47) return 'low'
  if (midi <= 72) return 'middle'
  if (midi <= 95) return 'high'
  return 'extreme-high'
}

function noteEvent(onsetSec, midi, options = {}) {
  return { onsetSec, midi, scoreEvent: options.scoreEvent !== false, ...options }
}

function scoreEvent(onsetSec, midi) {
  return { onsetSec, midi }
}

function singleFixture(midi) {
  const amplitude = midi <= 32 ? 0.34 : midi >= 96 ? 0.18 : 0.24
  return {
    id: `range-midi-${String(midi).padStart(3, '0')}`,
    title: `Full-range individual MIDI ${midi}`,
    tags: ['individual', 'full-range', registerForMidi(midi)],
    durationSec: 0.78,
    events: [noteEvent(0.14, midi, { amplitude, durationSec: 0.56 })],
    scoreEvents: [scoreEvent(0.14, midi)],
    expectedAdvanceCount: 1,
  }
}

const FIXTURES = [
  ...Array.from({ length: 88 }, (_, index) => singleFixture(21 + index)),
  {
    id: 'soft-extreme-low', title: 'Soft A0', tags: ['soft', 'extreme-low'], durationSec: 1.15,
    events: [noteEvent(0.18, 21, { amplitude: 0.055, attackNoise: 0.012 })],
    scoreEvents: [scoreEvent(0.18, 21)], expectedAdvanceCount: 1,
  },
  {
    id: 'very-soft-extreme-low', title: 'Very soft A0 near the calibrated room floor', tags: ['soft', 'extreme-low'], durationSec: 1.2,
    events: [noteEvent(0.18, 21, { amplitude: 0.026, attackNoise: 0.006, decay: 0.55 })],
    scoreEvents: [scoreEvent(0.18, 21)], expectedAdvanceCount: 1, roomNoise: 0.0028,
  },
  {
    id: 'soft-weak-h1-a0-with-hum', title: 'Soft weak-fundamental A0 with 60 Hz hum', tags: ['soft', 'weak-fundamental', 'hum', 'extreme-low'], durationSec: 1.2,
    events: [noteEvent(0.18, 21, { amplitude: 0.09, attackNoise: 0.009, harmonics: WEAK_H1_STRONG_H2 })],
    scoreEvents: [scoreEvent(0.18, 21)], expectedAdvanceCount: 1, roomNoise: 0.005,
    hum: [{ hz: 60, amplitude: 0.012 }, { hz: 120, amplitude: 0.0035 }],
  },
  {
    id: 'short-soft-extreme-low', title: 'Short soft A0 attack', tags: ['soft', 'staccato', 'extreme-low'], durationSec: 0.78,
    events: [noteEvent(0.15, 21, { amplitude: 0.065, attackNoise: 0.012, durationSec: 0.105, decay: 4.5 })],
    scoreEvents: [scoreEvent(0.15, 21)], expectedAdvanceCount: 1, roomNoise: 0.0025,
  },
  {
    id: 'soft-extreme-high', title: 'Soft C8', tags: ['soft', 'extreme-high'], durationSec: 0.95,
    events: [noteEvent(0.16, 108, { amplitude: 0.045, attackNoise: 0.01, decay: 1.7 })],
    scoreEvents: [scoreEvent(0.16, 108)], expectedAdvanceCount: 1,
  },
  {
    id: 'loud-extreme-low', title: 'Loud A0', tags: ['loud', 'extreme-low'], durationSec: 1.1,
    events: [noteEvent(0.16, 21, { amplitude: 0.72, attackNoise: 0.06 })],
    scoreEvents: [scoreEvent(0.16, 21)], expectedAdvanceCount: 1,
  },
  {
    id: 'loud-extreme-high', title: 'Loud C8', tags: ['loud', 'extreme-high'], durationSec: 0.9,
    events: [noteEvent(0.14, 108, { amplitude: 0.58, attackNoise: 0.04 })],
    scoreEvents: [scoreEvent(0.14, 108)], expectedAdvanceCount: 1,
  },
  {
    id: 'staccato-extreme-low', title: 'Staccato A0', tags: ['staccato', 'extreme-low'], durationSec: 0.9,
    events: [noteEvent(0.16, 21, { amplitude: 0.36, durationSec: 0.16, decay: 3.5 })],
    scoreEvents: [scoreEvent(0.16, 21)], expectedAdvanceCount: 1,
  },
  {
    id: 'staccato-extreme-high', title: 'Staccato C8', tags: ['staccato', 'extreme-high'], durationSec: 0.72,
    events: [noteEvent(0.14, 108, { amplitude: 0.26, durationSec: 0.095, decay: 6 })],
    scoreEvents: [scoreEvent(0.14, 108)], expectedAdvanceCount: 1,
  },
  {
    id: 'sustained-extreme-low-once', title: 'Sustained A0 must not satisfy a later A0', tags: ['sustain', 'extreme-low'], durationSec: 1.75,
    events: [noteEvent(0.14, 21, { amplitude: 0.35, durationSec: 1.5, decay: 0.08 })],
    scoreEvents: [scoreEvent(0.14, 21), scoreEvent(0.76, 21)], expectedAdvanceCount: 1,
  },
  {
    id: 'sustained-extreme-high-once', title: 'Sustained C8 must not satisfy a later C8', tags: ['sustain', 'extreme-high'], durationSec: 1.25,
    events: [noteEvent(0.12, 108, { amplitude: 0.24, durationSec: 1.0, decay: 0.15 })],
    scoreEvents: [scoreEvent(0.12, 108), scoreEvent(0.58, 108)], expectedAdvanceCount: 1,
  },
  {
    id: 'repeated-extreme-low', title: 'Repeated A0 attacks', tags: ['repeat', 'extreme-low'], durationSec: 1.65,
    events: [noteEvent(0.14, 21, { amplitude: 0.38, decay: 0.48 }), noteEvent(0.78, 21, { amplitude: 0.16, attackNoise: 0.095, decay: 0.7 })],
    scoreEvents: [scoreEvent(0.14, 21), scoreEvent(0.78, 21)], expectedAdvanceCount: 2, compression: 2.2,
  },
  {
    id: 'repeated-extreme-high', title: 'Repeated C8 attacks', tags: ['repeat', 'extreme-high'], durationSec: 1.05,
    events: [noteEvent(0.12, 108, { amplitude: 0.28, decay: 1.6 }), noteEvent(0.5, 108, { amplitude: 0.15, attackNoise: 0.07, decay: 2.2 })],
    scoreEvents: [scoreEvent(0.12, 108), scoreEvent(0.5, 108)], expectedAdvanceCount: 2, compression: 1.8,
  },
  {
    id: 'neighboring-extreme-low', title: 'A0-B0 neighboring semitones', tags: ['neighbor', 'extreme-low'], durationSec: 1.55,
    events: [21, 22, 23].map((midi, i) => noteEvent(0.12 + i * 0.46, midi, { amplitude: i ? 0.22 : 0.36, durationSec: 0.34, decay: 1.2 })),
    scoreEvents: [21, 22, 23].map((midi, i) => scoreEvent(0.12 + i * 0.46, midi)), expectedAdvanceCount: 3,
  },
  {
    id: 'neighboring-extreme-high', title: 'Bb7-C8 neighboring semitones', tags: ['neighbor', 'extreme-high'], durationSec: 1.0,
    events: [106, 107, 108].map((midi, i) => noteEvent(0.1 + i * 0.28, midi, { amplitude: 0.23, durationSec: 0.2, decay: 3 })),
    scoreEvents: [106, 107, 108].map((midi, i) => scoreEvent(0.1 + i * 0.28, midi)), expectedAdvanceCount: 3,
  },
  {
    id: 'low-then-octave', title: 'A0 followed by A1', tags: ['octave-transition', 'extreme-low'], durationSec: 1.35,
    events: [noteEvent(0.14, 21, { amplitude: 0.36, durationSec: 0.5 }), noteEvent(0.76, 33, { amplitude: 0.25, durationSec: 0.46 })],
    scoreEvents: [scoreEvent(0.14, 21), scoreEvent(0.76, 33)], expectedAdvanceCount: 2,
  },
  {
    id: 'high-then-lower-octave', title: 'C8 followed by C7', tags: ['octave-transition', 'extreme-high'], durationSec: 1.0,
    events: [noteEvent(0.1, 108, { amplitude: 0.24, durationSec: 0.33 }), noteEvent(0.52, 96, { amplitude: 0.24, durationSec: 0.35 })],
    scoreEvents: [scoreEvent(0.1, 108), scoreEvent(0.52, 96)], expectedAdvanceCount: 2,
  },
  {
    id: 'low-weak-h1-strong-h2', title: 'A0 weak fundamental strong second harmonic', tags: ['weak-fundamental', 'extreme-low'], durationSec: 1.15,
    events: [noteEvent(0.16, 21, { amplitude: 0.34, harmonics: WEAK_H1_STRONG_H2 })],
    scoreEvents: [scoreEvent(0.16, 21)], expectedAdvanceCount: 1,
  },
  {
    id: 'low-weak-h1-strong-h3', title: 'A0 weak fundamental strong third harmonic', tags: ['weak-fundamental', 'extreme-low'], durationSec: 1.15,
    events: [noteEvent(0.16, 21, { amplitude: 0.34, harmonics: WEAK_H1_STRONG_H3 })],
    scoreEvents: [scoreEvent(0.16, 21)], expectedAdvanceCount: 1,
  },
  {
    id: 'high-weak-fundamental', title: 'C8 weak fundamental', tags: ['weak-fundamental', 'extreme-high'], durationSec: 0.9,
    events: [noteEvent(0.14, 108, { amplitude: 0.26, harmonics: HIGH_WEAK_H1 })],
    scoreEvents: [scoreEvent(0.14, 108)], expectedAdvanceCount: 1,
  },
  {
    id: 'high-with-lower-room-resonance', title: 'C8 with quiet C6 room resonance', tags: ['resonance', 'extreme-high'], durationSec: 1.0,
    events: [noteEvent(0.05, 84, { amplitude: 0.035, decay: 0.08, scoreEvent: false }), noteEvent(0.16, 108, { amplitude: 0.23 })],
    scoreEvents: [scoreEvent(0.16, 108)], expectedAdvanceCount: 1,
  },
  {
    id: 'low-with-50hz-hum', title: 'A0 with 50 Hz hum', tags: ['hum', 'extreme-low'], durationSec: 1.1,
    events: [noteEvent(0.16, 21, { amplitude: 0.34 })], scoreEvents: [scoreEvent(0.16, 21)], expectedAdvanceCount: 1,
    hum: [{ hz: 50, amplitude: 0.016 }, { hz: 100, amplitude: 0.005 }],
  },
  {
    id: 'low-with-60hz-hum', title: 'A0 with 60 Hz hum', tags: ['hum', 'extreme-low'], durationSec: 1.1,
    events: [noteEvent(0.16, 21, { amplitude: 0.34 })], scoreEvents: [scoreEvent(0.16, 21)], expectedAdvanceCount: 1,
    hum: [{ hz: 60, amplitude: 0.016 }, { hz: 120, amplitude: 0.005 }],
  },
  {
    id: 'high-with-broadband-noise', title: 'C8 with broadband noise', tags: ['noise', 'extreme-high'], durationSec: 0.95,
    events: [noteEvent(0.15, 108, { amplitude: 0.24 })], scoreEvents: [scoreEvent(0.15, 108)], expectedAdvanceCount: 1,
    roomNoise: 0.018,
  },
  {
    id: 'compressed-extreme-low', title: 'Compressed A0', tags: ['compression', 'extreme-low'], durationSec: 1.1,
    events: [noteEvent(0.15, 21, { amplitude: 0.52, harmonics: BRIGHT })], scoreEvents: [scoreEvent(0.15, 21)], expectedAdvanceCount: 1, compression: 3.4,
  },
  {
    id: 'compressed-extreme-high', title: 'Compressed C8', tags: ['compression', 'extreme-high'], durationSec: 0.9,
    events: [noteEvent(0.13, 108, { amplitude: 0.48, harmonics: BRIGHT })], scoreEvents: [scoreEvent(0.13, 108)], expectedAdvanceCount: 1, compression: 3.4,
  },
  {
    id: 'clipped-extreme-low', title: 'Mildly clipped A0', tags: ['clipping', 'extreme-low'], durationSec: 1.05,
    events: [noteEvent(0.14, 21, { amplitude: 0.68 })], scoreEvents: [scoreEvent(0.14, 21)], expectedAdvanceCount: 1, clip: 0.32,
  },
  {
    id: 'clipped-extreme-high', title: 'Mildly clipped C8', tags: ['clipping', 'extreme-high'], durationSec: 0.88,
    events: [noteEvent(0.12, 108, { amplitude: 0.55 })], scoreEvents: [scoreEvent(0.12, 108)], expectedAdvanceCount: 1, clip: 0.32,
  },
  {
    id: 'reverberant-extreme-low', title: 'Reverberant A0', tags: ['reverb', 'extreme-low'], durationSec: 1.3,
    events: [noteEvent(0.15, 21, { amplitude: 0.34 })], scoreEvents: [scoreEvent(0.15, 21)], expectedAdvanceCount: 1, reverb: true,
  },
  {
    id: 'reverberant-extreme-high', title: 'Reverberant C8', tags: ['reverb', 'extreme-high'], durationSec: 1.0,
    events: [noteEvent(0.13, 108, { amplitude: 0.24 })], scoreEvents: [scoreEvent(0.13, 108)], expectedAdvanceCount: 1, reverb: true,
  },
  {
    id: 'fast-extreme-low-passage', title: 'Fast A0-C1 passage', tags: ['fast', 'extreme-low'], durationSec: 1.15,
    events: [21, 22, 23, 24].map((midi, i) => noteEvent(0.1 + i * 0.23, midi, { amplitude: 0.32, durationSec: 0.17, decay: 3 })),
    scoreEvents: [21, 22, 23, 24].map((midi, i) => scoreEvent(0.1 + i * 0.23, midi)), expectedAdvanceCount: 4,
  },
  {
    id: 'very-fast-extreme-low-passage', title: 'Very fast A0-E1 passage over bass decay', tags: ['fast', 'extreme-low'], durationSec: 1.0,
    events: [21, 22, 23, 24, 25, 26, 27, 28].map((midi, i) => noteEvent(0.08 + i * 0.105, midi, { amplitude: i ? 0.17 : 0.34, attackNoise: 0.055, decay: 0.5 })) ,
    scoreEvents: [21, 22, 23, 24, 25, 26, 27, 28].map((midi, i) => scoreEvent(0.08 + i * 0.105, midi)), expectedAdvanceCount: 8, compression: 2.2,
  },
  {
    id: 'fast-extreme-high-passage', title: 'Fast G7-C8 passage', tags: ['fast', 'extreme-high'], durationSec: 0.9,
    events: [103, 104, 105, 106, 107, 108].map((midi, i) => noteEvent(0.08 + i * 0.12, midi, { amplitude: 0.24, durationSec: 0.085, decay: 7 })),
    scoreEvents: [103, 104, 105, 106, 107, 108].map((midi, i) => scoreEvent(0.08 + i * 0.12, midi)), expectedAdvanceCount: 6,
  },
  {
    id: 'slow-extreme-low-passage', title: 'Slow A0-B0 passage', tags: ['slow', 'extreme-low'], durationSec: 2.25,
    events: [21, 22, 23].map((midi, i) => noteEvent(0.14 + i * 0.7, midi, { amplitude: 0.32, durationSec: 0.48 })),
    scoreEvents: [21, 22, 23].map((midi, i) => scoreEvent(0.14 + i * 0.7, midi)), expectedAdvanceCount: 3,
  },
  {
    id: 'slow-extreme-high-passage', title: 'Slow Bb7-C8 passage', tags: ['slow', 'extreme-high'], durationSec: 1.75,
    events: [106, 107, 108].map((midi, i) => noteEvent(0.12 + i * 0.5, midi, { amplitude: 0.23, durationSec: 0.35 })),
    scoreEvents: [106, 107, 108].map((midi, i) => scoreEvent(0.12 + i * 0.5, midi)), expectedAdvanceCount: 3,
  },
  {
    id: 'wrong-octave-for-a0', title: 'A1 played while A0 is expected', tags: ['negative', 'wrong-octave', 'extreme-low'], durationSec: 1.05,
    events: [noteEvent(0.15, 33, { amplitude: 0.34 })], scoreEvents: [scoreEvent(0.15, 21)], expectedAdvanceCount: 0,
  },
  {
    id: 'wrong-octave-for-c8', title: 'C7 played while C8 is expected', tags: ['negative', 'wrong-octave', 'extreme-high'], durationSec: 0.9,
    events: [noteEvent(0.13, 96, { amplitude: 0.26 })], scoreEvents: [scoreEvent(0.13, 108)], expectedAdvanceCount: 0,
  },
  {
    id: 'harmonically-related-wrong-low', title: 'E2 played while A0 is expected', tags: ['negative', 'harmonic', 'extreme-low'], durationSec: 1.05,
    events: [noteEvent(0.15, 40, { amplitude: 0.34 })], scoreEvents: [scoreEvent(0.15, 21)], expectedAdvanceCount: 0,
  },
  {
    id: 'harmonically-related-wrong-high', title: 'C6 played while C8 is expected', tags: ['negative', 'harmonic', 'extreme-high'], durationSec: 0.95,
    events: [noteEvent(0.13, 84, { amplitude: 0.28 })], scoreEvents: [scoreEvent(0.13, 108)], expectedAdvanceCount: 0,
  },
  {
    id: 'low-to-high-transition', title: 'A0 to C8', tags: ['transition', 'extreme-low', 'extreme-high'], durationSec: 1.2,
    events: [noteEvent(0.12, 21, { amplitude: 0.36, durationSec: 0.43 }), noteEvent(0.64, 108, { amplitude: 0.25, durationSec: 0.4 })],
    scoreEvents: [scoreEvent(0.12, 21), scoreEvent(0.64, 108)], expectedAdvanceCount: 2,
  },
  {
    id: 'high-to-low-transition', title: 'C8 to A0', tags: ['transition', 'extreme-low', 'extreme-high'], durationSec: 1.35,
    events: [noteEvent(0.1, 108, { amplitude: 0.24, durationSec: 0.35 }), noteEvent(0.58, 21, { amplitude: 0.36, durationSec: 0.58 })],
    scoreEvents: [scoreEvent(0.1, 108), scoreEvent(0.58, 21)], expectedAdvanceCount: 2,
  },
  {
    id: 'hum-only-negative-low', title: '60 Hz hum must not satisfy A0', tags: ['negative', 'hum', 'extreme-low'], durationSec: 1.0,
    events: [], scoreEvents: [scoreEvent(0.12, 21)], expectedAdvanceCount: 0, roomNoise: 0.002,
    hum: [{ hz: 60, amplitude: 0.02 }, { hz: 120, amplitude: 0.006 }],
  },
  {
    id: 'noise-only-negative-high', title: 'Broadband noise must not satisfy C8', tags: ['negative', 'noise', 'extreme-high'], durationSec: 0.9,
    events: [], scoreEvents: [scoreEvent(0.1, 108)], expectedAdvanceCount: 0, roomNoise: 0.026,
  },
]

function addNote(buffer, event) {
  const start = Math.max(0, Math.floor(event.onsetSec * SAMPLE_RATE))
  const seconds = event.durationSec ?? Math.max(0, buffer.length / SAMPLE_RATE - event.onsetSec)
  const count = Math.min(buffer.length - start, Math.floor(seconds * SAMPLE_RATE))
  const f0 = midiToFrequency(event.midi)
  const harmonics = event.harmonics ?? DEFAULT_HARMONICS
  const harmonicTotal = harmonics.reduce((sum, value, index) =>
    f0 * (index + 1) < SAMPLE_RATE / 2 ? sum + Math.abs(value) : sum, 0) || 1
  const noise = seededNoise(9901 + event.midi * 31 + Math.round(event.onsetSec * 1000))
  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE
    const attack = 1 - Math.exp(-t * (event.attackRate ?? 210))
    const envelope = attack * Math.exp(-(event.decay ?? 0.72) * t)
    let tonal = 0
    for (let h = 0; h < harmonics.length; h += 1) {
      const multiple = h + 1
      const hz = f0 * multiple * (1 + 0.000035 * multiple * multiple)
      if (hz >= SAMPLE_RATE / 2) continue
      tonal += Math.sin(2 * Math.PI * hz * t + (event.phase ?? 0) * multiple) * harmonics[h]
    }
    const hammer = (noise() * 2 - 1) * (event.attackNoise ?? 0.035) * Math.exp(-t * 74)
    buffer[start + i] += (event.amplitude ?? 0.24) * (tonal / harmonicTotal * envelope + hammer)
  }
}

function renderFixture(definition) {
  const samples = new Float32Array(Math.ceil(definition.durationSec * SAMPLE_RATE))
  for (const event of definition.events) addNote(samples, event)
  const noise = seededNoise(7103 + definition.id.length * 17)
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / SAMPLE_RATE
    let extra = (noise() * 2 - 1) * (definition.roomNoise ?? 0.0022)
    for (const hum of definition.hum ?? []) extra += hum.amplitude * Math.sin(2 * Math.PI * hum.hz * t)
    samples[i] += extra
  }
  if (definition.reverb) {
    const dry = new Float32Array(samples)
    for (const [delaySec, gain] of [[0.043, 0.24], [0.089, 0.14], [0.151, 0.08]]) {
      const delay = Math.round(delaySec * SAMPLE_RATE)
      for (let i = delay; i < samples.length; i += 1) samples[i] += dry[i - delay] * gain
    }
  }
  if (definition.compression) {
    const norm = Math.tanh(definition.compression)
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.tanh(samples[i] * definition.compression) / norm
  }
  if (definition.clip) {
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.max(-definition.clip, Math.min(definition.clip, samples[i]))
  }
  return samples
}

function strongestHarmonic(note, expectedMidi) {
  const magnitudes = note?.harmonicMagnitudes ?? []
  let strongest = -1
  for (let i = 0; i < magnitudes.length; i += 1) {
    if (strongest < 0 || magnitudes[i] > magnitudes[strongest]) strongest = i
  }
  return strongest < 0 ? null : {
    multiple: strongest + 1,
    frequencyHz: round(midiToFrequency(expectedMidi) * (strongest + 1), 3),
    magnitude: round(magnitudes[strongest], 7),
  }
}

function rawReplay(samples) {
  const analyzer = createMicFrameAnalyzer()
  const frames = []
  for (let end = FRAME_SIZE; end <= samples.length; end += HOP_SAMPLES) {
    const frame = analyzeMicFrame(samples.subarray(end - FRAME_SIZE, end), SAMPLE_RATE, analyzer.noiseFloor)
    frames.push({
      timeMs: round(end / SAMPLE_RATE * 1000, 2),
      frequencyHz: round(frame?.frequency, 3),
      midiFloat: round(frame?.midiFloat, 4),
      selectedMidi: frame?.midi ?? null,
      clarity: round(frame?.clarity, 5),
      gateOpen: Boolean(frame?.gateOpen),
      rms: round(frame?.rms, 6),
    })
  }
  return frames
}

function captureHistory(samples, end, size = CAPTURE_HISTORY_SIZE) {
  const start = Math.max(0, end - size)
  const source = samples.subarray(start, end)
  if (source.length === size) return new Float32Array(source)
  const padded = new Float32Array(size)
  padded.set(source, size - source.length)
  return padded
}

function rawOutcome(definition, frames) {
  const played = definition.events.filter((event) => event.scoreEvent !== false)
  const detections = played.map((event, index) => {
    const window = frames.filter((frame) =>
      frame.timeMs >= event.onsetSec * 1000 && frame.timeMs <= event.onsetSec * 1000 + 300 && frame.gateOpen)
    const exact = window.find((frame) => frame.selectedMidi === event.midi) ?? null
    const octave = window.find((frame) =>
      frame.selectedMidi != null && frame.selectedMidi !== event.midi && (frame.selectedMidi - event.midi) % 12 === 0) ?? null
    return {
      index, playedMidi: event.midi, onsetMs: round(event.onsetSec * 1000, 2),
      detected: Boolean(exact), detectedAtMs: exact?.timeMs ?? null,
      latencyMs: exact ? round(exact.timeMs - event.onsetSec * 1000, 2) : null,
      octaveError: !exact && Boolean(octave), octaveMidi: !exact ? octave?.selectedMidi ?? null : null,
    }
  })
  let stableNoiseRun = 0
  let previousMidi = null
  let falsePositive = false
  if (!played.length) {
    for (const frame of frames) {
      if (frame.gateOpen && frame.selectedMidi != null && frame.selectedMidi === previousMidi) stableNoiseRun += 1
      else stableNoiseRun = frame.gateOpen && frame.selectedMidi != null ? 1 : 0
      previousMidi = frame.selectedMidi
      if (stableNoiseRun >= 3) falsePositive = true
    }
  }
  const latencies = detections.map((entry) => entry.latencyMs).filter(Number.isFinite)
  return {
    detections,
    expectedPlayedNotes: detections.length,
    matchedPlayedNotes: detections.filter((entry) => entry.detected).length,
    falseNegatives: detections.filter((entry) => !entry.detected).length,
    falsePositives: falsePositive ? 1 : 0,
    octaveErrors: detections.filter((entry) => entry.octaveError).length,
    medianLatencyMs: median(latencies),
  }
}

function followTargetIndex(scoreEvents, timeMs) {
  let target = 0
  for (let i = 0; i < scoreEvents.length; i += 1) {
    if (timeMs >= scoreEvents[i].onsetSec * 1000) target = i
    else break
  }
  return target
}

function replayMode(definition, samples, mode) {
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile('piano')
  const settings = normalizeMatchSettings({ allowOctaveMistakes: false })
  const detectorState = createMicEngineV2RuntimeState()
  const confirmState = createMatchConfirmState()
  const latch = createMicAttackLatchState()
  const frames = []
  const matches = []
  const attackEvents = []
  const matchedCheckpoints = new Set()
  let wfyIndex = 0
  let previousCheckpoint = null

  for (let end = FRAME_SIZE; end <= samples.length; end += HOP_SAMPLES) {
    const timeMs = end / SAMPLE_RATE * 1000
    const checkpointIndex = mode === 'wait-for-you'
      ? Math.min(wfyIndex, Math.max(0, definition.scoreEvents.length - 1))
      : followTargetIndex(definition.scoreEvents, timeMs)
    const checkpoint = definition.scoreEvents[checkpointIndex] ?? null
    const expectedMidi = checkpoint?.midi ?? null
    if (checkpointIndex !== previousCheckpoint) {
      resetMicEngineV2RuntimeState(detectorState)
      resetMatchConfirmState(confirmState)
      previousCheckpoint = checkpointIndex
    }
    const tick = processMicEngineV2Tick({
      buffer: captureHistory(samples, end),
      sampleRate: SAMPLE_RATE,
      expectedMidis: expectedMidi == null ? [] : [expectedMidi],
      noiseFloor: analyzer.noiseFloor,
      state: detectorState,
      centsTolerance: settings.micCentsTolerance,
      gateOptions: profile.gate,
      timeMs,
      stableFrameThreshold: settings.micChordStableHitsRequired,
    })
    const frame = tick.frame
    if (!frame || !checkpoint) continue

    const wasAwaiting = latch.awaitingRelease
    updateMicAttackRelease(latch, Boolean(frame.gateOpen), {
      rms: frame.filteredRms ?? frame.rms,
      spectralEnergy: frame.spectralEnergy,
      transientRms: frame.transientRms,
    })
    if (wasAwaiting && !latch.awaitingRelease) attackEvents.push({ type: 'release', timeMs: round(timeMs, 2) })

    let rearmReason = null
    let rejectReason = null
    let matchOutcome = null
    let advanced = false
    if (!canAcceptMicAttackMatch(latch)) {
      rearmReason = getMicAttackRearmReason(latch, frame, { expectedMidis: [expectedMidi] })
      if (rearmReason) {
        rearmMicAttackLatch(latch)
        attackEvents.push({ type: 'attack-rearm', reason: rearmReason, timeMs: round(timeMs, 2), checkpointIndex })
      }
    }

    const canEvaluate = mode === 'wait-for-you'
      ? wfyIndex < definition.scoreEvents.length
      : !matchedCheckpoints.has(checkpointIndex)
    if (!canEvaluate) {
      rejectReason = 'checkpoint-already-complete'
    } else if (!canAcceptMicAttackMatch(latch)) {
      rejectReason = 'awaiting-release'
      resetMatchConfirmState(confirmState)
    } else if (!frame.gateOpen) {
      rejectReason = 'gate-closed'
      resetMatchConfirmState(confirmState)
    } else if (!frame.v2DetectedMidis?.length) {
      rejectReason = 'no-score-informed-candidate'
      resetMatchConfirmState(confirmState)
    } else {
      const preview = evaluateMicScoreInformedInput({ id: `${definition.id}-${checkpointIndex}`, expectedMidi }, frame.v2DetectedMidis, settings)
      matchOutcome = preview.outcome
      const confident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
      const corroborated = frameCorroboratesSingleNote(frame, expectedMidi, { centsTolerance: settings.micCentsTolerance })
      if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
        rejectReason = 'score-mismatch'
        resetMatchConfirmState(confirmState)
      } else if (!confident) {
        rejectReason = micMusicalRejectReason(frame) ?? 'confidence-or-musical-gate'
        resetMatchConfirmState(confirmState)
      } else if (!corroborated) {
        rejectReason = 'pitch-corroboration'
        resetMatchConfirmState(confirmState)
      } else if (confirmConfidentMatch(
        confirmState,
        `${definition.id}-${mode}-${checkpointIndex}:${frame.v2DetectedMidis.join(',')}`,
        true,
        {
          pitchCents: pitchCentsForMicConfirmation(frame, expectedMidi),
          threshold: micConfirmFramesForExpectedMidis([expectedMidi]),
        },
      )) {
        resetMatchConfirmState(confirmState)
        markMicAttackConsumed(latch, { consumedMidis: [expectedMidi] })
        const playedReference = definition.events.find((event) => event.scoreEvent !== false && Math.abs(event.onsetSec - checkpoint.onsetSec) < 0.08)
        const octaveError = Boolean(playedReference && playedReference.midi !== expectedMidi && (playedReference.midi - expectedMidi) % 12 === 0)
        matches.push({
          checkpointIndex, expectedMidi, detectedMidis: [...frame.v2DetectedMidis],
          timeMs: round(timeMs, 2), onsetMs: round(checkpoint.onsetSec * 1000, 2),
          latencyMs: round(timeMs - checkpoint.onsetSec * 1000, 2), octaveError,
          advancement: mode === 'wait-for-you' ? 'score-checkpoint-advanced' : 'lane-group-marked-correct',
        })
        matchedCheckpoints.add(checkpointIndex)
        if (mode === 'wait-for-you') wfyIndex += 1
        advanced = true
      }
    }

    const note = frame.v2Notes?.find((candidate) => candidate.midi === expectedMidi) ?? null
    frames.push({
      timeMs: round(timeMs, 2), checkpointIndex, expectedMidi,
      rawPitchFrequencyHz: round(frame.frequency, 3), rawPitchMidiFloat: round(frame.dominantPitchMidiFloat, 4),
      selectedMidi: frame.midi ?? null, pitchCandidates: [...(frame.v2DetectedMidis ?? [])],
      harmonicFamily: {
        fundamentalHz: round(midiToFrequency(expectedMidi), 3),
        magnitudes: (note?.harmonicMagnitudes ?? []).map((value) => round(value, 7)),
        strongest: strongestHarmonic(note, expectedMidi),
        fundamentalMagnitude: round(note?.fundamentalEnergy, 7),
        ratio: round(note?.ratio, 5), confidence: round(note?.confidence, 5), support: round(note?.harmonicSupport, 5),
      },
      confidence: round(note?.confidence ?? frame.clarity, 5), gateOpen: Boolean(frame.gateOpen),
      rawGateOpen: Boolean(frame.rawGateOpen), softGateOpen: Boolean(frame.softGateOpen),
      rms: round(frame.rms, 6), filteredRms: round(frame.filteredRms, 6), noiseFloor: round(frame.noiseFloor, 6),
      spectralEnergy: round(frame.spectralEnergy, 6), transientRms: round(frame.transientRms, 6),
      signalFrameSize: frame.signalFrameSize ?? null, scoreFrameSize: frame.scoreFrameSize ?? null,
      signalShape: frame.signalShape, attackRearmReason: rearmReason, matchOutcome, rejectReason, advanced,
    })
  }

  const expected = definition.expectedAdvanceCount
  const trueMatches = matches.filter((match) =>
    match.checkpointIndex < expected && match.latencyMs >= 0 && match.latencyMs <= 300)
  const falsePositives = matches.length - trueMatches.length
  const falseNegatives = Math.max(0, expected - new Set(trueMatches.map((match) => match.checkpointIndex)).size)
  const octaveErrors = matches.filter((match) => match.octaveError).length
  const latencies = trueMatches.map((match) => match.latencyMs)
  let firstDivergentStage = null
  if (falseNegatives) {
    const missedIndex = Array.from({ length: expected }, (_, i) => i).find((i) => !trueMatches.some((match) => match.checkpointIndex === i))
    const relevant = frames.filter((frame) => frame.checkpointIndex === missedIndex)
    if (!relevant.some((frame) => frame.pitchCandidates.includes(frame.expectedMidi))) firstDivergentStage = '1-acoustic-candidate-generation'
    else if (!relevant.some((frame) => frame.pitchCandidates.includes(frame.expectedMidi) && frame.rejectReason !== 'non-musical-formant-harmonics')) firstDivergentStage = '2-harmonic-fundamental-selection'
    else if (relevant.some((frame) => frame.rejectReason === 'awaiting-release')) firstDivergentStage = '4-onset-release-rearm'
    else if (relevant.some((frame) => frame.rejectReason === 'pitch-corroboration')) firstDivergentStage = '2-harmonic-octave-disambiguation'
    else if (relevant.some((frame) => frame.matchOutcome === MATCH_OUTCOME.COMPLETE)) firstDivergentStage = '3-temporal-confirmation'
    else firstDivergentStage = '5-score-event-matching'
  } else if (falsePositives) {
    firstDivergentStage = octaveErrors ? '2-harmonic-octave-disambiguation' : '2-harmonic-false-positive-selection'
  }
  return {
    mode, matches, attackEvents, expectedAdvances: expected, matchedAdvances: trueMatches.length,
    falseNegatives, falsePositives, octaveErrors, latenciesMs: latencies,
    medianLatencyMs: median(latencies), maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    firstDivergentStage, frames,
  }
}

function summarize(cases) {
  const modeSummary = {}
  const registerSummary = {}
  const rawResults = cases.map((entry) => entry.rawDetector)
  const rawLatencies = rawResults.flatMap((result) => result.detections.map((entry) => entry.latencyMs).filter(Number.isFinite))
  modeSummary['raw-detector'] = {
    expectedPlayedNotes: rawResults.reduce((sum, value) => sum + value.expectedPlayedNotes, 0),
    matchedPlayedNotes: rawResults.reduce((sum, value) => sum + value.matchedPlayedNotes, 0),
    falseNegatives: rawResults.reduce((sum, value) => sum + value.falseNegatives, 0),
    falsePositives: rawResults.reduce((sum, value) => sum + value.falsePositives, 0),
    octaveErrors: rawResults.reduce((sum, value) => sum + value.octaveErrors, 0),
    medianLatencyMs: median(rawLatencies),
  }
  for (const mode of ['wait-for-you', 'follow-along']) {
    const results = cases.map((entry) => entry.modes[mode])
    const latencies = results.flatMap((result) => result.latenciesMs)
    modeSummary[mode] = {
      expectedAdvances: results.reduce((sum, value) => sum + value.expectedAdvances, 0),
      matchedAdvances: results.reduce((sum, value) => sum + value.matchedAdvances, 0),
      falseNegatives: results.reduce((sum, value) => sum + value.falseNegatives, 0),
      falsePositives: results.reduce((sum, value) => sum + value.falsePositives, 0),
      octaveErrors: results.reduce((sum, value) => sum + value.octaveErrors, 0),
      medianLatencyMs: median(latencies), maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
      passingCases: results.filter((value) => value.falseNegatives === 0 && value.falsePositives === 0).length,
      totalCases: results.length,
    }
  }
  for (const register of ['extreme-low', 'low', 'middle', 'high', 'extreme-high']) {
    registerSummary[register] = {}
    const rawSelected = cases.filter((entry) => entry.tags.includes(register)).map((entry) => entry.rawDetector)
    const registerRawLatencies = rawSelected.flatMap((result) => result.detections.map((entry) => entry.latencyMs).filter(Number.isFinite))
    registerSummary[register]['raw-detector'] = {
      cases: rawSelected.length,
      expectedPlayedNotes: rawSelected.reduce((sum, value) => sum + value.expectedPlayedNotes, 0),
      matchedPlayedNotes: rawSelected.reduce((sum, value) => sum + value.matchedPlayedNotes, 0),
      falseNegatives: rawSelected.reduce((sum, value) => sum + value.falseNegatives, 0),
      falsePositives: rawSelected.reduce((sum, value) => sum + value.falsePositives, 0),
      octaveErrors: rawSelected.reduce((sum, value) => sum + value.octaveErrors, 0),
      medianLatencyMs: median(registerRawLatencies),
    }
    for (const mode of ['wait-for-you', 'follow-along']) {
      const selected = cases.filter((entry) => entry.tags.includes(register)).map((entry) => entry.modes[mode])
      const latencies = selected.flatMap((result) => result.latenciesMs)
      registerSummary[register][mode] = {
        cases: selected.length,
        expectedAdvances: selected.reduce((sum, value) => sum + value.expectedAdvances, 0),
        matchedAdvances: selected.reduce((sum, value) => sum + value.matchedAdvances, 0),
        falseNegatives: selected.reduce((sum, value) => sum + value.falseNegatives, 0),
        falsePositives: selected.reduce((sum, value) => sum + value.falsePositives, 0),
        octaveErrors: selected.reduce((sum, value) => sum + value.octaveErrors, 0),
        medianLatencyMs: median(latencies), maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
      }
    }
  }
  return { modeSummary, registerSummary }
}

const cases = []
for (const definition of FIXTURES) {
  const samples = renderFixture(definition)
  const rawFrames = rawReplay(samples)
  const rawDetector = rawOutcome(definition, rawFrames)
  const modes = {
    'wait-for-you': replayMode(definition, samples, 'wait-for-you'),
    'follow-along': replayMode(definition, samples, 'follow-along'),
  }
  cases.push({
    id: definition.id, title: definition.title, tags: definition.tags,
    expectedNoteOnEvents: definition.scoreEvents.map((entry, index) => ({ index, midi: entry.midi, onsetMs: round(entry.onsetSec * 1000, 2) })),
    playedNoteOnEvents: definition.events.map((entry, index) => ({ index, midi: entry.midi, onsetMs: round(entry.onsetSec * 1000, 2), scoreEvent: entry.scoreEvent !== false })),
    expectedAdvanceCount: definition.expectedAdvanceCount,
    rawDetector: { ...rawDetector, frames: rawFrames },
    modes,
  })
}

const corpus = {
  corpusVersion: 1,
  generatedAt: new Date().toISOString(),
  baselineHead: 'c1faa8c5ba8913cdc5f7862401bcfc4d08b8e8c4',
  configuration: {
    sampleRate: SAMPLE_RATE, frameSize: FRAME_SIZE, hopSamples: HOP_SAMPLES,
    hopMs: round(HOP_MS, 4), supportedMidiMin: 21, supportedMidiMax: 108,
    fixtureCount: FIXTURES.length, modes: ['raw-detector', 'wait-for-you', 'follow-along'],
    generatedSignalsOnly: true,
  },
  summary: summarize(cases),
  cases,
}

await fs.writeFile(new URL(OUTPUT_NAME, OUTPUT_DIR), JSON.stringify(corpus, null, 2))
console.log(JSON.stringify({ configuration: corpus.configuration, summary: corpus.summary }, null, 2))
