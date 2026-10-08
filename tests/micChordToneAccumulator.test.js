/**
 * Chord-tone accumulator (Stage 4 P2) — rolled semantics for mic evidence.
 */
import { describe, expect, it } from 'vitest'
import {
  createChordToneAccumulator,
  pushChordToneFrame,
  resetChordToneAccumulator,
} from '../src/features/practice/micChordToneAccumulator.js'

function tone(midi, confidence = 0.8) {
  return { midi, confidence }
}

describe('micChordToneAccumulator', () => {
  it('completes sparse detections no single frame ever held together', () => {
    const state = createChordToneAccumulator({ expectedMidis: [57, 64, 73] })
    // Frame 1: only C+E heard; frame 2 (300 ms later): only E+G heard.
    let verdict = pushChordToneFrame(state, { timeMs: 0, tones: [tone(57), tone(64)], musical: true })
    expect(verdict.completed).toBe(false)
    pushChordToneFrame(state, { timeMs: 100, tones: [tone(57), tone(64)], musical: true })
    verdict = pushChordToneFrame(state, { timeMs: 300, tones: [tone(64), tone(73)], musical: true })
    expect(verdict.completed).toBe(false)
    verdict = pushChordToneFrame(state, { timeMs: 380, tones: [tone(64), tone(73)], musical: true })
    expect(verdict.completed).toBe(true)
    expect(verdict.matchedMidis).toEqual([57, 64, 73])
  })

  it('requires minHits independent frames per tone (blips do not count)', () => {
    const state = createChordToneAccumulator({ expectedMidis: [60, 64] })
    let verdict = pushChordToneFrame(state, { timeMs: 0, tones: [tone(60), tone(64)], musical: true })
    expect(verdict.completed).toBe(false)
    verdict = pushChordToneFrame(state, { timeMs: 100, tones: [tone(60)], musical: true })
    expect(verdict.completed).toBe(false)
    expect(verdict.pendingMidis).toEqual([64])
  })

  it('ignores non-musical frames and weak evidence', () => {
    const state = createChordToneAccumulator({ expectedMidis: [60] })
    for (let step = 0; step < 5; step += 1) {
      const verdict = pushChordToneFrame(state, { timeMs: step * 50, tones: [tone(60, 0.9)], musical: false })
      expect(verdict.completed).toBe(false)
    }
    const weak = pushChordToneFrame(state, { timeMs: 300, tones: [tone(60, 0.1)], musical: true })
    expect(weak.completed).toBe(false)
  })

  it('never completes a wrong chord from unexpected tones', () => {
    const state = createChordToneAccumulator({ expectedMidis: [60, 64, 67] })
    for (let step = 0; step < 6; step += 1) {
      const verdict = pushChordToneFrame(state, {
        timeMs: step * 60,
        tones: [tone(62, 0.9), tone(65, 0.9), tone(69, 0.9)],
        musical: true,
      })
      expect(verdict.completed).toBe(false)
    }
  })

  it('expires stale hits outside the window', () => {
    const state = createChordToneAccumulator({ expectedMidis: [60, 64], windowMs: 500 })
    pushChordToneFrame(state, { timeMs: 0, tones: [tone(60)], musical: true })
    pushChordToneFrame(state, { timeMs: 50, tones: [tone(60)], musical: true })
    const verdict = pushChordToneFrame(state, { timeMs: 900, tones: [tone(64)], musical: true })
    expect(verdict.completed).toBe(false)
    expect(verdict.pendingMidis).toContain(60)
  })

  it('resets across checkpoints without leakage', () => {
    const state = createChordToneAccumulator({ expectedMidis: [60, 64] })
    pushChordToneFrame(state, { timeMs: 0, tones: [tone(60), tone(64)], musical: true })
    pushChordToneFrame(state, { timeMs: 50, tones: [tone(60), tone(64)], musical: true })
    resetChordToneAccumulator(state)
    const verdict = pushChordToneFrame(state, { timeMs: 100, tones: [tone(60)], musical: true })
    expect(verdict.completed).toBe(false)
    expect(verdict.matchedMidis).toEqual([])
  })

  it('completes a single note with two confident frames', () => {
    const state = createChordToneAccumulator({ expectedMidis: [57] })
    pushChordToneFrame(state, { timeMs: 0, tones: [tone(57)], musical: true })
    const verdict = pushChordToneFrame(state, { timeMs: 40, tones: [tone(57)], musical: true })
    expect(verdict.completed).toBe(true)
  })
})
