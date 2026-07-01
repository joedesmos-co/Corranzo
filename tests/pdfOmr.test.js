import { describe, expect, it } from 'vitest'
import {
  cleanPianoPage,
  densePianoPage,
  renderPagesFromArray,
  rhythmicPianoPage,
} from './helpers/syntheticScore.js'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  buildOmrMusicXml,
  buildOmrMusicXmlFromNotes,
} from '../src/features/omr/buildOmrMusicXml.js'
import { assembleMeasureRhythm } from '../src/features/omr/assembleOmrMeasureRhythm.js'
import { detectNoteheadsInMeasure } from '../src/features/omr/detectOmrNoteheads.js'
import { buildMeasureBoxesForSystem } from '../src/features/omr/buildOmrMeasureGrid.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'
import { validateAndNormalizeMeasureRhythm } from '../src/features/omr/validateOmrMeasureRhythm.js'
import { OMR_STATUS } from '../src/features/omr/omrConstants.js'
import { OMR_MEASURE_DIVISIONS } from '../src/features/omr/omrRhythmConstants.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

describe('experimental PDF OMR (local-only)', () => {
  it('buildOmrMusicXml produces parseable MusicXML', () => {
    const xml = buildOmrMusicXmlFromNotes({
      title: 'Test',
      notes: [
        { measureNumber: 1, positionInMeasure: 0, midi: 60 },
        { measureNumber: 1, positionInMeasure: 0.5, midi: 64 },
        { measureNumber: 2, positionInMeasure: 0.25, midi: 67 },
      ],
    })
    const timing = parseMusicXml(xml, 'test.omr.musicxml')
    expect(timing.measures.length).toBeGreaterThanOrEqual(2)
    expect(timing.durationSeconds).toBeGreaterThan(0)
  })

  it('validateAndNormalizeMeasureRhythm pads gaps with rests', () => {
    const result = validateAndNormalizeMeasureRhythm([
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [{ midi: 60 }],
      },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 4,
        notes: [{ midi: 62 }],
      },
    ])
    expect(result.valid).toBe(true)
    expect(result.totalDivisions).toBe(OMR_MEASURE_DIVISIONS)
    expect(result.normalizedEvents.some((event) => event.type === 'rest')).toBe(true)
  })

  it('detects noteheads on a dense synthetic piano page', async () => {
    const page = densePianoPage({ systems: 2, measuresPerSystem: 4 })
    const statuses = []
    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 1,
      renderPage: renderPagesFromArray([page]),
      onStatus: (status) => statuses.push(status),
    })

    expect(result.noteCount).toBeGreaterThan(0)
    expect(result.measureCount).toBeGreaterThan(0)
    expect(result.measureGrid?.measures?.length).toBeGreaterThan(0)
    expect(result.measureGrid.measures[0]).toMatchObject({
      page: 1,
      measureNumber: expect.any(Number),
      xStart: expect.any(Number),
      xEnd: expect.any(Number),
    })
    expect(statuses).toContain(OMR_STATUS.READY)

    const timing = parseMusicXml(result.musicXml, 'dense.omr.musicxml')
    expect(timing.measures.length).toBeGreaterThan(0)
  })

  it('fails gracefully when no noteheads are present', async () => {
    const page = cleanPianoPage({ systems: 2, measuresPerSystem: 4 })
    await expect(
      runPdfOmrPipeline('synthetic', {
        numPages: 1,
        renderPage: renderPagesFromArray([page]),
      }),
    ).rejects.toThrow(/noteheads|staff systems/i)
  })
})

describe('experimental PDF OMR rhythm (v2)', () => {
  it('infers quarter and half durations on a rhythmic synthetic page', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 4 })
    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 1,
      renderPage: renderPagesFromArray([page]),
    })

    const timing = parseMusicXml(result.musicXml, 'rhythm.omr.musicxml')
    expect(timing.measures.length).toBeGreaterThanOrEqual(2)

    const firstMeasureNotes = timing.notes.filter((note) => note.measureNumber === 1)
    const secondMeasureNotes = timing.notes.filter((note) => note.measureNumber === 2)
    expect(firstMeasureNotes.length).toBeGreaterThanOrEqual(3)
    expect(secondMeasureNotes.length).toBeGreaterThanOrEqual(1)

    const quarterish = firstMeasureNotes.filter(
      (note) => note.durationQuarters >= 0.75 && note.durationQuarters <= 1.25,
    )
    expect(quarterish.length).toBeGreaterThanOrEqual(2)

    const halfish = secondMeasureNotes.filter(
      (note) => note.durationQuarters >= 1.5 && note.durationQuarters <= 2.5,
    )
    expect(halfish.length).toBeGreaterThanOrEqual(1)
  })

  it('measure rhythm assembly fills each measure to the time signature', () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    const imageData = page
    const contentBounds = detectContentBounds(imageData)
    const { systems, inkThreshold } = detectStaffLineSystems(imageData, contentBounds, {
      stavesPerSystem: 2,
      countBarlines: true,
    })
    const measureBoxes = buildMeasureBoxesForSystem({
      page: 1,
      systemIndex: 0,
      system: systems[0],
      contentBounds,
      imageData,
      measureNumberStart: 1,
    })

    const measureBox = measureBoxes[0]
    const noteheads = detectNoteheadsInMeasure(imageData, measureBox, inkThreshold)
    expect(noteheads.length).toBeGreaterThan(0)

    const rhythm = assembleMeasureRhythm(imageData, measureBox, noteheads, inkThreshold)
    const total = rhythm.events.reduce((sum, event) => sum + event.durationDivisions, 0)
    expect(total).toBe(OMR_MEASURE_DIVISIONS)
  })

  it('buildOmrMusicXml emits dotted notes and tie markup when present', () => {
    const xml = buildOmrMusicXml({
      measures: [
        {
          measureNumber: 1,
          uncertain: false,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 6,
              durationType: 'quarter',
              dotted: true,
              tieStart: true,
              notes: [{ midi: 72 }],
            },
            {
              type: 'rest',
              startDivision: 6,
              durationDivisions: 10,
              durationType: 'quarter',
            },
          ],
        },
      ],
    })
    expect(xml).toContain('<dot/>')
    expect(xml).toContain('<tie type="start"/>')
    const timing = parseMusicXml(xml, 'dotted.omr.musicxml')
    expect(timing.durationSeconds).toBeGreaterThan(0)
  })
})

function scoreGraphPromotionMeasures() {
  return [
    {
      measureNumber: 1,
      page: 1,
      systemIndex: 0,
      confidence: 0.95,
      events: [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 8,
          durationType: 'half',
          notes: [{ midi: 60, clef: 'treble', cx: 20, cy: 50 }],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ midi: 62, clef: 'treble', cx: 60, cy: 48 }],
        },
      ],
    },
    {
      measureNumber: 2,
      page: 1,
      systemIndex: 0,
      confidence: 0.95,
      events: [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ midi: 64, clef: 'treble', cx: 20, cy: 46 }],
        },
        {
          type: 'note',
          startDivision: 4,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ midi: 65, clef: 'treble', cx: 60, cy: 45 }],
        },
      ],
    },
  ]
}

function scoreGraphPromotionAnalyzePage(measures = scoreGraphPromotionMeasures()) {
  return () => ({
    stats: {
      systems: 1,
      measures: measures.length,
      notes: measures.reduce(
        (sum, measure) =>
          sum + measure.events.reduce((eventSum, event) => eventSum + (event.notes?.length ?? 0), 0),
        0,
      ),
      uncertainMeasures: 0,
    },
    nextMeasureNumber: (measures.at(-1)?.measureNumber ?? 0) + 1,
    keySignature: { fifths: 0, mode: 'major', confidence: 1 },
    timeSignature: { beats: 4, beatType: 4, confidence: 1 },
    measureRhythms: measures,
    measureGrid: [],
    measureGridDiagnostics: [],
    pageEntry: {
      page: 1,
      systems: [
        {
          systemIndex: 0,
          confidence: 0.95,
          measures,
        },
      ],
    },
  })
}

function noteSignature(xml) {
  const timing = parseMusicXml(xml, 'scoregraph-promotion.musicxml')
  return timing.notes
    .filter((note) => !note.isRest)
    .map((note) => ({
      measureNumber: note.measureNumber,
      midi: note.midi,
      quarterTime: note.quarterTime,
      durationQuarters: note.durationQuarters,
    }))
}

describe('ScoreGraph clip promotion pipeline gate', () => {
  it('keeps default and explicit-off OMR output byte-identical', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    const baseOptions = {
      numPages: 1,
      preprocessPages: false,
      renderPage: renderPagesFromArray([page]),
      analyzePage: scoreGraphPromotionAnalyzePage(),
      title: 'scoregraph-gate',
    }

    const baseline = await runPdfOmrPipeline('synthetic', baseOptions)
    const explicitOff = await runPdfOmrPipeline('synthetic', {
      ...baseOptions,
      promoteScoreGraphClips: false,
    })

    expect(explicitOff.musicXml).toBe(baseline.musicXml)
    expect(explicitOff.diagnostics).not.toHaveProperty('scoreGraphClipPromotion')
  })

  it('promotes only eligible durations when enabled and preserves note/measure/onset invariants', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    const baseOptions = {
      numPages: 1,
      preprocessPages: false,
      renderPage: renderPagesFromArray([page]),
      analyzePage: scoreGraphPromotionAnalyzePage(),
      title: 'scoregraph-promoted',
    }

    const baseline = await runPdfOmrPipeline('synthetic', baseOptions)
    const promoted = await runPdfOmrPipeline('synthetic', {
      ...baseOptions,
      promoteScoreGraphClips: true,
    })

    expect(promoted.diagnostics.scoreGraphClipPromotion).toMatchObject({
      enabled: true,
      promotedToRuntime: true,
      promotedMeasureCount: 1,
      promotedDecisions: 1,
      promotedMeasureNumbers: [1],
    })
    expect(promoted.noteCount).toBe(baseline.noteCount)
    expect(promoted.measureCount).toBe(baseline.measureCount)

    const before = noteSignature(baseline.musicXml)
    const after = noteSignature(promoted.musicXml)
    expect(after.map(({ measureNumber, midi, quarterTime }) => ({ measureNumber, midi, quarterTime }))).toEqual(
      before.map(({ measureNumber, midi, quarterTime }) => ({ measureNumber, midi, quarterTime })),
    )
    expect(before.map((note) => note.durationQuarters)).toEqual([2, 1, 1, 1])
    expect(after.map((note) => note.durationQuarters)).toEqual([1, 1, 1, 1])
  })

  it('leaves no-violation scores unchanged even when promotion diagnostics are enabled', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    const cleanMeasures = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        confidence: 0.95,
        events: [
          { type: 'note', startDivision: 0, durationDivisions: 4, notes: [{ midi: 60, clef: 'treble' }] },
          { type: 'note', startDivision: 4, durationDivisions: 4, notes: [{ midi: 62, clef: 'treble' }] },
        ],
      },
    ]
    const baseOptions = {
      numPages: 1,
      preprocessPages: false,
      renderPage: renderPagesFromArray([page]),
      analyzePage: scoreGraphPromotionAnalyzePage(cleanMeasures),
      title: 'scoregraph-noop',
    }

    const baseline = await runPdfOmrPipeline('synthetic', baseOptions)
    const promoted = await runPdfOmrPipeline('synthetic', {
      ...baseOptions,
      promoteScoreGraphClips: true,
    })

    expect(promoted.musicXml).toBe(baseline.musicXml)
    expect(promoted.diagnostics.scoreGraphClipPromotion).toMatchObject({
      enabled: true,
      promotedToRuntime: false,
      promotedMeasureCount: 0,
      promotedDecisions: 0,
    })
  })
})
