/**
 * Measure-local x ranges: beat 1 of each measure sits at that measure's own
 * playable start (skipping clef/key/time on a system's first measure), and
 * later measures do NOT inherit measure 1's large left padding. Built from
 * MusicXML engraved widths + first-note default-x mapped onto the system span.
 */
import { describe, expect, it } from 'vitest'
import { buildPerMeasureSystemAnchors } from '../src/features/score-follow/semiAutoScoreAlignment.js'

const bounds = { x0: 0.05, x1: 0.95 }

// One system of 5 measures. Measure 1 is WIDE (clef/key/time padding) and its
// first note is far into the measure; later measures are narrower with the note
// near their start.
function timingMap() {
  return {
    measures: [
      { number: 1, engravedWidth: 280 },
      { number: 2, engravedWidth: 180 },
      { number: 3, engravedWidth: 180 },
      { number: 4, engravedWidth: 180 },
      { number: 5, engravedWidth: 180 },
    ],
    notes: [
      { measureNumber: 1, defaultX: 170 }, // beat 1 far right (after clef/key/time)
      { measureNumber: 2, defaultX: 60 },
      { measureNumber: 3, defaultX: 60 },
      { measureNumber: 4, defaultX: 60 },
      { measureNumber: 5, defaultX: 60 },
    ],
  }
}

function systemEntries() {
  // No imageData → uses the system content range as the x anchor (tests the
  // width + default-x mapping without a rendered image).
  return [
    {
      page: 1,
      system: { y0: 0.2, y1: 0.3, center: 0.25, contentBounds: bounds },
      contentBounds: bounds,
    },
  ]
}

const span = {
  systemIndex: 0,
  page: 1,
  measureStart: 1,
  measureEnd: 5,
  measuresInSpan: 5,
  measureNumbers: [1, 2, 3, 4, 5],
}

describe('measure-local x ranges', () => {
  const anchors = buildPerMeasureSystemAnchors(systemEntries(), [span], timingMap())

  it('produces one anchor per written measure with a local x span', () => {
    expect(anchors.map((a) => a.measureNumber)).toEqual([1, 2, 3, 4, 5])
    for (const a of anchors) {
      expect(a.meta.measureStartX).toBeLessThanOrEqual(a.x) // beat 1 ≥ measure left
      expect(a.x).toBeLessThanOrEqual(a.meta.playableEndX) // beat 1 ≤ measure right
      expect(a.meta.playableEndX).toBeGreaterThan(a.meta.measureStartX)
    }
  })

  it('measure boundaries are monotonic and non-overlapping (wide measure 1)', () => {
    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i].meta.measureStartX).toBeGreaterThan(anchors[i - 1].meta.measureStartX)
      // playableEnd of one ≈ start of the next (contiguous spans).
      expect(anchors[i].meta.measureStartX).toBeCloseTo(anchors[i - 1].meta.playableEndX, 5)
    }
    // Measure 1 is wider than measure 2 (clef padding), so its span is larger.
    const span1 = anchors[0].meta.playableEndX - anchors[0].meta.measureStartX
    const span2 = anchors[1].meta.playableEndX - anchors[1].meta.measureStartX
    expect(span1).toBeGreaterThan(span2)
  })

  it('beat 1 of measure 1 is well right of the system left (skips clef padding)', () => {
    const m1 = anchors[0]
    const leadFraction =
      (m1.x - m1.meta.measureStartX) / (m1.meta.playableEndX - m1.meta.measureStartX)
    expect(leadFraction).toBeGreaterThan(0.4) // first note is far into measure 1
  })

  it('later measures do NOT inherit measure 1’s large left padding', () => {
    const leadFraction = (a) =>
      (a.x - a.meta.measureStartX) / (a.meta.playableEndX - a.meta.measureStartX)
    const m1Lead = leadFraction(anchors[0])
    const m2Lead = leadFraction(anchors[1])
    // Each measure uses its OWN offset — measure 2's lead is its own (smaller),
    // not measure 1's clef offset.
    expect(m2Lead).toBeLessThan(m1Lead)
    // And measure 2's beat 1 sits near its own start, not shifted by measure 1.
    expect(anchors[1].x).toBeGreaterThan(anchors[0].meta.playableEndX - 0.001)
    expect(anchors[1].x).toBeLessThan(anchors[1].meta.playableEndX)
  })

  it('uses MusicXML default-x when widths are present', () => {
    expect(anchors.every((a) => a.meta.xSource.includes('default-x'))).toBe(true)
  })
})

describe('system-start playable x clears the clef/key area (widths, no default-x)', () => {
  // Two systems; each system's FIRST measure is engraved wider to hold the
  // clef/key/(time). With NO note default-x, this exercises the width-difference
  // fallback that should still inset beat 1 past the system margin.
  const widthOnlyMap = {
    measures: [
      { number: 1, engravedWidth: 280 }, // system 1 start (clef+key+time → widest)
      { number: 2, engravedWidth: 170 },
      { number: 3, engravedWidth: 170 },
      { number: 4, engravedWidth: 250 }, // system 2 start (clef+key)
      { number: 5, engravedWidth: 170 },
      { number: 6, engravedWidth: 170 },
    ],
    notes: [], // no default-x anywhere
  }
  const entries = [
    { page: 1, contentBounds: bounds, system: { y0: 0.2, y1: 0.3, center: 0.25 } },
    { page: 1, contentBounds: bounds, system: { y0: 0.45, y1: 0.55, center: 0.5 } },
  ]
  const spans = [
    { systemIndex: 0, page: 1, measureStart: 1, measureEnd: 3, measuresInSpan: 3, measureNumbers: [1, 2, 3] },
    { systemIndex: 1, page: 1, measureStart: 4, measureEnd: 6, measuresInSpan: 3, measureNumbers: [4, 5, 6] },
  ]
  const anchors = buildPerMeasureSystemAnchors(entries, spans, widthOnlyMap)
  const lead = (a) => (a.x - a.meta.measureStartX) / (a.meta.playableEndX - a.meta.measureStartX)
  const startAnchors = [
    anchors.find((a) => a.measureNumber === 1),
    anchors.find((a) => a.measureNumber === 4),
  ]

  it('insets each system-start measure past its margin (clears clef/key)', () => {
    for (const a of startAnchors) {
      expect(a.meta.xSource).toBe('system-start-width')
      expect(lead(a)).toBeGreaterThan(0.2) // well right of the measure's left edge
      expect(a.x).toBeGreaterThan(a.meta.measureStartX)
    }
  })

  it('does NOT start at the system-left margin for system-start measures', () => {
    // measureStartX of a system's first measure is the system left edge; beat 1
    // must be clearly to its right (normalized page units).
    for (const a of startAnchors) {
      expect(a.x - a.meta.measureStartX).toBeGreaterThan(0.02)
    }
  })

  it('keeps interior measures near their own start (unchanged small lead)', () => {
    for (const n of [2, 3, 5, 6]) {
      const a = anchors.find((x) => x.measureNumber === n)
      expect(lead(a)).toBeLessThan(0.12)
      expect(a.meta.xSource).not.toBe('system-start-width')
    }
  })

  it('stays monotonic within each system (x resets on the next line)', () => {
    const system1 = [1, 2, 3].map((n) => anchors.find((a) => a.measureNumber === n))
    const system2 = [4, 5, 6].map((n) => anchors.find((a) => a.measureNumber === n))
    for (const sys of [system1, system2]) {
      for (let i = 1; i < sys.length; i += 1) {
        expect(sys[i].x).toBeGreaterThan(sys[i - 1].x)
      }
    }
    // The second system starts back near the left margin, below the first.
    expect(system2[0].x).toBeLessThan(system1[2].x)
    expect(system2[0].y).toBeGreaterThan(system1[0].y)
  })
})

describe('default-x still wins when present (Gymnopédie-style, unchanged)', () => {
  // A clean export with note default-x: the system-start measure must use the
  // engraved first-note position, NOT the width fallback.
  const map = {
    measures: [
      { number: 1, engravedWidth: 280 },
      { number: 2, engravedWidth: 180 },
      { number: 3, engravedWidth: 180 },
    ],
    notes: [
      { measureNumber: 1, defaultX: 150 },
      { measureNumber: 2, defaultX: 55 },
      { measureNumber: 3, defaultX: 55 },
    ],
  }
  const entries = [{ page: 1, contentBounds: bounds, system: { y0: 0.2, y1: 0.3, center: 0.25 } }]
  const spans = [
    { systemIndex: 0, page: 1, measureStart: 1, measureEnd: 3, measuresInSpan: 3, measureNumbers: [1, 2, 3] },
  ]
  const anchors = buildPerMeasureSystemAnchors(entries, spans, map)

  it('uses default-x for every measure (no width fallback)', () => {
    expect(anchors.every((a) => a.meta.xSource.includes('default-x'))).toBe(true)
    expect(anchors.some((a) => a.meta.xSource === 'system-start-width')).toBe(false)
  })

  it('still insets the system-start measure past its margin', () => {
    const m1 = anchors.find((a) => a.measureNumber === 1)
    expect(m1.x).toBeGreaterThan(m1.meta.measureStartX)
  })
})

describe('measure-local x — conservative fallback (no widths / default-x)', () => {
  it('skips a larger lead on the system-first measure than middle measures', () => {
    // Empty timing map → no widths, no default-x → conservative per-measure lead.
    const anchors = buildPerMeasureSystemAnchors(systemEntries(), [span], { measures: [], notes: [] })
    const leadFraction = (a) =>
      (a.x - a.meta.measureStartX) / (a.meta.playableEndX - a.meta.measureStartX)
    expect(anchors).toHaveLength(5)
    expect(leadFraction(anchors[0])).toBeGreaterThan(leadFraction(anchors[1]))
    expect(anchors.every((a) => a.meta.xSource === 'estimated')).toBe(true)
    // Still monotonic.
    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i].x).toBeGreaterThan(anchors[i - 1].x)
    }
  })
})
