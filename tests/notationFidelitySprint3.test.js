import { describe, expect, it } from 'vitest'
import {
  applyDocumentVectorCurveContinuations,
  applyVectorPageTies,
} from '../src/features/omr/detectVectorTies.js'
import { extractPdfVectorCurvesFromOperatorList } from '../src/features/omr/extractPdfVectorCurves.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotationMarkings,
  buildStaffLaneNotes,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  constructPath: 91,
}

function blankImage(width = 1000, height = 1000) {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  return { width, height, data }
}

function pdfLens(x0, x1, y, archHeight = 10) {
  return new Float32Array([
    0, x0, y,
    2, x0 + (x1 - x0) * 0.25, y - archHeight,
    x0 + (x1 - x0) * 0.75, y - archHeight,
    x1, y,
    2, x0 + (x1 - x0) * 0.75, y - archHeight * 0.6,
    x0 + (x1 - x0) * 0.25, y - archHeight * 0.6,
    x0, y,
    3,
  ])
}

function vectorCurve(candidateId, start, end, archDirection = 'above') {
  return {
    candidateId,
    source: 'pdf-vector-path',
    page: 1,
    start: { ...start, tangent: { dx: 1, dy: 0 } },
    end: { ...end, tangent: { dx: 1, dy: 0 } },
    bounds: {
      x0: start.x,
      x1: end.x,
      y0: Math.min(start.y, end.y) - 8,
      y1: Math.max(start.y, end.y),
      width: end.x - start.x,
      height: 8,
    },
    archDirection,
  }
}

function noteEvent(startDivision, notes) {
  return {
    type: 'note',
    startDivision,
    durationDivisions: 4,
    durationType: 'quarter',
    notes,
  }
}

function box(measureNumber, systemIndex, x0, x1) {
  return {
    measureNumber,
    page: 1,
    systemIndex,
    x0,
    playableX0: x0,
    x1,
    staffLines: {
      treble: [0.31, 0.32, 0.33, 0.34, 0.35],
      bass: [0.5, 0.51, 0.52, 0.53, 0.54],
    },
  }
}

describe('Notation Fidelity Sprint 3 PDF path source', () => {
  it('extracts a closed cubic tie/slur lens in viewport coordinates', () => {
    const curves = extractPdfVectorCurvesFromOperatorList({
      operatorList: {
        fnArray: [OPS.save, OPS.transform, OPS.constructPath, OPS.restore],
        argsArray: [
          [],
          [1, 0, 0, 1, 20, 30],
          [OPS.eoFillStroke, [pdfLens(100, 160, 100)]],
          [],
        ],
      },
      ops: OPS,
      viewportTransform: [1, 0, 0, 1, 0, 0],
      pageNumber: 2,
      targetWidth: 1000,
    })

    expect(curves).toHaveLength(1)
    expect(curves[0].candidateId).toBe('pdf-path-p2-op2')
    expect(curves[0].start.x).toBeCloseTo(120)
    expect(curves[0].end.x).toBeCloseTo(180)
    expect(curves[0].sourcePriority).toBe(1)
  })

  it('retains short low-aspect continuation lenses but rejects non-cubic paths', () => {
    const curves = extractPdfVectorCurvesFromOperatorList({
      operatorList: {
        fnArray: [OPS.constructPath, OPS.constructPath],
        argsArray: [
          [OPS.eoFillStroke, [pdfLens(120, 144, 100, 9)]],
          [OPS.eoFillStroke, [new Float32Array([0, 10, 10, 1, 20, 10, 3])]],
        ],
      },
      ops: OPS,
      viewportTransform: [1, 0, 0, 1, 0, 0],
      targetWidth: 1000,
    })

    expect(curves).toHaveLength(1)
    expect(curves[0].bounds.width).toBeCloseTo(24)
  })

  it('attaches simultaneous vector ties per pitch instead of chord-wide', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [
          noteEvent(0, [
            { midi: 72, clef: 'treble', cx: 300, cy: 350 },
            { midi: 76, clef: 'treble', cx: 300, cy: 330 },
          ]),
        ],
      },
      {
        measureNumber: 2,
        page: 1,
        systemIndex: 0,
        events: [
          noteEvent(0, [
            { midi: 72, clef: 'treble', cx: 360, cy: 350 },
            { midi: 76, clef: 'treble', cx: 360, cy: 330 },
          ]),
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([
        [1, box(1, 0, 0.2, 0.34)],
        [2, box(2, 0, 0.34, 0.5)],
      ]),
      vectorCurves: [
        vectorCurve('partial-chord-tie', { x: 306, y: 342 }, { x: 354, y: 342 }),
      ],
      imageData: blankImage(),
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBe(true)
    expect(measureRecords[1].events[0].notes[0].tieStop).toBe(true)
    expect(measureRecords[0].events[0].notes[1].tieStart).toBeUndefined()
    expect(measureRecords[1].events[0].notes[1].tieStop).toBeUndefined()
  })

  it('emits a slur for different pitches and preserves both playback attacks', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [
          noteEvent(0, [{ midi: 72, clef: 'treble', cx: 300, cy: 350 }]),
          noteEvent(4, [{ midi: 76, clef: 'treble', cx: 500, cy: 330 }]),
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, box(1, 0, 0.2, 0.6)]]),
      vectorCurves: [
        vectorCurve('two-note-slur', { x: 306, y: 342 }, { x: 494, y: 322 }),
      ],
      imageData: blankImage(),
    })
    const xml = buildOmrMusicXml({ measures: measureRecords })
    const attacks = buildScoreNoteSchedule(parseMusicXml(xml, 'slur.musicxml'))

    expect(result.diagnostics.appliedSlurCount).toBe(1)
    expect(xml).toContain('<slur type="start"')
    expect(xml).toContain('<slur type="stop"')
    expect(attacks.map((attack) => attack.midi)).toEqual([72, 76])
  })

  it('stitches explicit right/left system fragments into one tie', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [noteEvent(0, [{ midi: 72, clef: 'treble', cx: 700, cy: 350 }])],
      },
      {
        measureNumber: 2,
        page: 1,
        systemIndex: 1,
        events: [noteEvent(0, [{ midi: 72, clef: 'treble', cx: 220, cy: 650 }])],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([
        [1, box(1, 0, 0.2, 0.8)],
        [2, box(2, 1, 0.2, 0.8)],
      ]),
      vectorCurves: [
        vectorCurve('system-out', { x: 706, y: 342 }, { x: 800, y: 342 }),
        vectorCurve('system-in', { x: 200, y: 642 }, { x: 214, y: 642 }),
      ],
      imageData: blankImage(),
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(result.diagnostics.appliedTiePairs[0].source).toBe(
      'pdf-vector-path-system-continuation',
    )
  })

  it('pairs page fragments after page records are assembled and emits no orphans', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 4,
        events: [noteEvent(0, [{ midi: 72, clef: 'treble', cx: 800, cy: 900 }])],
      },
      {
        measureNumber: 2,
        page: 2,
        systemIndex: 0,
        events: [noteEvent(0, [{ midi: 72, clef: 'treble', cx: 140, cy: 200 }])],
      },
    ]
    const result = applyDocumentVectorCurveContinuations({
      measureRecords,
      fragments: [
        {
          role: 'start',
          page: 1,
          candidateId: 'page-out',
          archDirection: 'above',
          endpointOffset: -7,
          ref: {
            measureNumber: 1,
            eventIndex: 0,
            noteIndex: 0,
            midi: 72,
            clef: 'treble',
          },
        },
        {
          role: 'stop',
          page: 2,
          candidateId: 'page-in',
          archDirection: 'above',
          endpointOffset: -7,
          ref: {
            measureNumber: 2,
            eventIndex: 0,
            noteIndex: 0,
            midi: 72,
            clef: 'treble',
          },
        },
      ],
    })

    expect(result.appliedTieCount).toBe(1)
    expect(result.orphanFragmentCount).toBe(0)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBe(true)
    expect(measureRecords[1].events[0].notes[0].tieStop).toBe(true)
  })

  it('renders every written note and every link in a three-note tie chain', () => {
    const measures = [
      {
        measureNumber: 1,
        events: [
          {
            ...noteEvent(0, [
              {
                midi: 72,
                tieStart: true,
                tiePlacement: 'above',
                slurStart: true,
                slurNumber: '1',
                slurPlacement: 'above',
              },
            ]),
          },
          {
            ...noteEvent(4, [
              {
                midi: 72,
                tieStart: true,
                tieStop: true,
                tiePlacement: 'above',
              },
            ]),
          },
          {
            ...noteEvent(8, [
              {
                midi: 72,
                tieStop: true,
                tiePlacement: 'above',
                slurStop: true,
                slurNumber: '1',
                slurPlacement: 'above',
              },
            ]),
          },
        ],
      },
    ]
    const xml = buildOmrMusicXml({ measures })
    const timing = parseMusicXml(xml, 'tie-chain.musicxml')
    const groups = buildVisualLaneGroups(timing)
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const markings = buildStaffLaneNotationMarkings(groups, geometry, { notes })

    expect(buildScoreNoteSchedule(timing)).toHaveLength(1)
    expect(notes).toHaveLength(3)
    expect(markings.spanMarkings.filter((marking) => marking.kind === 'tie')).toHaveLength(2)
    expect(markings.spanMarkings.filter((marking) => marking.kind === 'slur')).toHaveLength(1)
    expect(
      markings.spanMarkings
        .filter((marking) => marking.kind === 'tie')
        .every((marking) => marking.placement === 'above'),
    ).toBe(true)
  })
})
