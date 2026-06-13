/**
 * Regression tests for the 5 product-blocking fixes applied 2026-06-13
 * (Session 4 — "real browser testing"):
 *
 *  B. Pointer click-through   — annotation layer wrapper passes events in pointer mode
 *  C. User-score cursor       — AUTO_SYSTEM anchors trusted; auto trust level shows cursor
 *  D. Cursor smoothness       — useScoreFollowDisplayCursor accepts real-time callbacks
 *  E. UI copy conciseness     — setup panel has no long instruction blocks
 *  F. Piano synth             — triangle8 oscillator, sustain 0, long decay
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'
import { filterTrustedAnchors } from '../src/features/score-follow/trustedAnchors.js'
import {
  assessScoreFollowTrust,
  FOLLOW_TRUST_LEVEL,
} from '../src/features/score-follow/scoreFollowTrust.js'

const __dir = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Fix B: Pointer click-through — wrapper div passes events in pointer mode
// ---------------------------------------------------------------------------

describe('Fix B: pointer mode disables annotation capture', () => {
  it('PdfPageFrame computes isPointerTool from activeTool (source check)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'PdfPageFrame.jsx'),
      'utf8',
    )
    // Must derive isPointerTool from activeTool
    expect(src).toMatch(/isPointerTool\s*=\s*activeTool\s*===\s*ANNOTATION_TOOLS\.POINTER/)
  })

  it('PdfPageFrame passes isPointerTool into the overlay layer (source check)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'PdfPageFrame.jsx'),
      'utf8',
    )
    // The PdfOverlayLayer pointerEvents must reference isPointerTool
    expect(src).toMatch(/isPointerTool/)
    // The condition must produce 'none' in pointer mode
    expect(src).toMatch(/'none'/)
  })

  it('AnnotationLayer still has its own isPointer guard (defense-in-depth)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'AnnotationLayer.jsx'),
      'utf8',
    )
    expect(src).toMatch(/isPointer/)
    expect(src).toMatch(/pointerEvents.*none|none.*pointerEvents/s)
  })

  it('ANNOTATION_TOOLS.POINTER exists and equals "pointer"', async () => {
    const { ANNOTATION_TOOLS } = await import('../src/components/pdf/annotationConstants.js')
    expect(ANNOTATION_TOOLS.POINTER).toBe('pointer')
  })
})

// ---------------------------------------------------------------------------
// Fix C: User-score cursor
//   C1 — filterTrustedAnchors now includes AUTO_SYSTEM / AUTO sources
//   C2 — assessScoreFollowTrust shows cursor for auto-only anchors (≥2)
// ---------------------------------------------------------------------------

describe('Fix C1: filterTrustedAnchors includes AUTO_SYSTEM anchors', () => {
  function makeAnchor(source, measureNumber = 1) {
    return { id: `${source}-${measureNumber}`, source, measureNumber, x: 0.1, y: 0.2, page: 1 }
  }

  it('includes AUTO_SYSTEM anchors', () => {
    const anchors = [makeAnchor(ANCHOR_SOURCE.AUTO_SYSTEM, 1), makeAnchor(ANCHOR_SOURCE.AUTO_SYSTEM, 2)]
    const trusted = filterTrustedAnchors(anchors)
    expect(trusted).toHaveLength(2)
  })

  it('includes legacy AUTO anchors', () => {
    const anchors = [makeAnchor(ANCHOR_SOURCE.AUTO, 1), makeAnchor(ANCHOR_SOURCE.AUTO, 2)]
    const trusted = filterTrustedAnchors(anchors)
    expect(trusted).toHaveLength(2)
  })

  it('includes DEMO anchors (unchanged)', () => {
    const anchors = [makeAnchor(ANCHOR_SOURCE.DEMO, 1)]
    expect(filterTrustedAnchors(anchors)).toHaveLength(1)
  })

  it('includes MANUAL anchors (unchanged)', () => {
    const anchors = [makeAnchor(ANCHOR_SOURCE.MANUAL, 1)]
    expect(filterTrustedAnchors(anchors)).toHaveLength(1)
  })

  it('includes MUSICXML_LAYOUT anchors (unchanged)', () => {
    const anchors = [makeAnchor(ANCHOR_SOURCE.MUSICXML_LAYOUT, 1)]
    expect(filterTrustedAnchors(anchors)).toHaveLength(1)
  })

  it('excludes AUTO_MEASURE anchors (not in trusted set)', () => {
    const anchors = [makeAnchor(ANCHOR_SOURCE.AUTO_MEASURE, 1)]
    // AUTO_MEASURE is not explicitly trusted — verify consistent with source
    const trusted = filterTrustedAnchors(anchors)
    // AUTO_MEASURE is NOT listed in filterTrustedAnchors → expect 0
    expect(trusted).toHaveLength(0)
  })
})

describe('Fix C2: assessScoreFollowTrust shows cursor for auto-only setup', () => {
  const minimalTimingMap = {
    measures: [{ number: 1, startTimeSeconds: 0, endTimeSeconds: 2 }],
  }

  function makeAnchor(source, measureNumber) {
    return { id: `${source}-${measureNumber}`, source, measureNumber, x: 0.1, y: 0.2, page: 1 }
  }

  it('returns showCursor:true when 2+ AUTO_SYSTEM anchors exist', () => {
    const anchors = [
      makeAnchor(ANCHOR_SOURCE.AUTO_SYSTEM, 1),
      makeAnchor(ANCHOR_SOURCE.AUTO_SYSTEM, 2),
      makeAnchor(ANCHOR_SOURCE.AUTO_SYSTEM, 3),
    ]
    const result = assessScoreFollowTrust({ anchors, timingMap: minimalTimingMap })
    expect(result.showCursor).toBe(true)
    expect(result.needsSetup).toBe(false)
    expect(result.level).toBe(FOLLOW_TRUST_LEVEL.AUTO)
  })

  it('returns showCursor:true when 2+ legacy AUTO anchors exist', () => {
    const anchors = [
      makeAnchor(ANCHOR_SOURCE.AUTO, 1),
      makeAnchor(ANCHOR_SOURCE.AUTO, 2),
    ]
    const result = assessScoreFollowTrust({ anchors, timingMap: minimalTimingMap })
    expect(result.showCursor).toBe(true)
    expect(result.level).toBe(FOLLOW_TRUST_LEVEL.AUTO)
  })

  it('returns showCursor:false when fewer than 2 auto anchors exist', () => {
    const anchors = [makeAnchor(ANCHOR_SOURCE.AUTO_SYSTEM, 1)]
    const result = assessScoreFollowTrust({ anchors, timingMap: minimalTimingMap })
    expect(result.showCursor).toBe(false)
    expect(result.needsSetup).toBe(true)
  })

  it('returns showCursor:false for empty anchors', () => {
    const result = assessScoreFollowTrust({ anchors: [], timingMap: minimalTimingMap })
    expect(result.showCursor).toBe(false)
    expect(result.level).toBe(FOLLOW_TRUST_LEVEL.NONE)
  })

  it('MANUAL beats AUTO — manual with 1 anchor still shows cursor', () => {
    const anchors = [makeAnchor(ANCHOR_SOURCE.MANUAL, 1)]
    const result = assessScoreFollowTrust({ anchors, timingMap: minimalTimingMap })
    expect(result.showCursor).toBe(true)
    expect(result.level).toBe(FOLLOW_TRUST_LEVEL.MANUAL)
  })

  it('AUTO trust result is marked approximate', () => {
    const anchors = [
      makeAnchor(ANCHOR_SOURCE.AUTO_SYSTEM, 1),
      makeAnchor(ANCHOR_SOURCE.AUTO_SYSTEM, 2),
    ]
    const result = assessScoreFollowTrust({ anchors, timingMap: minimalTimingMap })
    expect(result.approximate).toBe(true)
    expect(result.label).toMatch(/auto/i)
  })
})

// ---------------------------------------------------------------------------
// Fix D: Cursor smoothness — real-time callback interface
// ---------------------------------------------------------------------------

describe('Fix D: useScoreFollowDisplayCursor accepts real-time callbacks (source check)', () => {
  it('accepts getScoreTime parameter', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'score-follow', 'useScoreFollowDisplayCursor.js'),
      'utf8',
    )
    expect(src).toMatch(/getScoreTime/)
  })

  it('accepts resolveRealtimeCursor parameter', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'score-follow', 'useScoreFollowDisplayCursor.js'),
      'utf8',
    )
    expect(src).toMatch(/resolveRealtimeCursor/)
  })

  it('uses stable refs so the RAF closure always has latest callbacks', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'score-follow', 'useScoreFollowDisplayCursor.js'),
      'utf8',
    )
    expect(src).toMatch(/getScoreTimeRef/)
    expect(src).toMatch(/resolveRealtimeCursorRef/)
  })

  it('calls resolveRealtimeCursor with getScoreTime() in the RAF tick', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'score-follow', 'useScoreFollowDisplayCursor.js'),
      'utf8',
    )
    // Pattern: rtResolve(rtGetTime()) or similar — real-time resolution in tick
    expect(src).toMatch(/rtResolve.*rtGetTime\(\)|rtGetTime.*rtResolve/s)
  })

  it('useScoreFollow passes getScoreTime to the display cursor hook (source check)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'score-follow', 'useScoreFollow.js'),
      'utf8',
    )
    expect(src).toMatch(/getScoreTime/)
    expect(src).toMatch(/resolveRealtimeCursor/)
  })

  it('PracticeSessionContext threads getScoreTime from playback to scoreFollow (source check)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'context', 'PracticeSessionContext.jsx'),
      'utf8',
    )
    expect(src).toMatch(/getScoreTime/)
  })

  it('useScorePlayback exports getScoreTime callback (source check)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'playback', 'useScorePlayback.js'),
      'utf8',
    )
    expect(src).toMatch(/getScoreTime/)
    // Must return it
    expect(src).toMatch(/return.*getScoreTime|getScoreTime.*return/s)
  })
})

// ---------------------------------------------------------------------------
// Fix E: UI copy conciseness
// ---------------------------------------------------------------------------

describe('Fix E: setup panel has no long instruction blocks', () => {
  it('PracticeSetupPanel has no <ol> step-by-step instructions', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'practice', 'PracticeSetupPanel.jsx'),
      'utf8',
    )
    expect(src).not.toMatch(/<ol/)
    expect(src).not.toMatch(/<li.*step/i)
  })

  it('PracticeSetupPanel has no "Here is how" or multi-sentence instruction paragraphs', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'practice', 'PracticeSetupPanel.jsx'),
      'utf8',
    )
    // Must not contain the old verbose instruction copy
    expect(src).not.toMatch(/Here is how/i)
    expect(src).not.toMatch(/To use score follow/i)
    expect(src).not.toMatch(/Step 1|Step 2|Step 3/i)
  })

  it('ScoreFollowControls "Scanning" status is short (< 40 chars)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'ScoreFollowControls.jsx'),
      'utf8',
    )
    // Extract the scanning title string
    const match = src.match(/Scanning[^'"]*['"]/)
    expect(match).toBeTruthy()
    expect(match[0].length).toBeLessThan(40)
  })

  it('ScoreFollowControls "needs setup" detail is a short label (< 60 chars)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'ScoreFollowControls.jsx'),
      'utf8',
    )
    // The setup detail should reference MusicXML and be concise
    expect(src).toMatch(/Mark system starts|load MusicXML/i)
    // Confirm we removed the long paragraph from old version
    expect(src).not.toMatch(/Automatic setup requires/)
    expect(src).not.toMatch(/score-follow system needs/)
  })

  it('ScoreFollowControls "Following" status is a short title', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'pdf', 'ScoreFollowControls.jsx'),
      'utf8',
    )
    // Title is just "Following" — not a long sentence
    expect(src).toMatch(/'Following'|"Following"/)
  })

  it('no PracticeHelpTip component used in PracticeSetupPanel', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'components', 'practice', 'PracticeSetupPanel.jsx'),
      'utf8',
    )
    expect(src).not.toMatch(/PracticeHelpTip/)
  })
})

// ---------------------------------------------------------------------------
// Fix F: Piano synth — triangle8 oscillator, no sustain, long decay
// ---------------------------------------------------------------------------

describe('Fix F: scorePlaybackEngine uses piano-like synth config', () => {
  it('oscillator type is triangle8 (not sine)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'playback', 'scorePlaybackEngine.js'),
      'utf8',
    )
    expect(src).toMatch(/type\s*:\s*['"]triangle8['"]/)
    // Must not still use plain sine
    expect(src).not.toMatch(/type\s*:\s*['"]sine['"]/)
  })

  it('sustain is 0 (piano decay, no sustain plateau)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'playback', 'scorePlaybackEngine.js'),
      'utf8',
    )
    expect(src).toMatch(/sustain\s*:\s*0\.0|sustain\s*:\s*0[^.]/)
  })

  it('decay is >= 1.5 s (long piano-like decay)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'playback', 'scorePlaybackEngine.js'),
      'utf8',
    )
    const match = src.match(/decay\s*:\s*([\d.]+)/)
    expect(match).toBeTruthy()
    const decay = parseFloat(match[1])
    expect(decay).toBeGreaterThanOrEqual(1.5)
  })

  it('attack is short (<= 0.02 s for snappy piano attack)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'playback', 'scorePlaybackEngine.js'),
      'utf8',
    )
    const match = src.match(/attack\s*:\s*([\d.]+)/)
    expect(match).toBeTruthy()
    const attack = parseFloat(match[1])
    expect(attack).toBeLessThanOrEqual(0.02)
  })

  it('filter frequency is >= 3000 Hz (brighter, not overly muffled)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'playback', 'scorePlaybackEngine.js'),
      'utf8',
    )
    // Find the Tone.Filter block — frequency is an integer ≥ 100 (not 0.x like chorus)
    const match = src.match(/Tone\.Filter\s*\(\s*\{[^}]*frequency\s*:\s*(\d{3,})/s)
    expect(match).toBeTruthy()
    const freq = parseInt(match[1], 10)
    expect(freq).toBeGreaterThanOrEqual(3000)
  })

  it('reverb is applied (wet > 0)', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'playback', 'scorePlaybackEngine.js'),
      'utf8',
    )
    expect(src).toMatch(/Tone\.Reverb/)
    const match = src.match(/wet\s*:\s*([\d.]+)/)
    expect(match).toBeTruthy()
    const wet = parseFloat(match[1])
    expect(wet).toBeGreaterThan(0)
  })
})
