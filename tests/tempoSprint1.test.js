import { describe, expect, it } from 'vitest'
import {
  attachTemposToMeasureRecords,
  collectTempoCandidatesFromText,
  parseTempoFromTextItems,
  toQuarterBpm,
  shouldEmitTempo,
  shouldEmitTempoMarking,
} from '../src/features/omr/parseOmrTempoMarking.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

function textItem(text, { x = 20, y = 80, width = 12, height = 10, pageWidth = 100, pageHeight = 100 } = {}) {
  return { text, x, y, width, height, pageWidth, pageHeight }
}

function emptyMeasure(number) {
  return {
    measureNumber: number,
    events: [{ type: 'rest', startDivision: 0, durationDivisions: 16, durationType: 'whole' }],
  }
}

function box(number, x0, x1, y0 = 0.28, y1 = 0.55) {
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

describe('Tempo Recognition Sprint 1', () => {
  it('1. initial quarter = 120', async () => {
    const pageText = [textItem('♩ = 120', { x: 15, y: 75 })]
    const records = [emptyMeasure(1), emptyMeasure(2)]
    attachTemposToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: [[box(1, 0.1, 0.4), box(2, 0.45, 0.8)]],
      pageText,
    })
    expect(records[0].tempoMarkings?.[0]?.quarterBpm).toBe(120)
    expect(records[0].tempoMarkings?.[0]?.beatUnit).toBe('quarter')
    const xml = buildOmrMusicXml({
      measures: records,
      musical: { tempo: { bpm: 120, confidence: 0.9, fromDefault: false, beatUnit: 'quarter', markBpm: 120 } },
    })
    expect(xml).toMatch(/<beat-unit>quarter<\/beat-unit>/)
    expect(xml).toMatch(/tempo="120"/)
    const timing = await parseMusicXml(xml)
    expect(timing.tempoChanges[0].bpm).toBe(120)
  })

  it('2. initial dotted-quarter = 72', () => {
    const pageText = [
      textItem('q', { x: 12, y: 75, width: 6 }),
      textItem('.', { x: 18, y: 75, width: 4 }),
      textItem('=', { x: 24, y: 75, width: 6 }),
      textItem('72', { x: 32, y: 75, width: 10 }),
    ]
    const candidates = collectTempoCandidatesFromText(pageText)
    const mark = candidates.find((entry) => entry.kind === 'metronome')
    expect(mark?.dots).toBe(1)
    expect(mark?.markBpm).toBe(72)
    expect(mark?.quarterBpm).toBe(toQuarterBpm(72, 'quarter', 1))
    expect(mark?.quarterBpm).toBe(108)
  })

  it('3. eighth = 96', () => {
    const parsed = parseTempoFromTextItems([textItem('♪ = 96')])
    expect(parsed.fromDefault).toBe(false)
    expect(parsed.beatUnit).toBe('eighth')
    expect(parsed.markBpm).toBe(96)
    expect(parsed.bpm).toBe(48)
  })

  it('4. tempo word only preserves text and mapped BPM', () => {
    const pageText = [textItem('Allegro', { x: 15, y: 80 })]
    const records = [emptyMeasure(1)]
    attachTemposToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: [[box(1, 0.1, 0.5)]],
      pageText,
    })
    expect(records[0].tempoMarkings?.[0]?.words).toBe('Allegro')
    expect(records[0].tempoMarkings?.[0]?.quarterBpm).toBe(120)
    const xml = buildOmrMusicXml({
      measures: records,
      musical: { tempo: { fromDefault: true, bpm: 120, confidence: 0 } },
    })
    expect(xml).toContain('<words>Allegro</words>')
    expect(xml).toMatch(/tempo="120"/)
  })

  it('5. tempo word plus numeric mark prefers metronome BPM', () => {
    const pageText = [
      textItem('Allegro', { x: 12, y: 82 }),
      textItem('♩ = 132', { x: 28, y: 82 }),
    ]
    const parsed = parseTempoFromTextItems(pageText)
    expect(parsed.source).toContain('metronome')
    expect(parsed.bpm).toBe(132)
  })

  it('6. mid-score numeric tempo change', async () => {
    const pageText = [
      textItem('♩ = 100', { x: 15, y: 75 }),
      textItem('♩ = 80', { x: 60, y: 75 }),
    ]
    const records = [emptyMeasure(1), emptyMeasure(2)]
    attachTemposToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: [[box(1, 0.1, 0.4), box(2, 0.5, 0.85)]],
      pageText,
    })
    expect(records[0].tempoMarkings?.[0]?.quarterBpm).toBe(100)
    expect(records[1].tempoMarkings?.[0]?.quarterBpm).toBe(80)
    const xml = buildOmrMusicXml({ measures: records, musical: { tempo: { fromDefault: true } } })
    const timing = await parseMusicXml(xml)
    expect(timing.tempoChanges.some((change) => change.bpm === 100)).toBe(true)
    expect(timing.tempoChanges.some((change) => change.bpm === 80)).toBe(true)
  })

  it('7. multiple changes in one piece', () => {
    const pageText = [
      textItem('♩ = 90', { x: 12, y: 75 }),
      textItem('♩ = 110', { x: 40, y: 75 }),
      textItem('♩ = 70', { x: 70, y: 75 }),
    ]
    const records = [emptyMeasure(1), emptyMeasure(2), emptyMeasure(3)]
    attachTemposToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: [[
        box(1, 0.05, 0.3),
        box(2, 0.32, 0.55),
        box(3, 0.57, 0.9),
      ]],
      pageText,
    })
    expect(records.map((row) => row.tempoMarkings?.[0]?.quarterBpm)).toEqual([90, 110, 70])
  })

  it('8. tempo change inside a repeated section is written on the measure', async () => {
    const records = [
      {
        ...emptyMeasure(1),
        repeatMarking: { forwardRepeat: true, confidence: 0.9 },
        tempoMarkings: [
          {
            kind: 'metronome',
            beatUnit: 'quarter',
            dots: 0,
            markBpm: 100,
            quarterBpm: 100,
            bpm: 100,
            confidence: 0.9,
            onsetDivision: 0,
          },
        ],
      },
      {
        ...emptyMeasure(2),
        tempoMarkings: [
          {
            kind: 'metronome',
            beatUnit: 'quarter',
            dots: 0,
            markBpm: 60,
            quarterBpm: 60,
            bpm: 60,
            confidence: 0.9,
            onsetDivision: 0,
          },
        ],
      },
      {
        ...emptyMeasure(3),
        repeatMarking: { backwardRepeat: true, confidence: 0.9 },
      },
    ]
    const xml = buildOmrMusicXml({ measures: records, musical: { tempo: { fromDefault: true } } })
    expect(xml).toMatch(/tempo="100"/)
    expect(xml).toMatch(/tempo="60"/)
    const timing = await parseMusicXml(xml)
    // Written tempos remain; performed timeline expands separately.
    expect(timing.tempoChanges.some((change) => change.bpm === 60)).toBe(true)
  })

  it('9. rejects page/measure numbers near tempo-like digits', () => {
    const pageText = [
      textItem('12', { x: 50, y: 40 }),
      textItem('3', { x: 10, y: 50 }),
      textItem('CC0 Study', { x: 20, y: 90 }),
    ]
    const candidates = collectTempoCandidatesFromText(pageText)
    expect(candidates.filter((entry) => entry.kind === 'metronome')).toHaveLength(0)
  })

  it('10. score with no tempo marking emits no invented sound tempo', () => {
    const records = [emptyMeasure(1)]
    const xml = buildOmrMusicXml({
      measures: records,
      musical: { tempo: { bpm: 120, fromDefault: true, confidence: 0 } },
    })
    expect(xml).not.toMatch(/<sound tempo=/)
    expect(xml).not.toMatch(/<metronome>/)
  })

  it('11. duplicate vector+raster-style candidates dedupe on same measure', () => {
    const pageText = [
      textItem('♩ = 100', { x: 18, y: 75 }),
      textItem('♩ = 100', { x: 18.5, y: 75.2 }),
    ]
    const records = [emptyMeasure(1)]
    attachTemposToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: [[box(1, 0.1, 0.5)]],
      pageText,
    })
    expect(records[0].tempoMarkings).toHaveLength(1)
  })

  it('12. malformed BPM is ignored safely', () => {
    expect(parseTempoFromTextItems([textItem('♩ = 0')]).fromDefault).toBe(true)
    expect(parseTempoFromTextItems([textItem('♩ = -40')]).fromDefault).toBe(true)
    expect(parseTempoFromTextItems([textItem('♩ = 999')]).fromDefault).toBe(true)
    expect(parseTempoFromTextItems([textItem('♩ = NaN')]).fromDefault).toBe(true)
    expect(shouldEmitTempo({ bpm: 0, fromDefault: false, confidence: 1 })).toBe(false)
    expect(shouldEmitTempoMarking({ quarterBpm: Number.NaN, confidence: 1 })).toBe(false)
  })

  it('supports a tempo restoring the previous BPM', () => {
    const pageText = [
      textItem('♩ = 110', { x: 15, y: 75 }),
      textItem('a tempo', { x: 60, y: 75 }),
    ]
    const records = [emptyMeasure(1), emptyMeasure(2)]
    attachTemposToMeasureRecords({
      measureRecords: records,
      systemMeasureBoxes: [[box(1, 0.1, 0.4), box(2, 0.5, 0.85)]],
      pageText,
    })
    expect(records[1].tempoMarkings?.[0]?.aTempo || records[1].tempoMarkings?.[0]?.source === 'a-tempo').toBe(
      true,
    )
    expect(records[1].tempoMarkings?.[0]?.quarterBpm).toBe(110)
  })

  it('SMuFL metronome quarter glyph groups with digits', () => {
    const pageText = [
      textItem(String.fromCodePoint(0xeca5), { x: 12, y: 75, width: 8 }),
      textItem('=', { x: 22, y: 75, width: 6 }),
      textItem('88', { x: 30, y: 75, width: 10 }),
    ]
    const parsed = parseTempoFromTextItems(pageText)
    expect(parsed.bpm).toBe(88)
    expect(parsed.beatUnit).toBe('quarter')
  })
})
