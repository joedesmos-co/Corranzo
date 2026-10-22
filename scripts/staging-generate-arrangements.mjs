#!/usr/bin/env node
// Phase 2: arrangement MusicXML generation from a synthesized melody with a
// deterministic stub predictor (model accuracy is the separate gate).
// Outputs: tmp/audio-vision-staging/{piano,guitar}.musicxml + parse report.
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-staging')

const { runAudioArrangementPipeline } = await import('../src/features/audio-vision/audioArrangementPipeline.js')

// C major scale fragment, quarter notes at 120 BPM: C4 D4 E4 F4 G4 A4 G4 E4
const melody = [60, 62, 64, 65, 67, 69, 67, 64]
const sampleRate = 22050
const noteSeconds = 0.5
const totalSeconds = melody.length * noteSeconds + 0.5
const samples = new Float32Array(Math.floor(totalSeconds * sampleRate))
melody.forEach((midi, i) => {
  const freq = 440 * 2 ** ((midi - 69) / 12)
  const start = Math.floor(i * noteSeconds * sampleRate)
  const len = Math.floor(noteSeconds * 0.9 * sampleRate)
  for (let n = 0; n < len && start + n < samples.length; n += 1) {
    const t = n / sampleRate
    const env = Math.min(1, n / (0.01 * sampleRate)) * Math.exp(-2.2 * (t / noteSeconds))
    samples[start + n] += 0.5 * Math.sin(2 * Math.PI * freq * t) * env
  }
})

function wavBytes(floatSamples, rate) {
  const n = floatSamples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(floatSamples[i] * 32767))), 44 + i * 2)
  }
  return buf
}

const wav = wavBytes(samples, sampleRate)
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'scale-input.wav'), wav)

const stubPredict = async () => melody.map((midi, i) => ({
  midi, startSeconds: i * noteSeconds, endSeconds: i * noteSeconds + noteSeconds * 0.9,
}))
const decodeStub = async () => ({ channelData: [samples], sampleRate, durationSeconds: totalSeconds, channelCount: 1 })

for (const targetPart of ['solo-piano', 'solo-guitar']) {
  const result = await runAudioArrangementPipeline(
    { name: 'scale.wav', size: wav.length, type: 'audio/wav' },
    wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
    { targetPart, difficulty: 'easy', title: 'C Scale Etude' },
    { decodeAudioDataImpl: decodeStub, predictNotes: stubPredict },
  )
  console.log(targetPart, 'ok=' + result.ok, 'code=' + (result.code ?? 'ok'),
    'conf=' + result.confidence?.overall?.toFixed?.(2),
    'notes=' + result.musicXml?.match(/<note>/g)?.length)
  if (!result.ok) {
    console.log('FAIL', result.message)
    process.exitCode = 1
    continue
  }
  const name = targetPart === 'solo-piano' ? 'piano.musicxml' : 'guitar.musicxml'
  await writeFile(join(outDir, name), result.musicXml)
}
