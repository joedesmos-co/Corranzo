import { describe, expect, it } from 'vitest'
import {
  buildVectorEvents,
  extendCombinedGrandStaffOpening,
  extendPenultimateHalfBeforeFinalQuarter,
} from '../src/features/omr/processVectorOmrPage.js'
import { applyVectorPageTies } from '../src/features/omr/detectVectorTies.js'
import { enrichNoteheadRhythm } from '../src/features/omr/detectNoteRhythmFeatures.js'

const measureBox = { measureNumber: 1, page: 1 }
const TOTAL_DIVISIONS = 16

function noteEvent(startDivision, notes, durationDivisions = 4) {
  return {
    type: 'note',
    startDivision,
    durationDivisions,
    durationType: 'quarter',
    dotted: false,
    notes,
  }
}

function bass(midi, overrides = {}) {
  return { midi, clef: 'bass', ...overrides }
}

function treble(midi, overrides = {}) {
  return { midi, clef: 'treble', ...overrides }
}

describe('grand-staff same-beat integrity (Twinkle-class scores)', () => {
  it('one treble + one bass note on the same beat stay exactly two notes', () => {
    const notes = []
    for (let beat = 0; beat < 4; beat += 1) {
      const x = 20 + beat * 30
      notes.push({ cx: x, midi: 60, naturalMidi: 60, clef: 'treble', positionInMeasure: beat / 4 })
      notes.push({ cx: x, midi: 52, naturalMidi: 52, clef: 'bass', positionInMeasure: beat / 4 })
    }
    const events = buildVectorEvents(notes, measureBox, { beats: 4, beatType: 4 })
    const emitted = events.filter((event) => event.type === 'note')
    const totalNotes = emitted.reduce((sum, event) => sum + event.notes.length, 0)
    expect(totalNotes).toBe(8)
    const beatZero = emitted.filter((event) => event.startDivision === 0)
    expect(beatZero.reduce((sum, event) => sum + event.notes.length, 0)).toBe(2)
  })
})

describe('extendCombinedGrandStaffOpening caps', () => {
  it('does not stretch a proven-black opening bass over a same-pitch re-attack', () => {
    const events = [
      noteEvent(0, [bass(52, { hollowGlyph: false })]),
      noteEvent(0, [treble(60)]),
      noteEvent(4, [bass(52, { hollowGlyph: false })]),
      noteEvent(4, [treble(60)]),
    ]
    const result = extendCombinedGrandStaffOpening(events, TOTAL_DIVISIONS)
    expect(result[0].durationDivisions).toBe(4)
  })

  it('does not stretch a proven-black opening bass over a walking bass line', () => {
    const events = [
      noteEvent(0, [bass(53, { hollowGlyph: false })]),
      noteEvent(0, [treble(69)]),
      noteEvent(2, [bass(55)]),
      noteEvent(4, [bass(57)]),
    ]
    const result = extendCombinedGrandStaffOpening(events, TOTAL_DIVISIONS)
    expect(result[0].durationDivisions).toBe(4)
  })

  it('keeps the baseline stretch when glyph evidence is absent (raster path)', () => {
    const events = [
      noteEvent(0, [bass(43)]),
      noteEvent(0, [treble(60)]),
      noteEvent(4, [bass(50)]),
    ]
    const result = extendCombinedGrandStaffOpening(events, TOTAL_DIVISIONS)
    expect(result[0].durationDivisions).toBe(12)
  })

  it('keeps the glyph-backed sustained opening bass (Gymnopédie shape)', () => {
    const events = [
      noteEvent(0, [bass(43, { hollow: true, durationDivisions: 8 })], 4),
      noteEvent(4, [bass(66), bass(62), bass(59)], 8),
    ]
    const result = extendCombinedGrandStaffOpening(events, 12)
    expect(result[0].durationDivisions).toBe(12)
  })
})

describe('extendPenultimateHalfBeforeFinalQuarter closing-peer guard', () => {
  it('leaves durations alone when both staves close together', () => {
    const events = [
      noteEvent(0, [bass(52)]),
      noteEvent(0, [treble(60)]),
      noteEvent(8, [bass(52)]),
      noteEvent(8, [treble(67)]),
      noteEvent(12, [bass(52)]),
      noteEvent(12, [treble(67)]),
    ]
    const result = extendPenultimateHalfBeforeFinalQuarter(
      events,
      { beats: 4, beatType: 4 },
      TOTAL_DIVISIONS,
    )
    expect(result.map((event) => event.durationDivisions)).toEqual([4, 4, 4, 4, 4, 4])
  })

  it('still applies to a genuinely lone closing note', () => {
    const events = [
      noteEvent(8, [bass(52)]),
      noteEvent(8, [treble(67)]),
      noteEvent(12, [treble(69)]),
    ]
    const result = extendPenultimateHalfBeforeFinalQuarter(
      events,
      { beats: 4, beatType: 4 },
      TOTAL_DIVISIONS,
    )
    const sharedBeat = result.filter((event) => event.startDivision === 8)
    expect(sharedBeat.some((event) => event.durationDivisions === 8)).toBe(true)
  })
})

describe('vector tie detection', () => {
  const WIDTH = 300
  const HEIGHT = 160

  function blankImage() {
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255)
    return { width: WIDTH, height: HEIGHT, data }
  }

  function ink(imageData, x, y) {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) {
      return
    }
    const offset = (py * imageData.width + px) * 4
    imageData.data[offset] = 0
    imageData.data[offset + 1] = 0
    imageData.data[offset + 2] = 0
  }

  function drawTieArc(imageData, fromX, toX, y) {
    // Shallow parabolic arc below the notehead row, like an engraved tie.
    for (let x = fromX; x <= toX; x += 1) {
      const t = (x - fromX) / Math.max(1, toX - fromX)
      const dy = 3 + Math.round(5 * (1 - (2 * t - 1) ** 2))
      ink(imageData, x, y + dy)
      ink(imageData, x, y + dy + 1)
    }
  }

  function drawStaffLine(imageData, y) {
    for (let x = 0; x < imageData.width; x += 1) {
      ink(imageData, x, y)
    }
  }

  function drawStem(imageData, x, y) {
    for (let dy = -30; dy <= 0; dy += 1) {
      ink(imageData, x, y + dy)
    }
  }

  function makeRecords(midiFrom, midiTo) {
    return [
      {
        measureNumber: 1,
        events: [
          noteEvent(0, [
            { ...treble(midiFrom), cx: 60, cy: 80, pitchMapping: {} },
          ]),
          noteEvent(4, [
            { ...treble(midiTo), cx: 145, cy: 80, pitchMapping: {} },
          ]),
        ],
      },
    ]
  }

  const boxes = new Map([
    [1, { measureNumber: 1, page: 1, x0: 0, x1: 1, y0: 0, y1: 1 }],
  ])

  it('applies a same-pitch tie when a real arc spans the gap', () => {
    const imageData = blankImage()
    drawStem(imageData, 65, 80)
    drawStem(imageData, 150, 80)
    drawTieArc(imageData, 68, 137, 80)
    const records = makeRecords(67, 67)
    const { diagnostics } = applyVectorPageTies({
      measureRecords: records,
      measureBoxByNumber: boxes,
      glyphs: [],
      imageData,
    })
    expect(diagnostics.appliedTieCount).toBe(1)
    expect(records[0].events[0].tieStart).toBe(true)
    expect(records[0].events[1].tieStop).toBe(true)
  })

  it('ignores stems, staff lines, and stray marks between repeated notes', () => {
    const imageData = blankImage()
    drawStem(imageData, 65, 80)
    drawStem(imageData, 150, 80)
    drawStaffLine(imageData, 80)
    drawStaffLine(imageData, 88)
    // A fingering-digit-sized blob mid-window must not read as an arc.
    for (let x = 108; x <= 114; x += 1) {
      for (let y = 84; y <= 90; y += 1) {
        ink(imageData, x, y)
      }
    }
    const records = makeRecords(67, 67)
    const { diagnostics } = applyVectorPageTies({
      measureRecords: records,
      measureBoxByNumber: boxes,
      glyphs: [],
      imageData,
    })
    expect(diagnostics.appliedTieCount).toBe(0)
    expect(records[0].events[0].tieStart).toBeUndefined()
  })

  it('never ties different pitches, even under a slur-like arc', () => {
    const imageData = blankImage()
    drawTieArc(imageData, 68, 137, 80)
    const records = makeRecords(67, 65)
    const { diagnostics } = applyVectorPageTies({
      measureRecords: records,
      measureBoxByNumber: boxes,
      glyphs: [],
      imageData,
    })
    expect(diagnostics.appliedTieCount).toBe(0)
    expect(records[0].events[0].tieStart).toBeUndefined()
    expect(records[0].events[1].tieStop).toBeUndefined()
  })
})

describe('glyph-derived hollowness', () => {
  const image = {
    width: 60,
    height: 60,
    data: new Uint8ClampedArray(60 * 60 * 4).fill(255),
  }
  const box = { measureNumber: 1, page: 1, y0: 0, y1: 1 }
  const bounds = { left: 0, right: 59, top: 0, bottom: 59 }

  it('prefers the vector glyph over ink probing', () => {
    const hollowNote = enrichNoteheadRhythm(
      image,
      { cx: 30, cy: 30, hollowGlyph: true },
      box,
      170,
      bounds,
    )
    expect(hollowNote.hollow).toBe(true)
    expect(hollowNote.durationType).toBe('whole')

    const blackNote = enrichNoteheadRhythm(
      image,
      { cx: 30, cy: 30, hollowGlyph: false },
      box,
      170,
      bounds,
    )
    expect(blackNote.hollow).toBe(false)
    expect(blackNote.durationType).toBe('quarter')
  })
})
