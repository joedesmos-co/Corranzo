/**
 * The synthetic corpus is a data foundation: if its ground truth is wrong, or
 * its renders are silent, or its splits straddle compositions, every future
 * training result built on it is worthless. These tests guard exactly that.
 */
import { describe, it, expect } from 'vitest'
import {
  compositionSpec, renderComposition, measureAudibleOnset, hasIsolatedOnset,
  splitForComposition, makeRng, INSTRUMENTS, TEXTURES,
} from '../scripts/lib/synthCorpus.mjs'

describe('synthetic corpus: deterministic rendering', () => {
  it('is reproducible from the composition id and seed', () => {
    const spec = { id: 'piano-melody-000', instrument: 'piano', texture: 'melody', bars: 2, bpm: 100 }
    const a = renderComposition(compositionSpec(spec))
    const b = renderComposition(compositionSpec(spec))
    expect(a.notes).toEqual(b.notes)
    expect(a.samples.length).toBe(b.samples.length)
    let diff = 0
    for (let i = 0; i < a.samples.length; i += 1) diff = Math.max(diff, Math.abs(a.samples[i] - b.samples[i]))
    expect(diff).toBe(0)
  })

  it('produces audible audio, not silence (regression: the attack ramp once broke the envelope early-exit)', () => {
    for (const instrument of INSTRUMENTS) {
      const spec = compositionSpec({ id: `silence-check-${instrument}`, instrument, texture: 'single', bars: 1 })
      const { samples } = renderComposition(spec)
      let peak = 0
      for (const v of samples) peak = Math.max(peak, Math.abs(v))
      expect(peak).toBeGreaterThan(0.5)
    }
  })

  it('generates every texture with notes in the MIDI range and ordered', () => {
    for (const texture of TEXTURES) {
      const spec = compositionSpec({ id: `texture-${texture}`, instrument: 'guitar', texture, bars: 2 })
      expect(spec.notes.length).toBeGreaterThan(0)
      for (const note of spec.notes) {
        expect(note.midi).toBeGreaterThanOrEqual(21)
        expect(note.midi).toBeLessThanOrEqual(108)
        expect(note.offsetSeconds).toBeGreaterThan(note.onsetSeconds)
        expect(note.velocity).toBeGreaterThan(0)
      }
      for (let i = 1; i < spec.notes.length; i += 1) {
        expect(spec.notes[i].onsetSeconds).toBeGreaterThanOrEqual(spec.notes[i - 1].onsetSeconds)
      }
    }
  })
})

describe('synthetic corpus: ground-truth timing', () => {
  it('the audible onset matches the symbolic onset to within 5 ms', () => {
    const spec = compositionSpec({ id: 'onset-check', instrument: 'piano', texture: 'single', bars: 1, bpm: 60 })
    const { samples } = renderComposition(spec)
    const deltas = []
    spec.notes.forEach((note, index) => {
      if (!hasIsolatedOnset(spec, index)) return
      const measured = measureAudibleOnset(samples, 22050, note)
      if (measured == null) return
      deltas.push(Math.abs(measured - note.onsetSeconds) * 1000)
    })
    expect(deltas.length).toBeGreaterThan(0)
    expect(Math.max(...deltas)).toBeLessThan(5)
  })

  it('piano and guitar differ in timbre (a one-timbre corpus would teach nothing about instruments)', () => {
    const notes = [{ midi: 60, onsetSeconds: 0, offsetSeconds: 1, velocity: 0.7, instrument: 'piano' }]
    const piano = renderComposition({ id: 'timbre', instrument: 'piano', seed: 'x', durationSeconds: 1.2, notes })
    const guitar = renderComposition({ id: 'timbre', instrument: 'guitar', seed: 'x', durationSeconds: 1.2, notes })
    const rms = (s) => { let sum = 0; for (const v of s) sum += v * v; return Math.sqrt(sum / s.length) }
    expect(Math.abs(rms(piano.samples) - rms(guitar.samples))).toBeGreaterThan(0.001)
  })
})

describe('synthetic corpus: split integrity', () => {
  it('a composition always lands in the same split', () => {
    for (const id of ['a-1', 'b-2', 'c-3']) {
      expect(splitForComposition(id)).toBe(splitForComposition(id))
    }
  })

  it('covers all three splits across a plan-sized population', () => {
    const splits = new Set()
    for (let i = 0; i < 60; i += 1) splits.add(splitForComposition(`plan-comp-${i}`))
    expect(splits).toEqual(new Set(['train', 'val', 'test']))
  })

  it('variant renders of one composition keep the composition id (so they cannot straddle splits)', () => {
    const base = { id: 'shared-comp', instrument: 'piano', texture: 'chords', bars: 1 }
    const a = compositionSpec({ ...base, seed: 'variant-a' })
    const b = compositionSpec({ ...base, seed: 'variant-b' })
    expect(a.id).toBe(b.id)
    expect(splitForComposition(a.id)).toBe(splitForComposition(b.id))
  })

  it('the seeded RNG is deterministic', () => {
    const a = makeRng('seed'); const b = makeRng('seed')
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
