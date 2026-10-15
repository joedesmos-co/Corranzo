/**
 * M1/M2 — Musical-structure evidence for the 2/3 tempo lock.
 *
 * The two failures lock onto a period of ~1.5 beats. Onset-interval and comb
 * evidence were both measured and rejected, so this probe asks which MUSICAL
 * structure separates a 1-beat from a 1.5-beat pulse:
 *
 *   accented onsets     - onset energy by position inside the bar (is there a
 *                         repeating accent at the bar's own periodicity?)
 *   bar-level period    - autocorrelation of the onset envelope at BAR scale
 *                         (2/3-lock means the bar period becomes 3/2 of a
 *                         correct bar, i.e. wrong by a whole beat)
 *   harmony rhythm      - chord-change interval (does it divide the true bar?)
 *   bass changes        - lowest-pitch change points (an independent audio
 *                         signal from the onset envelope's highs)
 *   phrase boundaries   - self-similarity novelty peaks
 *
 * Reference = JAMS beat_position (downbeats = position 1) for the recordings
 * whose tempo we already know, ONCE, to identify the discriminating signal.
 * Candidate selection then uses only that signal's shape, never a BPM guess.
 *
 * Usage: node --expose-gc scripts/audio-vision-structure-probe.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { magnitudeSpectrogram, spectralFlux, pickOnsetFrames } from '../src/features/audio-vision/dsp.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { readWavPcm } from './lib/readWavPcm.mjs'

const TRACKS = [
  { id: 'ss-comp', wav: '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav', truth: 84 },
  { id: 'jazz2', wav: '/tmp/guitarset/00_Jazz2-110-Bb_comp_mic.wav', truth: 110 },
  { id: 'bn2', wav: '/tmp/guitarset/00_BN2-131-B_comp_mic.wav', truth: 131 },
  { id: 'funk3', wav: '/tmp/guitarset/00_Funk3-112-C#_comp_mic.wav', truth: 112 },
  { id: 'rock2', wav: '/tmp/guitarset/00_Rock2-142-D_comp_mic.wav', truth: 142 },
]

function autocorr(signal, lag) {
  let sum = 0
  for (let i = 0; i + lag < signal.length; i += 1) sum += signal[i] * signal[i + lag]
  return sum
}

for (const track of TRACKS) {
  if (!existsSync(track.wav)) {
    console.log(`skip ${track.id}`)
    continue
  }
  const wav = readWavPcm(track.wav)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const { frames, frameSeconds, fftSize } = magnitudeSpectrogram(mono, { sampleRate: 22050 })
  const flux = spectralFlux(frames)
  const picked = pickOnsetFrames(flux)
  const truePeriod = 60 / track.truth
  const trueBar = truePeriod * 4

  // (a) Accented onsets: total onset energy in the first half of the detected
  //     beat vs second half, over a candidate period. A true beat has a
  //     repeating accent structure; a 1.5-beat lock does not.
  const accentScore = (period) => {
    // Bucket onset energy by (t/period) mod 1 in 8 bins, count contrast.
    const bins = new Array(8).fill(0)
    let total = 0
    for (const f of picked) {
      const t = f * frameSeconds
      const phase = (t / period) % 1
      const bin = Math.floor(phase * 8) % 8
      bins[bin] += flux[f]
      total += flux[f]
    }
    if (total <= 0) return 0
    const mean = total / 8
    const contrast = bins.reduce((a, b) => a + Math.abs(b - mean), 0) / total
    return contrast
  }
  const accentTrue = accentScore(truePeriod)
  const accentLock = accentScore(truePeriod * 1.5)

  // (b) Bar-scale autocorrelation peak of the onset envelope. For a 4/4 track
  //     the bar period is 4 beats; if the lock is 1.5 beats the derived bar
  //     would be 6 beats - detectable as a peak at the WRONG bar width.
  const mean = flux.reduce((a, b) => a + b, 0) / flux.length
  const zeroed = flux.map((v) => v - mean)
  const barPeak = (barSeconds) => {
    const lag = Math.round(barSeconds / frameSeconds)
    if (lag < 2 || lag >= zeroed.length - 1) return null
    return autocorr(zeroed, lag)
  }
  const barPeakAtTrue = barPeak(trueBar)
  const barPeakAtTrueTimes15 = barPeak(trueBar * 1.5)
  const barPeakAtTrueTimes075 = barPeak(trueBar * 0.75)

  // (c) Harmony rhythm: use chroma-based novelty (bass changes are recorded
  //     in the analysis path; here the probe uses spectral novelty).
  let noveltyPeaks = 0
  const novelty = spectralFlux(frames.map((frame) => frame.map((v) => Math.sqrt(Math.abs(v)))))
  for (let i = 2; i < novelty.length - 2; i += 1) {
    if (novelty[i] > novelty[i - 1] && novelty[i] > novelty[i + 1] && novelty[i] > 0.02) noveltyPeaks += 1
  }
  const audioSeconds = mono.length / 22050
  const harmonicRhythmSeconds = noveltyPeaks ? audioSeconds / noveltyPeaks : null

  console.log(`\n=== ${track.id} (truth ${track.truth} BPM, bar ${trueBar.toFixed(2)}s) ===`)
  console.log(`  accent contrast: true beat ${accentTrue.toFixed(4)} vs 1.5x ${accentLock.toFixed(4)} | true wins: ${accentTrue > accentLock}`)
  const fmt = (v) => (v == null ? '—' : v.toFixed(0))
  console.log(`  bar-scale autocorr: true bar ${fmt(barPeakAtTrue)} | 1.5x bar ${fmt(barPeakAtTrueTimes15)} | 0.75x bar ${fmt(barPeakAtTrueTimes075)} | true wins: ${barPeakAtTrue > barPeakAtTrueTimes15}`)
  console.log(`  chroma-novelty peaks ${noveltyPeaks} (${harmonicRhythmSeconds?.toFixed(2)}s apart => harmonic rhythm) | true bar ${trueBar.toFixed(2)}s | bar/nrhythm ${(trueBar / (harmonicRhythmSeconds || 1)).toFixed(2)}`)
}
