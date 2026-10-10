/**
 * A2 — Music analysis: tempo, beats, onsets, chroma/chords, melody, bass, sections.
 * Every output item carries provenance: detected | predicted | inferred.
 * Inferred musical claims are never labeled detected.
 */
import {
  magnitudeSpectrogram,
  spectralFlux,
  pickOnsetFrames,
  estimateTempoFromEnvelope,
  buildBeatGrid,
  chromaOfSpectrum,
  recognizeChord,
  hzToMidi,
  binToHz,
} from './dsp.js'

export const PROVENANCE = {
  DETECTED: 'detected', // direct DSP evidence (onsets, spectral peaks)
  PREDICTED: 'predicted', // neural model output (Basic Pitch note events)
  INFERRED: 'inferred', // musical inference from evidence (chords, sections, quantization)
  ARRANGED: 'arranged', // arrangement decision for playability
}

function dominantMelodyMidi(spectrum, fftSize, sampleRate, { minHz = 180, maxHz = 1400 } = {}) {
  let bestBin = -1
  let bestVal = 0
  for (let b = 1; b < spectrum.length; b += 1) {
    const hz = binToHz(b, fftSize, sampleRate)
    if (hz < minHz || hz > maxHz) continue
    if (spectrum[b] > bestVal) {
      bestVal = spectrum[b]
      bestBin = b
    }
  }
  if (bestBin < 0 || bestVal <= 1e-9) return null
  // Parabolic interpolation for sub-bin accuracy.
  const prev = spectrum[bestBin - 1] ?? 0
  const next = spectrum[bestBin + 1] ?? 0
  const denom = prev - 2 * spectrum[bestBin] + next
  const delta = denom !== 0 ? (0.5 * (prev - next)) / denom : 0
  const hz = binToHz(bestBin + Math.max(-0.5, Math.min(0.5, delta)), fftSize, sampleRate)
  return { midiFloat: hzToMidi(hz), strength: bestVal, hz }
}

function bassMidi(spectrum, fftSize, sampleRate, { minHz = 40, maxHz = 250 } = {}) {
  let bestBin = -1
  let bestVal = 0
  for (let b = 1; b < spectrum.length; b += 1) {
    const hz = binToHz(b, fftSize, sampleRate)
    if (hz < minHz || hz > maxHz) continue
    if (spectrum[b] > bestVal) {
      bestVal = spectrum[b]
      bestBin = b
    }
  }
  if (bestBin < 0 || bestVal <= 1e-9) return null
  return { midiFloat: hzToMidi(binToHz(bestBin, fftSize, sampleRate)), strength: bestVal }
}

/**
 * Analyze mono 22050 Hz samples. views: { harmonic, percussive } magnitude frames (optional).
 * predictNotes: async (samples) => [{ midi, startSeconds, endSeconds }] | null (Basic Pitch).
 */
export async function analyzeMusic(samples, sampleRate, { views = null, predictNotes = null, onProgress = null } = {}) {
  const totalSeconds = samples.length / sampleRate
  const report = (stage, fraction) => {
    try { onProgress?.({ stage, fraction }) } catch { /* noop */ }
  }
  report('spectrogram', 0.05)
  const { frames, fftSize, hop, frameSeconds } = magnitudeSpectrogram(samples, { sampleRate })
  const harmFrames = views?.harmonic ?? frames
  report('onsets', 0.2)
  const flux = spectralFlux(frames)
  const onsetFrames = pickOnsetFrames(flux)
  const onsets = onsetFrames.map((f) => ({
    seconds: Math.round(f * frameSeconds * 1000) / 1000,
    strength: Math.round(flux[f] * 1e6) / 1e6,
    provenance: PROVENANCE.DETECTED,
  }))
  report('tempo', 0.35)
  const tempo = estimateTempoFromEnvelope(flux, frameSeconds)
  // Sectional re-estimate for tempo variation: split in thirds, flag drift.
  const third = Math.floor(flux.length / 3)
  const sectionTempos = [0, 1, 2].map((s) => {
    const seg = flux.slice(s * third, s === 2 ? flux.length : (s + 1) * third)
    return estimateTempoFromEnvelope(seg, frameSeconds).bpm
  })
  const tempoVaries = Math.max(...sectionTempos) - Math.min(...sectionTempos) >= 8
  report('beats', 0.45)
  const { beats, beatPeriodSeconds } = buildBeatGrid({ onsetFrames, frameSeconds, bpm: tempo.bpm, totalSeconds })
  report('harmony', 0.6)
  // Chord per beat window from harmonic-view chroma.
  const chords = []
  for (let i = 0; i < beats.length; i += 1) {
    const start = beats[i]
    const end = i + 1 < beats.length ? beats[i + 1] : totalSeconds
    const f0 = Math.max(0, Math.floor(start / frameSeconds))
    const f1 = Math.min(harmFrames.length - 1, Math.ceil(end / frameSeconds))
    const acc = new Float64Array(12)
    let count = 0
    for (let f = f0; f <= f1; f += 1) {
      const c = chromaOfSpectrum(harmFrames[f], fftSize, sampleRate)
      for (let k = 0; k < 12; k += 1) acc[k] += c[k]
      count += 1
    }
    if (count > 0) for (let k = 0; k < 12; k += 1) acc[k] /= count
    const rec = recognizeChord(acc)
    chords.push({
      startSeconds: start,
      endSeconds: Math.round(end * 1000) / 1000,
      ...rec,
      confidence: Math.round(Math.min(1, rec.score) * 100) / 100,
      provenance: PROVENANCE.INFERRED,
    })
  }
  report('melody-bass', 0.75)
  const melody = []
  const bassLine = []
  for (let f = 0; f < harmFrames.length; f += 1) {
    const m = dominantMelodyMidi(harmFrames[f], fftSize, sampleRate)
    if (m && m.strength > 1e-7) {
      melody.push({
        seconds: Math.round(f * frameSeconds * 1000) / 1000,
        midiFloat: Math.round(m.midiFloat * 10) / 10,
        midi: Math.round(m.midiFloat),
        strength: m.strength,
        provenance: PROVENANCE.DETECTED,
      })
    }
    if (f % 2 === 0) {
      const b = bassMidi(frames[f], fftSize, sampleRate)
      if (b) {
        bassLine.push({
          seconds: Math.round(f * frameSeconds * 1000) / 1000,
          midi: Math.round(b.midiFloat),
          provenance: PROVENANCE.DETECTED,
        })
      }
    }
  }
  report('sections', 0.85)
  const sections = detectSections(frames, frameSeconds, totalSeconds)
  report('notes', 0.9)
  let predictedNotes = []
  let pitchSource = 'spectral-fallback'
  if (typeof predictNotes === 'function') {
    try {
      const events = await predictNotes(samples)
      if (Array.isArray(events) && events.length) {
        predictedNotes = events.map((e) => ({
          midi: Math.round(e.midi ?? e.pitchMidi ?? 0),
          startSeconds: Number(e.startSeconds ?? e.startTimeSeconds ?? 0),
          endSeconds: Number(e.endSeconds ?? (e.startTimeSeconds ?? 0) + (e.durationSeconds ?? 0)),
          provenance: PROVENANCE.PREDICTED,
        })).filter((e) => e.midi >= 21 && e.midi <= 108 && e.endSeconds > e.startSeconds)
        pitchSource = 'basic-pitch'
      }
    } catch {
      predictedNotes = []
    }
  }
  if (!predictedNotes.length) {
    predictedNotes = contourToNotes(melody, onsets)
  }
  report('done', 1)
  const hopSeconds = hop / sampleRate
  return {
    totalSeconds: Math.round(totalSeconds * 1000) / 1000,
    sampleRate,
    tempo: { ...tempo, varies: tempoVaries, sectionTempos, provenance: PROVENANCE.INFERRED },
    beats: { beats, beatPeriodSeconds, provenance: PROVENANCE.INFERRED },
    onsets,
    chords,
    melody,
    bassLine,
    sections,
    predictedNotes,
    pitchSource,
    frameSeconds,
    hopSeconds,
    spectrum: { fftSize, frameCount: frames.length },
  }
}

/** Novelty-based section boundaries (self-similarity drop). Inferred, low-stakes. */
export function detectSections(frames, frameSeconds, totalSeconds) {
  if (frames.length < 16) {
    return [{ startSeconds: 0, endSeconds: Math.round(totalSeconds * 1000) / 1000, label: 'A', provenance: PROVENANCE.INFERRED }]
  }
  const step = Math.max(1, Math.floor(frames.length / 64))
  const sampled = frames.filter((_, i) => i % step === 0)
  const novelty = []
  for (let i = 4; i < sampled.length - 4; i += 1) {
    let before = 0
    let after = 0
    for (let k = 1; k <= 4; k += 1) {
      before += cosineDist(sampled[i], sampled[i - k])
      after += cosineDist(sampled[i], sampled[i + k])
    }
    novelty.push({ index: i, value: (before + after) / 8 })
  }
  const mean = novelty.reduce((a, b) => a + b.value, 0) / Math.max(1, novelty.length)
  const boundaries = novelty
    .filter((n) => n.value > mean * 1.6)
    .filter((n, i, arr) => i === 0 || n.index - arr[i - 1].index > 6)
    .slice(0, 6)
    .map((n) => Math.round((n.index * step * frameSeconds) * 1000) / 1000)
    .filter((t) => t > 3 && t < totalSeconds - 3)
    .sort((a, b) => a - b)
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  const points = [0, ...boundaries, Math.round(totalSeconds * 1000) / 1000]
  return points.slice(0, -1).map((start, i) => ({
    startSeconds: start,
    endSeconds: points[i + 1],
    label: labels[i % labels.length],
    provenance: PROVENANCE.INFERRED,
  }))
}

function cosineDist(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 1
  return 1 - dot / (Math.sqrt(na * nb) + 1e-12)
}

/** Fallback: melody contour → note events segmented at onsets. Provenance stays detected-derived. */
export function contourToNotes(melodyFrames, onsets) {
  if (!melodyFrames.length) return []
  const boundaries = new Set(onsets.map((o) => o.seconds))
  const notes = []
  let current = null
  for (const m of melodyFrames) {
    if (!current || boundaries.has(m.seconds) || Math.abs(m.midi - current.midi) > 1.5) {
      if (current) {
        current.endSeconds = m.seconds
        if (current.endSeconds - current.startSeconds >= 0.08) notes.push(current)
      }
      current = { midi: m.midi, startSeconds: m.seconds, endSeconds: m.seconds + 0.15, provenance: PROVENANCE.DETECTED }
    } else {
      current.endSeconds = m.seconds + 0.05
    }
  }
  if (current) {
    if (current.endSeconds - current.startSeconds >= 0.08) notes.push(current)
  }
  return notes
}
