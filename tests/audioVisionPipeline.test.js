import { describe, it, expect } from 'vitest'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { synthBandFixture } from './audioVisionAnalysis.test.js'

const SR = 22050

function wavDecodeOf(samples, sampleRate = SR) {
  return async () => ({
    channelData: [samples],
    sampleRate,
    durationSeconds: samples.length / sampleRate,
    channelCount: 1,
  })
}

function fakeFile(name = 'song.mp3', size = 50000) {
  return { name, size, type: 'audio/mpeg' }
}

describe('A10 end-to-end pipeline (no ground-truth substitution)', () => {
  it('mp3 band fixture -> solo piano arrangement with valid MusicXML', async () => {
    const samples = synthBandFixture({ seconds: 6 })
    const out = await runAudioArrangementPipeline(fakeFile('band.mp3'), new ArrayBuffer(64), {
      targetPart: 'solo-piano',
      difficulty: 'intermediate',
    }, {
      decodeAudioDataImpl: wavDecodeOf(samples),
      predictNotes: null, // spectral path only — real analysis, no cheating
    })
    expect(out.ok).toBe(true)
    expect(out.musicXml).toContain('<score-partwise')
    expect(out.model.parts).toHaveLength(1)
    expect(out.confidence.overall).toBeGreaterThan(0)
    expect(out.analysis.pitchSource).toBe('spectral-fallback')
  }, 60000)

  it('same fixture -> solo guitar with TAB', async () => {
    const samples = synthBandFixture({ seconds: 6 })
    const out = await runAudioArrangementPipeline(fakeFile('band.mp3'), new ArrayBuffer(64), {
      targetPart: 'solo-guitar',
      difficulty: 'easy',
    }, {
      decodeAudioDataImpl: wavDecodeOf(samples),
      predictNotes: null,
    })
    expect(out.ok).toBe(true)
    expect(out.musicXml).toContain('<technical>')
  }, 60000)

  it('refuses silence/noise instead of inventing music (A12)', async () => {
    const noise = new Float32Array(SR * 4).map(() => (Math.random() - 0.5) * 0.0005)
    const out = await runAudioArrangementPipeline(fakeFile('hiss.wav'), new ArrayBuffer(64), {
      targetPart: 'solo-piano',
      difficulty: 'easy',
    }, {
      decodeAudioDataImpl: wavDecodeOf(noise),
      predictNotes: null,
    })
    expect(out.ok).toBe(false)
    expect(['low-confidence', 'empty-audio']).toContain(out.code)
  }, 60000)

  it('rejects unsupported part + bad file honestly', async () => {
    const bad = await runAudioArrangementPipeline({ name: 'x.xyz', size: 10 }, new ArrayBuffer(10), {
      targetPart: 'solo-piano',
      difficulty: 'easy',
    }, { decodeAudioDataImpl: null })
    expect(bad.ok).toBe(false)
  })
})
