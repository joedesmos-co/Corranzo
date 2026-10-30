/**
 * Build deterministic PCM sequences for the multi-checkpoint microphone
 * harness. Script-only; never imported by the app.
 *
 * A sequence is a mono room-tone bed plus placed source clips. `startMs` is
 * musical time (after the calibration prelude). Clips are mixed, not
 * concatenated, so their natural decays overlap exactly as they do in a real
 * performance.
 */
import { readWavPcm } from './readWavPcm.mjs'

export const DEFAULT_SAMPLE_RATE = 44100

export function loadClip(filePath, { startSeconds = 0, durationSeconds = null } = {}) {
  const wav = readWavPcm(filePath)
  const from = Math.max(0, Math.floor(startSeconds * wav.sampleRate))
  const to = durationSeconds == null
    ? wav.samples.length
    : Math.min(wav.samples.length, from + Math.floor(durationSeconds * wav.sampleRate))
  return {
    samples: wav.samples.subarray(from, to),
    sampleRate: wav.sampleRate,
    durationSeconds: Math.max(0, (to - from) / wav.sampleRate),
  }
}

function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(samples.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(samples.length - 1, left + 1)
    const fraction = position - left
    out[i] = samples[left] * (1 - fraction) + samples[right] * fraction
  }
  return out
}

/**
 * @param {object} options
 * @param {{samples:Float32Array|number[], sampleRate:number, startMs:number, gain?:number}[]} options.segments
 * @param {number} options.preludeSeconds room-tone bed before musical time 0
 * @param {number} options.tailSeconds extra room tone after the last segment
 * @param {number} options.sampleRate output rate
 * @param {number} options.noiseAmplitude deterministic room-tone RMS-ish amplitude
 */
export function buildSequenceAudio({
  segments = [],
  preludeSeconds = 8,
  tailSeconds = 1.5,
  sampleRate = DEFAULT_SAMPLE_RATE,
  noiseAmplitude = 0.0015,
  seed = 0x1234567,
} = {}) {
  const preludeSamples = Math.max(0, Math.round(preludeSeconds * sampleRate))
  const placed = segments
    .map((segment) => {
      const samples = resampleLinear(segment.samples, segment.sampleRate, sampleRate)
      return {
        samples,
        startSample: preludeSamples + Math.max(0, Math.round((segment.startMs / 1000) * sampleRate)),
        gain: Number.isFinite(segment.gain) ? segment.gain : 1,
      }
    })
    .filter((segment) => segment.samples?.length)
  const lastEnd = placed.reduce(
    (max, segment) => Math.max(max, segment.startSample + segment.samples.length),
    0,
  )
  const total = Math.max(
    preludeSamples + Math.round(tailSeconds * sampleRate),
    lastEnd + Math.round(tailSeconds * sampleRate),
  )
  const out = new Float32Array(total)
  let state = seed >>> 0
  for (let i = 0; i < total; i += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    out[i] = ((state / 0x7fffffff) * 2 - 1) * noiseAmplitude
  }
  for (const segment of placed) {
    const end = Math.min(total, segment.startSample + segment.samples.length)
    for (let i = segment.startSample; i < end; i += 1) {
      out[i] += segment.samples[i - segment.startSample] * segment.gain
    }
  }
  let peak = 0
  for (let i = 0; i < total; i += 1) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0.98) {
    const scale = 0.98 / peak
    for (let i = 0; i < total; i += 1) out[i] *= scale
  }
  return {
    samples: out,
    sampleRate,
    preludeSeconds,
    durationSeconds: total / sampleRate,
    peak,
  }
}

/** Convert a WAV onset (seconds, relative to the placed clip) to sequence ms. */
export function onsetMs(placementStartMs, sourceOnsetSeconds) {
  return Math.round(placementStartMs + sourceOnsetSeconds * 1000)
}
