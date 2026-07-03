/**
 * OMR Engine V2 Phase 7 — duration-coupled lane shadow solver.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCORE_GRAPH_NODE } from '../src/features/omr/scoreGraph.js'
import {
  buildDurationHintsFromMeasureGraph,
  coupleOverlappingDurations,
} from '../src/features/omr/scoreGraphDurationCoupling.js'
import { validateHardConstraints } from '../src/features/omr/scoreGraphSolver.js'
import {
  validateDurationCoupledPreservation,
  validateRhythmShadowPreservation,
} from '../src/features/omr/scoreGraphRhythmShadowConstraints.js'
import {
  applyDurationCoupledLaneVariant,
  applyLanePhaseShift,
  solveMeasureGraphVoiceSerializationShadow,
  VOICE_SERIALIZATION_DECISION,
} from '../src/features/omr/scoreGraphVoiceSerializationShadow.js'
import { extractFixtureMetrics } from '../src/features/omr/omrBenchmarkDashboard.js'
import { RELEASE_SOURCE, TIE_SUSTAIN_SOURCE } from '../src/features/omr/scoreGraphDurationObservation.js'

const denseFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
)

function twinkleM10LikeEvents() {
  return [
    { type: 'note', startDivision: 4, durationDivisions: 2, notes: [{ midi: 55, clef: 'bass' }] },
    { type: 'note', startDivision: 6, durationDivisions: 2, notes: [{ midi: 57, clef: 'bass' }] },
    { type: 'note', startDivision: 6, durationDivisions: 5, notes: [{ midi: 69, clef: 'treble' }] },
    { type: 'note', startDivision: 9, durationDivisions: 2, notes: [{ midi: 59, clef: 'bass' }] },
    { type: 'note', startDivision: 11, durationDivisions: 5, notes: [{ midi: 60, clef: 'bass' }] },
    { type: 'note', startDivision: 11, durationDivisions: 5, notes: [{ midi: 67, clef: 'treble' }] },
  ]
}

function twinkleM10LikeGraph() {
  return {
    measureNumber: 10,
    page: 1,
    systemIndex: 0,
    totalDivisions: 16,
    onsetColumns: [{}, {}, {}, {}],
    nodes: twinkleM10LikeEvents().flatMap((event, eventIndex) =>
      (event.notes ?? []).map((note) => ({
        kind: SCORE_GRAPH_NODE.NOTEHEAD,
        eventIndex,
        onsetDivision: event.startDivision,
        durationDivisions: event.durationDivisions,
        writtenDurationDivisions: event.durationDivisions,
        soundingReleaseDivision: (event.startDivision ?? 0) + (event.durationDivisions ?? 0),
        durationSource: 'stem-tail',
        releaseSource: RELEASE_SOURCE.GAP_TO_NEXT_ONSET,
        gapToNextOnset: 2,
        midi: note.midi,
        clef: note.clef,
      })),
    ),
  }
}

/** Voice overlap after onset shift — duration coupling should clear hard constraints. */
function overlapAfterShiftEvents() {
  return [
    { type: 'note', startDivision: 0, durationDivisions: 4, notes: [{ midi: 55, clef: 'bass' }] },
    { type: 'note', startDivision: 2, durationDivisions: 6, notes: [{ midi: 57, clef: 'bass' }] },
    { type: 'note', startDivision: 6, durationDivisions: 4, notes: [{ midi: 59, clef: 'bass' }] },
  ]
}

describe('OMR V2 Phase 7 duration-coupled lane shadow', () => {
  it('reads Phase 3 duration hints from measure graph nodes', () => {
    const hints = buildDurationHintsFromMeasureGraph(twinkleM10LikeGraph())
    const g3 = hints.get('55|bass')
    expect(g3?.writtenDurationDivisions).toBe(2)
    expect(g3?.releaseSource).toBe(RELEASE_SOURCE.GAP_TO_NEXT_ONSET)
    expect(g3?.gapToNextOnset).toBe(2)
  })

  it('shortens overlapping durations per voice without lengthening', () => {
    const coupled = coupleOverlappingDurations(overlapAfterShiftEvents(), 16)
    expect(coupled).toBeTruthy()
    const bass = coupled.filter((event) => event.notes?.[0]?.clef === 'bass')
    expect(bass[0].durationDivisions).toBe(2)
    expect(bass[1].durationDivisions).toBe(4)
    const constraints = validateHardConstraints(coupled, 16)
    expect(constraints.pass).toBe(true)
  })

  it('respects tie sustain floor when shortening', () => {
    const events = [
      { type: 'note', startDivision: 0, durationDivisions: 8, notes: [{ midi: 60, clef: 'treble' }] },
      { type: 'note', startDivision: 4, durationDivisions: 4, notes: [{ midi: 62, clef: 'treble' }] },
    ]
    const measureGraph = {
      nodes: [
        {
          kind: SCORE_GRAPH_NODE.NOTEHEAD,
          midi: 60,
          clef: 'treble',
          writtenDurationDivisions: 6,
          tieSustainSource: TIE_SUSTAIN_SOURCE.TIE_START,
          releaseSource: RELEASE_SOURCE.TIE_SUSTAIN,
        },
      ],
    }
    const coupled = coupleOverlappingDurations(events, 16, { measureGraph })
    const first = coupled.find((event) => event.notes?.[0]?.midi === 60)
    expect(first.durationDivisions).toBeGreaterThanOrEqual(6)
  })

  it('applyDurationCoupledLaneVariant passes duration-coupled preservation', () => {
    const events = twinkleM10LikeEvents()
    const built = applyDurationCoupledLaneVariant(events, {
      target: 'grand-staff-late',
      mode: 'adaptive',
      totalDivisions: 16,
      measureContext: { isGrandStaff: true, hasTreble: true, hasBass: true },
      measureGraph: twinkleM10LikeGraph(),
    })
    expect(built).toBeTruthy()
    const preservation = validateDurationCoupledPreservation(events, built.events)
    expect(preservation.pass).toBe(true)
    const constraints = validateHardConstraints(built.events, 16)
    expect(constraints.pass).toBe(true)
  })

  it('onset-only shift without coupling can fail hard constraints when durations overlap', () => {
    const baseline = twinkleM10LikeEvents()
    const shifted = applyLanePhaseShift(baseline, {
      target: 'grand-staff-late',
      mode: 'uniform',
      uniformDelta: -3,
      totalDivisions: 16,
      measureContext: { isGrandStaff: true, hasTreble: true, hasBass: true },
    })
    expect(shifted).toBeTruthy()
    const uncoupledConstraints = validateHardConstraints(shifted, 16)
    const coupled = coupleOverlappingDurations(shifted, 16, {
      measureGraph: twinkleM10LikeGraph(),
    })
    const coupledConstraints = validateHardConstraints(coupled, 16)
    if (!uncoupledConstraints.pass) {
      expect(coupledConstraints.pass).toBe(true)
    }
  })

  it('structurally applies duration-coupled lane shift on Twinkle-like m10', () => {
    const solved = solveMeasureGraphVoiceSerializationShadow(twinkleM10LikeGraph())
    expect(solved.applied).toBe(true)
    expect(solved.variantId).toMatch(/coupled|grand-staff-late|accompaniment/)
    if (solved.durationCoupled) {
      expect(solved.decision).toBe(VOICE_SERIALIZATION_DECISION.DURATION_COUPLED_LANE_SHIFT)
    }
    const preservation = validateRhythmShadowPreservation(twinkleM10LikeEvents(), solved.events)
    expect(preservation.pass).toBe(false)
    const coupledPreservation = validateDurationCoupledPreservation(
      twinkleM10LikeEvents(),
      solved.events,
    )
    expect(coupledPreservation.pass).toBe(true)
  })

  it('keeps frozen dense benchmark runtime metrics unchanged', () => {
    const metrics = extractFixtureMetrics(denseFixture)
    expect(metrics.wrongOnset).toBe(94)
    expect(metrics.wrongDuration).toBe(77)
    expect(metrics.chordMismatch).toBe(172)
    expect(metrics.wrongPitch).toBe(147)
  })
})
