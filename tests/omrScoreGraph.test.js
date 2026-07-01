import { describe, expect, it } from 'vitest'
import {
  SCORE_GRAPH_NODE,
  SCORE_GRAPH_EDGE,
  buildMeasureGraph,
  buildScoreGraph,
  summarizeScoreGraph,
  buildRuntimeVsScoreGraphReport,
} from '../src/features/omr/scoreGraph.js'
import { buildOmrDiagnostics } from '../src/features/omr/buildOmrDiagnostics.js'

// A representative vector measure: a two-note treble chord, a rest, then a bass
// note with an accidental + tie, plus the beam/stem graph the runtime already
// attaches. Not a fixture of any real score — just the shapes the pipeline emits.
function sampleMeasure() {
  return {
    measureNumber: 1,
    page: 1,
    systemIndex: 0,
    events: [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        dotted: false,
        confidence: 0.9,
        notes: [
          { midi: 60, clef: 'treble', cx: 100, cy: 50 },
          { midi: 64, clef: 'treble', cx: 100, cy: 42 },
        ],
      },
      { type: 'rest', startDivision: 4, durationDivisions: 4 },
      {
        type: 'note',
        startDivision: 8,
        durationDivisions: 8,
        dotted: false,
        confidence: 0.85,
        notes: [
          {
            midi: 49,
            clef: 'bass',
            cx: 180,
            cy: 90,
            accidental: { type: 'sharp', alter: 1 },
            tieStart: true,
          },
        ],
      },
    ],
    beamStemGraph: {
      measureBounds: { x0: 80, x1: 260, y0: 20, y1: 120 },
      noteheads: [
        { id: 'h1', cx: 100, cy: 50, attachedStemIds: ['s1'] },
        { id: 'h2', cx: 180, cy: 90, attachedStemIds: ['s2'] },
      ],
      stems: [
        { id: 's1', direction: 'up', noteheadIds: ['h1'] },
        { id: 's2', direction: 'down', noteheadIds: ['h2'] },
      ],
      beams: [{ id: 'beam-1', attachedStemIds: ['s1'] }],
    },
  }
}

function pagesFrom(measure) {
  return [{ page: 1, systems: [{ systemIndex: 0, confidence: 0.8, measures: [measure] }] }]
}

function nodesOfKind(graph, kind) {
  return graph.nodes.filter((node) => node.kind === kind)
}

function edgesOfKind(graph, kind) {
  return graph.edges.filter((edge) => edge.kind === kind)
}

describe('ScoreGraph IR — measure graph', () => {
  it('derives noteheads/rests/accidentals from events and stems/beams from the graph', () => {
    const graph = buildMeasureGraph(sampleMeasure())
    expect(nodesOfKind(graph, SCORE_GRAPH_NODE.NOTEHEAD)).toHaveLength(3)
    expect(nodesOfKind(graph, SCORE_GRAPH_NODE.REST)).toHaveLength(1)
    expect(nodesOfKind(graph, SCORE_GRAPH_NODE.STEM)).toHaveLength(2)
    expect(nodesOfKind(graph, SCORE_GRAPH_NODE.BEAM)).toHaveLength(1)
    expect(nodesOfKind(graph, SCORE_GRAPH_NODE.ACCIDENTAL)).toHaveLength(1)
    // noteheads carry musical attributes from the runtime events
    const bass = nodesOfKind(graph, SCORE_GRAPH_NODE.NOTEHEAD).find((n) => n.clef === 'bass')
    expect(bass.voice).toBe(2)
    expect(bass.onsetDivision).toBe(8)
    expect(bass.pitch).toMatchObject({ step: 'C', alter: 1 })
  })

  it('emits chord, voice, tie, beam and stem-ownership edges', () => {
    const graph = buildMeasureGraph(sampleMeasure())
    expect(edgesOfKind(graph, SCORE_GRAPH_EDGE.HEAD_IN_CHORD)).toHaveLength(1)
    expect(edgesOfKind(graph, SCORE_GRAPH_EDGE.NOTE_IN_VOICE)).toHaveLength(3)
    expect(edgesOfKind(graph, SCORE_GRAPH_EDGE.TIE_LINKS)).toHaveLength(1)
    expect(edgesOfKind(graph, SCORE_GRAPH_EDGE.BEAM_LINKS_STEM)).toHaveLength(1)
    expect(edgesOfKind(graph, SCORE_GRAPH_EDGE.STEM_OWNS_HEAD)).toHaveLength(2)
  })

  it('bridges beam/stem geometry to the musical noteheads by position', () => {
    const graph = buildMeasureGraph(sampleMeasure())
    expect(graph.provenance.hasBeamStemGraph).toBe(true)
    expect(graph.provenance.geometryBridge).toEqual({ matched: 2, total: 2 })
    expect(edgesOfKind(graph, SCORE_GRAPH_EDGE.HEAD_GEOMETRY_LINK)).toHaveLength(2)
    // onset columns exclude rests: two note onsets (0 and 8)
    expect(graph.onsetColumns).toHaveLength(2)
  })

  it('degrades gracefully with no beam/stem graph (raster-style measure)', () => {
    const measure = sampleMeasure()
    delete measure.beamStemGraph
    const graph = buildMeasureGraph(measure)
    expect(nodesOfKind(graph, SCORE_GRAPH_NODE.NOTEHEAD)).toHaveLength(3)
    expect(nodesOfKind(graph, SCORE_GRAPH_NODE.STEM)).toHaveLength(0)
    expect(graph.provenance.hasBeamStemGraph).toBe(false)
  })
})

describe('ScoreGraph IR — summary + runtime parity', () => {
  it('summarizes node/edge counts and bridge coverage', () => {
    const scoreGraph = buildScoreGraph(pagesFrom(sampleMeasure()))
    const summary = summarizeScoreGraph(scoreGraph)
    expect(summary.measureCount).toBe(1)
    expect(summary.nodeCounts[SCORE_GRAPH_NODE.NOTEHEAD]).toBe(3)
    expect(summary.geometryBridge).toEqual({ matched: 2, total: 2, coverage: 1 })
  })

  it('mirrors runtime events exactly (parity holds by construction)', () => {
    const pages = pagesFrom(sampleMeasure())
    const report = buildRuntimeVsScoreGraphReport(pages)
    expect(report.runtime.noteCount).toBe(3)
    expect(report.runtime.restCount).toBe(1)
    expect(report.scoreGraph.noteheadNodes).toBe(3)
    expect(report.parity).toEqual({ noteheads: true, rests: true })
  })
})

describe('ScoreGraph IR is observation-only (byte-identical guarantee)', () => {
  it('does not mutate the measure/pages it reads', () => {
    const pages = pagesFrom(sampleMeasure())
    const before = JSON.stringify(pages)
    buildScoreGraph(pages)
    summarizeScoreGraph(buildScoreGraph(pages))
    buildRuntimeVsScoreGraphReport(pages)
    buildMeasureGraph(pages[0].systems[0].measures[0])
    expect(JSON.stringify(pages)).toBe(before)
  })

  it('buildOmrDiagnostics adds ScoreGraph diagnostics without mutating inputs', () => {
    const pages = pagesFrom(sampleMeasure())
    const before = JSON.stringify(pages)
    const diagnostics = buildOmrDiagnostics({ pages, totalMeasures: 1 })
    // additive diagnostics present
    expect(diagnostics.scoreGraph.totalNodes).toBe(8)
    expect(diagnostics.runtimeVsScoreGraph.parity.noteheads).toBe(true)
    // pre-existing diagnostics still present
    expect(diagnostics).toHaveProperty('beamStemReconstruction')
    expect(diagnostics).toHaveProperty('musicalEventReconstruction')
    // inputs untouched
    expect(JSON.stringify(pages)).toBe(before)
  })
})
