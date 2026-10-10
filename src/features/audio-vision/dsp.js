/**
 * A2/A3 DSP primitives — dependency-free, deterministic, unit-tested.
 * FFT (radix-2), Hann STFT magnitude, spectral flux, autocorrelation tempo,
 * chroma, median-filter HPSS masks, Krumhansl-style chord templates.
 */

export function nextPow2(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** In-place radix-2 FFT on real/imag Float64 arrays. */
export function fftInPlace(real, imag) {
  const n = real.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1
      let cwi = 0
      for (let k = 0; k < len / 2; k += 1) {
        const ur = real[i + k]
        const ui = imag[i + k]
        const vr = real[i + k + len / 2] * cwr - imag[i + k + len / 2] * cwi
        const vi = real[i + k + len / 2] * cwi + imag[i + k + len / 2] * cwr
        real[i + k] = ur + vr
        imag[i + k] = ui + vi
        real[i + k + len / 2] = ur - vr
        imag[i + k + len / 2] = ui - vi
        const nwr = cwr * wr - cwi * wi
        cwi = cwr * wi + cwi * wr
        cwr = nwr
      }
    }
  }
  return { real, imag }
}

export function hannWindow(size) {
  const w = new Float64Array(size)
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, size - 1)))
  }
  return w
}

/** Magnitude spectrogram: frames × bins (bins = fftSize/2). */
export function magnitudeSpectrogram(samples, { sampleRate = 22050, fftSize = 2048, hop = 512 } = {}) {
  const size = nextPow2(fftSize)
  const window = hannWindow(size)
  const frames = []
  for (let start = 0; start + size <= samples.length + size; start += hop) {
    const real = new Float64Array(size)
    const imag = new Float64Array(size)
    for (let i = 0; i < size; i += 1) {
      const s = start + i < samples.length ? samples[start + i] : 0
      real[i] = s * window[i]
    }
    fftInPlace(real, imag)
    const mags = new Float64Array(size / 2)
    for (let b = 0; b < mags.length; b += 1) {
      mags[b] = Math.hypot(real[b], imag[b]) / (size / 2)
    }
    frames.push(mags)
    if (start + size >= samples.length) break
  }
  return { frames, fftSize: size, hop, sampleRate, frameSeconds: hop / sampleRate }
}

export function binToHz(bin, fftSize, sampleRate) {
  return (bin * sampleRate) / fftSize
}

export function hzToMidi(hz) {
  if (!(hz > 0)) return null
  return 69 + 12 * Math.log2(hz / 440)
}

/** Positive spectral-flux onset envelope (one value per frame). */
export function spectralFlux(frames) {
  const env = new Float64Array(frames.length)
  for (let f = 1; f < frames.length; f += 1) {
    const prev = frames[f - 1]
    const cur = frames[f]
    const n = Math.min(prev.length, cur.length)
    let sum = 0
    for (let b = 0; b < n; b += 1) {
      const d = cur[b] - prev[b]
      if (d > 0) sum += d
    }
    env[f] = sum / Math.max(1, n)
  }
  return env
}

/** Peak-pick onsets: adaptive median threshold + min spacing. Returns frame indices. */
export function pickOnsetFrames(envelope, { minGapFrames = 4, thresholdScale = 1.35 } = {}) {
  const med = median(Array.from(envelope))
  const threshold = med * thresholdScale + 1e-9
  const peaks = []
  for (let i = 1; i < envelope.length - 1; i += 1) {
    if (envelope[i] > threshold && envelope[i] >= envelope[i - 1] && envelope[i] > envelope[i + 1]) {
      if (!peaks.length || i - peaks[peaks.length - 1] >= minGapFrames) peaks.push(i)
    }
  }
  return peaks
}

export function median(values) {
  if (!values?.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function medianFilter1D(values, radius) {
  const out = new Float64Array(values.length)
  for (let i = 0; i < values.length; i += 1) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(values.length - 1, i + radius)
    out[i] = median(Array.from(values.slice(lo, hi + 1)))
  }
  return out
}

/**
 * HPSS masks via median filtering (Fitzgerald 2010, light): harmonic mask
 * emphasizes time-continuity, percussive mask frequency-continuity.
 * Returns per-frame { harmonic: Float64Array, percussive: Float64Array } magnitudes.
 */
export function hpssMasks(frames, { timeRadius = 8, freqRadius = 8, eps = 1e-10 } = {}) {
  const nFrames = frames.length
  if (!nFrames) return []
  const nBins = frames[0].length
  // Transpose to bin trajectories for time median.
  const harm = []
  const perc = []
  const timeMedByBin = []
  for (let b = 0; b < nBins; b += 1) {
    const traj = new Float64Array(nFrames)
    for (let f = 0; f < nFrames; f += 1) traj[f] = frames[f][b]
    timeMedByBin.push(medianFilter1D(traj, timeRadius))
  }
  for (let f = 0; f < nFrames; f += 1) {
    const spectrum = frames[f]
    const freqMed = medianFilter1D(spectrum, freqRadius)
    const h = new Float64Array(nBins)
    const p = new Float64Array(nBins)
    for (let b = 0; b < nBins; b += 1) {
      const hScore = timeMedByBin[b][f]
      const pScore = freqMed[b]
      const total = hScore + pScore + eps
      const maskH = (hScore / total) ** 2
      const maskP = (pScore / total) ** 2
      const norm = maskH + maskP + eps
      h[b] = spectrum[b] * (maskH / norm)
      p[b] = spectrum[b] * (maskP / norm)
    }
    harm.push(h)
    perc.push(p)
  }
  return { harmonic: harm, percussive: perc }
}

/** 12-dim chroma from one magnitude spectrum (peak-bin mapping, log-weighted). */
export function chromaOfSpectrum(spectrum, fftSize, sampleRate, { minHz = 55, maxHz = 2093 } = {}) {
  const chroma = new Float64Array(12)
  for (let b = 1; b < spectrum.length; b += 1) {
    const hz = binToHz(b, fftSize, sampleRate)
    if (hz < minHz || hz > maxHz) continue
    const midi = hzToMidi(hz)
    if (midi == null) continue
    const pc = ((Math.round(midi) % 12) + 12) % 12
    chroma[pc] += Math.log1p(spectrum[b])
  }
  const norm = Math.hypot(...chroma)
  if (norm > 0) for (let i = 0; i < 12; i += 1) chroma[i] /= norm
  return chroma
}

const CHORD_QUALITIES = [
  { quality: 'major', intervals: [0, 4, 7], suffix: '' },
  { quality: 'minor', intervals: [0, 3, 7], suffix: 'm' },
  // Phase 3: extended templates — jazz/pop harmony is rarely triad-only.
  // Measured against GuitarSet chord truth (maj7/min7/7/dim/sus present).
  { quality: 'major7', intervals: [0, 4, 7, 11], suffix: 'maj7' },
  { quality: 'minor7', intervals: [0, 3, 7, 10], suffix: 'm7' },
  { quality: 'dominant7', intervals: [0, 4, 7, 10], suffix: '7' },
  { quality: 'diminished', intervals: [0, 3, 6], suffix: 'dim' },
  { quality: 'suspended4', intervals: [0, 5, 7], suffix: 'sus4' },
]

const CHORD_TEMPLATES = (() => {
  const templates = []
  for (let root = 0; root < 12; root += 1) {
    for (const q of CHORD_QUALITIES) {
      const weights = new Array(12).fill(0.08)
      for (const iv of q.intervals) weights[(root + iv) % 12] = 1
      templates.push({ root, quality: q.quality, weights, suffix: q.suffix })
    }
  }
  return templates
})()

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Template-match chroma → { root, quality, score, label }. Score is cosine-ish 0..1. */
export function recognizeChord(chroma) {
  let best = { root: 0, quality: 'major', score: 0, suffix: '' }
  for (const t of CHORD_TEMPLATES) {
    let dot = 0
    let norm = 0
    for (let i = 0; i < 12; i += 1) {
      dot += chroma[i] * t.weights[i]
      norm += t.weights[i] * t.weights[i]
    }
    // Length-normalize so 4-note templates don't outscore triads for free.
    const score = dot / (Math.sqrt(norm) + 1e-9)
    if (score > best.score) best = { root: t.root, quality: t.quality, score, suffix: t.suffix }
  }
  return { ...best, label: `${PITCH_CLASS_NAMES[best.root]}${best.suffix}` }
}

/** Autocorrelation tempo from onset envelope. Returns { bpm, confidence, octaveAlternative }. */
export function estimateTempoFromEnvelope(envelope, frameSeconds, { minBpm = 60, maxBpm = 200 } = {}) {
  const n = envelope.length
  if (n < 8 || !(frameSeconds > 0)) {
    return { bpm: 120, confidence: 0, octaveAlternative: null, method: 'default' }
  }
  const mean = envelope.reduce((a, b) => a + b, 0) / n
  const zeroed = envelope.map((v) => v - mean)
  const minLag = Math.max(2, Math.floor(60 / maxBpm / frameSeconds))
  const maxLag = Math.min(n - 1, Math.ceil(60 / minBpm / frameSeconds))
  let bestLag = 0
  let bestVal = -Infinity
  const scores = new Map()
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let s = 0
    for (let i = 0; i + lag < n; i += 1) s += zeroed[i] * zeroed[i + lag]
    scores.set(lag, s)
    if (s > bestVal) {
      bestVal = s
      bestLag = lag
    }
  }
  if (!bestLag) return { bpm: 120, confidence: 0, octaveAlternative: null, method: 'default' }
  const bpm = 60 / (bestLag * frameSeconds)
  const half = scores.get(bestLag * 2) ?? -Infinity
  const dbl = scores.get(Math.round(bestLag / 2)) ?? -Infinity
  // Prefer the 90–160 pocket when a harmonic lag scores within 12%.
  let chosen = bpm
  let alt = null
  const altBpm = 60 / (Math.round(bestLag / 2) * frameSeconds)
  if (bpm < 90 && dbl > bestVal * 0.88 && altBpm <= maxBpm) {
    alt = Math.round(bpm)
    chosen = altBpm
  } else if (bpm > 170) {
    const halfBpm = 60 / (bestLag * 2 * frameSeconds)
    if (half > bestVal * 0.8 && halfBpm >= minBpm) {
      alt = Math.round(bpm)
      chosen = halfBpm
    }
  }
  const variance = scores.size
    ? [...scores.values()].reduce((a, b) => a + (b - bestVal) ** 2, 0) / scores.size
    : 1
  const confidence = Math.max(0, Math.min(1, bestVal / (Math.sqrt(Math.max(variance, 1e-12)) * 6 + 1e-9)))
  return {
    bpm: Math.round(Math.max(minBpm, Math.min(maxBpm, chosen))),
    confidence: Math.round(confidence * 100) / 100,
    octaveAlternative: alt,
    method: 'autocorr-onset',
  }
}

/** Beat grid from tempo + first strong onset anchor. */
export function buildBeatGrid({ onsetFrames, frameSeconds, bpm, totalSeconds, anchorFrame = null }) {
  const period = 60 / bpm
  const anchor = ((anchorFrame ?? onsetFrames[0] ?? 0) * frameSeconds) || 0
  const beats = []
  // Backfill to 0 then forward.
  let start = anchor
  while (start - period > 0) start -= period
  for (let t = start; t <= totalSeconds + 1e-6; t += period) {
    if (t >= -1e-6) beats.push(Math.round(Math.max(0, t) * 1000) / 1000)
  }
  return { beats, beatPeriodSeconds: period, anchorSeconds: anchor }
}
