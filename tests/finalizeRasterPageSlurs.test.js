import { describe, expect, it } from 'vitest'
import {
  finalizeRasterPageSlurs,
  probeRasterSlurWindow,
} from '../src/features/omr/finalizeRasterPageSlurs.js'
import { finalizeRasterPageTies } from '../src/features/omr/finalizeRasterPageTies.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { applyTieSustainToNotes } from '../src/features/musicxml/mergeTiedNotesForPlayback.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'

function blankImage(width = 1000, height = 400) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(255),
  }
}

function setInk(imageData, x, y) {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) return
  const i = (py * imageData.width + px) * 4
  imageData.data[i] = 0
  imageData.data[i + 1] = 0
  imageData.data[i + 2] = 0
  imageData.data[i + 3] = 255
}

function drawSlurArc(imageData, fromX, fromY, toX, side = 'above', bow = 16) {
  for (let x = fromX + 4; x <= toX - 4; x += 1) {
    const t = (x - fromX) / Math.max(1, toX - fromX)
    const arc =
      side === 'below'
        ? fromY + 4 + Math.round(bow * Math.sin(t * Math.PI))
        : fromY - 4 - Math.round(bow * Math.sin(t * Math.PI))
    setInk(imageData, x, arc)
    setInk(imageData, x, arc + (side === 'below' ? 1 : -1))
    setInk(imageData, x, arc + (side === 'below' ? 2 : -2))
  }
}

function measureBox(measureNumber, x0, x1) {
  return {
    measureNumber,
    x0,
    x1,
    playableX0: x0,
    y0: 0.1,
    y1: 0.45,
    staffLines: { treble: [0.2, 0.23, 0.26, 0.29, 0.32] },
  }
}

function monoEvent(midi, cx, cy, startDivision = 0) {
  return {
    type: 'note',
    startDivision,
    durationDivisions: 4,
    durationType: 'quarter',
    cx,
    notes: [{ midi, clef: 'treble', cx, cy }],
  }
}

describe('finalizeRasterPageSlurs', () => {
  it('emits a different-pitch slur within one measure above the staff', () => {
    const imageData = blankImage()
    drawSlurArc(imageData, 200, 200, 320, 'above', 14)
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [monoEvent(65, 200, 200, 0), monoEvent(67, 320, 195, 8)],
      },
    ]
    const boxes = new Map([[1, measureBox(1, 0.15, 0.4)]])
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: boxes,
      imageData,
      inkThreshold: 170,
    })
    expect(diagnostics.appliedSlurCount).toBe(1)
    expect(records[0].events[0].notes[0].slurStart).toBe(true)
    expect(records[0].events[1].notes[0].slurStop).toBe(true)
    expect(records[0].events[0].notes[0].tieStart).toBeUndefined()
  })

  it('emits a different-pitch slur below the staff', () => {
    const imageData = blankImage()
    drawSlurArc(imageData, 200, 200, 340, 'below', 15)
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [monoEvent(69, 200, 200, 0), monoEvent(71, 340, 205, 8)],
      },
    ]
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.45)]]),
      imageData,
      inkThreshold: 170,
    })
    expect(diagnostics.appliedSlurCount).toBe(1)
    expect(records[0].events[0].notes[0].slurPlacement).toBe('below')
  })

  it('emits a different-pitch slur across a barline', () => {
    const imageData = blankImage(1000, 400)
    drawSlurArc(imageData, 200, 200, 410, 'above', 18)
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [monoEvent(65, 200, 200, 12)],
      },
      {
        measureNumber: 2,
        systemIndex: 0,
        events: [monoEvent(67, 410, 195, 12)],
      },
    ]
    const boxes = new Map([
      [1, measureBox(1, 0.15, 0.3)],
      [2, measureBox(2, 0.3, 0.5)],
    ])
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: boxes,
      imageData,
      inkThreshold: 170,
    })
    expect(diagnostics.appliedSlurCount).toBe(1)
    expect(records[0].events[0].notes[0].slurStart).toBe(true)
    expect(records[1].events[0].notes[0].slurStop).toBe(true)
  })

  it('does not duplicate a slur onto every chord tone', () => {
    const imageData = blankImage()
    drawSlurArc(imageData, 200, 200, 360, 'above', 14)
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            cx: 200,
            notes: [
              { midi: 64, clef: 'treble', cx: 200, cy: 210 },
              { midi: 67, clef: 'treble', cx: 200, cy: 190 },
            ],
          },
          monoEvent(69, 360, 200, 8),
        ],
      },
    ]
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.45)]]),
      imageData,
      inkThreshold: 170,
    })
    // Chord start is not monophonic — slur emitter skips chord endpoints.
    expect(diagnostics.appliedSlurCount).toBe(0)
  })

  it('never emits a tie for a different-pitch curve', () => {
    const imageData = blankImage()
    drawSlurArc(imageData, 200, 200, 360, 'above', 14)
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            notes: [{ midi: 69, clef: 'treble', cx: 200, cy: 200, tieStart: true }],
          },
          monoEvent(70, 360, 198, 8),
        ],
      },
    ]
    finalizeRasterPageTies(records)
    finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.45)]]),
      imageData,
      inkThreshold: 170,
    })
    expect(records[0].events[0].notes[0].tieStart).toBeUndefined()
    expect(records[0].events[1].notes[0].tieStop).toBeUndefined()
    expect(records[0].events[0].notes[0].slurStart).toBe(true)
    expect(records[0].events[1].notes[0].slurStop).toBe(true)
  })

  it('keeps same-pitch ties as ties when enrich evidence exists', () => {
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            notes: [{ midi: 69, clef: 'treble', cx: 100, cy: 200, tieStart: true }],
          },
          {
            type: 'note',
            startDivision: 4,
            notes: [{ midi: 69, clef: 'treble', cx: 160, cy: 200 }],
          },
        ],
      },
    ]
    finalizeRasterPageTies(records)
    expect(records[0].events[0].notes[0].tieStart).toBe(true)
    expect(records[0].events[1].notes[0].tieStop).toBe(true)
  })

  it('rejects a flat beam-like band as a slur', () => {
    const imageData = blankImage()
    for (let x = 210; x <= 350; x += 1) {
      setInk(imageData, x, 180)
      setInk(imageData, x, 181)
      setInk(imageData, x, 182)
    }
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [monoEvent(65, 200, 200, 0), monoEvent(67, 360, 200, 8)],
      },
    ]
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.45)]]),
      imageData,
      inkThreshold: 170,
    })
    expect(diagnostics.appliedSlurCount).toBe(0)
  })

  it('rejects a stem hairline as a slur', () => {
    const imageData = blankImage()
    for (let y = 120; y <= 260; y += 1) setInk(imageData, 280, y)
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [monoEvent(65, 200, 200, 0), monoEvent(67, 360, 200, 8)],
      },
    ]
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.45)]]),
      imageData,
      inkThreshold: 170,
    })
    expect(diagnostics.appliedSlurCount).toBe(0)
  })

  it('rejects an accent-like compact wedge as a slur', () => {
    const imageData = blankImage()
    for (let x = 270; x <= 290; x += 1) {
      setInk(imageData, x, 170)
      setInk(imageData, 270, 170 + (x - 270))
      setInk(imageData, 290, 170 + (290 - x))
    }
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [monoEvent(65, 200, 200, 0), monoEvent(67, 360, 200, 8)],
      },
    ]
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.45)]]),
      imageData,
      inkThreshold: 170,
    })
    expect(diagnostics.appliedSlurCount).toBe(0)
  })

  it('abstains when endpoint ownership is ambiguous between two equal stops', () => {
    const imageData = blankImage(1200, 400)
    // Arc that equally covers two close destinations — greedy still picks one,
    // but weak stop support on a far incomplete crop should abstain.
    for (let x = 250; x <= 320; x += 1) {
      const t = (x - 250) / 70
      setInk(imageData, x, 180 - Math.round(8 * Math.sin(t * Math.PI)))
    }
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        events: [monoEvent(65, 200, 200, 0), monoEvent(67, 400, 200, 8)],
      },
    ]
    const { diagnostics } = finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.5)]]),
      imageData,
      inkThreshold: 170,
    })
    expect(diagnostics.appliedSlurCount).toBe(0)
  })

  it('emits balanced MusicXML slur start/stop that survives reload', () => {
    const imageData = blankImage()
    drawSlurArc(imageData, 200, 200, 340, 'above', 14)
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        uncertain: false,
        events: [monoEvent(65, 200, 200, 0), monoEvent(67, 340, 198, 8)],
        confidence: 1,
      },
    ]
    finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.45)]]),
      imageData,
      inkThreshold: 170,
    })
    const xml = buildOmrMusicXml({
      measures: records,
      title: 'slur-test',
    })
    expect(xml).toMatch(/slur type="start"/)
    expect(xml).toMatch(/slur type="stop"/)
    expect(xml).not.toMatch(/<tie /)
    const parsed = parseMusicXml(xml)
    const starts = parsed.notes.filter((n) => (n.slurs ?? []).some((s) => s.type === 'start'))
    const stops = parsed.notes.filter((n) => (n.slurs ?? []).some((s) => s.type === 'stop'))
    expect(starts.length).toBe(1)
    expect(stops.length).toBe(1)
  })

  it('does not suppress playback reattack for slurred different pitches', () => {
    const imageData = blankImage()
    drawSlurArc(imageData, 200, 200, 340, 'above', 14)
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        uncertain: false,
        events: [monoEvent(65, 200, 200, 0), monoEvent(67, 340, 198, 8)],
        confidence: 1,
      },
    ]
    finalizeRasterPageSlurs({
      measureRecords: records,
      measureBoxByNumber: new Map([[1, measureBox(1, 0.15, 0.45)]]),
      imageData,
      inkThreshold: 170,
    })
    const xml = buildOmrMusicXml({
      measures: records,
      title: 'slur-playback',
    })
    const parsed = parseMusicXml(xml)
    applyTieSustainToNotes(parsed.notes)
    expect(parsed.notes.filter((n) => n.suppressPlaybackAttack).length).toBe(0)
    const schedule = buildScoreNoteSchedule(parsed)
    expect(schedule.length).toBeGreaterThanOrEqual(2)
  })

  it('still suppresses continuation reattack for true ties', () => {
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        uncertain: false,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            durationType: 'quarter',
            notes: [{ midi: 69, clef: 'treble', cx: 100, cy: 200, tieStart: true }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            durationType: 'quarter',
            notes: [{ midi: 69, clef: 'treble', cx: 160, cy: 200, tieStop: true }],
          },
        ],
        confidence: 1,
      },
    ]
    finalizeRasterPageTies(records)
    const xml = buildOmrMusicXml({
      measures: records,
      title: 'tie-playback',
    })
    const parsed = parseMusicXml(xml)
    applyTieSustainToNotes(parsed.notes)
    expect(parsed.notes.some((n) => n.suppressPlaybackAttack)).toBe(true)
    const schedule = buildScoreNoteSchedule(parsed)
    expect(schedule.length).toBe(1)
  })

  it('rejects incomplete crop-edge fragments without both endpoints', () => {
    const imageData = blankImage()
    // Arc only near the left head — no continuity to the right destination.
    for (let x = 208; x <= 240; x += 1) {
      setInk(imageData, x, 175)
      setInk(imageData, x, 174)
    }
    const probe = probeRasterSlurWindow(
      imageData,
      { cx: 200, cy: 200, clef: 'treble' },
      { cx: 360, cy: 200, clef: 'treble' },
      208,
      352,
      measureBox(1, 0.15, 0.45),
      170,
    )
    expect(probe.passes).toBe(false)
  })
})
