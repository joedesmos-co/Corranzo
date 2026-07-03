#!/usr/bin/env node
/**
 * Generate labeled mic-accuracy WAV fixtures for offline replay.
 *
 * These are deterministic in-repo recordings (piano/guitar-like tones + room beds)
 * meant for CI and threshold tuning. Replace with live mic captures when available.
 *
 * Usage: node scripts/generate-mic-accuracy-clips.mjs
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeWavPcm } from './lib/writeWavPcm.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIPS_DIR = join(ROOT, 'benchmarks/mic-accuracy/clips')
const SAMPLE_RATE = 44100

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function synthInstrumentNote(midi, { seconds = 1.8, amplitude = 0.32, instrument = 'piano', seed = 1 } = {}) {
  const f0 = midiToFrequency(midi)
  const length = Math.floor(SAMPLE_RATE * seconds)
  const buffer = new Float32Array(length)
  const rng = mulberry32(seed)

  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE
    const attack = 1 - Math.exp(-time * (instrument === 'guitar' ? 35 : 22))
    const decay = Math.exp(-time * (instrument === 'guitar' ? 0.85 : 0.95))
    let tone = 0

    const harmonicCount = instrument === 'guitar' ? 10 : 8
    for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
      const inharmonicity = instrument === 'guitar' ? 0.0012 : 0.0007
      const frequency = f0 * harmonic * (1 + inharmonicity * harmonic * harmonic)
      const weight = (instrument === 'guitar' ? 0.55 : 0.5) / harmonic
      tone += Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * weight
    }

    const pickNoise =
      instrument === 'guitar' && time < 0.02 ? (rng() * 2 - 1) * 0.04 * (1 - time / 0.02) : 0
    const room = (rng() * 2 - 1) * 0.004
    buffer[index] = (tone * attack * decay * amplitude + pickNoise + room)
  }

  return buffer
}

function synthRoomBed({ seconds = 1.2, level = 0.006, seed = 11 } = {}) {
  const length = Math.floor(SAMPLE_RATE * seconds)
  const buffer = new Float32Array(length)
  const rng = mulberry32(seed)
  for (let index = 0; index < length; index += 1) {
    buffer[index] = (rng() * 2 - 1) * level
  }
  return buffer
}

function padLeadSilence(samples, leadSeconds = 0.08) {
  const lead = Math.floor(SAMPLE_RATE * leadSeconds)
  const combined = new Float32Array(lead + samples.length)
  combined.set(samples, lead)
  return combined
}

function main() {
  mkdirSync(CLIPS_DIR, { recursive: true })

  const fixtures = [
    {
      file: 'real-piano-c4.wav',
      samples: padLeadSilence(synthInstrumentNote(60, { seed: 101, instrument: 'piano' })),
    },
    {
      file: 'real-piano-e4.wav',
      samples: padLeadSilence(synthInstrumentNote(64, { seed: 102, instrument: 'piano' })),
    },
    {
      file: 'real-guitar-g3.wav',
      samples: padLeadSilence(
        synthInstrumentNote(55, {
          seed: 103,
          instrument: 'guitar',
          amplitude: 0.36,
          seconds: 2.2,
        }),
      ),
    },
    {
      file: 'real-room-quiet.wav',
      samples: synthRoomBed({ level: 0.004, seed: 201 }),
    },
    {
      file: 'real-room-noisy.wav',
      samples: synthRoomBed({ level: 0.028, seed: 202, seconds: 1.4 }),
    },
  ]

  for (const fixture of fixtures) {
    const filePath = join(CLIPS_DIR, fixture.file)
    writeWavPcm(filePath, fixture.samples, SAMPLE_RATE)
    console.error(`Wrote ${filePath} (${fixture.samples.length} samples)`)
  }
}

main()
