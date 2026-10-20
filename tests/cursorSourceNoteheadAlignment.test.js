import { describe, expect, it } from 'vitest'
import { buildCursorMotionTimeline, resolveCursorMotion } from '../src/features/score-follow/cursorMotionTimeline.js'

/**
 * The painted red cursor and the note target must resolve the same note to the
 * same x. When the score owns exact printed-notehead geometry (OMR source
 * map), the cursor must use THAT — not an engraving-space default-x
 * approximation, which can sit tens of pixels away from the notehead.
 */
describe('cursor motion timeline — source-notehead alignment', () => {
  const timingMap = {
    divisions: 4,
    measures: [
      {
        number: 1,
        startTimeSeconds: 0,
        endTimeSeconds: 2,
        engravedWidth: 800,
      },
    ],
    notes: [
      {
        id: 'P1-m1-n0',
        measureNumber: 1,
        timeSeconds: 0,
        durationSeconds: 1,
        quarterTime: 0,
        durationQuarters: 1,
        midi: 60,
        defaultX: 100,
        sourceNoteheadId: 'sfnh-a',
        isRest: false,
      },
      {
        id: 'P1-m1-n1',
        measureNumber: 1,
        timeSeconds: 1,
        durationSeconds: 1,
        quarterTime: 1,
        durationQuarters: 1,
        midi: 62,
        defaultX: 500,
        sourceNoteheadId: 'sfnh-b',
        isRest: false,
      },
    ],
    beats: [],
  }

  const anchors = [
    {
      id: 'm1',
      page: 1,
      x: 0.1,
      y: 0.3,
      measureNumber: 1,
      source: 'manual',
      meta: { role: 'measure', playableStartX: 0.1, playableEndX: 0.5, systemEndX: 0.95 },
    },
  ]

  const sourceVisualMap = {
    anchorCount: 2,
    anchors: [
      { sourceNoteheadId: 'sfnh-a', page: 1, sourceCenter: { x: 0.14, y: 0.3 } },
      { sourceNoteheadId: 'sfnh-b', page: 1, sourceCenter: { x: 0.42, y: 0.3 } },
    ],
  }

  it('uses the exact source notehead x for onsets when source geometry exists', () => {
    const timeline = buildCursorMotionTimeline({
      timingMap,
      trustedAnchors: anchors,
      sourceVisualMap,
    })
    const first = resolveCursorMotion(timeline, 0)
    const second = resolveCursorMotion(timeline, 1)
    expect(first.x).toBeCloseTo(0.14, 3)
    expect(second.x).toBeCloseTo(0.42, 3)
  })

  it('falls back to the engraved default-x mapping without source geometry', () => {
    const timeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: anchors })
    const first = resolveCursorMotion(timeline, 0)
    // defaultX 100 over an 800-tenth measure, across [0.1, 0.5] → 0.15
    expect(first.x).toBeCloseTo(0.15, 3)
  })

  it('the source-mapped and fallback timelines are both monotonic and onset-locked', () => {
    const timeline = buildCursorMotionTimeline({
      timingMap,
      trustedAnchors: anchors,
      sourceVisualMap,
    })
    let prev = -Infinity
    for (let t = 0; t <= 2; t += 1 / 60) {
      const c = resolveCursorMotion(timeline, t)
      if (!c) continue
      expect(c.x).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = c.x
    }
  })
})
