import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { Midi } from '@tonejs/midi'
import {
  DEMO_PIECE,
  FIXTURE_FILENAMES,
  FIXTURE_PATHS,
  GUITAR_DEMO_PIECE,
  GUITAR_FIXTURE_FILENAMES,
  GUITAR_FIXTURE_PATHS,
  PRACTICE_LIBRARY_FIXTURES,
  getDemoPieceForInstrument,
  getFixtureFilenamesForInstrument,
  getFixturePathsForInstrument,
  getPracticeLibraryFixture,
} from '../src/dev/fixturePaths.js'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import { isDemoFixtureFileSet } from '../src/features/demo/demoBundledAnchors.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  OMR_DIAGNOSTIC_FLAG,
  setOmrDiagnosticFlag,
} from '../src/features/omr/omrDiagnosticFlags.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import { GUITAR_SCORE_TARGET } from '../src/features/score-follow/guitarScoreTarget.js'
import {
  setPdfAnalysisCanvasFactory,
  setPdfjsLoader,
} from '../src/features/score-follow/pdfPageAnalysis.js'
import {
  assessBundledMeasureCursorX,
  validateBundledAnchorPayload,
} from '../src/features/score-follow/demoAnchorCalibration.js'
import { renderPagesFromArray } from './helpers/syntheticScore.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(root, 'public')
const ANALYSIS_WIDTH = 1000

function fixturePath(urlPath) {
  return join(publicRoot, urlPath.replace(/^\//, ''))
}

async function loadMxlTimingMap(path, fileName = 'score.mxl') {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const container = zip.file('META-INF/container.xml')
  let rootPath = null
  if (container) {
    const match = (await container.async('string')).match(/full-path="([^"]+)"/)
    rootPath = match?.[1] ?? null
  }
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (name) => name.endsWith('.xml') && !name.startsWith('META-INF'),
    )
  }
  const xml = await zip.file(rootPath).async('string')
  return parseMusicXml(xml, fileName)
}

async function rasterizePdfPages(pdfPath) {
  const { createCanvas } = await import('@napi-rs/canvas')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: ANALYSIS_WIDTH / base.width })
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    pages.push({
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
    })
  }
  return pages
}

async function configureNodePdfAnalysis() {
  const [{ createCanvas }, pdfjs] = await Promise.all([
    import('@napi-rs/canvas'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  ])
  setPdfjsLoader(() => pdfjs)
  setPdfAnalysisCanvasFactory((width, height) => createCanvas(width, height))
}

beforeAll(() => {
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
})

afterAll(() => {
  setPdfjsLoader(null)
  setPdfAnalysisCanvasFactory(null)
})

describe('Practice library fixture catalog', () => {
  it('ships PDF, MusicXML/MXL, and MIDI for every built-in practice card', async () => {
    expect(PRACTICE_LIBRARY_FIXTURES).toHaveLength(6)

    for (const fixture of PRACTICE_LIBRARY_FIXTURES) {
      expect(existsSync(fixturePath(fixture.paths.pdf)), `${fixture.id} pdf`).toBe(true)
      expect(existsSync(fixturePath(fixture.paths.midi)), `${fixture.id} midi`).toBe(true)
      expect(existsSync(fixturePath(fixture.paths.musicXml)), `${fixture.id} musicxml`).toBe(true)

      const musicXmlPath = fixturePath(fixture.paths.musicXml)
      const midi = new Midi(readFileSync(fixturePath(fixture.paths.midi)))
      const timingMap = fixture.paths.musicXml.endsWith('.mxl')
        ? await loadMxlTimingMap(musicXmlPath, fixture.fileNames.musicXml)
        : parseMusicXml(readFileSync(musicXmlPath, 'utf8'), fixture.fileNames.musicXml)
      const playable = timingMap.notes.filter((note) => !note.isRest && !note.isTabMirror)

      expect(playable.length, fixture.id).toBeGreaterThan(0)
      expect(midi.tracks.reduce((sum, track) => sum + track.notes.length, 0), fixture.id).toBeGreaterThan(0)
      expect(timingMap.durationSeconds, fixture.id).toBeGreaterThan(0)
      if (fixture.paths.musicXml.includes('/practice-library/')) {
        expect(timingMap.measures.every((measure) => measure.engravedWidth === 106), fixture.id).toBe(true)
        const firstPlayable = playable.find((note) => note.measureNumber === 1)
        expect(firstPlayable?.defaultX, fixture.id).toBe(16)
      }
      if (fixture.instrumentId === INSTRUMENT_IDS.GUITAR) {
        expect(timingMap.notation.suggestedInstrumentId, fixture.id).toBe('guitar')
        expect(timingMap.notation.hasTabStaff, fixture.id).toBe(true)
        expect(playable.every((note) => note.string != null && note.fret != null), fixture.id).toBe(true)
        expect(Math.max(...playable.map((note) => note.fret ?? 0)), fixture.id).toBeLessThanOrEqual(6)
      }
    }
  }, 30_000)

  it('resolves clicked practice cards to their own fixture bundle', () => {
    const minuet = getPracticeLibraryFixture('demo-minuet-in-g', INSTRUMENT_IDS.PIANO)
    const amazingGrace = getPracticeLibraryFixture('guitar-amazing-grace', INSTRUMENT_IDS.GUITAR)

    expect(minuet.title).toBe('Minuet in G')
    expect(minuet.paths.musicXml).toContain('/demo-minuet-in-g.musicxml')
    expect(amazingGrace.title).toBe('Amazing Grace')
    expect(amazingGrace.paths.musicXml).toContain('/practice-library/guitar-amazing-grace/')
    expect(getPracticeLibraryFixture(null, INSTRUMENT_IDS.PIANO).id).toBe(DEMO_PIECE.id)
    expect(getPracticeLibraryFixture(null, INSTRUMENT_IDS.GUITAR).id).toBe(GUITAR_DEMO_PIECE.id)
  })

  it('auto-setup anchors generated guitar practice library pieces at the first playable note, not the 30% fallback', async () => {
    await configureNodePdfAnalysis()

    const leadFraction = (anchor) =>
      (anchor.x - anchor.meta.measureStartX) /
      (anchor.meta.playableEndX - anchor.meta.measureStartX)

    async function assertPracticeLibraryStart({ fixtureId, instrumentId, guitarScoreTarget = null }) {
      const fixture = getPracticeLibraryFixture(fixtureId, instrumentId)
      const pdfPath = fixturePath(fixture.paths.pdf)
      const xml = readFileSync(fixturePath(fixture.paths.musicXml), 'utf8')
      const [pages, timingMap] = await Promise.all([
        rasterizePdfPages(pdfPath),
        Promise.resolve(parseMusicXml(xml, fixture.fileNames.musicXml)),
      ])
      const firstPlayable = timingMap.notes.find(
        (note) => note.measureNumber === 1 && !note.isRest && !note.isTabMirror,
      )
      const firstMeasure = timingMap.measures.find((measure) => measure.number === 1)
      const expectedFirstLead = firstPlayable.defaultX / firstMeasure.engravedWidth

      const result = await analyzeSemiAutoScoreSetup({
        pdfSource: `${fixtureId}-practice-library`,
        numPages: pages.length,
        timingMap,
        guitarScoreTarget,
        renderPage: renderPagesFromArray(pages),
      })

      expect(result.ok, fixtureId).toBe(true)
      const measureOne = result.preview.supplementalMeasureAnchors.find(
        (item) => item.measureNumber === 1,
      )
      expect(measureOne?.meta?.xSource, fixtureId).toContain('default-x')
      expect(measureOne?.meta?.xSource, fixtureId).not.toBe('estimated')
      expect(leadFraction(measureOne), fixtureId).toBeCloseTo(expectedFirstLead, 3)
      expect(leadFraction(measureOne), fixtureId).toBeLessThan(0.22)
      expect(leadFraction(measureOne), fixtureId).not.toBeCloseTo(0.3, 2)
    }

    await assertPracticeLibraryStart({
      fixtureId: 'guitar-amazing-grace',
      instrumentId: INSTRUMENT_IDS.GUITAR,
    })
    await assertPracticeLibraryStart({
      fixtureId: 'guitar-amazing-grace',
      instrumentId: INSTRUMENT_IDS.GUITAR,
      guitarScoreTarget: GUITAR_SCORE_TARGET.TAB,
    })
    await assertPracticeLibraryStart({
      fixtureId: 'guitar-aura-lee',
      instrumentId: INSTRUMENT_IDS.GUITAR,
    })
    await assertPracticeLibraryStart({
      fixtureId: 'guitar-aura-lee',
      instrumentId: INSTRUMENT_IDS.GUITAR,
      guitarScoreTarget: GUITAR_SCORE_TARGET.TAB,
    })
  }, 60_000)
})

describe('Hungarian Dance demo fixtures', () => {
  it('exposes Hungarian Dance as the built-in demo piece', () => {
    expect(DEMO_PIECE.id).toBe('hungarian-dance-no5')
    expect(DEMO_PIECE.title).toContain('Hungarian Dance')
    expect(DEMO_PIECE.measureCount).toBe(104)
    expect(DEMO_PIECE.pageCount).toBe(4)
  })

  it('ships pdf, mxl, and midi on disk', () => {
    for (const path of [FIXTURE_PATHS.pdf, FIXTURE_PATHS.midi, FIXTURE_PATHS.musicXml]) {
      expect(existsSync(fixturePath(path)), path).toBe(true)
    }
  })

  it('ships validated auto-preview bundled anchors (not hybrid-reconciled)', () => {
    const anchorsPath = fixturePath(FIXTURE_PATHS.demoAnchors)
    expect(existsSync(anchorsPath)).toBe(true)
    const payload = JSON.parse(readFileSync(anchorsPath, 'utf8'))
    expect(payload.alignmentNote).not.toContain('hybrid-reconciled')
    const result = validateBundledAnchorPayload(payload, { pieceId: DEMO_PIECE.id })
    expect(result.ok).toBe(true)
    expect(result.anchors).toHaveLength(104)
    const measureOne = result.anchors.find((anchor) => anchor.measureNumber === 1)
    expect(measureOne.x).toBeGreaterThan(0.16)
    expect(assessBundledMeasureCursorX(measureOne).ok).toBe(true)
  })

  it('recognizes the demo file set by filename', () => {
    expect(
      isDemoFixtureFileSet(FIXTURE_FILENAMES.pdf, FIXTURE_FILENAMES.musicXml),
    ).toBe(true)
  })

  it('rejects measure-1 anchors parked on the clef margin', () => {
    const bad = {
      pieceId: 'hungarian-dance-no5',
      anchors: [
        {
          page: 1,
          x: 0.12,
          y: 0.2,
          measureNumber: 1,
          meta: {
            role: 'measure',
            measureStartX: 0.12,
            playableStartX: 0.25,
            playableEndX: 0.4,
            systemEndX: 0.95,
          },
        },
        { page: 1, x: 0.4, y: 0.2, measureNumber: 2, meta: { role: 'measure' } },
      ],
    }
    expect(validateBundledAnchorPayload(bad).reason).toBe('cursor-before-playable-start')
    expect(
      assessBundledMeasureCursorX(bad.anchors[0]).reason,
    ).toBe('cursor-before-playable-start')
  })

  it('auto-setup on public fixtures places measure 1 in the playable area', async () => {
    const pdfPath = fixturePath(FIXTURE_PATHS.pdf)
    const mxlPath = fixturePath(FIXTURE_PATHS.musicXml)
    const [pages, timingMap] = await Promise.all([
      rasterizePdfPages(pdfPath),
      loadMxlTimingMap(mxlPath),
    ])

    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'hungarian-demo-fixture',
      numPages: pages.length,
      timingMap,
      renderPage: renderPagesFromArray(pages),
    })

    expect(result.ok).toBe(true)
    expect(result.preview.supplementalMeasureAnchors.length).toBe(104)

    const measureOne =
      result.preview.supplementalMeasureAnchors.find((anchor) => anchor.measureNumber === 1) ??
      result.preview.proposedAnchors.find((anchor) => anchor.measureNumber === 1)
    expect(measureOne).toBeTruthy()
    expect(measureOne.page).toBe(1)
    expect(assessBundledMeasureCursorX(measureOne).ok).toBe(true)
    expect(measureOne.x).toBeGreaterThan(0.16)

    const pagesWithAnchors = new Set(result.preview.proposedAnchors.map((anchor) => anchor.page))
    expect(pagesWithAnchors.size).toBe(4)
  }, 120_000)

  describe('page 4 final-system geometry', () => {
    const payload = JSON.parse(readFileSync(fixturePath(FIXTURE_PATHS.demoAnchors), 'utf8'))
    const anchor = (measureNumber) =>
      payload.anchors.find((item) => item.measureNumber === measureNumber)

    it('page-4 system 1 uses grand-staff center Y, not the treble band alone', () => {
      const m89 = anchor(89)
      const m95 = anchor(95)
      const m96 = anchor(96)
      const m102 = anchor(102)
      expect(m89.page).toBe(4)
      expect(m89.x).toBeGreaterThan(0.12)
      expect(m89.y).toBeCloseTo(0.12455, 2)
      expect(m89.y).toBeGreaterThan(0.12)
      expect(m89.y).toBeLessThan(0.13)
      expect(m89.y).not.toBeCloseTo(0.087, 2)
      expect(m95.y).toBeCloseTo(m89.y, 3)
      const gapToSystem2 = m96.y - m89.y
      const gapToSystem3 = m102.y - m96.y
      expect(gapToSystem2).toBeGreaterThan(0.1)
      expect(gapToSystem2).toBeLessThan(0.2)
      expect(Math.abs(gapToSystem2 - gapToSystem3)).toBeLessThan(0.05)
    })

    it('places measure 96 on the second grand staff, not the bass band of system 1', () => {
      expect(anchor(96).page).toBe(4)
      expect(anchor(96).y).toBeGreaterThan(0.22)
      expect(anchor(96).y).toBeLessThan(0.32)
      expect(anchor(96).y).toBeGreaterThan(anchor(89).y + 0.1)
      expect(anchor(96).x).toBeGreaterThan(0.13)
      expect(anchor(96).x).toBeLessThan(0.28)
      expect(assessBundledMeasureCursorX(anchor(96)).ok).toBe(true)
    })

    it('places measure 102 on the third grand staff', () => {
      expect(anchor(102).page).toBe(4)
      expect(anchor(102).y).toBeGreaterThan(0.35)
      expect(anchor(102).y).toBeLessThan(0.45)
      expect(anchor(102).y).toBeGreaterThan(anchor(96).y + 0.1)
      expect(anchor(102).x).toBeGreaterThan(0.13)
      expect(anchor(102).x).toBeLessThan(0.28)
    })

    it('places measure 104 near the final measure region on system 3', () => {
      expect(anchor(104).page).toBe(4)
      expect(anchor(104).y).toBeCloseTo(anchor(102).y, 2)
      expect(anchor(104).x).toBeGreaterThan(0.65)
      expect(anchor(104).x).toBeLessThan(0.85)
    })
  })
})

describe('Guitar demo fixtures', () => {
  it('exposes a dedicated public-domain beginner guitar demo', () => {
    expect(GUITAR_DEMO_PIECE.id).toBe('guitar-ode-to-joy')
    expect(GUITAR_DEMO_PIECE.title).toContain('Ode to Joy')
    expect(GUITAR_DEMO_PIECE.measureCount).toBeGreaterThanOrEqual(5)
    expect(GUITAR_DEMO_PIECE.measureCount).toBeLessThanOrEqual(10)
    expect(getDemoPieceForInstrument(INSTRUMENT_IDS.GUITAR)).toBe(GUITAR_DEMO_PIECE)
    expect(getDemoPieceForInstrument(INSTRUMENT_IDS.PIANO)).toBe(DEMO_PIECE)
  })

  it('keeps Piano and Guitar demo bundles independent', () => {
    expect(getFixturePathsForInstrument(INSTRUMENT_IDS.PIANO)).toBe(FIXTURE_PATHS)
    expect(getFixturePathsForInstrument(INSTRUMENT_IDS.GUITAR)).toBe(GUITAR_FIXTURE_PATHS)
    expect(getFixtureFilenamesForInstrument(INSTRUMENT_IDS.PIANO)).toBe(FIXTURE_FILENAMES)
    expect(getFixtureFilenamesForInstrument(INSTRUMENT_IDS.GUITAR)).toBe(GUITAR_FIXTURE_FILENAMES)
    expect(GUITAR_FIXTURE_PATHS.pdf).not.toBe(FIXTURE_PATHS.pdf)
    expect(GUITAR_FIXTURE_PATHS.midi).not.toBe(FIXTURE_PATHS.midi)
    expect(GUITAR_FIXTURE_PATHS.musicXml).not.toBe(FIXTURE_PATHS.musicXml)
  })

  it('ships guitar PDF, MusicXML, and MIDI on disk', () => {
    for (const path of [
      GUITAR_FIXTURE_PATHS.pdf,
      GUITAR_FIXTURE_PATHS.midi,
      GUITAR_FIXTURE_PATHS.musicXml,
    ]) {
      expect(existsSync(fixturePath(path)), path).toBe(true)
    }
  })

  it('parses as a short guitar score with standard notation and TAB positions', () => {
    const xml = readFileSync(fixturePath(GUITAR_FIXTURE_PATHS.musicXml), 'utf8')
    const timingMap = parseMusicXml(xml, GUITAR_FIXTURE_FILENAMES.musicXml)
    const playable = timingMap.notes.filter((note) => !note.isRest && !note.isTabMirror)

    expect(timingMap.notation.hasStandardStaff).toBe(true)
    expect(timingMap.notation.hasTabStaff).toBe(true)
    expect(timingMap.notation.suggestedInstrumentId).toBe('guitar')
    expect(timingMap.durationSeconds).toBeGreaterThanOrEqual(20)
    expect(timingMap.durationSeconds).toBeLessThanOrEqual(40)
    expect(timingMap.parts[0].tuning).toEqual([64, 59, 55, 50, 45, 40])
    expect(timingMap.notes.filter((note) => note.isTabMirror)).toHaveLength(playable.length)
    expect(playable.every((note) => note.string != null && note.fret != null)).toBe(true)
    expect(timingMap.measures.every((measure) => measure.engravedWidth === 126)).toBe(true)
    expect(playable.slice(0, 4).map((note) => note.defaultX)).toEqual([20, 47, 74, 101])
  })

  it('can run local OMR from the guitar demo PDF alone', async () => {
    await configureNodePdfAnalysis()
    const pdfData = new Uint8Array(readFileSync(fixturePath(GUITAR_FIXTURE_PATHS.pdf)))

    const result = await runPdfOmrPipeline(
      { data: pdfData, isEvalSupported: false },
      { instrumentId: INSTRUMENT_IDS.GUITAR, title: 'Guitar Demo PDF OMR' },
    )
    const timingMap = parseMusicXml(result.musicXml, 'guitar-demo-pdf-omr.musicxml')
    const playable = timingMap.notes.filter(
      (note) => !note.isRest && !note.isTabMirror && note.midi != null,
    )

    expect(result.noteCount).toBe(28)
    expect(result.measureCount).toBe(7)
    expect(result.diagnostics.failureReasons).not.toContain('low-confidence')
    expect(result.diagnostics.difficulty.tooDifficult).toBe(false)
    expect(result.diagnostics.tablature).toMatchObject({
      tabStaves: 2,
      tabNotes: 28,
      tabPositionalMeasures: 7,
    })
    expect(playable).toHaveLength(28)
    expect(playable.every((note) => note.string != null && note.fret != null)).toBe(true)
  }, 30_000)

  it('auto-setup can follow notation rows or TAB rows for paired guitar systems', async () => {
    const pdfPath = fixturePath(GUITAR_FIXTURE_PATHS.pdf)
    const xml = readFileSync(fixturePath(GUITAR_FIXTURE_PATHS.musicXml), 'utf8')
    const [pages, timingMap] = await Promise.all([
      rasterizePdfPages(pdfPath),
      Promise.resolve(parseMusicXml(xml, GUITAR_FIXTURE_FILENAMES.musicXml)),
    ])

    const notationResult = await analyzeSemiAutoScoreSetup({
      pdfSource: 'guitar-demo-fixture',
      numPages: pages.length,
      timingMap,
      renderPage: renderPagesFromArray(pages),
    })

    expect(notationResult.ok).toBe(true)
    expect(notationResult.preview.debugReport.pairedTabMirrorFilter).toMatchObject({
      applied: true,
      target: GUITAR_SCORE_TARGET.NOTATION,
      originalSystemCount: 4,
      effectiveSystemCount: 2,
    })
    expect(notationResult.preview.systemCount).toBe(2)
    expect(notationResult.preview.supplementalMeasureAnchors).toHaveLength(7)

    const notationAnchor = (measureNumber) =>
      notationResult.preview.supplementalMeasureAnchors.find(
        (item) => item.measureNumber === measureNumber,
      )
    const firstPlayable = timingMap.notes.find(
      (note) => note.measureNumber === 1 && !note.isRest && !note.isTabMirror,
    )
    const firstMeasure = timingMap.measures.find((measure) => measure.number === 1)
    const expectedFirstLead = firstPlayable.defaultX / firstMeasure.engravedWidth
    const leadFraction = (anchor) =>
      (anchor.x - anchor.meta.measureStartX) /
      (anchor.meta.playableEndX - anchor.meta.measureStartX)

    expect(notationAnchor(1).y).toBeCloseTo(notationAnchor(4).y, 3)
    expect(notationAnchor(5).y).toBeCloseTo(notationAnchor(7).y, 3)
    expect(notationAnchor(5).y).toBeGreaterThan(notationAnchor(1).y + 0.1)
    expect(notationAnchor(1).meta.xSource).toBe('default-x+barline')
    expect(leadFraction(notationAnchor(1))).toBeCloseTo(expectedFirstLead, 3)

    const tabResult = await analyzeSemiAutoScoreSetup({
      pdfSource: 'guitar-demo-fixture',
      numPages: pages.length,
      timingMap,
      guitarScoreTarget: GUITAR_SCORE_TARGET.TAB,
      renderPage: renderPagesFromArray(pages),
    })

    expect(tabResult.ok).toBe(true)
    expect(tabResult.preview.debugReport.pairedTabMirrorFilter).toMatchObject({
      applied: true,
      target: GUITAR_SCORE_TARGET.TAB,
      originalSystemCount: 4,
      effectiveSystemCount: 2,
    })
    expect(tabResult.preview.systemCount).toBe(2)
    expect(tabResult.preview.supplementalMeasureAnchors).toHaveLength(7)

    const tabAnchor = (measureNumber) =>
      tabResult.preview.supplementalMeasureAnchors.find(
        (item) => item.measureNumber === measureNumber,
      )
    expect(tabAnchor(1).y).toBeCloseTo(tabAnchor(4).y, 3)
    expect(tabAnchor(5).y).toBeCloseTo(tabAnchor(7).y, 3)
    expect(tabAnchor(1).y).toBeGreaterThan(notationAnchor(1).y + 0.03)
    expect(tabAnchor(5).y).toBeGreaterThan(notationAnchor(5).y + 0.03)
    expect(tabAnchor(1).meta.xSource).toBe('default-x+barline')
    expect(leadFraction(tabAnchor(1))).toBeCloseTo(expectedFirstLead, 3)
  }, 60_000)

  it('does not route the Guitar demo through Piano bundled anchors', () => {
    expect(
      isDemoFixtureFileSet(GUITAR_FIXTURE_FILENAMES.pdf, GUITAR_FIXTURE_FILENAMES.musicXml),
    ).toBe(false)
  })
})
