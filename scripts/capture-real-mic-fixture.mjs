#!/usr/bin/env node
/**
 * Developer-only real microphone fixture capture.
 *
 * Examples:
 *   CORRANZO_DEVELOPER_MODE=1 node scripts/capture-real-mic-fixture.mjs \
 *     --target accuracy --id macbook-piano-c4 --expected-midi 60 \
 *     --instrument piano --tone acoustic-piano --device macbook-mic --seconds 3
 *
 *   CORRANZO_DEVELOPER_MODE=1 node scripts/capture-real-mic-fixture.mjs \
 *     --target polyphony --id macbook-guitar-open-em --expected-midis 40,45,50,55,59,64 \
 *     --string-frets 6:0:40,5:0:45,4:0:50,3:0:55,2:0:59,1:0:64 \
 *     --instrument guitar --tone acoustic-guitar --device macbook-mic --seconds 4
 *
 *   CORRANZO_DEVELOPER_MODE=1 node scripts/capture-real-mic-fixture.mjs \
 *     --from-wav /path/to/existing.wav --target polyphony --id desk-piano-c-major \
 *     --expected-midis 60,64,67 --instrument piano --tone acoustic-piano --device usb-condenser
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { writeWavPcm } from './lib/writeWavPcm.mjs'
import { replayMicClip } from '../src/features/microphone-input/micReplayHarness.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = {
  accuracy: {
    manifest: join(ROOT, 'benchmarks/mic-accuracy/manifest.json'),
    clipsDir: join(ROOT, 'benchmarks/mic-accuracy/clips'),
    expectedField: 'expectedMidi',
  },
  polyphony: {
    manifest: join(ROOT, 'benchmarks/mic-polyphony/manifest.json'),
    clipsDir: join(ROOT, 'benchmarks/mic-polyphony/clips'),
    expectedField: 'expectedMidis',
  },
}

function argValue(args, flag, fallback = null) {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : args[index + 1] ?? fallback
}

function parseList(value) {
  if (!value) {
    return []
  }
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite)
}

function parseStringFrets(value) {
  if (!value) {
    return null
  }
  const entries = []
  for (const item of value.split(',')) {
    const [stringValue, fretValue, midiValue] = item.split(':').map((part) => Number(part))
    if (
      Number.isFinite(stringValue) &&
      Number.isFinite(fretValue) &&
      Number.isFinite(midiValue)
    ) {
      entries.push({ string: stringValue, fret: fretValue, midi: midiValue })
    }
  }
  return entries.length ? entries : null
}

function sanitizeId(id) {
  return String(id ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function peakAbs(samples) {
  let peak = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample))
  }
  return peak
}

function rmsEnergy(samples) {
  if (!samples?.length) {
    return 0
  }
  let sum = 0
  for (const sample of samples) {
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

/** Refuse silent / near-silent captures so empty rooms never enter the corpus. */
function assertAudibleCapture(samples, { peakFloor = 0.02, rmsFloor = 0.004 } = {}) {
  const peak = peakAbs(samples)
  const rms = rmsEnergy(samples)
  if (peak < peakFloor || rms < rmsFloor) {
    throw new Error(
      `Refusing silent capture (peak=${peak.toFixed(4)}, rms=${rms.toFixed(4)}). Play the expected note/chord and retry.`,
    )
  }
  return { peak, rms }
}

function requireDeveloperMode() {
  if (process.env.CORRANZO_DEVELOPER_MODE !== '1') {
    throw new Error(
      'Refusing to save mic fixture: set CORRANZO_DEVELOPER_MODE=1 to enable developer capture.',
    )
  }
}

async function recordMicSamples({ seconds }) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream'],
  })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('about:blank')
  try {
    return await page.evaluate(async ({ seconds: captureSeconds }) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      })
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      const audioContext = new AudioContextClass()
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      const chunks = []
      const needed = Math.ceil(audioContext.sampleRate * captureSeconds)

      await new Promise((resolve) => {
        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0)
          chunks.push(Array.from(input))
          const captured = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          if (captured >= needed) {
            resolve()
          }
        }
        source.connect(processor)
        processor.connect(audioContext.destination)
      })

      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      await audioContext.close()

      const flat = []
      for (const chunk of chunks) {
        for (const sample of chunk) {
          flat.push(sample)
          if (flat.length >= needed) {
            break
          }
        }
        if (flat.length >= needed) {
          break
        }
      }
      return { sampleRate: audioContext.sampleRate, samples: flat }
    }, { seconds })
  } finally {
    await browser.close()
  }
}

function compactSingleNoteTrace(samples, sampleRate, expectedMidi, instrument) {
  const replay = replayMicClip(samples, sampleRate, { instrumentId: instrument })
  return {
    kind: 'single-note-mic-trace',
    sampleRate,
    expectedMidi,
    stableDetections: replay.stableDetections,
    calibration: replay.calibration,
    frames: replay.frames.map((frame) => ({
      timeMs: Math.round(frame.timeMs),
      midi: frame.midi,
      clarity: frame.clarity,
      rms: frame.rms,
      filteredRms: frame.filteredRms,
      noiseFloor: frame.noiseFloor,
      gateOpen: frame.gateOpen,
      signalShape: frame.signalShape,
      signalQuality: frame.signalQuality,
    })),
  }
}

function compactPolyphonyTrace(samples, sampleRate, expectedMidis, chordType) {
  const replay = replayScoreInformedPolyphonyClip(samples, sampleRate, {
    expectedMidis,
    chordType,
  })
  return {
    kind: 'polyphony-mic-trace',
    sampleRate,
    expectedMidis,
    stableDetections: replay.stableDetections,
    frames: replay.frames.map((frame) => ({
      timeMs: Math.round(frame.timeMs),
      detectedMidis: frame.detectedMidis,
      meanConfidence: frame.meanConfidence,
      noiseFloor: frame.noiseFloor,
      notes: frame.notes.map((note) => ({
        midi: note.midi,
        confidence: note.confidence,
        detected: note.detected,
        ratio: note.ratio,
        bassBoosted: note.bassBoosted,
      })),
    })),
  }
}

function appendManifestClip(manifestPath, clip) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const withoutExisting = manifest.clips.filter((entry) => entry.id !== clip.id)
  manifest.clips = [...withoutExisting, clip]
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function main() {
  requireDeveloperMode()

  const args = process.argv.slice(2)
  const targetName = argValue(args, '--target', 'polyphony')
  const target = TARGETS[targetName]
  if (!target) {
    throw new Error(`Unknown --target ${targetName}; expected accuracy or polyphony`)
  }

  const id = sanitizeId(argValue(args, '--id'))
  if (!id) {
    throw new Error('Missing --id')
  }

  const seconds = Number(argValue(args, '--seconds', '3'))
  const instrument = argValue(args, '--instrument')
  const tone = argValue(args, '--tone')
  const device = argValue(args, '--device')
  if (!instrument || !tone || !device) {
    throw new Error('Missing --instrument, --tone, or --device')
  }

  const expectedMidi = Number(argValue(args, '--expected-midi'))
  const expectedMidis = parseList(argValue(args, '--expected-midis'))
  const chordType = argValue(args, '--chord-type', 'simultaneous')
  const dynamic = argValue(args, '--dynamic', null)
  const stringFrets = parseStringFrets(argValue(args, '--string-frets'))
  const label = targetName === 'accuracy' ? 'note' : 'chord'

  if (targetName === 'accuracy' && !Number.isFinite(expectedMidi)) {
    throw new Error('Accuracy captures require --expected-midi')
  }
  if (targetName === 'polyphony' && expectedMidis.length < 2) {
    throw new Error('Polyphony captures require --expected-midis with at least two tones')
  }

  mkdirSync(target.clipsDir, { recursive: true })
  const wavName = `${id}.wav`
  const traceName = `${id}.trace.json`
  const wavPath = join(target.clipsDir, wavName)
  const tracePath = join(target.clipsDir, traceName)
  const fromWav = argValue(args, '--from-wav')

  let samples
  let sampleRate
  if (fromWav) {
    if (!existsSync(fromWav)) {
      throw new Error(`--from-wav file not found: ${fromWav}`)
    }
    const wav = readWavPcm(fromWav)
    samples = wav.samples
    sampleRate = wav.sampleRate
    console.error(`Loaded ${fromWav}`)
  } else {
    console.error(`Recording ${seconds}s from the default microphone...`)
    const recording = await recordMicSamples({ seconds })
    samples = Float32Array.from(recording.samples)
    sampleRate = recording.sampleRate
  }

  const levels = assertAudibleCapture(samples)
  if (fromWav) {
    if (resolve(fromWav) !== resolve(wavPath)) {
      copyFileSync(fromWav, wavPath)
    }
    console.error(`Imported ${fromWav} → ${wavPath}`)
  } else {
    writeWavPcm(wavPath, samples, sampleRate)
  }
  console.error(`Audible capture OK (peak=${levels.peak.toFixed(3)}, rms=${levels.rms.toFixed(4)})`)

  const trace =
    targetName === 'accuracy'
      ? compactSingleNoteTrace(samples, sampleRate, expectedMidi, instrument)
      : compactPolyphonyTrace(samples, sampleRate, expectedMidis, chordType)
  writeFileSync(
    tracePath,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        id,
        instrument,
        tone,
        device,
        dynamic,
        stringFrets,
        sourceWav: fromWav || null,
        ...trace,
      },
      null,
      2,
    )}\n`,
  )

  const clip = {
    id,
    label,
    instrument,
    micDevice: device,
    tone,
    dynamic,
    noiseCondition: argValue(args, '--noise-condition', 'room'),
    sourceType: fromWav ? 'developer-imported-wav' : 'developer-live-mic',
    file: `clips/${wavName}`,
    traceFile: `clips/${traceName}`,
    capturedAt: new Date().toISOString(),
    developerModeRequired: true,
    redistribution: argValue(args, '--redistribution', 'local-developer-fixture'),
    notes: argValue(args, '--notes', 'Developer-captured real microphone fixture.'),
  }

  if (targetName === 'accuracy') {
    clip.expectedMidi = expectedMidi
    clip.expectedOnsetMs = Number(argValue(args, '--expected-onset-ms', '120'))
  } else {
    clip.expectedMidis = expectedMidis
    clip.expectedOnsetMs = Number(argValue(args, '--expected-onset-ms', '120'))
    clip.chordType = chordType
    if (stringFrets) {
      clip.expectedStringFrets = stringFrets
    }
  }

  appendManifestClip(target.manifest, clip)
  console.error(`Wrote ${wavPath}`)
  console.error(`Wrote ${tracePath}`)
  console.error(`Updated ${target.manifest}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
