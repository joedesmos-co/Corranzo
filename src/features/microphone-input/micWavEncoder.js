/**
 * Mic recording harness (Stage 2, S1) — Float32 PCM ↔ 16-bit WAV.
 *
 * The dev recording harness captures raw time-domain audio and must save it
 * locally for later replay through the offline benchmark scripts. WAV/PCM is
 * the exchange format (readWavPcm.mjs already reads it back).
 *
 * Pure + testable: no audio APIs, no DOM. The UI layer wraps the returned
 * bytes in a Blob only at download time.
 */

export const WAV_MIME_TYPE = 'audio/wav'
export const WAV_BITS_PER_SAMPLE = 16
export const WAV_CHANNELS = 1

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

/**
 * Encode mono Float32 samples (-1..1) as a 16-bit PCM WAV file.
 * Values outside -1..1 are hard-clipped (never wrap).
 *
 * @returns {Uint8Array} complete .wav file bytes
 */
export function encodeWav16PCM(samples, sampleRate) {
  const rate = Math.round(sampleRate)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new TypeError('encodeWav16PCM requires a positive sample rate')
  }
  const count = samples?.length ?? 0
  const dataBytes = count * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, WAV_CHANNELS, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * WAV_CHANNELS * 2, true)
  view.setUint16(32, WAV_CHANNELS * 2, true)
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let index = 0; index < count; index += 1) {
    const raw = Number(samples[index])
    const clamped = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0
    view.setInt16(44 + index * 2, Math.round(clamped * 32767), true)
  }

  return new Uint8Array(buffer)
}

/**
 * Minimal 16-bit PCM WAV reader (mono or multi-channel → first channel).
 * Used to verify harness output round-trips; the benchmark scripts keep
 * using scripts/lib/readWavPcm.mjs as the canonical reader.
 */
export function decodeWav16PCM(bytes) {
  const view = bytes instanceof DataView
    ? bytes
    : new DataView(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length)
  if (view.byteLength < 44) {
    throw new TypeError('decodeWav16PCM: file too short for a WAV header')
  }
  const magic = (offset, length) => {
    let text = ''
    for (let index = 0; index < length; index += 1) {
      text += String.fromCharCode(view.getUint8(offset + index))
    }
    return text
  }
  if (magic(0, 4) !== 'RIFF' || magic(8, 4) !== 'WAVE' || magic(12, 4) !== 'fmt ') {
    throw new TypeError('decodeWav16PCM: not a PCM WAV file')
  }
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bits = view.getUint16(34, true)
  if (bits !== 16 || channels < 1) {
    throw new TypeError(`decodeWav16PCM: unsupported format (${channels}ch/${bits}bit)`)
  }
  // Locate the data chunk (skip any extra chunks after fmt).
  let dataOffset = 36
  while (dataOffset + 8 <= view.byteLength) {
    const id = magic(dataOffset, 4)
    const size = view.getUint32(dataOffset + 4, true)
    if (id === 'data') {
      break
    }
    dataOffset += 8 + size
  }
  if (magic(dataOffset, 4) !== 'data') {
    throw new TypeError('decodeWav16PCM: data chunk not found')
  }
  const dataSize = view.getUint32(dataOffset + 4, true)
  const frameCount = Math.floor(dataSize / (channels * 2))
  const samples = new Float32Array(frameCount)
  const start = dataOffset + 8
  for (let frame = 0; frame < frameCount; frame += 1) {
    samples[frame] = view.getInt16(start + frame * channels * 2, true) / 32767
  }
  return { samples, sampleRate, channels }
}
