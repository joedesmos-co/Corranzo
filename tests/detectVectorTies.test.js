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
  // Draw a thick bowed arc below the midline so probeInkArcWindow's column
  // continuity (50% overall / 75% mid-span) and curvature check can pass.
  for (let x = fromX + 8; x <= toX - 8; x += 1) {
    const t = (x - fromX) / Math.max(1, toX - fromX)
    const arcY = fromY + 4 + Math.round(4 * Math.sin(t * Math.PI))
    setInk(imageData, x, arcY)
    setInk(imageData, x, arcY + 1)
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
    expect(result.diagnostics.appliedSlurCount).toBeGreaterThan(0)
    expect(measureRecords[0].events[0].notes[0].slurStart).toBe(true)
    expect(measureRecords[0].events[1].notes[0].slurStop).toBe(true)
  })

  it('does not invent ink-arc ties on chord events', () => {
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
            notes: [
              { midi: 72, clef: 'treble', cx: 300, cy: 350 },
              { midi: 76, clef: 'treble', cx: 300, cy: 330 },
            ],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            cx: 360,
            notes: [
              { midi: 72, clef: 'treble', cx: 360, cy: 350 },
              { midi: 76, clef: 'treble', cx: 360, cy: 330 },
            ],
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

  it('does not invent ink-arc ties under beams', () => {
    const imageData = blankImage(1000, 1000)
    drawShortTieArc(imageData, 300, 350, 360)
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 2,
            beams: 1,
            cx: 300,
            notes: [{ midi: 74, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 2,
            durationDivisions: 2,
            beams: 1,
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

    expect(result.diagnostics.appliedTieCount).toBe(0)
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
              notes: [{ midi: 72, tieStart: true }],
            },
            {
              type: 'note',
              startDivision: 4,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 72, tieStop: true }],
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

  it('only suppresses re-attack for the tied pitch in a partially tied chord', () => {
    const notes = [
      {
        partId: 'P1',
        voice: 1,
        midi: 60,
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
        midi: 64,
        quarterTime: 0,
        durationQuarters: 1,
        durationDivisions: 1,
        tieStart: false,
        tieStop: false,
        isRest: false,
      },
      {
        partId: 'P1',
        voice: 1,
        midi: 60,
        quarterTime: 1,
        durationQuarters: 1,
        durationDivisions: 1,
        tieStart: false,
        tieStop: true,
        isRest: false,
      },
      {
        partId: 'P1',
        voice: 1,
        midi: 64,
        quarterTime: 1,
        durationQuarters: 1,
        durationDivisions: 1,
        tieStart: false,
        tieStop: false,
        isRest: false,
      },
    ]
    applyTieSustainToNotes(notes)
    expect(notes[0].suppressPlaybackAttack).toBeFalsy()
    expect(notes[1].suppressPlaybackAttack).toBeFalsy()
    expect(notes[2].suppressPlaybackAttack).toBe(true)
    expect(notes[3].suppressPlaybackAttack).toBeFalsy()
    expect(notes[0].durationQuarters).toBe(2)
  })

  it('sustains a cross-measure tie chain without re-attacking the continuation', () => {
    const notes = [
      {
        partId: 'P1',
        voice: 1,
        midi: 67,
        quarterTime: 3,
        durationQuarters: 1,
        durationDivisions: 1,
        tieStart: true,
        tieStop: false,
        isRest: false,
      },
      {
        partId: 'P1',
        voice: 1,
        midi: 67,
        quarterTime: 4,
        durationQuarters: 2,
        durationDivisions: 2,
        tieStart: false,
        tieStop: true,
        isRest: false,
      },
    ]
    applyTieSustainToNotes(notes)
    expect(notes[0].durationQuarters).toBe(3)
    expect(notes[1].suppressPlaybackAttack).toBe(true)
  })

  it('preserves written tieStart/tieStop flags while merging playback duration', () => {
    const notes = [
      {
        partId: 'P1',
        voice: 1,
        midi: 67,
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
        midi: 67,
        quarterTime: 1,
        durationQuarters: 1,
        durationDivisions: 1,
        tieStart: false,
        tieStop: true,
        isRest: false,
      },
    ]
    applyTieSustainToNotes(notes)
    expect(notes[0].tieStart).toBe(true)
    expect(notes[0].tieStop).toBe(false)
    expect(notes[1].tieStart).toBe(false)
    expect(notes[1].tieStop).toBe(true)
    expect(notes[0].durationQuarters).toBe(2)
    expect(notes[1].suppressPlaybackAttack).toBe(true)
  })

  it('does not stamp ties onto untied chord mates in MusicXML', () => {
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
              notes: [
                { midi: 72, tieStart: true },
                { midi: 76 },
              ],
            },
            {
              type: 'note',
              startDivision: 4,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [
                { midi: 72, tieStop: true },
                { midi: 76 },
              ],
            },
          ],
        },
      ],
    })
    const notes = [...xml.matchAll(/<note\b[\s\S]*?<\/note>/gi)].map((match) => match[0])
    const tiedStarts = notes.filter((note) => /<tie[^>]*type="start"/i.test(note))
    const untiedMates = notes.filter(
      (note) => /<chord\/>/i.test(note) && !/<tie\b/i.test(note) && /<step>E<\/step>/.test(note),
    )
    expect(tiedStarts).toHaveLength(1)
    expect(untiedMates.length).toBeGreaterThan(0)
  })
})

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

function staffBox(measureNumber, systemIndex, x0, x1) {
  return {
    measureNumber,
    page: 1,
    systemIndex,
    x0,
    playableX0: x0,
    x1,
    y0: 0.08,
    y1: 0.42,
    staffLines: {
      treble: [0.31, 0.32, 0.33, 0.34, 0.35],
      bass: [0.5, 0.51, 0.52, 0.53, 0.54],
    },
  }
}

describe('exclusive vector tie pairing geometry', () => {
  it('keeps only one tie when two curves compete for one source note', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [{ midi: 72, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            notes: [{ midi: 72, clef: 'treble', cx: 380, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 8,
            durationDivisions: 4,
            notes: [{ midi: 72, clef: 'treble', cx: 460, cy: 350 }],
          },
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, staffBox(1, 0, 0.2, 0.7)]]),
      vectorCurves: [
        // Clear winner: tight geometry to the nearer destination.
        vectorCurve('src-compete-a', { x: 306, y: 350 }, { x: 374, y: 350 }),
        // Competitor: same source, farther destination (worse score, exclusive drop).
        vectorCurve('src-compete-b', { x: 306, y: 350 }, { x: 454, y: 350 }),
      ],
      imageData: blankImage(1000, 1000),
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBe(true)
    expect(measureRecords[0].events[1].notes[0].tieStop).toBe(true)
    expect(measureRecords[0].events[2].notes[0].tieStop).toBeUndefined()
  })

  it('keeps only one tie when two curves compete for one destination note', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [{ midi: 72, clef: 'treble', cx: 280, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            notes: [{ midi: 72, clef: 'treble', cx: 360, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 8,
            durationDivisions: 4,
            notes: [{ midi: 72, clef: 'treble', cx: 440, cy: 350 }],
          },
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, staffBox(1, 0, 0.2, 0.7)]]),
      vectorCurves: [
        vectorCurve('dst-compete-a', { x: 366, y: 350 }, { x: 434, y: 350 }),
        vectorCurve('dst-compete-b', { x: 286, y: 350 }, { x: 434, y: 350 }),
      ],
      imageData: blankImage(1000, 1000),
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(measureRecords[0].events[2].notes[0].tieStop).toBe(true)
    const starts = measureRecords[0].events.filter((event) => event.notes[0].tieStart)
    expect(starts).toHaveLength(1)
  })

  it('preserves separate ties on multiple chord pitches', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [
              { midi: 72, clef: 'treble', cx: 300, cy: 350 },
              { midi: 76, clef: 'treble', cx: 300, cy: 330 },
            ],
          },
        ],
      },
      {
        measureNumber: 2,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [
              { midi: 72, clef: 'treble', cx: 380, cy: 350 },
              { midi: 76, clef: 'treble', cx: 380, cy: 330 },
            ],
          },
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([
        [1, staffBox(1, 0, 0.2, 0.34)],
        [2, staffBox(2, 0, 0.34, 0.5)],
      ]),
      vectorCurves: [
        vectorCurve('chord-tie-72', { x: 306, y: 350 }, { x: 374, y: 350 }),
        vectorCurve('chord-tie-76', { x: 306, y: 330 }, { x: 374, y: 330 }),
      ],
      imageData: blankImage(1000, 1000),
    })

    expect(result.diagnostics.appliedTieCount).toBe(2)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBe(true)
    expect(measureRecords[0].events[0].notes[1].tieStart).toBe(true)
    expect(measureRecords[1].events[0].notes[0].tieStop).toBe(true)
    expect(measureRecords[1].events[0].notes[1].tieStop).toBe(true)
  })

  it('pairs a same-pitch cross-measure tie', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [{ midi: 67, clef: 'treble', cx: 300, cy: 340 }],
          },
        ],
      },
      {
        measureNumber: 2,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [{ midi: 67, clef: 'treble', cx: 380, cy: 340 }],
          },
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([
        [1, staffBox(1, 0, 0.2, 0.34)],
        [2, staffBox(2, 0, 0.34, 0.5)],
      ]),
      vectorCurves: [vectorCurve('cross-bar', { x: 306, y: 340 }, { x: 374, y: 340 })],
      imageData: blankImage(1000, 1000),
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBe(true)
    expect(measureRecords[1].events[0].notes[0].tieStop).toBe(true)
  })

  it('does not turn slur-like different-pitch curves into ties', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [{ midi: 72, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            notes: [{ midi: 76, clef: 'treble', cx: 500, cy: 330 }],
          },
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, staffBox(1, 0, 0.2, 0.7)]]),
      vectorCurves: [vectorCurve('slur-like', { x: 306, y: 342 }, { x: 494, y: 322 })],
      imageData: blankImage(1000, 1000),
    })

    expect(result.diagnostics.appliedTieCount).toBe(0)
    expect(result.diagnostics.appliedSlurCount).toBe(1)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBeUndefined()
    expect(measureRecords[0].events[1].notes[0].tieStop).toBeUndefined()
  })

  it('rejects ambiguous competing geometry instead of inventing a tie', () => {
    const measureRecords = [
      {
        measureNumber: 1,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [{ midi: 72, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            voice: 1,
            notes: [{ midi: 72, clef: 'treble', voice: 1, cx: 400, cy: 338 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            voice: 2,
            notes: [{ midi: 72, clef: 'treble', voice: 2, cx: 400, cy: 362 }],
          },
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, staffBox(1, 0, 0.2, 0.7)]]),
      vectorCurves: [
        // Same onset destinations with mirrored geometry from one source.
        vectorCurve('ambig-a', { x: 306, y: 350 }, { x: 394, y: 338 }),
        vectorCurve('ambig-b', { x: 306, y: 350 }, { x: 394, y: 362 }),
      ],
      imageData: blankImage(1000, 1000),
    })

    expect(result.diagnostics.appliedTieCount).toBe(0)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBeUndefined()
    expect(measureRecords[0].events[1].notes[0].tieStop).toBeUndefined()
    expect(measureRecords[0].events[2].notes[0].tieStop).toBeUndefined()
  })

  it('infers a cross-system tie from an outgoing open-cubic measure fragment', () => {
    const measureRecords = [
      {
        measureNumber: 4,
        page: 1,
        systemIndex: 0,
        events: [
          {
            type: 'note',
            startDivision: 12,
            durationDivisions: 4,
            notes: [{ midi: 62, clef: 'treble', cx: 852, cy: 302 }],
          },
        ],
      },
      {
        measureNumber: 5,
        page: 1,
        systemIndex: 2,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            notes: [{ midi: 69, clef: 'treble', cx: 191, cy: 742 }],
          },
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([
        [4, staffBox(4, 0, 0.68, 0.92)],
        [5, staffBox(5, 2, 0.08, 0.32)],
      ]),
      vectorCurves: [
        {
          candidateId: 'open-outgoing',
          source: 'pdf-vector-path',
          strokeStyle: 'open-cubic',
          start: { x: 847, y: 309, tangent: { dx: 1, dy: 0 } },
          end: { x: 911, y: 309, tangent: { dx: 1, dy: 0 } },
          bounds: { x0: 847, x1: 911, y0: 309, y1: 309, width: 64, height: 1 },
          archDirection: 'below',
        },
      ],
      imageData: blankImage(1000, 1000),
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBe(true)
    expect(measureRecords[1].events[0].notes[0].tieStop).toBe(true)
  })
})
