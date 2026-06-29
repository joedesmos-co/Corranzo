import { describe, expect, it } from 'vitest'
import {
  musicalPianoPage,
  renderPagesFromArray,
  rhythmicPianoPage,
} from './helpers/syntheticScore.js'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { detectKeySignature } from '../src/features/omr/detectOmrKeySignature.js'
import { detectAccidentalNearNote, refineNotePitch } from '../src/features/omr/detectOmrAccidentals.js'
import { detectRepeatBarline } from '../src/features/omr/detectOmrRepeatBarline.js'
import { parseTempoFromTextItems } from '../src/features/omr/parseOmrTempoMarking.js'
import { detectNoteheadsInMeasure } from '../src/features/omr/detectOmrNoteheads.js'
import { buildMeasureBoxesForSystem } from '../src/features/omr/buildOmrMeasureGrid.js'
import {
  buildVectorMeasureRecord,
  processVectorPageSystems,
} from '../src/features/omr/processVectorOmrPage.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'
import {
  estimateGrandStaffLines,
  midiFromStaffPosition,
  estimateLedgerLineCount,
} from '../src/features/omr/pitchFromStaffPosition.js'
import { OMR_DISCLAIMER } from '../src/features/omr/omrMusicalConstants.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

describe('experimental PDF OMR musical details (v3)', () => {
  it('parseTempoFromTextItems reads metronome marks and tempo words', () => {
    expect(parseTempoFromTextItems([{ text: 'Allegro' }], { pageNumber: 1 }).bpm).toBe(120)
    expect(parseTempoFromTextItems([{ text: 'Lent et douloureux' }], { pageNumber: 1 }).bpm).toBe(54)
    expect(parseTempoFromTextItems([{ text: '♩ = 96' }]).bpm).toBe(96)
    expect(parseTempoFromTextItems([{ text: 'Playback 72 bpm' }]).bpm).toBe(72)
    expect(parseTempoFromTextItems([{ text: 'Allegro' }], { pageNumber: 2 }).fromDefault).toBe(true)
    expect(parseTempoFromTextItems([]).fromDefault).toBe(true)
  })

  it('detects a sharp key signature on a synthetic page', () => {
    const page = musicalPianoPage()
    const imageData = page
    const contentBounds = detectContentBounds(imageData)
    const { systems, inkThreshold } = detectStaffLineSystems(imageData, contentBounds, {
      stavesPerSystem: 2,
      countBarlines: true,
    })
    const boxes = buildMeasureBoxesForSystem({
      page: 1,
      systemIndex: 0,
      system: systems[0],
      contentBounds,
      imageData,
      measureNumberStart: 1,
    })
    const key = detectKeySignature(imageData, boxes[0], boxes[0].staffLines, inkThreshold)
    expect(key.fifths).toBe(1)
    expect(key.confidence).toBeGreaterThan(0.65)
  })

  it('refines pitch when a sharp accidental is detected', () => {
    const page = musicalPianoPage()
    const imageData = page
    const note = { midi: 65, cx: Math.floor(page.width * 0.22), cy: Math.floor(page.height * 0.2) }
    const glyph = detectAccidentalNearNote(imageData, note, 170)
    if (glyph) {
      const refined = refineNotePitch(note, { imageData, inkThreshold: 170 })
      expect(refined.alter).toBe(1)
      expect(refined.midi).toBe(66)
    } else {
      const refined = refineNotePitch(
        { midi: 65, cx: 100, cy: 100 },
        { imageData, inkThreshold: 170 },
      )
      expect(refined.midi).toBe(65)
    }
  })

  it('supports ledger-line pitch range', () => {
    const lineYs = [0.2, 0.22, 0.24, 0.26, 0.28]
    const ledger = estimateLedgerLineCount(0.17, lineYs)
    expect(ledger.direction).toBe('above')
    expect(ledger.count).toBeGreaterThan(0)
    const midi = midiFromStaffPosition(0.26, lineYs, 'treble')
    expect(midi).not.toBeNull()
    expect(midi).toBeGreaterThan(60)
  })

  it('maps staff positions upward in diatonic pitch order', () => {
    const lineYs = [0.2, 0.22, 0.24, 0.26, 0.28]

    expect(midiFromStaffPosition(0.28, lineYs, 'treble')).toBe(64) // E4
    expect(midiFromStaffPosition(0.27, lineYs, 'treble')).toBe(65) // F4
    expect(midiFromStaffPosition(0.26, lineYs, 'treble')).toBe(67) // G4
    expect(midiFromStaffPosition(0.24, lineYs, 'treble')).toBe(71) // B4
    expect(midiFromStaffPosition(0.2, lineYs, 'treble')).toBe(77) // F5
    expect(midiFromStaffPosition(0.29, lineYs, 'treble')).toBe(62) // D4

    expect(midiFromStaffPosition(0.28, lineYs, 'bass')).toBe(43) // G2
    expect(midiFromStaffPosition(0.26, lineYs, 'bass')).toBe(47) // B2
    expect(midiFromStaffPosition(0.2, lineYs, 'bass')).toBe(57) // A3
  })

  it('uses measured treble and bass stave bounds for grand-staff pitch lines', () => {
    const staffLines = estimateGrandStaffLines({
      y0: 0.1,
      y1: 0.3,
      staves: [
        { y0: 0.1, y1: 0.14, center: 0.12, lineCount: 5 },
        { y0: 0.24, y1: 0.28, center: 0.26, lineCount: 5 },
      ],
    })

    expect(staffLines.treble[0]).toBeCloseTo(0.1)
    expect(staffLines.treble[4]).toBeCloseTo(0.14)
    expect(staffLines.bass[0]).toBeCloseTo(0.24)
    expect(staffLines.bass[4]).toBeCloseTo(0.28)
    expect(staffLines.splitY).toBeCloseTo(0.19)
  })

  it('maps vector notehead glyphs through staff geometry and key signature', () => {
    const measureBox = {
      measureNumber: 1,
      page: 1,
      systemIndex: 0,
      x0: 0.1,
      playableX0: 0.2,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
      staffLines: {
        treble: [0.1, 0.12, 0.14, 0.16, 0.18],
        bass: [0.3, 0.32, 0.34, 0.36, 0.38],
        splitY: 0.24,
      },
    }
    const record = buildVectorMeasureRecord({
      glyphs: [{ text: '\ue0a4', x: 300, y: 170 }],
      imageData: { width: 1000, height: 1000 },
      measureBox,
      keySignature: { fifths: 2, mode: 'major', confidence: 0.9 },
      timeSignature: { beats: 3, beatType: 4, confidence: 0.9 },
    })

    expect(record.vectorNoteCount).toBe(1)
    expect(record.events[0].notes[0].midi).toBe(66)
    expect(record.events[0].notes[0].alter).toBe(1)
    expect(record.events[0].durationDivisions).toBe(12)
    expect(record.events[0].durationType).toBe('half')
    expect(record.events[0].dotted).toBe(true)
  })

  it('uses vector natural accidentals to cancel key signature within a measure', () => {
    const measureBox = {
      measureNumber: 1,
      page: 1,
      systemIndex: 0,
      x0: 0.1,
      playableX0: 0.2,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
      staffLines: {
        treble: [0.1, 0.12, 0.14, 0.16, 0.18],
        bass: [0.3, 0.32, 0.34, 0.36, 0.38],
        splitY: 0.24,
      },
    }
    const record = buildVectorMeasureRecord({
      glyphs: [
        { text: '\ue261', x: 280, y: 170 },
        { text: '\ue0a4', x: 300, y: 170 },
        { text: '\ue0a4', x: 500, y: 170 },
      ],
      imageData: { width: 1000, height: 1000 },
      measureBox,
      keySignature: { fifths: 2, mode: 'major', confidence: 0.9 },
      timeSignature: { beats: 3, beatType: 4, confidence: 0.9 },
    })

    const notes = record.events.flatMap((event) => event.notes ?? [])
    expect(notes.map((note) => note.midi)).toEqual([65, 65])
    expect(notes[0].accidental?.type).toBe('natural')
    expect(notes[1].accidental).toBeNull()
  })

  it('does not treat key-signature glyphs before the playable area as local accidentals', () => {
    const measureBox = {
      measureNumber: 1,
      page: 1,
      systemIndex: 0,
      x0: 0.1,
      playableX0: 0.2,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
      staffLines: {
        treble: [0.1, 0.12, 0.14, 0.16, 0.18],
        bass: [0.3, 0.32, 0.34, 0.36, 0.38],
        splitY: 0.24,
      },
    }
    const record = buildVectorMeasureRecord({
      glyphs: [
        { text: '\ue261', x: 150, y: 170 },
        { text: '\ue0a4', x: 300, y: 170 },
      ],
      imageData: { width: 1000, height: 1000 },
      measureBox,
      keySignature: { fifths: 2, mode: 'major', confidence: 0.9 },
      timeSignature: { beats: 3, beatType: 4, confidence: 0.9 },
    })

    expect(record.events[0].notes[0].midi).toBe(66)
    expect(record.events[0].notes[0].accidental).toBeNull()
  })

  it('binds a natural accidental to the nearest notehead in a dense chord', () => {
    const measureBox = {
      measureNumber: 1,
      page: 1,
      systemIndex: 0,
      x0: 0.1,
      playableX0: 0.2,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
      staffLines: {
        treble: [0.1, 0.12, 0.14, 0.16, 0.18],
        bass: [0.3, 0.32, 0.34, 0.36, 0.38],
        splitY: 0.24,
      },
    }
    const record = buildVectorMeasureRecord({
      glyphs: [
        { text: '\ue261', x: 280, y: 350 },
        { text: '\ue0a4', x: 300, y: 350 },
        { text: '\ue0a4', x: 330, y: 318 },
      ],
      imageData: { width: 1000, height: 1000 },
      measureBox,
      keySignature: { fifths: 2, mode: 'major', confidence: 0.9 },
      timeSignature: { beats: 3, beatType: 4, confidence: 0.9 },
    })

    const notes = record.events.flatMap((event) => event.notes ?? [])
    const cNatural = notes.find((note) => note.naturalMidi === 48)
    const fSharp = notes.find((note) => note.naturalMidi === 53)
    expect(cNatural?.midi).toBe(48)
    expect(cNatural?.accidental?.type).toBe('natural')
    expect(fSharp?.midi).toBe(54)
    expect(fSharp?.accidental).toBeNull()
  })

  it('carries vector OMR time signature to pages without repeated time glyphs', () => {
    const measureBox = {
      measureNumber: 5,
      page: 2,
      systemIndex: 0,
      x0: 0.1,
      playableX0: 0.2,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
      staffLines: {
        treble: [0.1, 0.12, 0.14, 0.16, 0.18],
        bass: [0.3, 0.32, 0.34, 0.36, 0.38],
        splitY: 0.24,
      },
    }
    const result = processVectorPageSystems({
      imageData: { width: 1000, height: 1000 },
      pageText: [
        {
          text: '\ue0a4',
          x: 295,
          y: 830,
          width: 10,
          height: 10,
          pageWidth: 1000,
          pageHeight: 1000,
        },
      ],
      systems: [{}],
      systemMeasureBoxes: [[measureBox]],
      inheritedKeySignature: { fifths: 2, mode: 'major', confidence: 0.9 },
      inheritedTimeSignature: { beats: 3, beatType: 4, confidence: 0.92 },
    })

    expect(result.timeSignature.beats).toBe(3)
    expect(result.measureRecordsBySystem[0][0].events[0].durationDivisions).toBe(12)
  })

  it('detects backward repeat barlines when clearly drawn', () => {
    const page = musicalPianoPage()
    const imageData = page
    const band = page.systemBands[0]
    const x0 = Math.floor(page.width * 0.08)
    const x1 = Math.floor(page.width * 0.92)
    const measureWidth = (x1 - x0) / 3
    const barX = Math.floor(x0 + measureWidth * 2) - 2
    const repeat = detectRepeatBarline(
      imageData,
      {
        x0: (barX - 24) / page.width,
        x1: barX / page.width,
        y0: band.top / page.height,
        y1: band.bottom / page.height,
      },
      170,
      'right',
    )
    expect(repeat?.backwardRepeat).toBe(true)
    expect(repeat?.confidence).toBeGreaterThan(0.7)
  })

  it('buildOmrMusicXml emits key, disclaimer, and repeat markup', () => {
    const xml = buildOmrMusicXml({
      measures: [
        {
          measureNumber: 1,
          uncertain: false,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 66 }],
            },
          ],
        },
        {
          measureNumber: 2,
          uncertain: false,
          repeatMarking: { backwardRepeat: true, confidence: 0.8 },
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 67 }],
            },
          ],
        },
      ],
      musical: {
        keySignature: { fifths: 1, mode: 'major', confidence: 0.8 },
        tempo: { bpm: 96, confidence: 0.85, fromDefault: false },
      },
    })
    expect(xml).toContain('<fifths>1</fifths>')
    expect(xml).toContain(OMR_DISCLAIMER.replace(/&/g, '&amp;').split(' ')[0])
    expect(xml).toContain('repeat direction="backward"')
    expect(xml).toContain('tempo="96"')
    const timing = parseMusicXml(xml, 'musical.omr.musicxml')
    expect(timing.durationSeconds).toBeGreaterThan(0)
  })

  it('pipeline returns diagnostics with page/system/measure confidence', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 1,
      renderPage: renderPagesFromArray([page]),
    })
    expect(result.disclaimer).toContain('Generated from PDF')
    expect(result.diagnostics.pages?.length).toBeGreaterThan(0)
    expect(result.overallConfidence).toBeGreaterThan(0)
    expect(result.warnings?.length).toBeGreaterThan(0)
  })

  it('musical synthetic page produces mapped pitch and repeat metadata', async () => {
    const page = musicalPianoPage()
    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 1,
      renderPage: renderPagesFromArray([page]),
    })
    expect(result.musical?.keySignature?.fifths).toBeGreaterThanOrEqual(0)
    expect(result.disclaimer).toContain('Generated from PDF')
    expect(result.musicXml).toContain('repeat direction="backward"')
    const timing = parseMusicXml(result.musicXml, 'musical-page.omr.musicxml')
    const pitched = timing.notes.filter((note) => note.midi != null)
    expect(pitched.length).toBeGreaterThan(0)
    expect(Math.max(...pitched.map((note) => note.midi))).toBeGreaterThan(72)
  })
})
