/**
 * §5 — Agreement-based transcription confidence and uncertainty regions.
 *
 * Core idea (evidence, not invention): a second, INDEPENDENT transcription
 * pass (model-free spectral peak-picking on the harmonic view) is compared
 * window-by-window with the primary pitch model. Where both agree, the
 * transcription is corroborated; where they diverge, the region is
 * genuinely uncertain and is reported as such. No ground truth is used, so
 * this works at runtime in the browser.
 *
 * Returns { agreement, windows, uncertainRegions, source }.
 */
import { binToHz, hzToMidi } from './dsp.js'
import { PROVENANCE } from './musicAnalysis.js'

const WINDOW_SECONDS = 2
const UNCERTAIN_THRESHOLD = 0.3

/** Top-N pitched peaks per frame -> pitch classes with time support. */
function framePitchClasses(spectrum, fftSize, sampleRate, { minHz = 120, maxHz = 2400, maxPeaks = 5 } = {}) {
  const found = []
  for (let b = 2; b < spectrum.length - 2; b += 1) {
    const hz = binToHz(b, fftSize, sampleRate)
    if (hz < minHz || hz > maxHz) continue
    const midi = hzToMidi(hz)
    if (midi == null) continue
    // Local maxima only.
    if (spectrum[b] < spectrum[b - 1] || spectrum[b] < spectrum[b + 1]) continue
    found.push({ midi: Math.round(midi), mag: spectrum[b] })
  }
  found.sort((a, b) => b.mag - a.mag)
  return found.slice(0, maxPeaks).map((f) => f.midi)
}

/**
 * Model-free second opinion: for each onset interval, the set of pitch
 * classes present (peaks of the harmonic view). Cheap: reuses the existing
 * spectrogram; no model, no download.
 */
export function spectralSecondOpinion({ harmonicFrames, onsets, totalSeconds, fftSize, sampleRate }) {
  if (!Array.isArray(harmonicFrames) || !harmonicFrames.length) return []
  const notes = []
  const boundaries = [...onsets.map((o) => o.seconds)].filter((s) => Number.isFinite(s))
  boundaries.push(totalSeconds)
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i]
    const end = boundaries[Math.min(i + 1, boundaries.length - 1)]
    if (end <= start || end - start < 0.05) continue
    const f0 = Math.max(0, Math.floor(start * (sampleRate / 512)))
    const f1 = Math.min(harmonicFrames.length - 1, Math.ceil(end * (sampleRate / 512)))
    const votes = new Map()
    for (let f = f0; f <= f1; f += 1) {
      const spectrum = Array.from(harmonicFrames[f])
      for (const midi of framePitchClasses(spectrum, fftSize, sampleRate)) {
        if (!votes.has(midi)) votes.set(midi, 0)
        votes.set(midi, votes.get(midi) + 1)
      }
    }
    for (const [midi, count] of votes) {
      if (count >= 2) {
        notes.push({ midi, startSeconds: start, endSeconds: end, provenance: PROVENANCE.DETECTED })
      }
    }
  }
  return notes
}

function pcSet(midis) {
  return new Set(midis.map((m) => ((m % 12) + 12) % 12))
}

/**
 * Compare primary (model) notes against the second opinion per window.
 * windowF1 over sounding pitch classes; agreement = mean over windows.
 */
export function scoreAgreement(primaryNotes, secondOpinionNotes, { totalSeconds, windowSeconds = WINDOW_SECONDS } = {}) {
  if (!totalSeconds || !primaryNotes?.length || !secondOpinionNotes?.length) {
    return { agreement: null, windows: [], uncertainRegions: [], source: 'degraded' }
  }
  const windows = []
  const uncertainRegions = []
  let sum = 0
  let n = 0
  for (let start = 0; start < totalSeconds; start += windowSeconds) {
    const end = Math.min(totalSeconds, start + windowSeconds)
    const primary = pcSet(primaryNotes.filter((note) => note.startSeconds >= start - 0.05 && note.startSeconds < end).map((note) => note.midi))
    const second = pcSet(secondOpinionNotes.filter((note) => note.startSeconds >= start - 0.05 && note.startSeconds < end).map((note) => note.midi))
    if (!primary.size && !second.size) continue
    const inter = [...primary].filter((pc) => second.has(pc)).length
    const prec = second.size ? inter / second.size : 1
    const rec = primary.size ? inter / primary.size : 1
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0
    const entry = {
      startSeconds: Math.round(start * 100) / 100,
      endSeconds: Math.round(end * 100) / 100,
      agreement: Math.round(f1 * 1000) / 1000,
      primaryPitchClasses: primary.size,
      secondPitchClasses: second.size,
    }
    windows.push(entry)
    if (f1 < UNCERTAIN_THRESHOLD) uncertainRegions.push(entry)
    sum += f1
    n += 1
  }
  const agreement = n ? Math.round((sum / n) * 1000) / 1000 : null
  return { agreement, windows, uncertainRegions, source: 'model-vs-spectral' }
}

export const AGREEMENT_WINDOW_SECONDS = WINDOW_SECONDS
export const AGREEMENT_UNCERTAIN_THRESHOLD = UNCERTAIN_THRESHOLD
