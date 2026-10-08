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
  // Prime with one empty tick first: live capture always runs before the
  // first attack, so take-start taint must see room, not the chord itself.
  if (frames.length) {
    pushChordGroupingFrame(state, { timeMs: frames[0].timeMs - 17, candidates: [] })
  }
  for (const frame of frames) {
    // Two identical ticks per frame: fresh onsets require a confirmation
    // frame (minOnsetFrames), mirroring the 60 fps live cadence.
    events.push(...pushChordGroupingFrame(state, frame).events)
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

  it('separates funk-style rapid repeats via re-onset energy jumps', () => {
    // Same chord re-struck 130 ms later (16ths at ~115 BPM): the second
    // attack arrives louder than the decayed ring, opening a new event
    // even though it lands inside the strum window.
    const events = feed([
      { timeMs: 0, candidates: [{ midi: 60, confidence: 0.8 }, { midi: 64, confidence: 0.8 }] },
      { timeMs: 65, candidates: [{ midi: 60, confidence: 0.4 }, { midi: 64, confidence: 0.4 }] },
      { timeMs: 130, candidates: [{ midi: 60, confidence: 0.85 }, { midi: 64, confidence: 0.85 }] },
      { timeMs: 400, candidates: [] },
    ])
    expect(events).toHaveLength(2)
    expect(events[0].midis).toEqual([60, 64])
    expect(events[1].midis).toEqual([60, 64])
  })

  it('keeps a slow 190 ms strum as one event', () => {
    const events = feed([
      { timeMs: 0, candidates: [{ midi: 40, confidence: 0.8 }] },
      { timeMs: 95, candidates: [{ midi: 40, confidence: 0.7 }, { midi: 45, confidence: 0.8 }] },
      { timeMs: 190, candidates: [{ midi: 45, confidence: 0.7 }, { midi: 50, confidence: 0.8 }] },
      { timeMs: 500, candidates: [] },
    ])
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(CHORD_GROUP_TYPE.STRUMMED)
    expect(events[0].midis).toEqual([40, 45, 50])
  })

  it('ignores sub-threshold candidates', () => {
    const events = feed([
      { timeMs: 0, candidates: [{ midi: 60, confidence: 0.05 }] },
    ])
    expect(events).toHaveLength(0)
  })

  it('never anchors steady-state ringing heard since take start', () => {
    const state = createChordGroupingState()
    const events = []
    // Room resonance present from the very first tick, flat forever.
    for (let step = 0; step < 10; step += 1) {
      events.push(
        ...pushChordGroupingFrame(state, { timeMs: step * 17, candidates: [{ midi: 44, confidence: 0.4 }] }).events,
      )
    }
    events.push(...flushChordGrouping(state).events)
    expect(events).toHaveLength(0)
  })

  it('lets a re-attack on top of take-start ring open an onset', () => {
    const state = createChordGroupingState()
    const events = []
    for (let step = 0; step < 3; step += 1) {
      events.push(
        ...pushChordGroupingFrame(state, { timeMs: step * 17, candidates: [{ midi: 44, confidence: 0.4 }] }).events,
      )
    }
    // Same pitch re-struck at 1.6×+ its take-start level: a new attack.
    events.push(
      ...pushChordGroupingFrame(state, { timeMs: 51, candidates: [{ midi: 44, confidence: 0.8 }] }).events,
    )
    events.push(
      ...pushChordGroupingFrame(state, { timeMs: 68, candidates: [{ midi: 44, confidence: 0.8 }] }).events,
    )
    events.push(...flushChordGrouping(state).events)
    expect(events).toHaveLength(1)
    expect(events[0].midis).toEqual([44])
  })

  it('never anchors a single-frame transient ghost', () => {
    const state = createChordGroupingState()
    const events = []
    // Ghost blip for exactly one tick inside an otherwise empty stream.
    events.push(...pushChordGroupingFrame(state, { timeMs: 0, candidates: [] }).events)
    events.push(...pushChordGroupingFrame(state, { timeMs: 17, candidates: [{ midi: 66, confidence: 0.9 }] }).events)
    events.push(...pushChordGroupingFrame(state, { timeMs: 34, candidates: [] }).events)
    events.push(...flushChordGrouping(state).events)
    expect(events).toHaveLength(0)
  })
})
