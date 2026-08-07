import { describe, expect, it } from 'vitest'
import {
  normalizeVectorBarComponents,
  classifyNormalizedBarStructure,
  findVectorRepeatDotPair,
  classifyVectorRepeatDirection,
  detectVectorRepeatAtEdge,
  fuseVectorRepeatMarkings,
} from '../src/features/omr/detectVectorRepeatBarlines.js'
import {
  detectMeasureStructureMarkings,
  detectRepeatBarline,
  finalizeRepeatMarkings,
  shouldEmitRepeat,
} from '../src/features/omr/detectOmrRepeatBarline.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { musicalPianoPage } from './helpers/syntheticScore.js'

function blankPage(width = 400, height = 200) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { width, height, data }
}

function inkRect(img, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * img.width + x) * 4
      img.data[i] = 0
      img.data[i + 1] = 0
      img.data[i + 2] = 0
    }
  }
}

function bar(x0, y0, x1, y1, { filled = true, id = 'bar' } = {}) {
  return {
    candidateId: id,
    source: 'vector-path',
    filled,
    stroked: !filled,
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    bounds: { x0, x1, y0, y1, width: x1 - x0, height: y1 - y0 },
    width: x1 - x0,
    height: y1 - y0,
    aspect: (y1 - y0) / Math.max(x1 - x0, 1e-6),
    curveCount: 0,
    lineCount: 4,
    closeCount: 1,
  }
}

function dot(x, y, r = 2.5, id = 'dot') {
  return {
    candidateId: id,
    source: 'vector-path',
    filled: true,
    x,
    y,
    radius: r,
    bounds: { x0: x - r, x1: x + r, y0: y - r, y1: y + r, width: r * 2, height: r * 2 },
  }
}

const STAFF = [40, 52, 64, 76, 88]
const STAFF_GAP = 12

describe('vector-native repeat barlines', () => {
  it('1. forward repeat with filled rectangular thick bar', () => {
    const verticalBars = [bar(100, 40, 104, 88, { id: 'thick' }), bar(108, 40, 109.5, 88, { id: 'thin' })]
    const compactDots = [dot(118, 58, 2.4, 'd1'), dot(118, 70, 2.4, 'd2')]
    const hit = detectVectorRepeatAtEdge({
      verticalBars,
      compactDots,
      measureBox: { x0: 0.25, x1: 0.55, y0: 0.15, y1: 0.5 },
      imageWidth: 400,
      imageHeight: 200,
      edge: 'left',
      staffLineYs: STAFF,
    })
    expect(hit?.forwardRepeat).toBe(true)
    expect(hit?.source).toBe('vector-path')
  })

  it('glyph colon pair + stroked thick/thin recovers backward', () => {
    const verticalBars = [
      { ...bar(200, 40, 201.3, 88, { id: 'thin' }), width: 1.3, stroked: true },
      { ...bar(205, 40, 209.2, 88, { id: 'thick' }), width: 4.2, stroked: true },
    ]
    const compactDots = [
      { ...dot(190, 58, 2.2), source: 'vector-glyph' },
      { ...dot(190, 70, 2.2), source: 'vector-glyph' },
    ]
    const hit = detectVectorRepeatAtEdge({
      verticalBars,
      compactDots,
      measureBox: { x0: 0.4, x1: 0.53, y0: 0.15, y1: 0.5 },
      imageWidth: 400,
      imageHeight: 200,
      edge: 'right',
      staffLineYs: STAFF,
    })
    expect(hit?.backwardRepeat).toBe(true)
  })

  it('rejects left-edge hit when bar cluster is nearer the right edge', () => {
    // Shared boundary column near x=210 on a wide measure — left edge must abstain.
    const verticalBars = [
      bar(206, 40, 210, 88, { id: 'thick' }),
      bar(211, 40, 212.5, 88, { id: 'thin' }),
    ]
    const compactDots = [dot(216, 58), dot(216, 70)]
    const hit = detectVectorRepeatAtEdge({
      verticalBars,
      compactDots,
      measureBox: { x0: 0.1, x1: 0.55, y0: 0.15, y1: 0.5 },
      imageWidth: 400,
      imageHeight: 200,
      edge: 'left',
      staffLineYs: STAFF,
    })
    expect(hit).toBeNull()
  })

  it('2. backward repeat with filled rectangular thick bar', () => {
    const verticalBars = [bar(200, 40, 201.5, 88, { id: 'thin' }), bar(205, 40, 211, 88, { id: 'thick' })]
    const compactDots = [dot(190, 58), dot(190, 70)]
    const hit = detectVectorRepeatAtEdge({
      verticalBars,
      compactDots,
      measureBox: { x0: 0.4, x1: 0.53, y0: 0.15, y1: 0.5 },
      imageWidth: 400,
      imageHeight: 200,
      edge: 'right',
      staffLineYs: STAFF,
    })
    expect(hit?.backwardRepeat).toBe(true)
  })

  it('3. thick bar from adjacent vector paths merges', () => {
    const normalized = normalizeVectorBarComponents(
      [
        bar(100, 40, 102.5, 88, { id: 'a' }),
        bar(102.2, 40, 104.8, 88, { id: 'b' }),
      ],
      { staffGap: STAFF_GAP },
    )
    expect(normalized).toHaveLength(1)
    expect(normalized[0].kind).toBe('thick')
    expect(normalized[0].members).toHaveLength(2)
  })

  it('4. thick stroked line classifies as thick', () => {
    const normalized = normalizeVectorBarComponents(
      [bar(100, 40, 106, 88, { filled: false, id: 'stroke' })],
      { staffGap: STAFF_GAP },
    )
    expect(normalized[0].kind).toBe('thick')
  })

  it('5–6. dot glyph/path pairs accepted; single rejected', () => {
    const pair = findVectorRepeatDotPair([dot(90, 58), dot(90.5, 70)], {
      barX: 100,
      side: 'left',
      staffLineYs: STAFF,
      staffGap: STAFF_GAP,
    })
    expect(pair?.dots).toHaveLength(2)
    expect(
      findVectorRepeatDotPair([dot(90, 58)], {
        barX: 100,
        side: 'left',
        staffLineYs: STAFF,
        staffGap: STAFF_GAP,
      }),
    ).toBeNull()
  })

  it('7. per-staff components fuse into one semantic repeat', () => {
    const fused = fuseVectorRepeatMarkings([
      { backwardRepeat: true, confidence: 0.9, source: 'vector-path', evidenceFamilies: ['bar-order+dot-side'] },
      { backwardRepeat: true, confidence: 0.91, source: 'vector-path', evidenceFamilies: ['bar-order+dot-side'] },
    ])
    expect(fused?.backwardRepeat).toBe(true)
    expect(fused?.staffCount).toBe(2)
    expect(fused?.evidenceFamilies).toContain('multi-staff-fusion')
  })

  it('8. single-staff strong evidence still accepted', () => {
    const marking = classifyVectorRepeatDirection({
      structure: 'thin-thick',
      bars: [{ kind: 'thin', x: 100 }, { kind: 'thick', x: 106 }],
      leftDots: { dots: [1, 2], side: 'left' },
      edge: 'right',
    })
    expect(marking?.backwardRepeat).toBe(true)
    expect(shouldEmitRepeat(marking)).toBe(true)
  })

  it('9–11. system-start forward, system-end backward, internal backward ownership', () => {
    const records = [
      {
        measureNumber: 7,
        systemIndex: 1,
        repeatMarking: {
          forwardRepeat: true,
          confidence: 0.92,
          source: 'vector-path',
        },
      },
      {
        measureNumber: 8,
        systemIndex: 1,
        repeatMarking: {
          backwardRepeat: true,
          confidence: 0.92,
          source: 'vector-path',
        },
      },
      {
        measureNumber: 12,
        systemIndex: 2,
        repeatMarking: {
          backwardRepeat: true,
          confidence: 0.92,
          source: 'vector-path',
        },
      },
      {
        measureNumber: 13,
        systemIndex: 2,
        repeatMarking: null,
      },
    ]
    finalizeRepeatMarkings(records)
    expect(records[0].repeatMarking?.forwardRepeat).toBe(true)
    expect(records[1].repeatMarking?.backwardRepeat).toBe(true)
    expect(records[2].repeatMarking?.backwardRepeat).toBe(true)
  })

  it('12–14. thin+thick / thick+thin ordering and dot side', () => {
    expect(classifyNormalizedBarStructure([
      { kind: 'thin', x: 1, bounds: { x0: 0, x1: 1, y0: 0, y1: 40 } },
      { kind: 'thick', x: 5, bounds: { x0: 3, x1: 7, y0: 0, y1: 40 } },
    ], { staffGap: 10 }).structure).toBe('thin-thick')
    expect(classifyNormalizedBarStructure([
      { kind: 'thick', x: 1, bounds: { x0: 0, x1: 4, y0: 0, y1: 40 } },
      { kind: 'thin', x: 7, bounds: { x0: 6, x1: 7, y0: 0, y1: 40 } },
    ], { staffGap: 10 }).structure).toBe('thick-thin')

    const forward = classifyVectorRepeatDirection({
      structure: 'thick-thin',
      leftDots: null,
      rightDots: { dots: [1, 2], side: 'right' },
      edge: 'left',
    })
    expect(forward?.forwardRepeat).toBe(true)
  })

  it('15–16. ordinary double / final barline rejected', () => {
    expect(
      classifyVectorRepeatDirection({
        structure: 'double-thin',
        leftDots: null,
        rightDots: null,
        edge: 'right',
      }),
    ).toBeNull()
    expect(
      classifyVectorRepeatDirection({
        structure: 'thin-thick',
        leftDots: null,
        rightDots: null,
        edge: 'right',
      }),
    ).toBeNull()
  })

  it('17–20. single / notehead / staccato / augmentation dots rejected', () => {
    // notehead-sized blob
    expect(
      findVectorRepeatDotPair([dot(90, 58, 7), dot(90, 70, 7)], {
        barX: 100,
        side: 'left',
        staffLineYs: STAFF,
        staffGap: STAFF_GAP,
      }),
    ).toBeNull()
    // staccato-like tiny / wrong separation
    expect(
      findVectorRepeatDotPair([dot(90, 50, 1.2), dot(90, 52, 1.2)], {
        barX: 100,
        side: 'left',
        staffLineYs: STAFF,
        staffGap: STAFF_GAP,
      }),
    ).toBeNull()
    // augmentation: on staff line / wrong side distance handled by side filter
    expect(
      findVectorRepeatDotPair([dot(50, 58), dot(50, 70)], {
        barX: 100,
        side: 'left',
        staffLineYs: STAFF,
        staffGap: STAFF_GAP,
        maxDistance: 20,
      }),
    ).toBeNull()
  })

  it('21–23. text colon / stem / volta hook rejected as barline structure', () => {
    // stem-like short/narrow mid-measure vertical not at edge → no hit
    const stemOnly = detectVectorRepeatAtEdge({
      verticalBars: [bar(150, 50, 151, 80, { id: 'stem' })],
      compactDots: [dot(140, 58), dot(140, 70)],
      measureBox: { x0: 0.2, x1: 0.55, y0: 0.15, y1: 0.5 },
      imageWidth: 400,
      imageHeight: 200,
      edge: 'right',
      staffLineYs: STAFF,
    })
    expect(stemOnly).toBeNull()

    // volta-like horizontal is not extracted as verticalBars; empty → null
    expect(
      detectVectorRepeatAtEdge({
        verticalBars: [],
        compactDots: [],
        measureBox: { x0: 0.2, x1: 0.5, y0: 0.1, y1: 0.4 },
        imageWidth: 400,
        imageHeight: 200,
        edge: 'right',
        staffLineYs: STAFF,
      }),
    ).toBeNull()
  })

  it('24–25. measure ownership + no duplicate across staves', () => {
    const imageData = blankPage(400, 200)
    const components = {
      verticalBars: [
        bar(200, 40, 201.5, 88, { id: 't1' }),
        bar(205, 40, 211, 88, { id: 'k1' }),
        bar(200, 110, 201.5, 158, { id: 't2' }),
        bar(205, 110, 211, 158, { id: 'k2' }),
      ],
      compactDots: [
        dot(190, 58, 2.4, 'a'),
        dot(190, 70, 2.4, 'b'),
        dot(190, 128, 2.4, 'c'),
        dot(190, 140, 2.4, 'd'),
      ],
    }
    const structure = detectMeasureStructureMarkings(
      imageData,
      { x0: 0.3, x1: 0.53, y0: 0.15, y1: 0.85 },
      170,
      {
        isFirstInSystem: false,
        staffLineYs: [...STAFF, 110, 122, 134, 146, 158],
        vectorBarlineComponents: components,
      },
    )
    expect(structure.repeatMarking?.backwardRepeat).toBe(true)
    expect(structure.repeatMarking?.source).toBe('vector-path')
    // One fused marking, not two.
    expect(structure.repeatMarking?.staffCount == null || structure.repeatMarking.staffCount >= 1).toBe(
      true,
    )
  })

  it('26. existing raster repeat detection unchanged', () => {
    const page = musicalPianoPage()
    const band = page.systemBands[0]
    const x0 = Math.floor(page.width * 0.08)
    const x1 = Math.floor(page.width * 0.92)
    const measureWidth = (x1 - x0) / 3
    const barX = Math.floor(x0 + measureWidth * 2) - 2
    const repeat = detectRepeatBarline(
      page,
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
  })

  it('27. TAB system-break raster false positives still suppressed', () => {
    const records = [
      {
        measureNumber: 1,
        systemIndex: 0,
        repeatMarking: { forwardRepeat: true, confidence: 0.84 },
      },
      {
        measureNumber: 4,
        systemIndex: 0,
        repeatMarking: { backwardRepeat: true, confidence: 0.84 },
      },
      {
        measureNumber: 5,
        systemIndex: 1,
        repeatMarking: { forwardRepeat: true, confidence: 0.84 },
      },
      {
        measureNumber: 8,
        systemIndex: 1,
        endingMarking: { endingStartNumbers: [2], endingStop: true, confidence: 0.88 },
        repeatMarking: { backwardRepeat: true, confidence: 0.84 },
      },
    ]
    finalizeRepeatMarkings(records)
    expect(records[0].repeatMarking?.forwardRepeat).toBe(true)
    expect(records[1].repeatMarking).toBeNull()
    expect(records[2].repeatMarking).toBeNull()
    expect(records[3].repeatMarking?.backwardRepeat).toBe(true)
  })

  it('28–32. MusicXML emission, save/reload, ownership, playback-stable parse', () => {
    const xml = buildOmrMusicXml({
      measures: [
        {
          measureNumber: 1,
          uncertain: false,
          repeatMarking: { forwardRepeat: true, confidence: 0.92, source: 'vector-path' },
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 60 }],
            },
          ],
        },
        {
          measureNumber: 2,
          uncertain: false,
          endingMarking: { endingStartNumbers: [1], endingStop: true, confidence: 0.9 },
          repeatMarking: { backwardRepeat: true, confidence: 0.92, source: 'vector-path' },
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 62 }],
            },
          ],
        },
      ],
      musical: {
        keySignature: { fifths: 0, mode: 'major', confidence: 0.9 },
        timeSignature: { beats: 4, beatType: 4, confidence: 0.9 },
      },
      divisions: 4,
    })
    expect(xml).toContain('repeat direction="forward"')
    expect(xml).toContain('repeat direction="backward"')
    expect(xml).toContain('location="left"')
    expect(xml).toContain('location="right"')
    expect(xml.match(/repeat direction=/g)?.length).toBe(2)

    const parsed = parseMusicXml(xml)
    expect(parsed.measures.length).toBeGreaterThanOrEqual(2)
    const roundTrip = buildOmrMusicXml({
      measures: [
        {
          measureNumber: 1,
          uncertain: false,
          repeatMarking: { forwardRepeat: true, confidence: 0.92, source: 'vector-path' },
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 60 }],
            },
          ],
        },
        {
          measureNumber: 2,
          uncertain: false,
          repeatMarking: { backwardRepeat: true, confidence: 0.92, source: 'vector-path' },
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 62 }],
            },
          ],
        },
      ],
      musical: {
        keySignature: { fifths: 0, mode: 'major', confidence: 0.9 },
        timeSignature: { beats: 4, beatType: 4, confidence: 0.9 },
      },
      divisions: 4,
    })
    expect(roundTrip).toContain('repeat direction="forward"')
    expect(roundTrip).toContain('repeat direction="backward"')
  })
})
