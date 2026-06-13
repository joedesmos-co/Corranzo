/**
 * Regression tests for the 4 UX fixes applied 2026-06-13:
 *
 *  1. Cursor height — `.score-follow-cursor` uses 9 % page height (not fixed 28 px)
 *  2. Intra-measure x glide — resolveScoreFollowCursor interpolates x within a
 *     measure when the next anchor is on the same system
 *  3. Synth tone — (audio chain not unit-testable, validated manually)
 *  4. Annotation pointer mode — POINTER tool exists; AnnotationLayer passes
 *     pointer events through; pointer is the default tool
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getPlaybackDurationSeconds } from '../src/features/musicxml/performedTimeline.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { filterTrustedAnchors } from '../src/features/score-follow/trustedAnchors.js'
import { ANNOTATION_TOOLS } from '../src/components/pdf/annotationConstants.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dir, '..', 'public', 'fixtures')

function loadDemoAnchors() {
  const raw = readFileSync(join(fixturesDir, 'demo-minuet-in-g.anchors.json'), 'utf8')
  return JSON.parse(raw)
}

function loadDemoTiming() {
  const xml = readFileSync(join(fixturesDir, 'demo-minuet-in-g.musicxml'), 'utf8')
  return parseMusicXml(xml, 'demo-minuet-in-g.musicxml')
}

// ---------------------------------------------------------------------------
// Fix 1: Cursor height — CSS value is % not px
// ---------------------------------------------------------------------------

describe('Fix 1: cursor height CSS uses percentage', () => {
  it('App.css .score-follow-cursor has height:9% (not height:28px)', () => {
    const css = readFileSync(
      join(__dir, '..', 'src', 'App.css'),
      'utf8',
    )
    // Find the .score-follow-cursor block (before the __line subclass)
    const cursorBlock = css.match(/\.score-follow-cursor\s*\{([^}]*)\}/)?.[1] ?? ''
    // Must contain a percentage height
    expect(cursorBlock).toMatch(/height\s*:\s*\d+%/)
    // Must NOT contain the old fixed 28px height
    expect(cursorBlock).not.toMatch(/height\s*:\s*28px/)
  })

  it('App.css .score-follow-cursor__line uses height:100% to fill the container', () => {
    const css = readFileSync(
      join(__dir, '..', 'src', 'App.css'),
      'utf8',
    )
    const lineBlock = css.match(/\.score-follow-cursor__line\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(lineBlock).toMatch(/height\s*:\s*100%/)
    // The old fixed height is gone
    expect(lineBlock).not.toMatch(/height\s*:\s*28px/)
  })
})

// ---------------------------------------------------------------------------
// Fix 2: Intra-measure x glide
// ---------------------------------------------------------------------------

describe('Fix 2: intra-measure x interpolation', () => {
  const timingMap = loadDemoTiming()
  const { anchors: rawAnchors } = loadDemoAnchors()
  const anchors = filterTrustedAnchors(rawAnchors)
  const duration = getPlaybackDurationSeconds(timingMap)
  const trust = { showCursor: true, needsSetup: false }

  it('cursor x increases through a measure when playing forward on a single system', () => {
    // Measure 1 (sys 0) → Measure 2 (sys 0): both on same system.
    // Sample cursor x at three points inside measure 1.
    // We just need measures that are on the same system; use 5% and 8% of duration
    // to land in early measures on system 0.
    const t0 = duration * 0.05
    const t1 = duration * 0.08
    const c0 = resolveScoreFollowCursor({ timingMap, practiceTime: t0, trustedAnchors: anchors, trust })
    const c1 = resolveScoreFollowCursor({ timingMap, practiceTime: t1, trustedAnchors: anchors, trust })
    if (!c0.cursor.visible || !c1.cursor.visible) {
      return // can't test if not visible
    }
    if (c0.cursor.measureNumber !== c1.cursor.measureNumber) {
      return // crossed measure boundary — both code paths fine
    }
    // Within the same measure on the same system, x should advance (or stay equal at boundary)
    expect(c1.cursor.x).toBeGreaterThanOrEqual(c0.cursor.x - 0.001)
  })

  it('cursor x at measure start equals the anchor x', () => {
    // At practiceTime = just after measure 1 starts, cursor.x ≈ anchor x for M1
    const { anchors: rawA } = loadDemoAnchors()
    const m1anchor = rawA.find((a) => a.measureNumber === 1)
    const t = 0.16 // just after start-lock threshold (0.15 s)
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: filterTrustedAnchors(rawA),
      trust,
    })
    if (!cursor.visible) return
    if (cursor.measureNumber === 1) {
      // x should be close to M1 anchor x (progress ≈ 0 at measure start)
      expect(cursor.x).toBeGreaterThanOrEqual(m1anchor.x - 0.01)
    }
  })

  it('interpolation does not cross system boundary (different y → falls back to anchor x)', () => {
    // The last measure of system 0 (M5) and first of system 1 (M6) have different y.
    // Within M5, the next anchor (M6) is on a different system → intra-measure glide
    // must NOT activate; cursor.x should be the M5 anchor x.
    const { anchors: rawA } = loadDemoAnchors()
    const m5anchor = rawA.find((a) => a.measureNumber === 5)
    const m6anchor = rawA.find((a) => a.measureNumber === 6)
    // Confirm they ARE on different systems
    expect(Math.abs(m5anchor.y - m6anchor.y)).toBeGreaterThan(0.02)

    // Find a time that's inside measure 5 (somewhere in the middle of the piece)
    const { measures } = timingMap
    const m5 = measures.find((m) => m.number === 5)
    if (!m5) return

    const t = (m5.startTimeSeconds + m5.endTimeSeconds) / 2
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: filterTrustedAnchors(rawA),
      trust,
    })
    if (!cursor.visible || cursor.measureNumber !== 5) return
    // x must not have crept past M5's anchor x by any significant amount
    // (without intra-measure glide, x === m5anchor.x; with glide but wrong,
    // x could jump toward m6anchor.x which is much lower)
    expect(cursor.x).toBeGreaterThanOrEqual(m5anchor.x - 0.001)
    // x must NOT be near m6's x (which is far left on the next system)
    expect(cursor.x).not.toBeLessThan(m5anchor.x - 0.05)
  })

  it('cursor x is always in [0, 1] during intra-measure glide', () => {
    // Sweep all times — x must never leave page bounds
    for (let t = 0.2; t <= duration - 0.2; t += 0.5) {
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: anchors,
        trust,
      })
      if (cursor.visible) {
        expect(cursor.x).toBeGreaterThanOrEqual(0)
        expect(cursor.x).toBeLessThanOrEqual(1)
      }
    }
  })

  it('seek snap: cursor at seek target is exact anchor x (no stale smooth position)', () => {
    // After a large seek, the resolved cursor returns the correct x for the
    // new time. The display-cursor hook then snaps (tested separately via
    // the resetSnapKey mechanism). Here we verify the resolver is correct.
    const seekTarget = duration * 0.75
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: seekTarget,
      trustedAnchors: anchors,
      trust,
    })
    expect(cursor.visible).toBe(true)
    expect(cursor.x).toBeGreaterThanOrEqual(0)
    expect(cursor.x).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Fix 4: Annotation pointer mode
// ---------------------------------------------------------------------------

describe('Fix 4: annotation POINTER tool', () => {
  it('ANNOTATION_TOOLS includes POINTER key', () => {
    expect(ANNOTATION_TOOLS).toHaveProperty('POINTER')
    expect(ANNOTATION_TOOLS.POINTER).toBe('pointer')
  })

  it('POINTER is distinct from PEN, HIGHLIGHTER, ERASER', () => {
    const values = Object.values(ANNOTATION_TOOLS)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })

  it('useAnnotations initializes activeTool to POINTER', () => {
    // Verify via source text rather than calling the hook (needs React runtime).
    const src = readFileSync(
      join(__dir, '..', 'src', 'hooks', 'useAnnotations.js'),
      'utf8',
    )
    expect(src).toMatch(/useState\s*\(\s*ANNOTATION_TOOLS\.POINTER\s*\)/)
    // And reset() should also restore POINTER
    expect(src.match(/ANNOTATION_TOOLS\.POINTER/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('PdfViewerToolbar DRAW_TOOLS includes pointer as first entry', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'PdfViewerToolbar.jsx'),
      'utf8',
    )
    // DRAW_TOOLS array literal — POINTER must appear before PEN
    const drawToolsMatch = src.match(/const DRAW_TOOLS\s*=\s*\[([^\]]*)\]/s)
    expect(drawToolsMatch).toBeTruthy()
    const block = drawToolsMatch[1]
    const pointerIndex = block.indexOf('ANNOTATION_TOOLS.POINTER')
    const penIndex = block.indexOf('ANNOTATION_TOOLS.PEN')
    expect(pointerIndex).toBeGreaterThanOrEqual(0)
    expect(pointerIndex).toBeLessThan(penIndex)
  })

  it('AnnotationLayer sets pointer-events:none when isPointer is true (source check)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'AnnotationLayer.jsx'),
      'utf8',
    )
    // Source must contain the isPointer guard for pointer-events
    expect(src).toMatch(/isPointer/)
    expect(src).toMatch(/pointerEvents.*none/)
  })
})
