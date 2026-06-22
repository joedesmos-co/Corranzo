/**
 * Playback cursor following — the cursor must progress measure-by-measure,
 * monotonically within a system, dropping to the next system only at its first
 * measure. Regression cover for "stalls for 3 measures, jumps to the system
 * end, then jitters backward".
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'
import { cleanPianoPage, renderPagesFromArray } from './helpers/syntheticScore.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'
import { filterTrustedAnchors, dedupeTrustedAnchorsByMeasure } from '../src/features/score-follow/trustedAnchors.js'
import { getMeasureAtTime } from '../src/features/musicxml/timingQuery.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'

/** Piano MusicXML (2 staves), N 4/4 measures @120. */
function pianoTimingMap(measureCount) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) {
      xml +=
        '<attributes><divisions>1</divisions><staves>2</staves>' +
        '<time><beats>4</beats><beat-type>4</beat-type></time>' +
        '<clef><sign>G</sign><line>2</line></clef></attributes>' +
        F.soundTempo(120)
    }
    xml += F.fourQuarters()
    xml += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

// Page 1 of Guren: 5 systems holding 5,5,4,4,4 measures → starts 1,6,11,15,19.
async function setupPage1() {
  const timingMap = pianoTimingMap(22)
  const page = cleanPianoPage({ measuresPerSystemList: [5, 5, 4, 4, 4] })
  const result = await analyzeSemiAutoScoreSetup({
    pdfSource: 'p1',
    numPages: 1,
    timingMap,
    renderPage: renderPagesFromArray([page]),
  })
  const anchors = [...result.preview.proposedAnchors, ...result.preview.supplementalMeasureAnchors]
  const trusted = filterTrustedAnchors(anchors)
  const trust = assessScoreFollowTrust({ anchors, timingMap })
  return { timingMap, result, anchors, trusted, trust }
}

function cursorAt(timingMap, trusted, trust, t) {
  return resolveScoreFollowCursor({ timingMap, practiceTime: t, trustedAnchors: trusted, trust }).cursor
}

describe('per-measure anchors', () => {
  it('generates one canonical anchor per written measure (no duplicates)', async () => {
    const { result } = await setupPage1()
    const perMeasure = result.preview.supplementalMeasureAnchors
    expect(perMeasure.length).toBe(22)
    const measures = perMeasure.map((a) => a.measureNumber)
    expect(new Set(measures).size).toBe(22) // unique
    expect(Math.min(...measures)).toBe(1)
    expect(Math.max(...measures)).toBe(22)
    expect(perMeasure.every((a) => a.source === ANCHOR_SOURCE.AUTO_MEASURE)).toBe(true)
  })

  it('dedupes to exactly one anchor per measure (AUTO_MEASURE over AUTO_SYSTEM)', async () => {
    const { trusted } = await setupPage1()
    const deduped = dedupeTrustedAnchorsByMeasure(trusted)
    expect(deduped.length).toBe(22)
    // measures 1 and 5 have both a system span anchor and a per-measure anchor;
    // the per-measure (AUTO_MEASURE) must win.
    expect(deduped.find((a) => a.measureNumber === 1).source).toBe(ANCHOR_SOURCE.AUTO_MEASURE)
    expect(deduped.find((a) => a.measureNumber === 5).source).toBe(ANCHOR_SOURCE.AUTO_MEASURE)
  })
})

describe('cursor progresses measure-by-measure on a system', () => {
  it('measures 1-5 resolve to strictly increasing x on system 1 (same y)', async () => {
    const { timingMap, trusted, trust } = await setupPage1()
    // Sample the start of each measure 1..5 (2s per measure at 120bpm 4/4).
    const samples = [0.2, 2.2, 4.2, 6.2, 8.2].map((t) => cursorAt(timingMap, trusted, trust, t))
    for (const c of samples) {
      expect(c.visible).toBe(true)
    }
    const y0 = samples[0].y
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].y).toBeCloseTo(y0, 2) // all on system 1
      expect(samples[i].x).toBeGreaterThan(samples[i - 1].x) // forward
    }
  })

  it('measure 6 begins system 2 (new y, x near the start), not the system-1 end', async () => {
    const { timingMap, trusted, trust } = await setupPage1()
    const m5 = cursorAt(timingMap, trusted, trust, 8.2) // measure 5
    const m6 = cursorAt(timingMap, trusted, trust, 10.2) // measure 6
    expect(getMeasureAtTime(timingMap, 10.2).number).toBe(6)
    expect(m6.y).toBeGreaterThan(m5.y + 0.05) // dropped to the next system
    expect(m6.x).toBeLessThan(0.3) // near the left start, not the far right
  })

  it('x is monotonic within each system across a full playback sweep', async () => {
    const { timingMap, trusted, trust } = await setupPage1()
    const duration =
      timingMap.performedMeasureTimeline?.performedDurationSeconds ?? timingMap.durationSeconds
    let prevX = -1
    let prevY = -1
    let backward = 0
    for (let t = 0.2; t <= duration; t += 0.1) {
      const c = cursorAt(timingMap, trusted, trust, t)
      if (!c.visible) continue
      if (prevY >= 0 && Math.abs(c.y - prevY) < 0.005 && c.x < prevX - 0.002) {
        backward += 1
      }
      prevX = c.x
      prevY = c.y
    }
    expect(backward).toBe(0)
  })

  it('does not stall: cursor x changes within the first measure', async () => {
    const { timingMap, trusted, trust } = await setupPage1()
    const early = cursorAt(timingMap, trusted, trust, 0.3)
    const late = cursorAt(timingMap, trusted, trust, 1.7)
    expect(late.x).toBeGreaterThan(early.x) // moved across measure 1, not stuck
  })
})

describe('repeats keep written-measure anchors stable', () => {
  it('repeated passes do not duplicate visual anchors', async () => {
    // oneRepeat: 4 written measures, performed 1,2,1,2,3,4.
    const timingMap = parseMusicXml(F.oneRepeat())
    const page = cleanPianoPage({ measuresPerSystemList: [4] })
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'r',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([page]),
    })
    const perMeasure = result.preview.supplementalMeasureAnchors
    // Exactly the 4 WRITTEN measures — never the 6-event performed expansion.
    expect(perMeasure.map((a) => a.measureNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  it('a repeated measure resolves to the same visual anchor on each pass', () => {
    const timingMap = parseMusicXml(F.oneRepeat()) // 1,2,1,2,3,4 @ 2s each
    const anchors = [
      { id: 'm1', page: 1, x: 0.1, y: 0.3, measureNumber: 1, source: 'manual' },
      { id: 'm2', page: 1, x: 0.5, y: 0.3, measureNumber: 2, source: 'manual' },
      { id: 'm3', page: 1, x: 0.1, y: 0.6, measureNumber: 3, source: 'manual' },
      { id: 'm4', page: 1, x: 0.5, y: 0.6, measureNumber: 4, source: 'manual' },
    ]
    const trust = { showCursor: true, needsSetup: false }
    const pass1 = cursorAt(timingMap, anchors, trust, 0.5) // measure 1, first pass
    const pass2 = cursorAt(timingMap, anchors, trust, 4.5) // measure 1, second pass
    expect(pass1.measureNumber).toBe(1)
    expect(pass2.measureNumber).toBe(1)
    expect(pass2.y).toBeCloseTo(pass1.y, 5) // same visual location
  })
})
