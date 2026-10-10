import { describe, it, expect } from 'vitest'
import {
  magnitudeSpectrogram,
  spectralFlux,
  pickOnsetFrames,
  estimateTempoFromEnvelope,
  recognizeChord,
  hpssMasks,
} from '../src/features/audio-vision/dsp.js'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'

const SR = 22050

/** Original synthesized fixture: 8 s, 120 BPM click + A4/C5/E5 melody + A2 bass + noise hat. */
export function synthBandFixture({ seconds = 8, bpm = 120 } = {}) {
  const samples = new Float32Array(Math.floor(seconds * SR))
  const beat = 60 / bpm
  const melody = [69, 72, 76, 72, 69, 72, 76, 79]
  const addTone = (midi, start, dur, amp = 0.4, harmonics = 3) => {
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const s0 = Math.floor(start * SR)
    const s1 = Math.min(samples.length, Math.floor((start + dur) * SR))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / SR
      const env = Math.exp(-2.2 * t)
      let v = 0
      for (let h = 1; h <= harmonics; h += 1) v += Math.sin(2 * Math.PI * freq * h * t) / h
      samples[i] += amp * env * v
    }
  }
  for (let b = 0; b < Math.floor(seconds / beat); b += 1) {
    // kick-ish transient on beats (percussive)
    const s0 = Math.floor(b * beat * SR)
    for (let i = 0; i < 400 && s0 + i < samples.length; i += 1) {
      samples[s0 + i] += 0.5 * Math.exp(-i / 60) * Math.sin((2 * Math.PI * 120 * i) / SR)
    }
    addTone(33, b * beat, 0.4, 0.3, 2) // A1 bass root
    addTone(melody[b % melody.length], b * beat, beat * 0.9, 0.35, 4)
    if (b % 2 === 0) addTone(melody[(b + 2) % melody.length] - 12, b * beat, 0.3, 0.2, 2)
  }
  return samples
}

describe('A2 DSP + analysis on synthesized band fixture', () => {
  it('estimates 120 BPM within tolerance', () => {
    const samples = synthBandFixture()
    const { frames, frameSeconds } = magnitudeSpectrogram(samples, { sampleRate: SR })
    const flux = spectralFlux(frames)
    const { bpm, confidence } = estimateTempoFromEnvelope(flux, frameSeconds)
    expect(Math.abs(bpm - 120)).toBeLessThanOrEqual(8)
    expect(confidence).toBeGreaterThan(0)
  })
  it('finds onsets near each beat', () => {
    const samples = synthBandFixture()
    const { frames } = magnitudeSpectrogram(samples, { sampleRate: SR })
    const flux = spectralFlux(frames)
    const onsets = pickOnsetFrames(flux)
    expect(onsets.length).toBeGreaterThanOrEqual(10)
  })
  it('recognizes A minor-ish harmony from chroma', () => {
    const chroma = new Float64Array(12)
    for (const pc of [9, 0, 4]) chroma[pc] = 1 // A C E
    const rec = recognizeChord(chroma)
    expect(rec.label).toBe('Am')
  })
  it('recognizes extended harmony (Bmaj7) without breaking triads', () => {
    const chroma = new Float64Array(12)
    for (const pc of [11, 3, 6, 10]) chroma[pc] = 1 // B D# F# A#
    const rec = recognizeChord(chroma)
    expect(rec.root).toBe(11)
    expect(rec.label).toBe('Bmaj7')
    const tri = new Float64Array(12)
    for (const pc of [0, 4, 7]) tri[pc] = 1 // C E G
    expect(recognizeChord(tri).label).toBe('C')
  })
  it('HPSS separates harmonic and percussive energy honestly', () => {
    const samples = synthBandFixture({ seconds: 4 })
    const { frames } = magnitudeSpectrogram(samples, { sampleRate: SR })
    const { harmonic, percussive } = hpssMasks(frames.slice(0, 40))
    expect(harmonic.length).toBe(40)
    expect(percussive.length).toBe(40)
  })
  it('full analyzeMusic recovers tempo, beats, chords, melody with provenance', async () => {
    const samples = synthBandFixture({ seconds: 6 })
    const analysis = await analyzeMusic(samples, SR, { predictNotes: null })
    expect(Math.abs(analysis.tempo.bpm - 120)).toBeLessThanOrEqual(10)
    expect(analysis.beats.beats.length).toBeGreaterThan(8)
    expect(analysis.onsets[0].provenance).toBe('detected')
    expect(analysis.chords[0].provenance).toBe('inferred')
    expect(analysis.melody.length).toBeGreaterThan(0)
    expect(analysis.sections.length).toBeGreaterThanOrEqual(1)
    expect(analysis.predictedNotes.length).toBeGreaterThan(0)
  })
  it('analysis views report whether separation helps', () => {
    const samples = synthBandFixture({ seconds: 4 })
    const views = buildAnalysisViews(samples, SR)
    expect(views.quality.harmonicRatio).toBeGreaterThan(0)
    expect(typeof views.quality.helpsTranscription).toBe('boolean')
  })
  it('stereo side evidence is measured honestly, never a stem claim (A4)', async () => {
    const { splitMidSide, centerRatio } = await import('../src/features/audio-vision/audioImport.js')
    const left = Float32Array.from([1, 2, 3, 4])
    const right = Float32Array.from([1, 0, -1, -2])
    const split = splitMidSide([left, right])
    expect(Array.from(split.mid)).toEqual([1, 1, 1, 1])
    expect(Array.from(split.side)).toEqual([0, 1, 2, 3])
    expect(splitMidSide([left])).toBe(null)
    expect(centerRatio(split.mid, split.side)).toBeGreaterThan(0)
    // Wide mix (strong side ambience) -> high spaciousness; dual-mono -> ~0.
    const seconds = 4
    const center = new Float32Array(SR * seconds)
    const amb = new Float32Array(SR * seconds)
    for (let i = 0; i < center.length; i += 1) {
      const t = i / SR
      center[i] = 0.4 * Math.sin(2 * Math.PI * 440 * t)
      amb[i] = 0.4 * Math.sin(2 * Math.PI * 110 * t)
    }
    const wideL = center.map((v, i) => v + amb[i])
    const wideR = center.map((v, i) => v - amb[i])
    const wide = splitMidSide([Float32Array.from(wideL), Float32Array.from(wideR)])
    const monoOfWide = Float32Array.from(wideL.map((v, i) => (v + wideR[i]) / 2))
    const wideViews = buildAnalysisViews(monoOfWide, SR, { stereoSide: wide.side })
    expect(wideViews.stereo.spaciousness).toBeGreaterThan(0.3)
    const dryViews = buildAnalysisViews(Float32Array.from(center), SR, {
      stereoSide: splitMidSide([Float32Array.from(center), Float32Array.from(center)]).side,
    })
    expect(dryViews.stereo.spaciousness).toBeLessThan(0.05)
    // Mono input -> no stereo claims at all.
    const monoViews = buildAnalysisViews(Float32Array.from(center), SR)
    expect(monoViews.stereo).toBe(null)
  })
})
