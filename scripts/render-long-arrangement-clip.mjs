// Long-clip fixture for the long-arrangement engraving test: a 32-note
// melody (16 measures at 4 quarters each) with a slow tail, written as a WAV
// so the real in-browser Basic Pitch path arranges it.
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dir, '..', 'tmp', 'long-arrangement')
const sampleRate = 22050
const noteSeconds = 0.5

const scale = [60, 62, 64, 65, 67, 69, 71, 72]
const melody = []
for (let measure = 0; measure < 16; measure += 1) {
  for (let beat = 0; beat < 4; beat += 1) {
    melody.push(scale[(measure + beat) % scale.length])
  }
}
const totalSeconds = melody.length * noteSeconds + 1
const samples = new Float32Array(Math.floor(totalSeconds * sampleRate))
melody.forEach((midi, index) => {
  const frequency = 440 * 2 ** ((midi - 69) / 12)
  const start = Math.floor(index * noteSeconds * sampleRate)
  const length = Math.floor(noteSeconds * 0.85 * sampleRate)
  for (let n = 0; n < length && start + n < samples.length; n += 1) {
    const t = n / sampleRate
    const env = Math.min(1, n / (0.01 * sampleRate)) * Math.exp(-2.6 * (t / noteSeconds))
    samples[start + n] += 0.5 * Math.sin(2 * Math.PI * frequency * t) * env
  }
})

function wavBytes(floatSamples, rate) {
  const n = floatSamples.length
  const buffer = Buffer.alloc(44 + n * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + n * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(floatSamples[i] * 32767))), 44 + i * 2)
  }
  return buffer
}

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'long-scale.wav'), wavBytes(samples, sampleRate))
console.log(`wrote long-scale.wav (${melody.length} notes, ${(totalSeconds).toFixed(1)}s)`)
