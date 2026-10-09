#!/usr/bin/env node
/**
 * Render piano-pluck WAV fixtures for the unified mic e2e.
 *
 * Mirrors the in-app synth recipe (harmonic stack + exponential decay)
 * so the spectral detector hears realistic piano-ish attacks. Writes:
 *  - mic-c4-loop.wav: 1.5 s silence (calibration) + 3x C4 plucks
 *  - mic-wrong-loop.wav: 1.5 s silence + 3x F#4 plucks (wrong-note)
 *  - mic-melody8.wav: first 8 Prelude checkpoints as timed plucks
 *  - mic-quiet.wav: low room noise (no-advance control)
 *
 * Usage: node scripts/render-unified-mic-clips.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { encodeWav16PCM } from '../src/features/microphone-input/micWavEncoder.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'unified-practice-mic')
const SAMPLE_RATE = 44100

const PIANO_HARMONICS = [
  { multiple: 1, amplitude: 0.5 },
  { multiple: 2, amplitude: 0.28 },
  { multiple: 3, amplitude: 0.14 },
  { multiple: 4, amplitude: 0.07 },
  { multiple: 5, amplitude: 0.035 },
]

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function pluck(midi, seconds, decay = 3.2, level = 0.9) {
  const frequency = midiToFrequency(midi)
  const length = Math.max(1, Math.floor(SAMPLE_RATE * seconds))
  const buffer = new Float32Array(length)
  const total = PIANO_HARMONICS.reduce((sum, part) => sum + part.amplitude, 0)
  for (let index = 0; index < length; index += 1) {
    const envelope = Math.exp((-decay * index) / SAMPLE_RATE)
    let sample = 0
    for (const { multiple, amplitude } of PIANO_HARMONICS) {
      sample += Math.sin((2 * Math.PI * frequency * multiple * index) / SAMPLE_RATE) * amplitude
    }
    buffer[index] = (envelope * level * sample) / total
  }
  return buffer
}

function silence(seconds) {
  return new Float32Array(Math.max(1, Math.floor(SAMPLE_RATE * seconds)))
}

/**
 * Soft room tone (low noise, no pitch): keeps calibration in READY with a
 * low floor. Digital zeros read as a dead stream (NO_INPUT verdict, which
 * correctly disables matching) — a real room is never digital-zero.
 */
function roomTone(seconds, rms = 0.004, seed = 4242) {
  const length = Math.max(1, Math.floor(SAMPLE_RATE * seconds))
  const buffer = new Float32Array(length)
  let state = seed
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    buffer[index] = ((state / 0x7fffffff) * 2 - 1) * rms * 1.4
  }
  return buffer
}

function concat(...buffers) {
  const total = buffers.reduce((sum, buffer) => sum + buffer.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const buffer of buffers) {
    out.set(buffer, offset)
    offset += buffer.length
  }
  return out
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const xml = readFileSync(
    join(root, 'public/fixtures/practice-library/piano-bach-prelude-bwv846/piano-bach-prelude-bwv846.musicxml'),
    'utf8',
  )
  const checkpoints = buildNoteCheckpoints(parseMusicXml(xml))
  const first = checkpoints.slice(0, 8).map((checkpoint) => checkpoint.expectedMidis[0])
  console.log('melody midis:', first.join(','))
  await writeFile(join(outDir, 'melody.json'), JSON.stringify({ midis: first }, null, 2))

  // Long leading silence (deterministic calibration): Chromium starts the
  // fake-file loop when capture opens, so capture/calibration always lands
  // in silence and the noise floor is clean. Test waits already cover it.
  const LEAD_SILENCE = 30
  const c4Loop = concat(roomTone(LEAD_SILENCE), pluck(60, 0.8), silence(0.2), pluck(60, 0.8), silence(0.2), pluck(60, 0.8))
  await writeFile(join(outDir, 'mic-c4-loop.wav'), encodeWav16PCM(c4Loop, SAMPLE_RATE))

  const wrongLoop = concat(roomTone(LEAD_SILENCE, 0.004, 777), pluck(66, 0.8), silence(0.2), pluck(66, 0.8), silence(0.2), pluck(66, 0.8))
  await writeFile(join(outDir, 'mic-wrong-loop.wav'), encodeWav16PCM(wrongLoop, SAMPLE_RATE))

  const melodyParts = [roomTone(LEAD_SILENCE, 0.004, 999)]
  for (const midi of first) {
    melodyParts.push(pluck(midi, 0.85, 2.6), silence(0.25))
  }
  await writeFile(join(outDir, 'mic-melody8.wav'), encodeWav16PCM(concat(...melodyParts), SAMPLE_RATE))

  // Low room noise: well under speech/music level, exercises the silence gate.
  const quiet = new Float32Array(Math.floor(SAMPLE_RATE * 4))
  let state = 12345
  for (let index = 0; index < quiet.length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    quiet[index] = ((state / 0x7fffffff) * 2 - 1) * 0.004
  }
  await writeFile(join(outDir, 'mic-quiet.wav'), encodeWav16PCM(quiet, SAMPLE_RATE))
  console.log('wrote clips to', outDir)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
