import { describe, expect, it } from 'vitest'
import { buildScoreGraph } from '../src/features/omr/scoreGraph.js'
import {
  reconstructMeasuresFromScoreGraph,
  emitMusicXmlFromScoreGraph,
  compareRuntimeVsShadow,
  evaluateShadowAgreement,
  buildScoreGraphShadowReport,
} from '../src/features/omr/scoreGraphEmit.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { buildOmrDiagnostics } from '../src/features/omr/buildOmrDiagnostics.js'

// A small multi-measure vector score: a treble chord, a rest, a bass note, then
// a second measure with two treble quarters. Shapes the pipeline emits, not a
// fixture of any real piece.
function sampleMeasures() {
  return [
    {
      measureNumber: 1,
      page: 1,
      systemIndex: 0,
      events: [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [
            { midi: 60, clef: 'treble', cx: 100, cy: 50 },
            { midi: 64, clef: 'treble', cx: 100, cy: 42 },
          ],
        },
        { type: 'rest', startDivision: 4, durationDivisions: 4, durationType: 'quarter', clef: 'treble' },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 8,
          durationType: 'half',
          notes: [{ midi: 47, clef: 'bass', cx: 180, cy: 90 }],
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
          durationDivisions: 8,
          durationType: 'half',
          notes: [{ midi: 67, clef: 'treble', cx: 100, cy: 40 }],
        },
        {
          type: 'note',
          startDivision: 8,
          durationDivisions: 8,
          durationType: 'half',
          notes: [{ midi: 69, clef: 'treble', cx: 160, cy: 38 }],
        },
      ],
    },
  ]
}

function pagesFrom(measures) {
  return [{ page: 1, systems: [{ systemIndex: 0, confidence: 0.8, measures }] }]
}

describe('ScoreGraph shadow emitter', () => {
  it('reconstructs the same events the IR came from', () => {
    const measures = sampleMeasures()
    const graph = buildScoreGraph(pagesFrom(measures))
    const rebuilt = reconstructMeasuresFromScoreGraph(graph)
    expect(rebuilt).toHaveLength(2)
    expect(rebuilt[0].events).toHaveLength(3)
    const chord = rebuilt[0].events.find((e) => e.type === 'note' && e.notes.length === 2)
    expect(chord.notes.map((n) => n.midi).sort()).toEqual([60, 64])
    expect(rebuilt[0].events.some((e) => e.type === 'rest')).toBe(true)
  })

  it('emits valid MusicXML that round-trips to the runtime serializer output', () => {
    const measures = sampleMeasures()
    const runtimeXml = buildOmrMusicXml({ title: 't', measures, musical: {} })
    const graph = buildScoreGraph(pagesFrom(measures))
    const shadowXml = emitMusicXmlFromScoreGraph(graph, { musical: {}, title: 't' })

    const comparison = compareRuntimeVsShadow(runtimeXml, shadowXml)
    expect(comparison.noteCountDiff).toBe(0)
    expect(comparison.measureCountDiff).toBe(0)

    const agreement = evaluateShadowAgreement(shadowXml, runtimeXml)
    expect(agreement.pitch).toBe(1)
    expect(agreement.onset).toBe(1)
    expect(agreement.duration).toBe(1)
    expect(agreement.chord).toBe(1)
  })

  it('builds a shadow report with structural diff and agreement', () => {
    const measures = sampleMeasures()
    const runtimeXml = buildOmrMusicXml({ title: 't', measures, musical: {} })
    const graph = buildScoreGraph(pagesFrom(measures))
    const shadowXml = emitMusicXmlFromScoreGraph(graph, { musical: {}, title: 't' })
    const report = buildScoreGraphShadowReport({ id: 'demo', runtimeXml, shadowXml, truthXml: runtimeXml })
    expect(report.comparison.runtime.noteCount).toBe(5)
    expect(report.comparison.shadow.noteCount).toBe(5)
    // shadow vs truth should equal runtime vs truth when truth == runtime
    expect(report.vsTruth.delta.pitch).toBe(0)
    expect(report.vsTruth.delta.duration).toBe(0)
  })
})

describe('shadow path does not affect runtime output', () => {
  it('full IR is exposed only when explicitly requested', () => {
    const pages = pagesFrom(sampleMeasures())
    const off = buildOmrDiagnostics({ pages })
    const on = buildOmrDiagnostics({ pages, includeScoreGraph: true })
    expect(off).not.toHaveProperty('scoreGraphFull')
    expect(on).toHaveProperty('scoreGraphFull')
    // summary + parity are always present (Phase 1), unchanged by the flag
    expect(off.scoreGraph.totalNodes).toBeGreaterThan(0)
    expect(on.runtimeVsScoreGraph.parity.noteheads).toBe(true)
  })

  it('emitting shadow XML does not mutate the ScoreGraph or the pages', () => {
    const pages = pagesFrom(sampleMeasures())
    const before = JSON.stringify(pages)
    const graph = buildScoreGraph(pages)
    const graphBefore = JSON.stringify(graph)
    emitMusicXmlFromScoreGraph(graph, { musical: {} })
    reconstructMeasuresFromScoreGraph(graph)
    expect(JSON.stringify(graph)).toBe(graphBefore)
    expect(JSON.stringify(pages)).toBe(before)
  })
})
