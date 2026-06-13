/**
 * Regression tests for the system-start fallback mode.
 *
 * When PDF pixel analysis fails to detect staff systems, the user can tap the
 * start of each visible grand-staff system. These tests verify that:
 *   - buildAnchorsFromSystemStarts produces correct anchors
 *   - those anchors pass filterTrustedAnchors
 *   - assessScoreFollowTrust returns showCursor:true for AUTO level
 *   - resolveScoreFollowCursor works with the resulting anchors
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildAnchorsFromSystemStarts } from '../src/features/score-follow/buildAnchorsFromSystemStarts.js'
import { filterTrustedAnchors } from '../src/features/score-follow/trustedAnchors.js'
import { assessScoreFollowTrust, FOLLOW_TRUST_LEVEL } from '../src/features/score-follow/scoreFollowTrust.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'
import * as F from './helpers/buildXml.js'

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a MusicXML timing map with `n` 4/4 measures at 120 bpm. */
function buildTimingMap(measureCount) {
  let measures = ''
  for (let m = 1; m <= measureCount; m += 1) {
    measures += `<measure number="${m}">`
    if (m === 1) measures += F.attributes() + F.soundTempo(120)
    measures += F.fourQuarters()
    measures += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${measures}</part>`))
}

/** Fake system-start marks as if the user tapped them on the PDF. */
function makeMarks(count, page = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: `mark-${i}`,
    page,
    x: 0.05,
    y: 0.1 + i * 0.15,
  }))
}

// ─── buildAnchorsFromSystemStarts ──────────────────────────────────────────

describe('buildAnchorsFromSystemStarts', () => {
  it('returns empty array when no marks provided', () => {
    const timingMap = buildTimingMap(4)
    expect(buildAnchorsFromSystemStarts([], timingMap)).toEqual([])
    expect(buildAnchorsFromSystemStarts(null, timingMap)).toEqual([])
  })

  it('returns empty array when timingMap has no measures', () => {
    const marks = makeMarks(2)
    expect(buildAnchorsFromSystemStarts(marks, { measures: [] })).toEqual([])
    expect(buildAnchorsFromSystemStarts(marks, null)).toEqual([])
  })

  it('32 measures over 6 systems → 12 anchors (start+end per system)', () => {
    const timingMap = buildTimingMap(32)
    const marks = makeMarks(6)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    // Each system gets a system-start anchor + a system-end anchor
    // (except possibly the last measure if start===end, but with 32/6 each
    // system has multiple measures so all produce pairs)
    expect(anchors.length).toBe(12)
  })

  it('all anchors have source AUTO_SYSTEM', () => {
    const timingMap = buildTimingMap(32)
    const marks = makeMarks(6)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    for (const anchor of anchors) {
      expect(anchor.source).toBe(ANCHOR_SOURCE.AUTO_SYSTEM)
    }
  })

  it('anchors are sorted by measureNumber ascending', () => {
    const timingMap = buildTimingMap(32)
    const marks = makeMarks(6)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i].measureNumber).toBeGreaterThanOrEqual(anchors[i - 1].measureNumber)
    }
  })

  it('marks tapped in reverse page/y order are sorted into reading order', () => {
    const timingMap = buildTimingMap(8)
    // Marks intentionally in reverse y order
    const marks = [
      { id: 'm2', page: 1, x: 0.05, y: 0.8 },
      { id: 'm1', page: 1, x: 0.05, y: 0.1 },
    ]
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    // First anchor should be at lower y (m1) → measure 1
    expect(anchors[0].measureNumber).toBe(1)
  })

  it('multi-page marks: page is preserved on each anchor', () => {
    const timingMap = buildTimingMap(8)
    const marks = [
      { id: 'p1', page: 1, x: 0.05, y: 0.1 },
      { id: 'p2', page: 2, x: 0.05, y: 0.1 },
    ]
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    const page1Anchors = anchors.filter((a) => a.page === 1)
    const page2Anchors = anchors.filter((a) => a.page === 2)
    expect(page1Anchors.length).toBeGreaterThan(0)
    expect(page2Anchors.length).toBeGreaterThan(0)
  })

  it('system-start anchor x matches the tapped x', () => {
    const timingMap = buildTimingMap(4)
    const marks = [
      { id: 'm1', page: 1, x: 0.07, y: 0.1 },
      { id: 'm2', page: 1, x: 0.07, y: 0.5 },
    ]
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    const startAnchors = anchors.filter((a) => a.meta?.role === 'system-start')
    for (const anchor of startAnchors) {
      expect(anchor.x).toBe(0.07)
    }
  })

  it('system-end anchor x is fixed at the default (0.88)', () => {
    const timingMap = buildTimingMap(4)
    const marks = makeMarks(2)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    const endAnchors = anchors.filter((a) => a.meta?.role === 'system-end')
    for (const anchor of endAnchors) {
      expect(anchor.x).toBe(0.88)
    }
  })

  it('fromSystemStartFallback meta flag is set on all anchors', () => {
    const timingMap = buildTimingMap(8)
    const marks = makeMarks(3)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    for (const anchor of anchors) {
      expect(anchor.meta?.fromSystemStartFallback).toBe(true)
    }
  })

  it('single-system score: produces ≥2 anchors (start + end)', () => {
    const timingMap = buildTimingMap(4)
    const marks = makeMarks(1) // user marks just one system
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    // With measures 1..4 in a single system: start at m1 and end at m4
    expect(anchors.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── filterTrustedAnchors ──────────────────────────────────────────────────

describe('filterTrustedAnchors with system-start anchors', () => {
  it('includes AUTO_SYSTEM anchors', () => {
    const timingMap = buildTimingMap(8)
    const marks = makeMarks(3)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    const trusted = filterTrustedAnchors(anchors)
    expect(trusted.length).toBe(anchors.length)
  })

  it('all generated anchors survive the filter', () => {
    const timingMap = buildTimingMap(32)
    const marks = makeMarks(6)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)
    const trusted = filterTrustedAnchors(anchors)

    expect(trusted.length).toBe(anchors.length)
  })
})

// ─── assessScoreFollowTrust ───────────────────────────────────────────────

describe('assessScoreFollowTrust with system-start anchors', () => {
  it('returns AUTO level and showCursor:true for ≥2 AUTO_SYSTEM anchors', () => {
    const timingMap = buildTimingMap(8)
    const marks = makeMarks(2)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    const trust = assessScoreFollowTrust({ anchors, timingMap })
    expect(trust.level).toBe(FOLLOW_TRUST_LEVEL.AUTO)
    expect(trust.showCursor).toBe(true)
    expect(trust.needsSetup).toBe(false)
  })

  it('32 measures / 6 systems → showCursor:true', () => {
    const timingMap = buildTimingMap(32)
    const marks = makeMarks(6)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    const trust = assessScoreFollowTrust({ anchors, timingMap })
    expect(trust.showCursor).toBe(true)
  })

  it('single-system score (1 mark → 2 anchors) → showCursor:true', () => {
    const timingMap = buildTimingMap(4)
    const marks = makeMarks(1)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    // Must have ≥2 AUTO_SYSTEM anchors from the start+end pair
    expect(anchors.length).toBeGreaterThanOrEqual(2)
    const trust = assessScoreFollowTrust({ anchors, timingMap })
    expect(trust.showCursor).toBe(true)
  })

  it('empty anchors → showCursor:false (no regression)', () => {
    const timingMap = buildTimingMap(4)
    const trust = assessScoreFollowTrust({ anchors: [], timingMap })
    expect(trust.showCursor).toBe(false)
    expect(trust.needsSetup).toBe(true)
  })
})

// ─── resolveScoreFollowCursor ─────────────────────────────────────────────

describe('resolveScoreFollowCursor with system-start anchors', () => {
  it('cursor is visible at t=0 (start-lock)', () => {
    const timingMap = buildTimingMap(8)
    const marks = makeMarks(2)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)
    const trust = assessScoreFollowTrust({ anchors, timingMap })

    const result = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0,
      trustedAnchors: anchors,
      trust,
    })
    expect(result.cursor.visible).toBe(true)
  })

  it('cursor moves to later x/y as time progresses', () => {
    const timingMap = buildTimingMap(8)
    const marks = makeMarks(2)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)
    const trust = assessScoreFollowTrust({ anchors, timingMap })

    const atStart = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0,
      trustedAnchors: anchors,
      trust,
    })
    const atMid = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 8, // ~halfway through 8 measures at 120bpm (2s/measure)
      trustedAnchors: anchors,
      trust,
    })

    // Both visible
    expect(atStart.cursor.visible).toBe(true)
    expect(atMid.cursor.visible).toBe(true)

    // Cursor should have advanced (x increases across a system)
    expect(atMid.cursor.x).toBeGreaterThanOrEqual(atStart.cursor.x)
  })

  it('needsSetup is false when system-start anchors are present', () => {
    const timingMap = buildTimingMap(8)
    const marks = makeMarks(2)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)
    const trust = assessScoreFollowTrust({ anchors, timingMap })

    const result = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 2,
      trustedAnchors: anchors,
      trust,
    })
    expect(result.needsSetup).toBe(false)
  })
})

// ─── fallback path source check ───────────────────────────────────────────

describe('system-start fallback: anchor source integrity', () => {
  it('no AUTO_MEASURE or MANUAL sources leak into system-start anchors', () => {
    const timingMap = buildTimingMap(16)
    const marks = makeMarks(4)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    for (const anchor of anchors) {
      expect(anchor.source).not.toBe(ANCHOR_SOURCE.MANUAL)
      expect(anchor.source).not.toBe(ANCHOR_SOURCE.AUTO_MEASURE)
    }
  })

  it('each anchor has a unique id', () => {
    const timingMap = buildTimingMap(16)
    const marks = makeMarks(4)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    const ids = anchors.map((a) => a.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('all anchors have required fields: id, page, x, y, measureNumber, source', () => {
    const timingMap = buildTimingMap(8)
    const marks = makeMarks(3)
    const anchors = buildAnchorsFromSystemStarts(marks, timingMap)

    for (const anchor of anchors) {
      expect(typeof anchor.id).toBe('string')
      expect(typeof anchor.page).toBe('number')
      expect(typeof anchor.x).toBe('number')
      expect(typeof anchor.y).toBe('number')
      expect(typeof anchor.measureNumber).toBe('number')
      expect(typeof anchor.source).toBe('string')
    }
  })
})
