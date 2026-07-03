#!/usr/bin/env node
/**
 * Generate in-repo polyphony WAV fixtures for offline replay.
 * Usage: npm run mic:generate-polyphony-clips
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthSimultaneousChord } from '../src/features/microphone-input/micSyntheticChordClips.js'
import { synthRoomBed } from './lib/micPolyphonyClipSynth.mjs'
import { writeWavPcm } from './lib/writeWavPcm.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIPS_DIR = join(ROOT, 'benchmarks/mic-polyphony/clips')
const SAMPLE_RATE = 44100

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
      file: 'real-c-major-triad.wav',
      samples: padLeadSilence(synthSimultaneousChord([60, 64, 67], SAMPLE_RATE, { seconds: 1.8, seed: 201 })),
    },
    {
      file: 'real-dyad-c4-g4.wav',
      samples: padLeadSilence(synthSimultaneousChord([60, 67], SAMPLE_RATE, { seconds: 1.6, seed: 202 })),
    },
    {
      file: 'real-room-quiet.wav',
      samples: synthRoomBed(SAMPLE_RATE, { level: 0.004, seed: 301, seconds: 1 }),
    },
  ]

  for (const fixture of fixtures) {
    const filePath = join(CLIPS_DIR, fixture.file)
    writeWavPcm(filePath, fixture.samples, SAMPLE_RATE)
    console.error(`Wrote ${filePath} (${fixture.samples.length} samples)`)
  }
}

main()
