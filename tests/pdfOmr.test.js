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
