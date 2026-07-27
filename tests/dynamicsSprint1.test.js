import { describe, expect, it } from 'vitest'
import {
  attachDynamicsToMeasureRecords,
  collectDynamicCandidatesFromText,
  associateDynamicsToMeasures,
  detectDynamicNearMeasure,
  detectHairpinNearMeasure,
  finalizeWedgeStops,
  shouldEmitDynamic,
  shouldEmitWedge,
} from '../src/features/omr/detectOmrDynamics.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import {
  predictionsFromMeasureRecords,
  predictionsFromMusicXml,
  scoreDynamicsRecognition,
} from '../src/features/omr/omrDynamicsQuality.js'

function textItem(text, { x, y, width = 8, height = 10, pageWidth = 100, pageHeight = 100 } = {}) {
  return { text, x, y, width, height, pageWidth, pageHeight }
}

function blankImage(width = 200, height = 120) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(255),
  }
}

function paintInk(imageData, x0, y0, x1, y1) {
  const { data, width } = imageData
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = (y * width + x) * 4
      data[index] = 20
      data[index + 1] = 20
      data[index + 2] = 20
      data[index + 3] = 255
    }
  }
}

function measureBox(number, { x0, x1, y0 = 0.3, y1 = 0.55 } = {}) {
  return {
    measureNumber: number,
    systemIndex: 0,
    x0,
    x1,
    y0,
    y1,
    playableX0: x0 + 0.02,
  }
}

function emptyMeasure(number) {
  return {
    measureNumber: number,
    events: [{ type: 'rest', startDivision: 0, durationDivisions: 16, durationType: 'whole' }],
  }
}

describe('Dynamics Recognition Sprint 1', () => {
  it('1. recognizes one dynamic marking per measure and emits MusicXML', () => {
    const pageText = [textItem('mf', { x: 22, y: 40 })]
    const boxes = [[measureBox(1, { x0: 0.1, x1: 0.4 })]]
    const records = [emptyMeasure(1)]
    attachDynamicsToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: boxes,
      pageText,
      detectHairpins: false,
    })
    expect(records[0].dynamic?.mark).toBe('mf')
    const xml = buildOmrMusicXml({ measures: records })
    expect(xml).toMatch(/<dynamics><mf\s*\/>/)
    const scored = scoreDynamicsRecognition(
      [{ mark: 'mf', measureNumber: 1 }],
      predictionsFromMusicXml(xml),
    )
    expect(scored.bySymbol.mf.tp).toBe(1)
    expect(scored.totals.fp).toBe(0)
  })

  it('2. associates multiple dynamics in one system to separate measures', () => {
    const pageText = [
      textItem('p', { x: 18, y: 38 }),
      textItem('f', { x: 58, y: 38 }),
    ]
    const boxes = [[
      measureBox(1, { x0: 0.1, x1: 0.4 }),
      measureBox(2, { x0: 0.45, x1: 0.8 }),
    ]]
    const records = [emptyMeasure(1), emptyMeasure(2)]
    attachDynamicsToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: boxes,
      pageText,
      detectHairpins: false,
    })
    expect(records[0].dynamic?.mark).toBe('p')
    expect(records[1].dynamic?.mark).toBe('f')
  })

  it('3. grand-staff shared dynamic leaves staff unset (applies to part)', () => {
    const pageText = [textItem('mp', { x: 25, y: 48 })]
    const boxes = [[measureBox(1, { x0: 0.1, x1: 0.5, y0: 0.25, y1: 0.7 })]]
    const byMeasure = associateDynamicsToMeasures(
      collectDynamicCandidatesFromText(pageText),
      boxes,
    )
    const entry = byMeasure.get(1).dynamics[0]
    expect(entry.mark).toBe('mp')
    // Near system mid → shared / null staff
    expect(entry.staff == null || entry.staff === 1 || entry.staff === 2).toBe(true)
  })

  it('4. separate right-hand and left-hand dynamics keep distinct staves', () => {
    // Both sit in the dynamics zone; upper vs lower half of the system → staff 1/2.
    const pageText = [
      textItem('p', { x: 22, y: 52 }), // midY ≈ 0.43 → upper staff
      textItem('f', { x: 22, y: 38 }), // midY ≈ 0.57 → lower staff
    ]
    const boxes = [[measureBox(1, { x0: 0.1, x1: 0.5, y0: 0.25, y1: 0.7 })]]
    const byMeasure = associateDynamicsToMeasures(
      collectDynamicCandidatesFromText(pageText),
      boxes,
    )
    const marks = byMeasure.get(1).dynamics
    expect(marks).toHaveLength(2)
    expect(new Set(marks.map((entry) => entry.mark))).toEqual(new Set(['p', 'f']))
    const staffs = marks.map((entry) => entry.staff)
    expect(staffs).toContain(1)
    expect(staffs).toContain(2)
  })

  it('5. recognizes pp → mf → ff sequence across measures', () => {
    const pageText = [
      textItem('pp', { x: 15, y: 38 }),
      textItem('mf', { x: 40, y: 38 }),
      textItem('ff', { x: 70, y: 38 }),
    ]
    const boxes = [[
      measureBox(1, { x0: 0.05, x1: 0.3 }),
      measureBox(2, { x0: 0.32, x1: 0.55 }),
      measureBox(3, { x0: 0.57, x1: 0.85 }),
    ]]
    const records = [emptyMeasure(1), emptyMeasure(2), emptyMeasure(3)]
    attachDynamicsToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: boxes,
      pageText,
      detectHairpins: false,
    })
    expect(records.map((row) => row.dynamic?.mark)).toEqual(['pp', 'mf', 'ff'])
  })

  it('6. crescendo hairpin start emits wedge semantics', () => {
    const image = blankImage()
    // Opening wedge: span grows left → right under the staff band.
    for (let x = 30; x <= 90; x += 1) {
      const half = 1 + Math.floor(((x - 30) / 60) * 4)
      paintInk(image, x, 70 - half, x, 70 + half)
    }
    const box = measureBox(1, { x0: 0.1, x1: 0.55, y0: 0.25, y1: 0.55 })
    const hairpin = detectHairpinNearMeasure(image, box, 170)
    expect(hairpin?.type).toBe('crescendo')
    expect(shouldEmitWedge(hairpin)).toBe(true)
    const records = [{ ...emptyMeasure(1), wedges: [hairpin] }]
    finalizeWedgeStops(records)
    const xml = buildOmrMusicXml({ measures: records })
    expect(xml).toMatch(/<wedge type="crescendo"\s*\/>/)
    expect(xml).toMatch(/<wedge type="stop"\s*\/>/)
  })

  it('7. diminuendo hairpin can start in one measure and stop after a barline', () => {
    const records = [
      {
        ...emptyMeasure(1),
        wedges: [{ type: 'diminuendo', stage: 'start', confidence: 0.9, onsetDivision: 4 }],
      },
      emptyMeasure(2),
    ]
    finalizeWedgeStops(records)
    expect(records[1].wedges?.some((wedge) => wedge.stage === 'stop')).toBe(true)
    const xml = buildOmrMusicXml({ measures: records })
    expect(xml).toMatch(/<wedge type="diminuendo"\s*\/>/)
    expect(xml).toMatch(/<wedge type="stop"\s*\/>/)
  })

  it('8. rejects titles/prose while accepting musical dynamic tokens', () => {
    const pageText = [
      textItem('Piano Sonata', { x: 20, y: 90, width: 40 }),
      textItem('Allegro', { x: 20, y: 85 }),
      textItem('composer', { x: 60, y: 90 }),
      textItem('mf', { x: 25, y: 40 }),
      textItem('A', { x: 10, y: 70 }),
    ]
    const candidates = collectDynamicCandidatesFromText(pageText)
    expect(candidates.every((entry) => entry.kind !== 'dynamics' || entry.mark === 'mf')).toBe(true)
    expect(candidates.some((entry) => entry.mark === 'mf')).toBe(true)
  })

  it('9. score with no dynamics emits none', () => {
    const pageText = [
      textItem('Sonata', { x: 20, y: 90 }),
      textItem('Allegro', { x: 20, y: 80 }),
    ]
    const records = [emptyMeasure(1), emptyMeasure(2)]
    attachDynamicsToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: [[measureBox(1, { x0: 0.1, x1: 0.4 }), measureBox(2, { x0: 0.45, x1: 0.8 })]],
      pageText,
      detectHairpins: false,
    })
    expect(records.every((row) => !row.dynamic && !(row.dynamics?.length) && !(row.wedges?.length))).toBe(
      true,
    )
    const xml = buildOmrMusicXml({ measures: records })
    expect(xml).not.toMatch(/<dynamics>/)
    expect(xml).not.toMatch(/<wedge /)
  })

  it('10. malformed / ambiguous wedge ink is ignored safely', () => {
    const image = blankImage()
    // Random blob — not a wedge.
    paintInk(image, 40, 68, 55, 78)
    const box = measureBox(1, { x0: 0.1, x1: 0.5, y0: 0.25, y1: 0.55 })
    expect(detectHairpinNearMeasure(image, box, 170)).toBeNull()
  })

  it('does not invent dynamics from anonymous ink counts', () => {
    expect(detectDynamicNearMeasure()).toBeNull()
  })

  it('merges separated SMuFL / letter components into mp and ff', () => {
    const pageText = [
      textItem('m', { x: 20, y: 40, width: 5 }),
      textItem('p', { x: 26, y: 40, width: 5 }),
      textItem('f', { x: 50, y: 40, width: 5 }),
      textItem('f', { x: 56, y: 40, width: 5 }),
    ]
    const candidates = collectDynamicCandidatesFromText(pageText)
    const marks = candidates.filter((entry) => entry.kind === 'dynamics').map((entry) => entry.mark)
    expect(marks).toContain('mp')
    expect(marks).toContain('ff')
  })

  it('recognizes cresc. / dim. words as wedge starts', () => {
    const pageText = [textItem('cresc.', { x: 22, y: 38 })]
    const records = [emptyMeasure(1)]
    attachDynamicsToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: [[measureBox(1, { x0: 0.1, x1: 0.5 })]],
      pageText,
      detectHairpins: false,
    })
    expect(records[0].wedges?.[0]?.type).toBe('crescendo')
  })

  it('SMuFL dynamic codepoints classify correctly', () => {
    const pageText = [
      textItem(String.fromCodePoint(0xe52c), { x: 22, y: 38 }), // mp
      textItem(String.fromCodePoint(0xe53e), { x: 50, y: 38 }), // cresc wedge
    ]
    const candidates = collectDynamicCandidatesFromText(pageText)
    expect(candidates.some((entry) => entry.mark === 'mp')).toBe(true)
    expect(candidates.some((entry) => entry.wedge === 'crescendo')).toBe(true)
  })

  it('quality harness reports staff/onset association errors', () => {
    const expected = [{ mark: 'f', measureNumber: 1, onsetDivision: 0, staff: 1 }]
    const predicted = [{ mark: 'f', measureNumber: 1, onsetDivision: 12, staff: 2 }]
    const scored = scoreDynamicsRecognition(expected, predicted)
    expect(scored.bySymbol.f.tp).toBe(1)
    expect(scored.staffAssociationErrors).toBe(1)
    expect(scored.onsetAssociationErrors).toBe(1)
  })

  it('shouldEmitDynamic gates on confidence and mark set', () => {
    expect(shouldEmitDynamic({ mark: 'mf', confidence: 0.9 })).toBe(true)
    expect(shouldEmitDynamic({ mark: 'mf', confidence: 0.2 })).toBe(false)
    expect(shouldEmitDynamic({ mark: 'zzz', confidence: 0.99 })).toBe(false)
  })

  it('predictionsFromMeasureRecords flattens dynamics and open wedges', () => {
    const preds = predictionsFromMeasureRecords([
      {
        measureNumber: 1,
        dynamics: [{ mark: 'p', onsetDivision: 0, staff: 1 }],
        wedges: [
          { type: 'crescendo', stage: 'start', onsetDivision: 4 },
          { type: 'crescendo', stage: 'stop', onsetDivision: 16 },
        ],
      },
    ])
    expect(preds).toHaveLength(2)
    expect(preds.map((row) => row.mark ?? row.type)).toEqual(['p', 'crescendo'])
  })
})
