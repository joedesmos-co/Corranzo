/**
 * Chord grouping layer (Stage 2, S6) — simultaneous vs strummed vs arpeggio.
 */
import { describe, expect, it } from 'vitest'
import {
  CHORD_GROUP_TYPE,
  createChordGroupingState,
  flushChordGrouping,
  pushChordGroupingFrame,
} from '../src/features/microphone-input/micChordGrouping.js'

function feed(frames) {
  const state = createChordGroupingState()
  const events = []
  for (const frame of frames) {
    events.push(...pushChordGroupingFrame(state, frame).events)
  }
  events.push(...flushChordGrouping(state).events)
  return events
}

const CONF = 0.8

describe('micChordGrouping', () => {
  it('groups a piano block chord as one simultaneous event with per-note onsets', () => {
    const events = feed([
      {
        timeMs: 0,
        candidates: [
          { midi: 60, confidence: CONF },
          { midi: 64, confidence: CONF },
          { midi: 67, confidence: CONF },
        ],
      },
      { timeMs: 200, candidates: [] },
    ])
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(CHORD_GROUP_TYPE.SIMULTANEOUS)
    expect(events[0].midis).toEqual([60, 64, 67])
    expect(events[0].groupOnsetMs).toBe(0)
    expect(events[0].notes).toHaveLength(3)
  })

  it('groups a naturally staggered guitar strum as one strummed event', () => {
    const events = feed([
      { timeMs: 0, candidates: [{ midi: 40, confidence: CONF }] },
      { timeMs: 60, candidates: [{ midi: 40, confidence: CONF }, { midi: 45, confidence: CONF }] },
      {
        timeMs: 120,
        candidates: [
          { midi: 40, confidence: CONF },
          { midi: 45, confidence: CONF },
          { midi: 50, confidence: CONF },
        ],
      },
      { timeMs: 400, candidates: [] },
    ])
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(CHORD_GROUP_TYPE.STRUMMED)
    expect(events[0].midis).toEqual([40, 45, 50])
  })

  it('keeps widely spaced notes as separate events, never one chord', () => {
    const events = feed([
      { timeMs: 0, candidates: [{ midi: 60, confidence: CONF }] },
      { timeMs: 300, candidates: [{ midi: 64, confidence: CONF }] },
      { timeMs: 600, candidates: [{ midi: 67, confidence: CONF }] },
    ])
    // Each lone note is its own event; nothing may merge them into a chord.
    expect(events).toHaveLength(3)
    for (const event of events) {
      expect(event.midis).toHaveLength(1)
    }
    expect(events.map((event) => event.midis[0])).toEqual([60, 64, 67])
  })

  it('starts a fresh group for a repeated chord after a gap', () => {
    const events = feed([
      { timeMs: 0, candidates: [{ midi: 60, confidence: CONF }, { midi: 64, confidence: CONF }] },
      { timeMs: 500, candidates: [{ midi: 60, confidence: CONF }, { midi: 64, confidence: CONF }] },
    ])
    expect(events).toHaveLength(2)
    expect(events[0].midis).toEqual([60, 64])
    expect(events[1].midis).toEqual([60, 64])
  })

  it('ignores sub-threshold candidates', () => {
    const events = feed([
      { timeMs: 0, candidates: [{ midi: 60, confidence: 0.05 }] },
    ])
    expect(events).toHaveLength(0)
  })
})
