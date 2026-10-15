import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAudioFingerprint,
  getTempoStorageKey,
  loadTempoCorrection,
  saveTempoCorrection,
  clearTempoCorrection,
} from '../src/features/audio-vision/tempoCorrectionStorage.js'

// Minimal localStorage stub (jsdom-free environment).
const store = new Map()
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
globalThis.localStorage = localStorageStub

describe('PRIORITY 3 — per-recording tempo correction persistence', () => {
  beforeEach(() => {
    store.clear()
  })

  it('keys corrections by a stable source fingerprint', () => {
    const file = { name: 'song.mp3', size: 1234, lastModified: 99 }
    expect(getAudioFingerprint(file)).toBe('song.mp3::1234::99')
    saveTempoCorrection(getAudioFingerprint(file), 128)
    expect(localStorage.getItem(getTempoStorageKey(getAudioFingerprint(file)))).toBeTruthy()
  })

  it('round-trips a correction for the same recording', () => {
    const fp = getAudioFingerprint({ name: 'a.mp3', size: 10, lastModified: 1 })
    expect(loadTempoCorrection(fp)).toBe(null)
    expect(saveTempoCorrection(fp, 96)).toBe(true)
    const loaded = loadTempoCorrection(fp)
    expect(loaded.bpm).toBe(96)
    expect(loaded.updatedAt).toBeGreaterThan(0)
  })

  it('never applies a correction to an unrelated recording', () => {
    saveTempoCorrection(getAudioFingerprint({ name: 'a.mp3', size: 10, lastModified: 1 }), 96)
    const other = getAudioFingerprint({ name: 'b.mp3', size: 10, lastModified: 1 })
    expect(loadTempoCorrection(other)).toBe(null)
  })

  it('distinguishes recordings that share a name but differ in size', () => {
    saveTempoCorrection('same.mp3::100::1', 90)
    expect(loadTempoCorrection('same.mp3::200::1')).toBe(null)
  })

  it('drops out-of-range or malformed values instead of trusting them', () => {
    const fp = 'guard::1::1'
    expect(saveTempoCorrection(fp, 5)).toBe(false)
    expect(saveTempoCorrection(fp, 900)).toBe(false)
    expect(saveTempoCorrection(fp, 'fast')).toBe(false)
    localStorage.setItem(getTempoStorageKey(fp), '{not json')
    expect(loadTempoCorrection(fp)).toBe(null)
    localStorage.setItem(getTempoStorageKey(fp), JSON.stringify({ bpm: 1000 }))
    expect(loadTempoCorrection(fp)).toBe(null)
  })

  it('clears a correction', () => {
    const fp = 'clear::1::1'
    saveTempoCorrection(fp, 100)
    expect(loadTempoCorrection(fp)?.bpm).toBe(100)
    expect(clearTempoCorrection(fp)).toBe(true)
    expect(loadTempoCorrection(fp)).toBe(null)
  })

  it('is safe without localStorage (SSR/private mode)', () => {
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    expect(loadTempoCorrection('x::1::1')).toBe(null)
    expect(saveTempoCorrection('x::1::1', 100)).toBe(false)
    expect(clearTempoCorrection('x::1::1')).toBe(false)
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  })
})
