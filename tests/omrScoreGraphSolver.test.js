import { describe, expect, it } from 'vitest'
import { buildScoreGraph } from '../src/features/omr/scoreGraph.js'
import { reconstructMeasureEvents, emitMusicXmlFromScoreGraph } from '../src/features/omr/scoreGraphEmit.js'
import {
  solveMeasureGraph,
  solveScoreGraph,
  validateHardConstraints,
  detectCandidateFamily,
  clipHardConstraintViolations,
  promoteClipDecisions,
  promoteMeasureRhythmsWithClips,
  emitMusicXmlFromSolver,
  buildSolverShadowReport,
  SOLVER_FALLBACK,
  SOLVER_DECISION,
} from '../src/features/omr/scoreGraphSolver.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'

// A clean, budget-tiling measure: four treble quarters. No beams.
function tilingMeasure() {
  return {
    measureNumber: 1,
    page: 1,
    systemIndex: 0,
    events: [0, 4, 8, 12].map((start, index) => ({
      type: 'note',
      startDivision: start,
      durationDivisions: 4,
      durationType: 'quarter',
      notes: [{ midi: 60 + index, clef: 'treble', cx: 20 + start * 4, cy: 50 }],
    })),
  }
}

// A mixed beam/stem ownership measure: at onset 0, a beamed eighth (moving) shares
// the column with an un-beamed sustained half in the other staff.
function mixedOwnershipMeasure() {
  return {
    measureNumber: 2,
    page: 1,
    systemIndex: 0,
    events: [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 72, clef: 'treble', cx: 100, cy: 40 }],
      },
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 8,
        durationType: 'half',
        notes: [{ midi: 48, clef: 'bass', cx: 100, cy: 92 }],
      },
      {
        type: 'note',
        startDivision: 2,
        durationDivisions: 2,
        durationType: 'eighth',
        notes: [{ midi: 74, clef: 'treble', cx: 130, cy: 38 }],
      },
    ],
    beamStemGraph: {
      measureBounds: { x0: 80, x1: 200, y0: 20, y1: 120 },
      noteheads: [
        { id: 'h1', cx: 100, cy: 40, attachedStemIds: ['s1'] },
        { id: 'h3', cx: 130, cy: 38, attachedStemIds: ['s3'] },
      ],
      stems: [
        { id: 's1', noteheadIds: ['h1'] },
        { id: 's3', noteheadIds: ['h3'] },
      ],
      beams: [{ id: 'beam-1', attachedStemIds: ['s1', 's3'] }],
    },
  }
}

function pagesFrom(measures) {
  return [{ page: 1, systems: [{ systemIndex: 0, confidence: 0.8, measures }] }]
}

describe('solver skeleton is identity in 3A', () => {
  it('returns exactly the reconstructed runtime events, with an identity fallback reason', () => {
    const graph = buildScoreGraph(pagesFrom([tilingMeasure()]))
    const measureGraph = graph.measures[0]
    const result = solveMeasureGraph(measureGraph)
    expect(result.events).toEqual(reconstructMeasureEvents(measureGraph))
    expect(result.fallbackReason).toBe(SOLVER_FALLBACK.IDENTITY_BASELINE)
    expect(result.confidence).toBe(1)
    expect(result.margin).toBe(0)
  })

  it('emits MusicXML byte-identical to the runtime serializer and the IR emitter', () => {
    const measures = [tilingMeasure()]
    const runtimeXml = buildOmrMusicXml({ title: 't', measures, musical: {} })
    const graph = buildScoreGraph(pagesFrom(measures))
    const solverXml = emitMusicXmlFromSolver(graph, { musical: {}, title: 't' })
    const irXml = emitMusicXmlFromScoreGraph(graph, { musical: {}, title: 't' })
    expect(solverXml).toBe(runtimeXml)
    expect(solverXml).toBe(irXml)
  })

  it('does not mutate the ScoreGraph', () => {
    const graph = buildScoreGraph(pagesFrom([mixedOwnershipMeasure()]))
    const before = JSON.stringify(graph)
    solveScoreGraph(graph)
    emitMusicXmlFromSolver(graph, { musical: {} })
    expect(JSON.stringify(graph)).toBe(before)
  })
})

describe('hard-constraint validation (diagnostic only)', () => {
  it('passes a budget-tiling measure', () => {
    const events = tilingMeasure().events
    const hc = validateHardConstraints(events, 16)
    expect(hc.pass).toBe(true)
    expect(hc.violations).toHaveLength(0)
  })

  it('flags an event that overflows the measure budget', () => {
    const events = [{ type: 'note', startDivision: 12, durationDivisions: 8, notes: [{ midi: 60, clef: 'treble' }] }]
    const hc = validateHardConstraints(events, 16)
    expect(hc.pass).toBe(false)
    expect(hc.violations.some((v) => v.type === 'overflow')).toBe(true)
  })

  it('flags same-voice overlap', () => {
    const events = [
      { type: 'note', startDivision: 0, durationDivisions: 8, notes: [{ midi: 60, clef: 'treble' }] },
      { type: 'note', startDivision: 4, durationDivisions: 8, notes: [{ midi: 62, clef: 'treble' }] },
    ]
    const hc = validateHardConstraints(events, 16)
    expect(hc.violations.some((v) => v.type === 'voice-overlap')).toBe(true)
  })
})

describe('candidate-family detection (does not alter events)', () => {
  it('flags mixed beam/stem ownership columns', () => {
    const graph = buildScoreGraph(pagesFrom([mixedOwnershipMeasure()]))
    const measureGraph = graph.measures[0]
    const family = detectCandidateFamily(measureGraph, {
      events: reconstructMeasureEvents(measureGraph),
    })
    expect(family.isCandidate).toBe(true)
    expect(family.reasons).toContain('mixed-beam-ownership-column')
  })

  it('does not flag a clean tiling measure', () => {
    const graph = buildScoreGraph(pagesFrom([tilingMeasure()]))
    const measureGraph = graph.measures[0]
    const family = detectCandidateFamily(measureGraph, {
      events: reconstructMeasureEvents(measureGraph),
    })
    expect(family.isCandidate).toBe(false)
  })

  it('summarizes candidate measures across the score', () => {
    const graph = buildScoreGraph(pagesFrom([tilingMeasure(), mixedOwnershipMeasure()]))
    const solved = solveScoreGraph(graph)
    expect(solved.summary.measureCount).toBe(2)
    expect(solved.summary.candidateMeasures).toBe(1)
    expect(solved.summary.candidateMeasureNumbers).toEqual([2])
  })
})

// Same-voice overlap: a half at beat 0 runs over a quarter at beat 1.
function overlapMeasure() {
  return {
    measureNumber: 3,
    page: 1,
    systemIndex: 0,
    events: [
      { type: 'note', startDivision: 0, durationDivisions: 8, durationType: 'half', notes: [{ midi: 60, clef: 'treble', cx: 20, cy: 50 }] },
      { type: 'note', startDivision: 4, durationDivisions: 4, durationType: 'quarter', notes: [{ midi: 62, clef: 'treble', cx: 60, cy: 48 }] },
    ],
  }
}

// Measure overflow: a final note runs past the barline.
function overflowMeasure() {
  return {
    measureNumber: 4,
    page: 1,
    systemIndex: 0,
    events: [
      { type: 'note', startDivision: 0, durationDivisions: 4, durationType: 'quarter', notes: [{ midi: 60, clef: 'treble', cx: 20, cy: 50 }] },
      { type: 'note', startDivision: 12, durationDivisions: 8, durationType: 'half', notes: [{ midi: 64, clef: 'treble', cx: 120, cy: 44 }] },
    ],
  }
}

// Overlap whose clip target (5 divisions) is not a clean note value → ambiguous.
function ambiguousMeasure() {
  return {
    measureNumber: 5,
    page: 1,
    systemIndex: 0,
    events: [
      { type: 'note', startDivision: 0, durationDivisions: 8, durationType: 'half', notes: [{ midi: 60, clef: 'treble', cx: 20, cy: 50 }] },
      { type: 'note', startDivision: 5, durationDivisions: 4, notes: [{ midi: 62, clef: 'treble', cx: 70, cy: 48 }] },
    ],
  }
}

describe('hard-constraint clip solver (3B, shadow only)', () => {
  it('clips a same-voice overlap to the next onset', () => {
    const graph = buildScoreGraph(pagesFrom([overlapMeasure()]))
    const result = solveMeasureGraph(graph.measures[0])
    expect(result.applied).toBe(true)
    expect(result.decision).toBe(SOLVER_DECISION.CLIP)
    expect(result.decisions[0]).toMatchObject({ violation: 'same-voice-overlap', before: 8, after: 4 })
    expect(result.hardConstraints.pass).toBe(true)
    // the clipped note now ends at the next onset
    const first = result.events.find((e) => e.startDivision === 0)
    expect(first.durationDivisions).toBe(4)
  })

  it('clips a measure overflow to the budget', () => {
    const graph = buildScoreGraph(pagesFrom([overflowMeasure()]), { totalDivisions: 16 })
    const result = solveMeasureGraph(graph.measures[0])
    expect(result.applied).toBe(true)
    expect(result.decisions[0]).toMatchObject({ violation: 'overflow', before: 8, after: 4 })
    const last = result.events.find((e) => e.startDivision === 12)
    expect(last.durationDivisions).toBe(4)
  })

  it('falls back to identity when the clip target is not a clean note value', () => {
    const graph = buildScoreGraph(pagesFrom([ambiguousMeasure()]))
    const result = solveMeasureGraph(graph.measures[0])
    expect(result.applied).toBe(false)
    expect(result.fallbackReason).toBe(SOLVER_FALLBACK.AMBIGUOUS_CULPRIT)
    const first = result.events.find((e) => e.startDivision === 0)
    expect(first.durationDivisions).toBe(8) // unchanged
  })

  it('changes only the violating measure, leaving clean measures identical', () => {
    const graph = buildScoreGraph(pagesFrom([tilingMeasure(), overlapMeasure()]))
    const solved = solveScoreGraph(graph)
    expect(solved.summary.changedMeasureNumbers).toEqual([3])
    // clean measure 1 is untouched
    const clean = solved.measures.find((m) => m.measureNumber === 1)
    expect(clean.applied).toBe(false)
    expect(clean.decision).toBe(SOLVER_DECISION.IDENTITY)
  })

  it('clip helper never mutates its input events', () => {
    const events = overlapMeasure().events
    const before = JSON.stringify(events)
    clipHardConstraintViolations(events, 16)
    expect(JSON.stringify(events)).toBe(before)
  })

  it('reports an evaluator delta vs truth when a truth XML is supplied', () => {
    const graph = buildScoreGraph(pagesFrom([overlapMeasure()]))
    // use runtime XML as a stand-in "truth" so the harness path is exercised
    const runtimeXml = emitMusicXmlFromScoreGraph(graph, { musical: {} })
    const report = buildSolverShadowReport({ id: 'demo', runtimeXml, scoreGraph: graph, musical: {}, truthXml: runtimeXml })
    expect(report.changedMeasures).toEqual([3])
    expect(report.vsTruth).toBeTruthy()
    expect(report.vsTruth.delta).toHaveProperty('duration')
  })
})

describe('ScoreGraph clip promotion (3C, gated helper)', () => {
  it('promotes only high-confidence clip decisions and preserves note/measure/onset invariants', () => {
    const measures = [tilingMeasure(), overlapMeasure(), ambiguousMeasure()]
    const graph = buildScoreGraph(pagesFrom(measures), { totalDivisions: 16 })
    const solved = solveScoreGraph(graph)
    const promoted = promoteClipDecisions(measures, solved.measures, { minConfidence: 0.9 })

    expect(promoted.promotedMeasureNumbers).toEqual([3])
    expect(promoted.summary).toMatchObject({
      promotedMeasureCount: 1,
      promotedDecisions: 1,
      skippedCount: 0,
    })

    expect(promoted.measures).toHaveLength(measures.length)
    expect(promoted.measures.map((measure) => measure.measureNumber)).toEqual(
      measures.map((measure) => measure.measureNumber),
    )
    expect(promoted.measures.flatMap((measure) => measure.events).map((event) => event.startDivision)).toEqual(
      measures.flatMap((measure) => measure.events).map((event) => event.startDivision),
    )
    expect(
      promoted.measures
        .flatMap((measure) => measure.events)
        .filter((event) => event.type === 'note')
        .reduce((sum, event) => sum + (event.notes?.length ?? 0), 0),
    ).toBe(
      measures
        .flatMap((measure) => measure.events)
        .filter((event) => event.type === 'note')
        .reduce((sum, event) => sum + (event.notes?.length ?? 0), 0),
    )

    const clean = promoted.measures.find((measure) => measure.measureNumber === 1)
    const clipped = promoted.measures.find((measure) => measure.measureNumber === 3)
    const ambiguous = promoted.measures.find((measure) => measure.measureNumber === 5)
    expect(clean).toBe(measures[0])
    expect(ambiguous).toBe(measures[2])
    expect(clipped).not.toBe(measures[1])
    expect(clipped.events[0]).toMatchObject({
      startDivision: 0,
      durationDivisions: 4,
    })
    expect(clipped.events[0].notes).toBe(measures[1].events[0].notes)
    expect(clipped.events[1]).toBe(measures[1].events[1])
  })

  it('leaves scores with no hard-constraint violation unchanged by reference', () => {
    const measures = [tilingMeasure()]
    const promoted = promoteMeasureRhythmsWithClips(measures, {
      totalDivisions: 16,
      minConfidence: 0.9,
    })

    expect(promoted.promotedMeasureNumbers).toEqual([])
    expect(promoted.summary.promotedDecisions).toBe(0)
    expect(promoted.measures[0]).toBe(measures[0])
  })

  it('does not promote low-confidence or ambiguous event matches', () => {
    const measures = [overlapMeasure()]
    const solverMeasures = [
      {
        measureNumber: 3,
        applied: true,
        confidence: 0.89,
        decisions: [{ voice: 1, startDivision: 0, violation: 'same-voice-overlap', before: 8, after: 4 }],
      },
    ]
    const lowConfidence = promoteClipDecisions(measures, solverMeasures, { minConfidence: 0.9 })
    expect(lowConfidence.promotedMeasureNumbers).toEqual([])
    expect(lowConfidence.measures[0]).toBe(measures[0])

    const ambiguousMeasureRecord = {
      ...overlapMeasure(),
      events: [
        ...overlapMeasure().events,
        { type: 'note', startDivision: 0, durationDivisions: 4, notes: [{ midi: 65, clef: 'treble' }] },
      ],
    }
    const ambiguous = promoteClipDecisions([ambiguousMeasureRecord], [{ ...solverMeasures[0], confidence: 0.9 }])
    expect(ambiguous.promotedMeasureNumbers).toEqual([])
    expect(ambiguous.summary.skippedCount).toBe(1)
    expect(ambiguous.measures[0]).toBe(ambiguousMeasureRecord)
  })
})
