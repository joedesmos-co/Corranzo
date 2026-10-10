import { describe, it, expect } from 'vitest'
import {
  validateAudioFile,
  validateDecodedAudio,
  mixToMono,
  resampleLinear,
  normalizePeak,
  importAudioFile,
  sliceExcerpt,
  EXCERPT_MAX_SECONDS,
} from '../src/features/audio-vision/audioImport.js'

function fakeFile(name, size, type = 'audio/mpeg') {
  return { name, size, type }
}

describe('A1 audio import validation', () => {
  it('accepts mp3/wav/m4a', () => {
    for (const name of ['song.mp3', 'take.WAV', 'demo.m4a']) {
      expect(validateAudioFile(fakeFile(name, 1000)).ok).toBe(true)
    }
  })
  it('rejects unsupported formats with guidance', () => {
    const r = validateAudioFile(fakeFile('video.mp4', 1000, 'video/mp4'))
    expect(r.ok).toBe(false)
    expect(r.code).toBe('unsupported-format')
  })
  it('rejects oversize and empty files', () => {
    expect(validateAudioFile(fakeFile('big.mp3', 101 * 1024 * 1024)).code).toBe('file-too-large')
    expect(validateAudioFile(fakeFile('empty.wav', 0)).code).toBe('empty-file')
  })
  it('rejects misnamed non-audio files', () => {
    // %PDF magic with an .mp3 name.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00, 0x00, 0x00]).buffer
    const r = validateAudioFile(fakeFile('fake.mp3', 12), { bytes })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('corrupt-file')
  })
  it('enforces duration limits', () => {
    expect(validateDecodedAudio({ sampleRate: 44100, durationSeconds: 0.5 }).code).toBe('too-short')
    expect(validateDecodedAudio({ sampleRate: 44100, durationSeconds: 601 }).code).toBe('too-long')
    expect(validateDecodedAudio({ sampleRate: 4000, durationSeconds: 10 }).code).toBe('bad-sample-rate')
  })
  it('mixes stereo to mono and normalizes without shifting pitch content', () => {
    const left = Float32Array.from([0.5, -0.5, 0.25])
    const right = Float32Array.from([0.5, -0.5, 0.25])
    const mono = mixToMono([left, right])
    expect(Array.from(mono)).toEqual([0.5, -0.5, 0.25])
    const { samples, gain } = normalizePeak(Float32Array.from([0.25, -0.5]))
    expect(gain).toBeCloseTo(0.89 / 0.5, 5)
    expect(Math.max(...Array.from(samples).map(Math.abs))).toBeCloseTo(0.89, 5)
  })
  it('resamples 44100 -> 22050 preserving length ratio', () => {
    const src = new Float32Array(44100).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 44100))
    const out = resampleLinear(src, 44100)
    expect(out.length).toBe(22050)
  })
  it('full import maps decode failures to user-facing errors', async () => {
    const file = fakeFile('song.mp3', 100)
    const bad = await importAudioFile(file, new ArrayBuffer(100), async () => { throw new Error('EncodingError') })
    expect(bad.ok).toBe(false)
    expect(bad.code).toBe('decode-failed')
    const noDecoder = await importAudioFile(file, new ArrayBuffer(100), null)
    expect(noDecoder.code).toBe('decoder-unavailable')
  })
  it('full import happy path normalizes to 22050 mono', async () => {    const sr = 44100
    const ch = new Float32Array(sr).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr))
    const file = fakeFile('a.wav', 100, 'audio/wav')
    const ok = await importAudioFile(file, new ArrayBuffer(64), async () => ({
      channelData: [ch, ch],
      sampleRate: sr,
      durationSeconds: 1,
      channelCount: 2,
    }))
    expect(ok.ok).toBe(true)
    expect(ok.sampleRate).toBe(22050)
    expect(ok.samples.length).toBe(22050)
  })
  it('slices explicit excerpts and always reports coverage (Phase 7)', () => {
    const sr = 22050
    const samples = new Float32Array(sr * 600) // 10 minutes
    const full = sliceExcerpt(samples, sr, {})
    expect(full.durationSeconds).toBe(EXCERPT_MAX_SECONDS)
    expect(full.truncated).toBe(true)
    expect(full.totalSeconds).toBe(600)
    const mid = sliceExcerpt(samples, sr, { startSeconds: 120, durationSeconds: 60 })
    expect(mid.startSeconds).toBe(120)
    expect(mid.durationSeconds).toBe(60)
    expect(mid.samples.length).toBe(sr * 60)
    expect(mid.truncated).toBe(true)
    const short = sliceExcerpt(new Float32Array(sr * 30), sr, {})
    expect(short.truncated).toBe(false)
    expect(short.durationSeconds).toBe(30)
    // Clamps beyond the end instead of failing.
    const clamp = sliceExcerpt(samples, sr, { startSeconds: 590, durationSeconds: 120 })
    expect(clamp.durationSeconds).toBeLessThanOrEqual(10)
  })
})
