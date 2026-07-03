import { readFileSync } from 'node:fs'

/**
 * Minimal PCM WAV reader for offline mic replay (mono/stereo 16-bit LE).
 * Script-only — not used in the browser bundle.
 */

function readAscii(view, offset, length) {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index))
  }
  return value
}

export function readWavPcm(filePath) {
  const buffer = readFileSync(filePath)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error(`Not a RIFF/WAVE file: ${filePath}`)
  }

  let offset = 12
  let audioFormat = null
  let numChannels = null
  let sampleRate = null
  let bitsPerSample = null
  let dataOffset = null
  let dataSize = null

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkDataOffset = offset + 8

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(chunkDataOffset, true)
      numChannels = view.getUint16(chunkDataOffset + 2, true)
      sampleRate = view.getUint32(chunkDataOffset + 4, true)
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true)
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset
      dataSize = chunkSize
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2)
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || !dataOffset || !sampleRate) {
    throw new Error(
      `Unsupported WAV (need PCM 16-bit): format=${audioFormat} bits=${bitsPerSample} ${filePath}`,
    )
  }

  const frameCount = Math.floor(dataSize / (bitsPerSample / 8) / numChannels)
  const samples = new Float32Array(frameCount)

  let writeIndex = 0
  for (let frame = 0; frame < frameCount; frame += 1) {
    const base = dataOffset + frame * numChannels * 2
    let sample = view.getInt16(base, true) / 32768
    if (numChannels > 1) {
      let sum = sample
      for (let channel = 1; channel < numChannels; channel += 1) {
        sum += view.getInt16(base + channel * 2, true) / 32768
      }
      sample = sum / numChannels
    }
    samples[writeIndex] = sample
    writeIndex += 1
  }

  return { samples, sampleRate, channels: numChannels, frameCount }
}
