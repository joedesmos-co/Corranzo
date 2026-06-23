/**
 * Visual practice correctness tests.
 *
 * These are regression guards for the class of bug reported 2026-06-13: the
 * demo score-follow cursor was visually misaligned because the bundled anchor
 * file used 4 estimated staff systems instead of the real 6 systems extracted
 * from the PDF. Measure 31 specifically was ~9% of page height off vertically.
 *
 * Tests cover:
 *  – Demo anchor structure (6 systems, correct y-midpoints, all 32 measures)
 *  – Cursor resolver at late-piece seek (94/96 %) resolves to measure 31
 *  – All anchor coordinates are within valid [0,1] page-space bounds
 *  – Page-follow scroll target keeps cursor in visible area
 *  – Toolbar clearance: system 0 (y ≈ 0.163) is below the 52 px toolbar
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getMeasureAtTime } from '../src/features/musicxml/timingQuery.js'
import { getPlaybackDurationSeconds } from '../src/features/musicxml/performedTimeline.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { filterTrustedAnchors } from '../src/features/score-follow/trustedAnchors.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dir, '..', 'public', 'fixtures')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDemoAnchors() {
  const raw = readFileSync(join(fixturesDir, 'demo-minuet-in-g.anchors.json'), 'utf8')
  return JSON.parse(raw)
}

function loadDemoTiming() {
  const xml = readFileSync(join(fixturesDir, 'demo-minuet-in-g.musicxml'), 'utf8')
  return parseMusicXml(xml, 'demo-minuet-in-g.musicxml')
}

// ---------------------------------------------------------------------------
// Anchor structure
// ---------------------------------------------------------------------------

describe('demo bundled anchor structure', () => {
  it('has exactly 32 anchors covering measures 1–32', () => {
    const { anchors } = loadDemoAnchors()
    expect(anchors).toHaveLength(32)
    const numbers = anchors.map((a) => a.measureNumber)
    for (let n = 1; n <= 32; n++) {
      expect(numbers).toContain(n)
    }
  })

  it('uses 6 systems (0–5), not the old 4-system estimate', () => {
    const { anchors } = loadDemoAnchors()
    const systems = new Set(anchors.map((a) => a.meta?.systemIndex))
    expect(systems.size).toBe(6)
    for (let s = 0; s <= 5; s++) {
      expect(systems.has(s)).toBe(true)
    }
  })

  it('system y-midpoints match real PDF staff positions (within 0.01)', () => {
    const { anchors } = loadDemoAnchors()
    // Expected y-midpoints from PyMuPDF analysis of the actual PDF
    const expectedY = {
      0: 0.163,
      1: 0.294,
      2: 0.424,
      3: 0.555,
      4: 0.690,
      5: 0.826,
    }
    for (const [sysIdx, expectedMid] of Object.entries(expectedY)) {
      const sysAnchors = anchors.filter((a) => a.meta?.systemIndex === Number(sysIdx))
      expect(sysAnchors.length).toBeGreaterThan(0)
      for (const anchor of sysAnchors) {
        expect(Math.abs(anchor.y - expectedMid)).toBeLessThan(0.01)
      }
    }
  })

  it('all anchor coordinates are within valid [0, 1] page-space bounds', () => {
    const { anchors } = loadDemoAnchors()
    for (const anchor of anchors) {
      expect(anchor.x).toBeGreaterThanOrEqual(0)
      expect(anchor.x).toBeLessThanOrEqual(1)
      expect(anchor.y).toBeGreaterThanOrEqual(0)
      expect(anchor.y).toBeLessThanOrEqual(1)
      expect(anchor.page).toBe(1)
    }
  })

  it('measure 31 is in system 5 at y ≈ 0.826 (was wrongly at 0.733 in old file)', () => {
    const { anchors } = loadDemoAnchors()
    const m31 = anchors.find((a) => a.measureNumber === 31)
    expect(m31).toBeDefined()
    expect(m31.meta.systemIndex).toBe(5)
    expect(Math.abs(m31.y - 0.826)).toBeLessThan(0.005)
    // Old (wrong) value was 0.733 — verify we're not still using that
    expect(Math.abs(m31.y - 0.733)).toBeGreaterThan(0.05)
  })

  it('system 0 starts at y ≈ 0.163, safely below the 52 px practice toolbar', () => {
    const { anchors } = loadDemoAnchors()
    const sys0 = anchors.filter((a) => a.meta?.systemIndex === 0)
    for (const anchor of sys0) {
      // 52 px toolbar on a ~850 px page ≈ 6.1 % from top.
      // System 0 at y≈0.163 is 16 % from top → well below the toolbar.
      expect(anchor.y).toBeGreaterThan(0.10)
    }
  })

  it('includes system-end metadata for smooth line-end cursor motion', () => {
    const { anchors } = loadDemoAnchors()
    const systems = new Set(anchors.map((a) => a.meta?.systemIndex))

    for (const systemIndex of systems) {
      const sysAnchors = anchors
        .filter((a) => a.meta?.systemIndex === systemIndex)
        .sort((a, b) => a.measureNumber - b.measureNumber)

      expect(sysAnchors.length).toBeGreaterThan(0)

      for (let index = 0; index < sysAnchors.length; index += 1) {
        const anchor = sysAnchors[index]
        const next = sysAnchors[index + 1]

        expect(anchor.meta.systemEndX).toBeGreaterThan(anchor.x)
        expect(anchor.meta.playableEndX).toBeGreaterThan(anchor.x)
        expect(anchor.meta.playableEndX).toBeLessThanOrEqual(anchor.meta.systemEndX)

        if (next) {
          expect(anchor.meta.playableEndX).toBeCloseTo(next.x, 4)
        } else {
          expect(anchor.meta.playableEndX).toBeCloseTo(anchor.meta.systemEndX, 4)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Cursor resolver with real timing + anchors
// ---------------------------------------------------------------------------

describe('cursor resolver with demo timing and PDF-extracted anchors', () => {
  const timingMap = loadDemoTiming()
  const { anchors: rawAnchors } = loadDemoAnchors()
  const anchors = filterTrustedAnchors(rawAnchors) // only DEMO/manual/musicxml-layout
  const duration = getPlaybackDurationSeconds(timingMap)
  const trust = { showCursor: true, needsSetup: false }

  it('resolves to measure 31 at 94 % through the piece', () => {
    const t = duration * 0.94
    const measure = getMeasureAtTime(timingMap, t)
    expect(measure?.number).toBe(31)

    const { cursor, confidence } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: anchors,
      trust,
    })
    expect(cursor.visible).toBe(true)
    expect(cursor.measureNumber).toBe(31)
    expect(confidence).not.toBe('none')
  })

  it('resolves to measure 31 at 96 % through the piece', () => {
    const t = duration * 0.96
    const measure = getMeasureAtTime(timingMap, t)
    expect(measure?.number).toBe(31)

    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: anchors,
      trust,
    })
    expect(cursor.visible).toBe(true)
    expect(cursor.measureNumber).toBe(31)
  })

  it('cursor x/y at M31 are within page-space bounds at both seek points', () => {
    for (const pct of [0.94, 0.96]) {
      const t = duration * pct
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: anchors,
        trust,
      })
      expect(cursor.x).toBeGreaterThanOrEqual(0)
      expect(cursor.x).toBeLessThanOrEqual(1)
      expect(cursor.y).toBeGreaterThanOrEqual(0)
      expect(cursor.y).toBeLessThanOrEqual(1)
    }
  })

  it('cursor page is always 1 (single-page score)', () => {
    for (let t = 0; t <= duration; t += 2) {
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: anchors,
        trust,
      })
      if (cursor.visible) {
        expect(cursor.page).toBe(1)
      }
    }
  })

  it('cursor measureNumber matches getMeasureAtTime at every sample', () => {
    // Sweep from just after start-lock threshold to end
    const START_LOCK = 0.15
    for (let t = START_LOCK + 0.1; t <= duration - 0.1; t += 1.0) {
      const expected = getMeasureAtTime(timingMap, t)
      if (!expected) continue
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: anchors,
        trust,
      })
      if (cursor.visible) {
        expect(cursor.measureNumber).toBe(expected.number)
      }
    }
  })

  it('cursor y for M31 is in system 5 range (y > 0.80), not system 3 (old bug)', () => {
    const t = duration * 0.95
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: anchors,
      trust,
    })
    expect(cursor.visible).toBe(true)
    // System 5 y ≈ 0.826 → cursor y must be > 0.80
    expect(cursor.y).toBeGreaterThan(0.80)
    // Old system 3 y was 0.733 → cursor y must NOT be in that range
    expect(cursor.y).not.toBeLessThan(0.78)
  })

  it('cursor glides through the final measure of a system instead of holding at the barline', () => {
    const m16 = anchors.find((a) => a.measureNumber === 16)
    const measure16 = timingMap.measures.find((measure) => measure.number === 16)
    const t =
      measure16.startTimeSeconds +
      (measure16.endTimeSeconds - measure16.startTimeSeconds) * 0.75

    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: anchors,
      trust,
    })

    expect(cursor.visible).toBe(true)
    expect(cursor.measureNumber).toBe(16)
    expect(cursor.x).toBeGreaterThan(m16.x + 0.04)
    expect(cursor.x).toBeLessThanOrEqual(m16.meta.systemEndX)
  })
})

// ---------------------------------------------------------------------------
// Page-follow scroll math
// ---------------------------------------------------------------------------

describe('page-follow scroll target math', () => {
  const LOOKAHEAD_RATIO = 0.36

  /**
   * Simulates the scroll target calculation in usePracticePageFollow.
   * containerHeight = pageFrame height (fit-page: PDF fills the container).
   */
  function computeScrollTarget({ cursorY, frameHeight, containerHeight, scrollTop = 0 }) {
    const frameTop = 0 // frame at top of scroll container
    const cursorPixelY = frameTop + cursorY * frameHeight + scrollTop
    const target = cursorPixelY - containerHeight * LOOKAHEAD_RATIO
    const maxScroll = Math.max(0, frameHeight - containerHeight)
    return Math.min(maxScroll, Math.max(0, target))
  }

  it('in fit-page mode (no overflow) scroll target is always 0', () => {
    // fit-page: frameHeight === containerHeight → no overflow → maxScroll = 0
    const h = 850
    for (const y of [0.163, 0.294, 0.424, 0.555, 0.690, 0.826]) {
      const target = computeScrollTarget({ cursorY: y, frameHeight: h, containerHeight: h })
      expect(target).toBe(0)
    }
  })

  it('in fit-width mode cursor at y=0.826 (M31) scrolls into the lower-third view', () => {
    // fit-width on a narrow container: PDF taller than container
    const frameHeight = 1400 // PDF rendered at ~1400 px tall
    const containerHeight = 850
    const target = computeScrollTarget({ cursorY: 0.826, frameHeight, containerHeight })
    // Cursor is at 1156 px; target = 1156 - 306 = 850. clamped to max = 550.
    const maxScroll = frameHeight - containerHeight // 550
    expect(target).toBeGreaterThan(0)
    expect(target).toBeLessThanOrEqual(maxScroll)
    // Cursor should be visible: target ≤ cursorPixelY ≤ target + containerHeight
    const cursorPx = 0.826 * frameHeight
    expect(cursorPx).toBeGreaterThanOrEqual(target)
    expect(cursorPx).toBeLessThanOrEqual(target + containerHeight)
  })

  it('in fit-width mode cursor at y=0.163 (M1, sys 0) is visible without scrolling', () => {
    const frameHeight = 1400
    const containerHeight = 850
    const target = computeScrollTarget({ cursorY: 0.163, frameHeight, containerHeight })
    // Cursor at 228 px; target = 228 - 306 = -78 → clamped to 0
    expect(target).toBe(0)
    const cursorPx = 0.163 * frameHeight
    expect(cursorPx).toBeLessThan(containerHeight) // visible at scrollTop=0
  })
})
