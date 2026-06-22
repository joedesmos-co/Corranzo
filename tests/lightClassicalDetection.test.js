/**
 * Light classical-piano detection (Gymnopédie-style): thin, light-gray staff
 * lines, short systems, whitespace, slurs. The fixed-threshold detector
 * returned "no systems" on these; detection must now be adaptive so a clean
 * page with visible staff lines is never reported as having no systems.
 *
 * Dense dark arrangements must keep working (no regression).
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'
import {
  cleanPianoPage,
  densePianoPage,
  lightClassicalPage,
  renderPagesFromArray,
} from './helpers/syntheticScore.js'
import {
  analyzeSemiAutoScoreSetup,
  DETECTION_STAGE,
} from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  detectStaffLineStaves,
  estimateInkThreshold,
} from '../src/features/score-follow/detectStaffLines.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'

/** Piano MusicXML (2 staves), N measures. */
function pianoTimingMap(measureCount, beats = 3) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) {
      xml +=
        `<attributes><divisions>1</divisions><staves>2</staves>` +
        `<time><beats>${beats}</beats><beat-type>4</beat-type></time>` +
        `<clef><sign>G</sign><line>2</line></clef></attributes>` +
        F.soundTempo(80)
    }
    xml += F.fourQuarters()
    xml += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

function analyze(pages, timingMap) {
  return analyzeSemiAutoScoreSetup({
    pdfSource: 'light',
    numPages: pages.length,
    timingMap,
    renderPage: renderPagesFromArray(pages),
  })
}

describe('adaptive ink threshold', () => {
  it('rises for light engraving and stays low for dark engraving', () => {
    const light = lightClassicalPage({ systems: 4, measuresPerSystem: 4 })
    const dark = cleanPianoPage({ systems: 4, measuresPerSystem: 4 })
    const lightThr = estimateInkThreshold(light, detectContentBounds(light))
    const darkThr = estimateInkThreshold(dark, detectContentBounds(dark))
    expect(lightThr).toBeGreaterThan(darkThr)
    expect(lightThr).toBeGreaterThan(195) // light lines need a high threshold
  })

  it('detects staves on a light page over the content range (not full page)', () => {
    const img = lightClassicalPage({ systems: 4, measuresPerSystem: 4 })
    const staves = detectStaffLineStaves(img, detectContentBounds(img))
    // 4 grand staves → 8 staves (treble + bass each).
    expect(staves.length).toBeGreaterThanOrEqual(8)
  })
})

describe('light classical auto setup', () => {
  it('detects systems automatically (thin light lines, short systems)', async () => {
    const result = await analyze([lightClassicalPage({ systems: 4, measuresPerSystem: 4 })], pianoTimingMap(16))
    expect(result.ok).toBe(true)
    expect(result.preview.stage).toBe(DETECTION_STAGE.STAFF_LINES)
    expect(result.preview.systemCount).toBe(4)
    const trust = assessScoreFollowTrust({
      anchors: [...result.preview.proposedAnchors, ...result.preview.supplementalMeasureAnchors],
      timingMap: pianoTimingMap(16),
    })
    expect(trust.showCursor).toBe(true)
    expect(trust.needsSetup).toBe(false)
  })

  it('a clean page with visible staff lines never returns "no systems"', async () => {
    // Across a range of light line intensities — none may report no-systems.
    for (const lineValue of [180, 195, 205]) {
      const result = await analyze(
        [lightClassicalPage({ systems: 4, measuresPerSystem: 4, lineValue })],
        pianoTimingMap(16),
      )
      expect(result.ok, `lineValue ${lineValue} should detect systems`).toBe(true)
      expect(result.noSystems).toBeFalsy()
      expect(result.preview.systemCount).toBeGreaterThanOrEqual(3)
    }
  })

  it('generates one per-measure anchor per written measure for smooth following', async () => {
    const result = await analyze([lightClassicalPage({ systems: 4, measuresPerSystem: 4 })], pianoTimingMap(16))
    expect(result.preview.supplementalMeasureAnchors.length).toBe(16)
  })
})

describe('dense dark arrangement still detected (regression)', () => {
  it('dense piano page resolves via staff lines', async () => {
    const result = await analyze([densePianoPage({ systems: 5, measuresPerSystem: 6 })], pianoTimingMap(30, 4))
    expect(result.ok).toBe(true)
    expect(result.preview.stage).toBe(DETECTION_STAGE.STAFF_LINES)
    expect(result.preview.systemCount).toBeGreaterThanOrEqual(4)
  })
})
