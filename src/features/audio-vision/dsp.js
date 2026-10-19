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
export async function magnitudeSpectrogram(samples, { sampleRate = 22050, fftSize = 2048, hop = 512, onProgress = null } = {}) {
  const size = nextPow2(fftSize)
  const window = hannWindow(size)
  const frames = []
  const totalFrames = Math.max(1, Math.ceil((samples.length - size) / hop) + 1)
  let frameIndex = 0
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
    frameIndex += 1
    // Yield periodically so the browser main thread can paint progress instead
    // of blocking on the whole FFT pass.
    if (frameIndex % 64 === 0) {
      try { onProgress?.(frameIndex / totalFrames) } catch { /* noop */ }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
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
  // Silence-invariant threshold. The median must describe the ACTIVE part of
  // the signal: including leading/trailing silence frames lowers the median in
  // proportion to how much silence is present, which shifts the threshold and
  // changes which peaks qualify. Measured: prepending 1-5 s of silence changed
  // onset recall to 0.52-0.61 and moved the beat phase. Taking the median of
  // frames above 2% of the envelope maximum makes the detector invariant to
  // the amount of surrounding silence.
  const max = envelope.length ? Math.max(...envelope) : 0
  const active = Array.from(envelope).filter((v) => v > max * 0.02)
  const med = median(active.length ? active : Array.from(envelope))
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

/**
 * Median filter with a fixed radius.
 *
 * The window is tiny (radius 8 -> 17 samples) but this runs once per bin per
 * frame, so it is the hottest loop in the analysis. Allocating and sorting a
 * fresh array for every output sample cost seconds of main-thread time on a
 * 30 s recording; a reused buffer with an insertion sort is the same result
 * (a median is a median) at a fraction of the cost.
 */
function medianFilter1D(values, radius) {
  const n = values.length
  const out = new Float64Array(n)
  const width = radius * 2 + 1
  const window = new Float64Array(width)
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n - 1, i + radius)
    const count = hi - lo + 1
    for (let k = 0; k < count; k += 1) window[k] = values[lo + k]
    for (let a = 1; a < count; a += 1) {
      const v = window[a]
      let b = a - 1
      while (b >= 0 && window[b] > v) {
        window[b + 1] = window[b]
        b -= 1
      }
      window[b + 1] = v
    }
    const mid = count >> 1
    out[i] = count % 2 ? window[mid] : (window[mid - 1] + window[mid]) / 2
  }
  return out
}

/**
 * HPSS masks via median filtering (Fitzgerald 2010, light): harmonic mask
 * emphasizes time-continuity, percussive mask frequency-continuity.
 * Returns per-frame { harmonic: Float64Array, percussive: Float64Array } magnitudes.
 */
export async function hpssMasks(frames, { timeRadius = 8, freqRadius = 8, eps = 1e-10, onProgress = null } = {}) {
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
    // Yield so the browser can paint progress instead of blocking on the
    // whole median-filter pass.
    if (b % 64 === 0) {
      try { onProgress?.(b / nBins) } catch { /* noop */ }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
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
    if (f % 64 === 0) {
      try { onProgress?.(0.5 + 0.5 * (f / nFrames)) } catch { /* noop */ }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
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

const EXTENSION_PC = { major7: 11, minor7: 10, dominant7: 10, suspended4: 5 }

/** Drop claimed extensions whose tone lacks real energy (passing tones). */
function guardExtensions(chroma, candidates, best) {
  const ext = EXTENSION_PC[best.quality]
  if (ext == null) return best
  const extEnergy = chroma[(best.root + ext) % 12] ?? 0
  const rootEnergy = chroma[best.root] ?? 0
  if (extEnergy >= rootEnergy * 0.45) return best
  return candidates.find((s) => s.root === best.root && (s.quality === 'major' || s.quality === 'minor' || s.quality === 'diminished')) ?? best
}

/**
 * Occam's razor for chord quality: when a 4-note extension beats a simple
 * triad of the SAME root by a hair, prefer the triad. Measured on real chord
 * labels (GuitarSet comping, CC-BY-4.0): plain-major chords were being read
 * as maj7 (root right, quality wrong) whenever the guitarist's voicing
* happened to ring a seventh strongly. A triad is the simpler explanation and
 * the score gap is not evidence for the extension.
 */
function preferSimplerWhenClose(candidates, best, { margin = 0.02 } = {}) {
  const isExtended = ['major7', 'minor7', 'dominant7', 'suspended4', 'diminished'].includes(best.quality)
  if (!isExtended) return best
  const simpler = candidates.find((s) => s.root === best.root && ['major', 'minor'].includes(s.quality))
  if (!simpler) return best
  return best.score - simpler.score <= margin ? simpler : best
}

/**
 * Downgrade a claimed seventh when the transcription itself did not hear the
 * seventh. Measured on real chord labels (GuitarSet comping, CC-BY-4.0): at
 * windows where both the notes and the annotation agree the 7th is absent,
 * chroma smearing still let 4-note templates outscore the true triad, so
 * 'maj' became 'maj7'. Only notes the model actually transcribed corroborate
 * an extension's existence.
 */
const SEVENTH_TO_TRIAD = {
  major7: { quality: 'major', suffix: '' },
  minor7: { quality: 'minor', suffix: 'm' },
  dominant7: { quality: 'major', suffix: '' },
}

export function downgradeUnheardExtension(recognition, heardPcs, { enabled = true } = {}) {
  if (!enabled) return recognition
  if (!recognition || !Array.isArray(heardPcs)) return recognition
  const ext = EXTENSION_PC[recognition.quality]
  const target = SEVENTH_TO_TRIAD[recognition.quality]
  if (ext == null || !target) return recognition
  const extPc = (recognition.root + ext) % 12
  if (heardPcs.includes(extPc)) return recognition
  return {
    ...recognition,
    quality: target.quality,
    suffix: target.suffix,
    label: `${PITCH_CLASS_NAMES[recognition.root]}${target.suffix}`,
    downgradedFrom: recognition.quality,
  }
}

/** Best-matching template constrained to a fixed root (bass prior). */
export function recognizeChordWithRoot(chroma, root) {
  const candidates = []
  for (const t of CHORD_TEMPLATES) {
    if (t.root !== root) continue
    let dot = 0
    let norm = 0
    for (let i = 0; i < 12; i += 1) {
      dot += chroma[i] * t.weights[i]
      norm += t.weights[i] * t.weights[i]
    }
    candidates.push({ root: t.root, quality: t.quality, score: dot / (Math.sqrt(norm) + 1e-9), suffix: t.suffix })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score)
  const best = preferSimplerWhenClose(candidates, guardExtensions(chroma, candidates, candidates[0]))
  return { ...best, label: `${PITCH_CLASS_NAMES[best.root]}${best.suffix}` }
}
/** Template-match chroma → { root, quality, score, label }. Score is cosine-ish 0..1. */
export function recognizeChord(chroma) {
  const scored = CHORD_TEMPLATES.map((t) => {
    let dot = 0
    let norm = 0
    for (let i = 0; i < 12; i += 1) {
      dot += chroma[i] * t.weights[i]
      norm += t.weights[i] * t.weights[i]
    }
    // Length-normalize so 4-note templates don't outscore triads for free.
    return { root: t.root, quality: t.quality, suffix: t.suffix, score: dot / (Math.sqrt(norm) + 1e-9) }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = preferSimplerWhenClose(scored, guardExtensions(chroma, scored, scored[0] ?? { root: 0, quality: 'major', score: 0, suffix: '' }))
  return { ...best, label: `${PITCH_CLASS_NAMES[best.root]}${best.suffix}` }
}

/** Autocorrelation tempo from onset envelope. Returns { bpm, confidence, octaveAlternative }. */
// Tempo search range. 200 BPM halved a 202 BPM recording to 99 (measured),
// silently writing every duration twice as long. Raised to 240 so double-time
// and fast electronic genres are not octave-halved. Lower bound stays 55 BPM:
// slower material is reported at its double-time pulse (see the octave note in
// estimateTempoFromEnvelope) with the original reading in octaveAlternative.
export async function estimateTempoFromEnvelope(envelope, frameSeconds, { minBpm = 55, maxBpm = 240 } = {}) {
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
    if (lag % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (!bestLag) return { bpm: 120, confidence: 0, octaveAlternative: null, method: 'default' }
  const bpm = 60 / (bestLag * frameSeconds)
  const half = scores.get(bestLag * 2) ?? -Infinity
  const dbl = scores.get(Math.round(bestLag / 2)) ?? -Infinity
  // Octave handling, now documented rather than hidden:
  //  * HALVING REMOVED: the old `bpm > 170` rule turned a real 202 BPM
  //    recording into 99 BPM, writing every duration twice as long. With the
  //    ceiling at 240, a reading above it is corrected down; anything inside
  //    the searched range is trusted.
  //  * DOUBLING KEPT for sub-90 BPM readings: it fixes the very common case
  //    where the autocorrelation locks onto the half-note pulse (a clean
  //    120 BPM pulse reads 60 without it). Consequence, documented as a V1
  //    limit: material genuinely slower than ~90 BPM is reported at its
  //    double-time pulse (a 43 BPM ballad reads 86). `octaveAlternative` always
  //    carries the other reading.
  let chosen = bpm
  let alt = null
  const altBpm = 60 / (Math.round(bestLag / 2) * frameSeconds)
  if (bpm > maxBpm) {
    const halfBpm = 60 / (bestLag * 2 * frameSeconds)
    if (half > bestVal * 0.8 && halfBpm >= minBpm) {
      alt = Math.round(bpm)
      chosen = halfBpm
    }
  } else if (bpm < 90 && dbl > bestVal * 0.88 && altBpm <= maxBpm) {
    alt = Math.round(bpm)
    chosen = altBpm
  }
  const variance = scores.size
    ? [...scores.values()].reduce((a, b) => a + (b - bestVal) ** 2, 0) / scores.size
    : 1
  const confidence = Math.max(0, Math.min(1, bestVal / (Math.sqrt(Math.max(variance, 1e-12)) * 6 + 1e-9)))
  // REJECTED EXPERIMENT (measured, then removed): octave disambiguation from
  // the inter-onset interval histogram. It chose the shortest commonly
  // occurring interval, which is an eighth-note gap rather than the beat, and
  // turned correct readings into 2-3x errors (ss-comp 86 -> 172, funk3
  // 74 -> 221, jazz3 68 -> 204). The autocorrelation's own octave rules stay.
  // REJECTED, TWICE MEASURED. Accent-contrast pulse selection:
  //   run 1 (family-wide maximisation): funk3 74->56, jazz2 112->84 - two
  //     correct recordings broken, none fixed.
  //   run 2 (narrow 1.5 / 0.667 only): ss-comp 86 (kept correct), funk3 74
  //     (still a 2/3 lock), rock2 96 (still a 2/3 lock), bn2 129 (kept
  //     correct), jazz2 112->168 - broke a correct recording to a 3/2 lock.
  // Both forms move correct recordings and fix none, so the 2/3 lock is not
  // fixable from onset-phase accent structure. Left in place as documented
  // evidence rather than removed, with the call opt-in only.
  const chosenTempo = Math.round(Math.max(minBpm, Math.min(maxBpm, chosen)))
  // Tempo ambiguity, reported instead of implied. Slow material is the usual
  // victim: a genuine ~45 BPM ballad and its double-time pulse are frequently
  // indistinguishable from an onset envelope alone, and we deliberately prefer
  // the faster reading. Flag it so downstream UI can say "tempo approximate"
  // rather than present one confident number.
  // Any sub-90 BPM reading in this pipeline is a stylistic preference (we
  // prefer the double-time pulse), not a certainty, so it is flagged.
  //
  // REJECTED EXPERIMENT (measured on the frozen timing benchmark, then
  // removed): flagging ambiguity from the comb-salience of the octave/multiple
  // family. The benchmark's two wrong readings are a 2/3 ratio (period = 1.5
  // beats), which the octave rules never catch. Salience was a promising
  // discriminator, but the measurement says it cannot decide these cases:
  //   ss-comp  (correct, 84):  own 6.14, best family member 5.29  (ratio 0.86)
  //   jazz2    (correct, 112): own 4.40, 2x member 4.40           (ratio 1.00)
  //   rock2    (WRONG, 96 vs 142): own 3.33, true 3.24            (ratio 0.97)
  //   funk3    (WRONG, 74 vs 112): own 5.47, true 4.40            (ratio 0.80)
  // i.e. a correct reading and a wrong reading can have the SAME family
  // profile (jazz2 correct at ratio 1.00; rock2 wrong at 0.97), so no threshold
  // separates them. The flag added false ambiguity to two correct recordings
  // and still missed the funk3 case, so it is removed. The 2/3 tempo lock
  // remains an open, documented blocker rather than a fixed one.
  const ambiguous = alt != null || chosenTempo < 90
  return {
    bpm: chosenTempo,
    confidence: Math.round(confidence * 100) / 100,
    octaveAlternative: alt,
    ambiguousTempo: Boolean(ambiguous),
    method: 'autocorr-onset',
  }
}



/** Beat grid from tempo + first strong onset anchor. */
export function buildBeatGrid({ onsetFrames, frameSeconds, bpm, totalSeconds, anchorFrame = null, flux = null }) {
  // REJECTED EXPERIMENT (measured, then removed): flux-based phase refinement.
  // It searched for the grid phase that puts the most onset energy on beats, but
  // the median residual against MIDI truth got slightly worse on two of three
  // recordings (0.406 -> 0.475, 0.394 -> 0.563) and no better on the third, so
  // it is removed rather than kept as an unproven heuristic. The residual turns
  // out NOT to be a transcription defect: the MEDIAN residual of the truth's own
  // onsets to this grid (0.243-0.260) matches the transcriptions' (0.227-0.238),
  // i.e. transcription is faithful and the remaining offset is grid phase.
  void flux
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

/**
 * Choose between a tempo and its simple multiples using the inter-onset
 * interval histogram. Returns the candidate whose beat period best matches the
 * shortest commonly-occurring onset interval in the same octave family, or
 * null when the evidence does not separate them.
 */
export function preferTempoByOnsetIntervals(bpm, envelope, frameSeconds, { minBpm, maxBpm } = {}) {
  const onsets = []
  let previous = null
  const mean = envelope.reduce((a, b) => a + b, 0) / Math.max(1, envelope.length)
  for (let i = 1; i < envelope.length; i += 1) {
    const value = envelope[i]
    if (previous != null && value < previous * 0.7 && previous > mean * 1.4) {
      onsets.push(i * frameSeconds)
      previous = null
    } else if (value > mean * 1.4) {
      previous = value
    }
  }
  if (onsets.length < 4) return null
  const intervals = []
  for (let i = 1; i < onsets.length; i += 1) {
    const d = onsets[i] - onsets[i - 1]
    if (d > 0.15) intervals.push(d)
  }
  if (intervals.length < 4) return null
  intervals.sort((a, b) => a - b)
  // The beat period is close to a low order statistic of the IOIs: the
  // shortest recurring gap that still spans the phrase (use the 15-35% band).
  const lo = intervals[Math.floor(intervals.length * 0.15)]
  const hi = intervals[Math.floor(intervals.length * 0.35)]
  const reference = (lo + hi) / 2
  const candidates = [bpm]
  for (const factor of [2, 3, 1.5]) candidates.push(bpm * factor)
  for (const factor of [2, 3, 1.5]) candidates.push(bpm / factor)
  let best = null
  let bestScore = Infinity
  for (const candidate of candidates) {
    if (!(candidate >= minBpm && candidate <= maxBpm)) continue
    const period = 60 / candidate
    // Score = how close the reference IOI is to an integer number of beats.
    const beats = Math.max(1, Math.round(reference / period))
    const score = Math.abs(reference / period - beats)
    if (score < bestScore - 1e-6) {
      bestScore = score
      best = candidate
    }
  }
  // Only override when the evidence clearly favours another multiple.
  if (best == null || Math.abs(best - bpm) < 1) return null
  return best
}

/**
 * Meter inference from accent pattern (M3).
 *
 * V1 emitted everything in 4/4. Instead of assuming, score each candidate
 * meter by how well the strongest beats land on its downbeats: beat i is a
 * downbeat of meter m when i mod m === 0, so meter m explains the accents
 * when onsets cluster at those positions. A meter is only accepted if it beats
 * the runner-up by a clear margin; otherwise the result is `uncertain` and the
 * caller keeps 4/4 while SAYING the meter is unverified.
 *
 * @param onsetFrames detected onset frame indices
 * @param frameSeconds seconds per analysis frame
 * @param bpm chosen tempo (only used to place beats; meters are relative)
 * @param candidates meters to consider (default 2,3,4,6)
 */
export function inferMeter(onsetFrames = [], frameSeconds, bpm, { candidates = [3, 4], margin = 0.15 } = {}) {
  const period = 60 / Math.max(1, bpm)
  const anchor = (onsetFrames[0] ?? 0) * frameSeconds
  const beatStrengths = []
  for (let t = anchor % period, i = 0; t <= (onsetFrames.length ? onsetFrames[onsetFrames.length - 1] * frameSeconds : 0); t += period, i += 1) {
    let strength = 0
    for (const frame of onsetFrames) {
      if (Math.abs(frame * frameSeconds - t) <= period * 0.2) strength += 1
    }
    beatStrengths.push(strength)
  }
  if (beatStrengths.length < candidates.length * 2) {
    return { meter: 4, uncertain: true, scores: {} }
  }
  const scores = {}
  for (const m of candidates) {
    let down = 0
    let off = 0
    beatStrengths.forEach((s, i) => {
      if (i % m === 0) down += s
      else off += s
    })
    const downCount = Math.ceil(beatStrengths.length / m)
    const offCount = beatStrengths.length - downCount
    scores[m] = down / Math.max(1, downCount) - off / Math.max(1, offCount)
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [bestMeter, bestScore] = ranked[0]
  const runnerUp = ranked[1]?.[1] ?? -Infinity
  const uncertain = !(bestScore - runnerUp >= margin)
  return { meter: Number(uncertain ? bestMeter : bestMeter), scores, uncertain, best: Number(bestMeter) }
}
