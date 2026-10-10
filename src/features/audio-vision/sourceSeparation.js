/**
 * A3 — Multi-instrument analysis views (DSP-only for V1; no weight downloads).
 * HPSS harmonic/percussive + bass/presence views. Measures whether separation
 * genuinely helps downstream transcription (energy-ratio + onset-clarity gain).
 */
import { magnitudeSpectrogram, hpssMasks, binToHz } from './dsp.js'
import { PROVENANCE } from './musicAnalysis.js'

export function buildAnalysisViews(samples, sampleRate, { fftSize = 2048, hop = 512, stereoSide = null } = {}) {
  const { frames, frameSeconds } = magnitudeSpectrogram(samples, { sampleRate, fftSize, hop })
  const { harmonic, percussive } = hpssMasks(frames)
  const bass = lowpassView(frames, fftSize, sampleRate, 300)
  const presence = bandView(frames, fftSize, sampleRate, 300, 3400)
  const quality = measureSeparationGain(frames, harmonic, percussive)
  const views = {
    fftSize,
    hop,
    frameSeconds,
    frameCount: frames.length,
    mix: frames,
    harmonic,
    percussive,
    bass,
    presence,
    quality,
    stereo: null,
  }
  // A4: stereo side-channel evidence. Mid IS the mono mix by construction, so
  // there is no "center-extracted stem" to adopt — that claim would be false.
  // What stereo honestly adds: side/mid energy (spaciousness: wide reverberant
  // mixes vs dry centered recordings) and L/R balance, recorded as detected
  // evidence for confidence calibration (adopted only if it predicts quality).
  if (stereoSide?.length) {
    const sideSpec = magnitudeSpectrogram(stereoSide, { sampleRate, fftSize, hop })
    const n = Math.min(frames.length, sideSpec.frames.length)
    let midE = 0
    let sideE = 0
    for (let f = 0; f < n; f += 1) {
      const a = frames[f]
      const b = sideSpec.frames[f]
      for (let k = 0; k < a.length; k += 1) {
        midE += a[k] * a[k]
        sideE += b[k] * b[k]
      }
    }
    const spaciousness = midE + sideE > 1e-12
      ? Math.round((sideE / (midE + sideE)) * 1000) / 1000
      : 0
    views.stereo = { spaciousness, provenance: PROVENANCE.DETECTED }
  }
  return views
}

function lowpassView(frames, fftSize, sampleRate, cutoffHz) {
  return frames.map((spectrum) => {
    const out = new Float64Array(spectrum.length)
    for (let b = 0; b < spectrum.length; b += 1) {
      if (binToHz(b, fftSize, sampleRate) <= cutoffHz) out[b] = spectrum[b]
    }
    return out
  })
}

function bandView(frames, fftSize, sampleRate, loHz, hiHz) {
  return frames.map((spectrum) => {
    const out = new Float64Array(spectrum.length)
    for (let b = 0; b < spectrum.length; b += 1) {
      const hz = binToHz(b, fftSize, sampleRate)
      if (hz >= loHz && hz <= hiHz) out[b] = spectrum[b]
    }
    return out
  })
}

function totalEnergy(frames) {
  let sum = 0
  for (const f of frames) for (let b = 0; b < f.length; b += 1) sum += f[b] * f[b]
  return sum
}

/**
 * Honest gain metric: harmonic-ratio + percussive-ratio + onset-clarity proxy.
 * helpsTranscription is true only when harmonic view concentrates pitched
 * energy AND percussive view captures transients (both ratios sensible).
 */
export function measureSeparationGain(mix, harmonic, percussive) {
  const mixE = totalEnergy(mix) + 1e-12
  const harmE = totalEnergy(harmonic)
  const percE = totalEnergy(percussive)
  const harmonicRatio = harmE / mixE
  const percussiveRatio = percE / mixE
  // Onset clarity: percussive view should be sparser (higher kurtosis proxy via peak/mean).
  let peak = 0
  let sum = 0
  let count = 0
  for (const f of percussive) {
    for (let b = 0; b < f.length; b += 1) {
      const v = f[b]
      sum += v
      count += 1
      if (v > peak) peak = v
    }
  }
  const mean = sum / Math.max(1, count)
  const sparsity = mean > 0 ? peak / mean : 0
  const helpsTranscription = harmonicRatio > 0.25 && harmonicRatio < 0.98 && percussiveRatio > 0.02 && sparsity > 4
  return {
    harmonicRatio: Math.round(harmonicRatio * 1000) / 1000,
    percussiveRatio: Math.round(percussiveRatio * 1000) / 1000,
    percussiveSparsity: Math.round(sparsity * 10) / 10,
    helpsTranscription,
    provenance: PROVENANCE.DETECTED,
  }
}

/** Lead-melody salience: presence-view peak persistence across frames. */
export function extractLeadSalience(presenceFrames, fftSize, sampleRate) {
  const track = []
  for (let f = 0; f < presenceFrames.length; f += 1) {
    const spectrum = presenceFrames[f]
    let best = 0
    let bestBin = -1
    for (let b = 1; b < spectrum.length; b += 1) {
      if (spectrum[b] > best) {
        best = spectrum[b]
        bestBin = b
      }
    }
    track.push({
      frame: f,
      hz: bestBin > 0 ? binToHz(bestBin, fftSize, sampleRate) : 0,
      strength: best,
    })
  }
  return track
}
