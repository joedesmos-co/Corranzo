/**
 * A1 — Audio import: validate, decode, normalize.
 *
 * Browser decoding (decodeAudioData) is injected so pure validation stays
 * unit-testable in Node. All DSP downstream expects mono Float32 @ MODEL_RATE.
 */

export const AUDIO_VISION_MODEL_RATE = 22050
export const AUDIO_VISION_MAX_DURATION_SECONDS = 600 // 10 min
export const AUDIO_VISION_MAX_FILE_BYTES = 100 * 1024 * 1024 // 100 MB
export const AUDIO_VISION_MIN_DURATION_SECONDS = 1
export const AUDIO_VISION_MIN_SAMPLE_RATE = 8000

export const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a']
export const SUPPORTED_AUDIO_MIME_PREFIXES = ['audio/']

export function extensionOfFileName(name = '') {
  const base = String(name).split('?')[0].split('#')[0]
  const dot = base.lastIndexOf('.')
  if (dot < 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** Typed, user-facing validation. Returns { ok, code, message, ext }. */
export function validateAudioFile(file, { bytes = null } = {}) {
  if (!file) {
    return { ok: false, code: 'no-file', message: 'No audio file was provided.', ext: '' }
  }
  const size = Number(file.size ?? bytes?.byteLength ?? NaN)
  const name = file.name ?? 'recording'
  const ext = extensionOfFileName(name)
  if (!SUPPORTED_AUDIO_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      code: 'unsupported-format',
      message: `“${name}” is not a supported audio file. V1 supports MP3, WAV, and M4A.`,
      ext,
    }
  }
  if (Number.isFinite(size)) {
    if (size <= 0) {
      return { ok: false, code: 'empty-file', message: 'That audio file is empty.', ext }
    }
    if (size > AUDIO_VISION_MAX_FILE_BYTES) {
      return {
        ok: false,
        code: 'file-too-large',
        message: `That file is too large (${Math.round(size / 1048576)} MB). V1 supports files up to 100 MB — try a shorter excerpt.`,
        ext,
      }
    }
  }
  const mime = String(file.type ?? '')
  if (mime && !SUPPORTED_AUDIO_MIME_PREFIXES.some((p) => mime.startsWith(p)) && !mime.includes(ext)) {
    return { ok: false, code: 'unreadable-mime', message: `“${name}” does not look like audio (${mime}).`, ext }
  }
  if (bytes && bytes.byteLength >= 12) {
    const view = new Uint8Array(bytes, 0, 12)
    const ascii = (a, b) => String.fromCharCode(...view.slice(a, b))
    // Positively identify non-audio containers rather than guessing from
    // absent MP3 frame sync (raw MP3 frames need not start with ID3/sync).
    const knownNonAudio =
      ascii(0, 4) === '%PDF' ||
      ascii(0, 5) === '%!PS-' ||
      (view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04) || // ZIP/docx
      (view[0] === 0x89 && ascii(1, 4) === 'PNG') ||
      (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) || // JPEG
      (view[0] === 0x4d && view[1] === 0x5a) || // EXE
      ascii(0, 6) === 'GIF89' ||
      ascii(0, 1) === '<'
    if (knownNonAudio) {
      return { ok: false, code: 'corrupt-file', message: `“${name}” could not be read as audio. The file may be corrupt or misnamed — try the original MP3 or WAV export.`, ext }
    }
  }
  return { ok: true, code: 'ok', message: '', ext }
}

export function validateDecodedAudio({ sampleRate, durationSeconds, channelCount }) {
  if (!Number.isFinite(sampleRate) || sampleRate < AUDIO_VISION_MIN_SAMPLE_RATE) {
    return { ok: false, code: 'bad-sample-rate', message: 'That recording has an unsupported sample rate.' }
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < AUDIO_VISION_MIN_DURATION_SECONDS) {
    return { ok: false, code: 'too-short', message: 'That recording is too short to arrange (under 1 second).' }
  }
  if (durationSeconds > AUDIO_VISION_MAX_DURATION_SECONDS) {
    return {
      ok: false,
      code: 'too-long',
      message: `That recording is ${Math.round(durationSeconds / 60)} minutes long. V1 supports up to 10 minutes — try an excerpt.`,
    }
  }
  if (channelCount != null && !(channelCount >= 1 && channelCount <= 8)) {
    return { ok: false, code: 'bad-channels', message: 'That recording has an unsupported channel layout.' }
  }
  return { ok: true, code: 'ok', message: '' }
}

/** Mix channel matrices to mono (equal-power-ish simple mean; timing/pitch preserved). */
export function mixToMono(channelData) {
  if (!Array.isArray(channelData) || channelData.length === 0) return new Float32Array(0)
  if (channelData.length === 1) return Float32Array.from(channelData[0])
  const length = Math.min(...channelData.map((c) => c.length))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    let sum = 0
    for (const ch of channelData) sum += ch[i]
    out[i] = sum / channelData.length
  }
  return out
}

/**
 * A4 — Mid/side split for stereo recordings (no model, no download).
 * Lead vocals are usually mixed center; ambience/reverb lives in the sides.
 * Returns null for mono. Callers must NOT call these isolated stems —
 * they are analysis views with a measured center ratio.
 */
export function splitMidSide(channelData) {
  if (!Array.isArray(channelData) || channelData.length < 2) return null
  const length = Math.min(channelData[0]?.length ?? 0, channelData[1]?.length ?? 0)
  if (!length) return null
  const mid = new Float32Array(length)
  const side = new Float32Array(length)
  const [left, right] = channelData
  for (let i = 0; i < length; i += 1) {
    mid[i] = (left[i] + right[i]) / 2
    side[i] = (left[i] - right[i]) / 2
  }
  return { mid, side }
}

/** Center ratio 0..1: how much vocal-band energy sits in the middle. */
export function centerRatio(mid, side) {
  let m = 0
  let s = 0
  for (let i = 0; i < mid.length; i += 1) {
    m += mid[i] * mid[i]
    s += side[i] * side[i]
  }
  const total = m + s
  if (total <= 1e-12) return 0.5
  return Math.round((m / total) * 1000) / 1000
}

/** Linear resample (matches micNeuralTfAdapter semantics for 22050 parity). */
export function resampleLinear(samples, inputRate, targetRate = AUDIO_VISION_MODEL_RATE) {
  if (!samples?.length) return new Float32Array(0)
  if (!Number.isFinite(inputRate) || inputRate <= 0) {
    throw new TypeError('resampleLinear requires a positive input sample rate')
  }
  if (inputRate === targetRate) return Float32Array.from(samples)
  const ratio = inputRate / targetRate
  const outLength = Math.max(1, Math.floor(samples.length / ratio))
  if (outLength > 22050 * AUDIO_VISION_MAX_DURATION_SECONDS + 22050) {
    throw new RangeError('Resampled audio exceeds the V1 duration cap')
  }
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio
    const lo = Math.floor(pos)
    const hi = Math.min(samples.length - 1, lo + 1)
    const frac = pos - lo
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac
  }
  return out
}

/** Peak-normalize to target peak; returns { samples, peakBefore, gain }. Silent stays silent. */
export function normalizePeak(samples, targetPeak = 0.89) {
  const out = Float32Array.from(samples ?? [])
  let peak = 0
  for (let i = 0; i < out.length; i += 1) {
    const a = Math.abs(out[i])
    if (a > peak) peak = a
  }
  if (peak < 1e-6) return { samples: out, peakBefore: peak, gain: 1 }
  const gain = Math.min(10, targetPeak / peak)
  for (let i = 0; i < out.length; i += 1) out[i] *= gain
  return { samples: out, peakBefore: peak, gain }
}

export function rmsLevel(samples) {
  if (!samples?.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/**
 * Phase 7 — explicit excerpt slicing. Never silent: callers must surface
 * the returned { startSeconds, durationSeconds, totalSeconds } to the user.
 */
export const EXCERPT_MAX_SECONDS = 180

export function sliceExcerpt(samples, sampleRate, { startSeconds = 0, durationSeconds = null } = {}) {
  const totalSeconds = samples.length / sampleRate
  const start = Math.max(0, Math.min(totalSeconds, Number(startSeconds) || 0))
  const maxDur = Math.min(EXCERPT_MAX_SECONDS, totalSeconds - start)
  const wanted = durationSeconds == null ? maxDur : Math.max(1, Math.min(maxDur, Number(durationSeconds)))
  const s0 = Math.floor(start * sampleRate)
  const s1 = Math.min(samples.length, s0 + Math.floor(wanted * sampleRate))
  return {
    samples: samples.slice(s0, s1),
    startSeconds: Math.round(start * 100) / 100,
    durationSeconds: Math.round(((s1 - s0) / sampleRate) * 100) / 100,
    totalSeconds: Math.round(totalSeconds * 100) / 100,
    truncated: s1 - s0 < samples.length,
  }
}

/**
 * Full import: validate → decode (injected) → mono → resample → normalize.
 * decodeAudioDataImpl: async (arrayBuffer) => { channelData: Float32Array[], sampleRate, durationSeconds, channelCount }
 */
export async function importAudioFile(file, arrayBuffer, decodeAudioDataImpl) {
  const head = validateAudioFile(file, { bytes: arrayBuffer })
  if (!head.ok) return { ok: false, ...head, stage: 'validate' }
  if (!arrayBuffer?.byteLength) {
    return { ok: false, code: 'empty-file', message: 'That audio file is empty.', ext: head.ext, stage: 'validate' }
  }
  let decoded
  try {
    if (typeof decodeAudioDataImpl !== 'function') {
      throw new Error('no-decoder')
    }
    decoded = await decodeAudioDataImpl(arrayBuffer)
  } catch (error) {
    const msg = String(error?.message ?? error)
    if (/no-decoder/i.test(msg)) {
      return { ok: false, code: 'decoder-unavailable', message: 'Audio decoding is unavailable in this browser.', ext: head.ext, stage: 'decode' }
    }
    return {
      ok: false,
      code: head.ext === 'm4a' ? 'unsupported-codec' : 'decode-failed',
      message: head.ext === 'm4a'
        ? 'That M4A file uses a codec this browser cannot decode. Try exporting it as MP3 or WAV.'
        : `“${file?.name ?? 'recording'}” could not be decoded. The file may be corrupt or use an unsupported codec. Try MP3 or WAV.`,
      ext: head.ext,
      stage: 'decode',
    }
  }
  const check = validateDecodedAudio({
    sampleRate: decoded.sampleRate,
    durationSeconds: decoded.durationSeconds ?? decoded.channelData?.[0]?.length / decoded.sampleRate,
    channelCount: decoded.channelCount ?? decoded.channelData?.length,
  })
  if (!check.ok) return { ...check, ext: head.ext, stage: 'limits' }
  const mono = mixToMono(decoded.channelData)
  const atRate = resampleLinear(mono, decoded.sampleRate, AUDIO_VISION_MODEL_RATE)
  const { samples, peakBefore, gain } = normalizePeak(atRate)
  // A4: preserve stereo mid/side (same gain keeps relative level honest).
  let stereo = null
  const split = splitMidSide(decoded.channelData)
  if (split) {
    const midRate = resampleLinear(split.mid, decoded.sampleRate, AUDIO_VISION_MODEL_RATE)
    const sideRate = resampleLinear(split.side, decoded.sampleRate, AUDIO_VISION_MODEL_RATE)
    const g = Math.min(10, gain)
    for (let i = 0; i < midRate.length; i += 1) {
      midRate[i] *= g
      sideRate[i] *= g
    }
    stereo = { mid: midRate, side: sideRate, centerRatio: centerRatio(midRate, sideRate) }
  }
  return {
    ok: true,
    code: 'ok',
    message: '',
    ext: head.ext,
    stage: 'done',
    samples,
    sampleRate: AUDIO_VISION_MODEL_RATE,
    durationSeconds: samples.length / AUDIO_VISION_MODEL_RATE,
    sourceSampleRate: decoded.sampleRate,
    channels: decoded.channelCount ?? decoded.channelData?.length ?? 1,
    stereo,
    peakBefore,
    gain,
    rms: rmsLevel(samples),
  }
}
