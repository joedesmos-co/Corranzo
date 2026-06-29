import { describe, expect, it } from 'vitest'
import { applyVectorPageTies, TIE_BEGIN_GLYPH, TIE_END_GLYPH } from '../src/features/omr/detectVectorTies.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { applyTieSustainToNotes } from '../src/features/musicxml/mergeTiedNotesForPlayback.js'

const measureBox = {
  measureNumber: 1,
  page: 1,
  x0: 0.1,
  playableX0: 0.2,
  x1: 0.8,
  y0: 0.08,
  y1: 0.42,
}

function blankImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
    data[index + 3] = 255
  }
  return { width, height, data }
}

function setInk(imageData, x, y) {
  const px = Math.round(x)
  const py = Math.round(y)
  const offset = (py * imageData.width + px) * 4
  imageData.data[offset] = 0
  imageData.data[offset + 1] = 0
  imageData.data[offset + 2] = 0
  imageData.data[offset + 3] = 255
}

function drawShortTieArc(imageData, fromX, fromY, toX) {
  for (let x = fromX + 4; x <= toX + 8; x += 1) {
    const arcY = fromY - 4 - Math.round(3 * Math.sin(((x - fromX) / Math.max(1, toX - fromX)) * Math.PI))
    setInk(imageData, x, arcY)
  }
}

describe('applyVectorPageTies', () => {
  it('ties adjacent same-pitch notes when a short ink arc is present', () => {
    const imageData = blankImage(1000, 1000)
    drawShortTieArc(imageData, 300, 350, 360)
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            cx: 300,
            notes: [{ midi: 74, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            cx: 360,
            notes: [{ midi: 74, clef: 'treble', cx: 360, cy: 350 }],
          },
        ],
      },
    ]

    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, measureBox]]),
      glyphs: [],
      imageData,
      inkThreshold: 170,
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(measureRecords[0].events[0].tieStart).toBe(true)
    expect(measureRecords[0].events[1].tieStop).toBe(true)
  })

  it('does not tie different pitches even when ink is present', () => {
    const imageData = blankImage(1000, 1000)
    drawShortTieArc(imageData, 300, 350, 360)
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            cx: 300,
            notes: [{ midi: 74, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            cx: 360,
            notes: [{ midi: 76, clef: 'treble', cx: 360, cy: 350 }],
          },
        ],
      },
    ]

    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, measureBox]]),
      glyphs: [],
      imageData,
      inkThreshold: 170,
    })

    expect(result.diagnostics.appliedTieCount).toBe(0)
    expect(result.diagnostics.uncertainSlurCount).toBeGreaterThan(0)
  })

  it('ignores long same-measure spans that look like closing pickups', () => {
    const imageData = blankImage(1000, 1000)
    drawShortTieArc(imageData, 250, 350, 620)
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 8,
            cx: 250,
            notes: [{ midi: 74, clef: 'treble', cx: 250, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 8,
            durationDivisions: 4,
            cx: 620,
            notes: [{ midi: 74, clef: 'treble', cx: 620, cy: 350 }],
          },
        ],
      },
    ]

    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, measureBox]]),
      glyphs: [],
      imageData,
      inkThreshold: 170,
    })

    expect(result.diagnostics.appliedTieCount).toBe(0)
  })

  it('pairs SMuFL tie control glyphs to nearest same-pitch notes', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            cx: 300,
            notes: [{ midi: 72, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            cx: 360,
            notes: [{ midi: 72, clef: 'treble', cx: 360, cy: 350 }],
          },
        ],
      },
    ]

    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, measureBox]]),
      glyphs: [
        { text: TIE_BEGIN_GLYPH, x: 285, y: 350 },
        { text: TIE_END_GLYPH, x: 345, y: 350 },
      ],
      imageData: blankImage(1000, 1000),
      inkThreshold: 170,
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(result.diagnostics.tieControlGlyphCount).toBe(2)
  })
})

describe('tie playback sustain', () => {
  it('merges tied notes into one sustained attack in generated MusicXML playback', () => {
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
              tieStart: true,
              notes: [{ midi: 72 }],
            },
            {
              type: 'note',
              startDivision: 4,
              durationDivisions: 4,
              durationType: 'quarter',
              tieStop: true,
              notes: [{ midi: 72 }],
            },
          ],
        },
      ],
    })

    expect(xml).toContain('<tie type="start"/>')
    expect(xml).toContain('<tied type="stop"/>')

    const timing = parseMusicXml(xml, 'tied.omr.musicxml')
    const attacks = buildScoreNoteSchedule(timing)
    expect(attacks).toHaveLength(1)
    expect(attacks[0].baseDurationSeconds).toBeCloseTo(1, 5)
  })

  it('keeps separate attacks for slur-like different pitches', () => {
    const notes = [
      {
        partId: 'P1',
        voice: 1,
        midi: 72,
        quarterTime: 0,
        durationQuarters: 1,
        durationDivisions: 1,
        tieStart: true,
        tieStop: false,
        isRest: false,
      },
      {
        partId: 'P1',
        voice: 1,
        midi: 74,
        quarterTime: 1,
        durationQuarters: 1,
        durationDivisions: 1,
        tieStart: false,
        tieStop: true,
        isRest: false,
      },
    ]
    applyTieSustainToNotes(notes)
    expect(notes[0].suppressPlaybackAttack).toBeFalsy()
    expect(notes[1].suppressPlaybackAttack).toBeFalsy()
  })
})
