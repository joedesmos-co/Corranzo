/**
 * OMR Notation Fidelity Sprint 1 — harness + slur emission + artic-scan cases.
 * Does not retune the frozen semantic evaluator.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NOTATION_FAILURE_LAYER,
  extractNotationSymbolsFromNotes,
  scoreNotationFidelityCase,
  summarizeNotationFidelityResults,
} from '../src/features/omr/omrNotationFidelityQuality.js'
import {
  applyVectorPageTies,
  SLUR_BEGIN_GLYPH,
  SLUR_END_GLYPH,
} from '../src/features/omr/detectVectorTies.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildVisualSpanMarkings } from '../src/features/practice/visualNotationMarkings.js'

const root = process.cwd()
const casesPath = join(root, 'benchmarks/omr-notation-fidelity-validation/cases.json')
const articTruthPath = join(
  root,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml',
)

function loadCases() {
  return JSON.parse(readFileSync(casesPath, 'utf8')).cases
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

function drawShortArc(imageData, fromX, fromY, toX) {
  for (let x = fromX + 8; x <= toX - 8; x += 1) {
    const t = (x - fromX) / Math.max(1, toX - fromX)
    const arcY = fromY + 4 + Math.round(4 * Math.sin(t * Math.PI))
    setInk(imageData, x, arcY)
    setInk(imageData, x, arcY + 1)
  }
}

describe('notation fidelity harness', () => {
  it('ships 20+ real-score cases covering ties/slurs/articulations/confusables', () => {
    const cases = loadCases()
    expect(cases.length).toBeGreaterThanOrEqual(20)
    const kinds = new Set(cases.map((entry) => entry.expectedSymbol))
    expect(kinds.has('tie')).toBe(true)
    expect(kinds.has('slur')).toBe(true)
    expect(kinds.has('staccato')).toBe(true)
    expect(kinds.has('accent')).toBe(true)
    expect(cases.some((entry) => entry.expectAbsent)).toBe(true)
    expect(cases.some((entry) => entry.source === 'minecraft')).toBe(true)
    expect(cases.some((entry) => entry.source === 'evangelion')).toBe(true)
    expect(cases.some((entry) => entry.source === 'gymnopedie')).toBe(true)
    expect(cases.some((entry) => entry.source === 'piano-articulation-scan')).toBe(true)
  })

  it('classifies missing symbols as undetected FN', () => {
    const result = scoreNotationFidelityCase(
      { id: 'x', expectedSymbol: 'staccato', measureNumber: 1, midi: 60 },
      [],
    )
    expect(result.status).toBe('fn')
    expect(result.failureLayer).toBe(NOTATION_FAILURE_LAYER.UNDETECTED)
  })

  it('classifies false ties as wrong-attachment FP when expectAbsent', () => {
    const result = scoreNotationFidelityCase(
      { id: 'x', expectedSymbol: 'tie', expectAbsent: true, measureNumber: 1, midi: 60 },
      [{ kind: 'tie', role: 'start', measureNumber: 1, midi: 60 }],
    )
    expect(result.status).toBe('fp')
    expect(result.failureLayer).toBe(NOTATION_FAILURE_LAYER.WRONG_ATTACHMENT)
  })
})

describe('slur emission (vector)', () => {
  it('emits numbered start/stop slur for different-pitch ink arc', () => {
    const imageData = blankImage(1000, 1000)
    drawShortArc(imageData, 300, 350, 380)
    const measureBox = {
      measureNumber: 1,
      page: 1,
      x0: 0.1,
      playableX0: 0.2,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
    }
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            cx: 300,
            notes: [{ midi: 65, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            cx: 380,
            notes: [{ midi: 67, clef: 'treble', cx: 380, cy: 348 }],
          },
        ],
      },
    ]

    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, measureBox]]),
      glyphs: [],
      imageData,
    })
    expect(result.diagnostics.appliedSlurCount).toBe(1)
    expect(measureRecords[0].events[0].notes[0].slurStart).toBe(true)
    expect(measureRecords[0].events[1].notes[0].slurStop).toBe(true)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBeFalsy()

    const xml = buildOmrMusicXml({
      title: 'slur-test',
      measures: measureRecords.map((record) => ({
        measureNumber: record.measureNumber,
        events: record.events,
      })),
    })
    expect(xml).toMatch(/<slur type="start" number="1"\/>/)
    expect(xml).toMatch(/<slur type="stop" number="1"\/>/)
    expect(xml).not.toMatch(/<tied/)
  })

  it('pairs SMuFL slur glyphs without creating a tie', () => {
    const imageData = blankImage(1000, 1000)
    const measureBox = {
      measureNumber: 1,
      x0: 0.1,
      playableX0: 0.2,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
    }
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            cx: 300,
            notes: [{ midi: 60, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            cx: 400,
            notes: [{ midi: 64, clef: 'treble', cx: 400, cy: 340 }],
          },
        ],
      },
    ]
    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, measureBox]]),
      glyphs: [
        { text: SLUR_BEGIN_GLYPH, x: 305, y: 345 },
        { text: SLUR_END_GLYPH, x: 395, y: 338 },
      ],
      imageData,
    })
    expect(result.diagnostics.appliedSlurCount).toBe(1)
    expect(measureRecords[0].events[0].notes[0].slurStart).toBe(true)
    expect(measureRecords[0].events[1].notes[0].slurStop).toBe(true)
  })

  it('does not apply a tie when the start note is staccato', () => {
    const imageData = blankImage(1000, 1000)
    drawShortArc(imageData, 300, 350, 360)
    const measureBox = {
      measureNumber: 1,
      x0: 0.1,
      playableX0: 0.2,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
    }
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
              {
                midi: 74,
                clef: 'treble',
                cx: 300,
                cy: 350,
                articulation: { type: 'staccato' },
              },
            ],
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
    })
    expect(result.diagnostics.appliedTieCount).toBe(0)
    expect(measureRecords[0].events[0].notes[0].tieStart).toBeFalsy()
  })
})

describe('artic-scan cases vs truth MusicXML (emission oracle)', () => {
  it('truth MusicXML satisfies the automated artic-scan cases', () => {
    const truth = parseMusicXml(readFileSync(articTruthPath, 'utf8'), 'piano-articulation-scan.musicxml')
    const symbols = extractNotationSymbolsFromNotes(truth.notes)
    const cases = loadCases().filter(
      (entry) => entry.source === 'piano-articulation-scan' && entry.status !== 'manual-pending',
    )
    const results = cases.map((entry) => scoreNotationFidelityCase(entry, symbols))
    const summary = summarizeNotationFidelityResults(results)
    // Truth is the oracle — every automated artic-scan case should be correct.
    expect(summary.fn).toBe(0)
    expect(summary.fp).toBe(0)
    expect(summary.correct).toBe(summary.total)
  })
})

describe('renderer layer (visual markings consume MusicXML)', () => {
  it('builds slur spans from parsed slur start/stop without suppressing attacks', () => {
    const xml =
      `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"/></part-list>` +
      `<part id="P1"><measure number="1">` +
      `<note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>` +
      `<notations><slur type="start" number="1"/></notations></note>` +
      `<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>` +
      `<notations><slur type="stop" number="1"/></notations></note>` +
      `</measure></part></score-partwise>`
    const timing = parseMusicXml(xml, 'slur.musicxml')
    const groups = [
      {
        id: 'g0',
        timeSeconds: 0,
        notes: [timing.notes[0]],
      },
      {
        id: 'g1',
        timeSeconds: 0.5,
        notes: [timing.notes[1]],
      },
    ]
    const spans = buildVisualSpanMarkings(groups)
    expect(spans.some((span) => span.kind === 'slur')).toBe(true)
    expect(timing.notes[1].suppressPlaybackAttack).toBeFalsy()
  })
})
