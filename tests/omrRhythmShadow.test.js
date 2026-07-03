/**
 * OMR Engine V2 Phase 2 — shadow rhythm/voice serialization solver.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRhythmShadowBenchmarkComparison,
  formatRhythmShadowMarkdown,
} from '../src/features/omr/omrRhythmShadowReport.js'
import { hotspotMeasuresForFixture } from '../src/features/omr/omrHotspotDiagnostics.js'
import {
  detectRhythmVoiceSerializationCandidate,
  solveMeasureGraphRhythmShadow,
  solveScoreGraphRhythmShadow,
  RHYTHM_SOLVER_REJECT,
} from '../src/features/omr/scoreGraphRhythmSolver.js'
import { validateRhythmShadowPreservation } from '../src/features/omr/scoreGraphRhythmShadowConstraints.js'
import {
  coalesceSameVoiceChordEvents,
  eventsMusicallyCompatibleForMerge,
} from '../src/features/omr/scoreGraphRhythmShadowCoalesce.js'
import {
  measurePassesRhythmShadowTruthGate,
} from '../src/features/omr/omrRhythmShadowMeasureGate.js'
import { SCORE_GRAPH_NODE, buildScoreGraph } from '../src/features/omr/scoreGraph.js'
import { formatOmrBenchmarkMarkdown, buildFixtureDashboardRecord, summarizeOmrBenchmarkDashboard } from '../src/features/omr/omrBenchmarkDashboard.js'

const denseFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
)
const simpleFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/simple.json'), 'utf8'),
)

const DENSE_TRUTH = join(process.cwd(), 'tmp/sprint1/gen/dense.xml')
const SIMPLE_TRUTH = join(process.cwd(), 'tmp/sprint1/gen/simple.xml')

function lateBassMeasureGraph() {
  return {
    measureNumber: 42,
    page: 1,
    systemIndex: 0,
    totalDivisions: 16,
    onsetColumns: [{}, {}, {}, {}],
    nodes: [
      {
        kind: SCORE_GRAPH_NODE.NOTEHEAD,
        eventIndex: 0,
        onsetDivision: 0,
        durationDivisions: 4,
        midi: 72,
        clef: 'treble',
      },
      {
        kind: SCORE_GRAPH_NODE.NOTEHEAD,
        eventIndex: 1,
        onsetDivision: 2,
        durationDivisions: 2,
        midi: 48,
        clef: 'bass',
      },
      {
        kind: SCORE_GRAPH_NODE.NOTEHEAD,
        eventIndex: 2,
        onsetDivision: 6,
        durationDivisions: 2,
        midi: 50,
        clef: 'bass',
      },
      {
        kind: SCORE_GRAPH_NODE.NOTEHEAD,
        eventIndex: 3,
        onsetDivision: 10,
        durationDivisions: 2,
        midi: 52,
        clef: 'bass',
      },
    ],
  }
}

describe('OMR V2 Phase 2 rhythm shadow solver', () => {
  it('detects rhythm/voice serialization families without hardcoded measure numbers', () => {
    const graph = lateBassMeasureGraph()
    const events = graph.nodes.map((node) => ({
      type: 'note',
      startDivision: node.onsetDivision,
      durationDivisions: node.durationDivisions,
      notes: [{ midi: node.midi, clef: node.clef }],
    }))
    const family = detectRhythmVoiceSerializationCandidate(graph, events)
    expect(family.isCandidate).toBe(true)
    expect(family.reasons).toContain('grand-staff')
    expect(family.reasons).toContain('bass-late-sixteenth-phase')
  })

  it('applies bass phase shift on synthetic late-bass measure', () => {
    const solved = solveMeasureGraphRhythmShadow(lateBassMeasureGraph())
    expect(solved.applied).toBe(true)
    expect(solved.variantId).toBe('bass-minus-2')
    const bassStarts = solved.events
      .filter((event) => event.type === 'note' && event.notes?.[0]?.clef === 'bass')
      .map((event) => event.startDivision)
    expect(bassStarts).toEqual([0, 4, 8])
  })

  it('leaves non-candidate measures on identity path', () => {
    const graph = {
      measureNumber: 1,
      totalDivisions: 4,
      nodes: [
        {
          kind: SCORE_GRAPH_NODE.NOTEHEAD,
          eventIndex: 0,
          onsetDivision: 0,
          durationDivisions: 4,
          midi: 60,
          clef: 'treble',
        },
      ],
    }
    const solved = solveMeasureGraphRhythmShadow(graph)
    expect(solved.applied).toBe(false)
    expect(solved.rejectReason).toBe('not-in-family')
  })

  it('reports hotspot measure targets for dense and simple fixtures', () => {
    expect(hotspotMeasuresForFixture('dense')).toEqual([7, 9, 121])
    expect(hotspotMeasuresForFixture('simple')).toEqual([10])
  })

  it('reports shadow-only-no-scoregraph when ScoreGraph IR measures are missing', () => {
    const comparison = buildRhythmShadowBenchmarkComparison({
      report: {
        generatedOmrDiagnostics: {
          pages: [{ page: 1, systems: [{ systemIndex: 0, measures: [{ measureNumber: 1 }] }] }],
        },
      },
      fixtureId: 'dense',
    })
    expect(comparison.status).toBe('shadow-only-no-scoregraph')
    expect(comparison.promoted).toBe(false)
  })

  it('compares runtime vs shadow when ScoreGraph IR and truth are provided', () => {
    let truthXml
    try {
      truthXml = readFileSync(DENSE_TRUTH, 'utf8')
    } catch {
      return
    }

    const scoreGraph = buildScoreGraph([
      {
        page: 1,
        systems: [
          {
            systemIndex: 0,
            measures: [
              {
                measureNumber: 1,
                page: 1,
                systemIndex: 0,
                events: [
                  {
                    type: 'note',
                    startDivision: 0,
                    durationDivisions: 4,
                    notes: [{ midi: 60, clef: 'treble' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])

    const comparison = buildRhythmShadowBenchmarkComparison({
      report: denseFixture,
      fixtureId: 'dense',
      groundTruthMusicXml: truthXml,
      scoreGraph,
    })

    expect(comparison.promoted).toBe(false)
    expect(comparison.engine).toBe('v2-rhythm-shadow-prototype')
    expect(comparison.solverDiagnostics).toBeTruthy()
    expect(comparison.hotspotMeasures).toEqual([7, 9, 121])
    expect(['shadow-improved', 'diagnostic-only-regressed', 'diagnostic-only-mixed', 'diagnostic-only', 'shadow-observed', 'shadow-only-no-truth', 'shadow-no-qualifying-measures']).toContain(
      comparison.status,
    )
  })

  it('includes rhythm shadow section in dashboard markdown', () => {
    const comparison = buildRhythmShadowBenchmarkComparison({
      report: {
        generatedOmrDiagnostics: {
          pages: [{ page: 1, systems: [{ systemIndex: 0, measures: [{ measureNumber: 1 }] }] }],
        },
      },
      fixtureId: 'dense',
    })
    const record = buildFixtureDashboardRecord({
      fixture: { id: 'dense', label: 'Dense' },
      report: denseFixture,
    })
    record.rhythmShadow = comparison
    const markdown = formatOmrBenchmarkMarkdown(summarizeOmrBenchmarkDashboard([record]))
    expect(markdown).toContain('Rhythm shadow solver')
    expect(formatRhythmShadowMarkdown(comparison)).toContain('diagnostic only')
  })

  it('runs shadow comparison on simple fixture hotspot m10 when scoreGraph is available', () => {
    let truthXml
    try {
      truthXml = readFileSync(SIMPLE_TRUTH, 'utf8')
    } catch {
      return
    }

    const scoreGraph = buildScoreGraph([
      {
        page: 1,
        systems: [
          {
            systemIndex: 0,
            measures: [
              {
                measureNumber: 10,
                page: 1,
                systemIndex: 0,
                events: [
                  {
                    type: 'note',
                    startDivision: 0,
                    durationDivisions: 4,
                    notes: [{ midi: 60, clef: 'treble' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])

    const comparison = buildRhythmShadowBenchmarkComparison({
      report: simpleFixture,
      fixtureId: 'simple',
      groundTruthMusicXml: truthXml,
      scoreGraph,
    })

    expect(comparison.fixtureId).toBe('simple')
    expect(comparison.hotspotMeasures).toEqual([10])
    expect(comparison.solverDiagnostics.measureCount).toBeGreaterThan(0)
  })

  it('coalesces same-voice same-start events into one chord event', () => {
    const baseline = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        notes: [{ midi: 60, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        notes: [{ midi: 64, clef: 'treble' }],
      },
    ]
    const shifted = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        notes: [{ midi: 60, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        notes: [{ midi: 64, clef: 'treble' }],
      },
    ]
    const coalesced = coalesceSameVoiceChordEvents(shifted)
    expect(coalesced.events).toHaveLength(1)
    expect(coalesced.events[0].notes).toHaveLength(2)
    expect(coalesced.coalescedCount).toBe(1)
    const preserved = validateRhythmShadowPreservation(baseline, coalesced.events)
    expect(preserved.pass).toBe(true)
    expect(eventsMusicallyCompatibleForMerge(shifted[0], shifted[1])).toBe(true)
  })

  it('accepts truth gate only when onset or duration improves without chord/pitch regression', () => {
    const runtime = {
      wrongOnsetCount: 4,
      wrongDurationCount: 1,
      chordMismatchCount: 2,
      wrongPitchCount: 0,
      generatedNoteCount: 10,
    }
    const improved = {
      wrongOnsetCount: 2,
      wrongDurationCount: 1,
      chordMismatchCount: 2,
      wrongPitchCount: 0,
      generatedNoteCount: 10,
    }
    const chordRegression = {
      wrongOnsetCount: 2,
      wrongDurationCount: 1,
      chordMismatchCount: 4,
      wrongPitchCount: 0,
      generatedNoteCount: 10,
    }
    expect(measurePassesRhythmShadowTruthGate(runtime, improved).pass).toBe(true)
    expect(measurePassesRhythmShadowTruthGate(runtime, chordRegression).pass).toBe(false)
  })

  it('rejects variants that create same-voice same-start collisions', () => {
    const baseline = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        notes: [{ midi: 60, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        notes: [{ midi: 64, clef: 'treble' }],
      },
    ]
    const variant = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        notes: [{ midi: 60, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        notes: [{ midi: 64, clef: 'treble' }],
      },
    ]
    const result = validateRhythmShadowPreservation(baseline, variant)
    expect(result.pass).toBe(false)
    expect(result.violations).toContain('same-start-collision')
  })

  it('rejects variants that split a multi-note chord event', () => {
    const baseline = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [
          { midi: 60, clef: 'treble' },
          { midi: 64, clef: 'treble' },
        ],
      },
    ]
    const variant = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [{ midi: 60, clef: 'treble' }],
      },
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 4,
        notes: [{ midi: 64, clef: 'treble' }],
      },
    ]
    const result = validateRhythmShadowPreservation(baseline, variant)
    expect(result.pass).toBe(false)
    expect(result.violations).toContain('chord-split')
  })

  it('coalesces treble phase-shift collisions into chord events when compatible', () => {
    const graph = {
      measureNumber: 9,
      totalDivisions: 16,
      onsetColumns: [{}, {}, {}, {}],
      nodes: [
        {
          kind: SCORE_GRAPH_NODE.NOTEHEAD,
          eventIndex: 0,
          onsetDivision: 0,
          durationDivisions: 2,
          midi: 72,
          clef: 'treble',
        },
        {
          kind: SCORE_GRAPH_NODE.NOTEHEAD,
          eventIndex: 1,
          onsetDivision: 2,
          durationDivisions: 2,
          midi: 60,
          clef: 'treble',
        },
        {
          kind: SCORE_GRAPH_NODE.NOTEHEAD,
          eventIndex: 2,
          onsetDivision: 2,
          durationDivisions: 2,
          midi: 64,
          clef: 'treble',
        },
      ],
    }
    const solved = solveMeasureGraphRhythmShadow(graph)
    expect(solved.applied).toBe(true)
    expect(solved.coalescedCount).toBeGreaterThan(0)
    expect(solved.variantId).not.toBe('identity')
  })

  it('never mutates score graph inputs during shadow solve', () => {
    const graph = {
      measures: [lateBassMeasureGraph()],
    }
    const before = JSON.stringify(graph)
    solveScoreGraphRhythmShadow(graph)
    expect(JSON.stringify(graph)).toBe(before)
  })
})
