/**
 * OMR Engine V2 Phase 6 — voice-aware serialization shadow solver.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildScoreGraph, SCORE_GRAPH_NODE, summarizeScoreGraph } from '../src/features/omr/scoreGraph.js'
import {
  buildMeasureStaffLaneDiagnostics,
  classifyStaffLaneForNote,
  STAFF_LANE,
  VOICE_ID,
} from '../src/features/omr/scoreGraphStaffLaneDiagnostics.js'
import {
  applyLanePhaseShift,
  detectVoiceSerializationCandidate,
  solveMeasureGraphVoiceSerializationShadow,
  solveScoreGraphVoiceSerializationShadow,
} from '../src/features/omr/scoreGraphVoiceSerializationShadow.js'
import {
  buildVoiceSerializationShadowBenchmarkComparison,
  formatVoiceSerializationShadowMarkdown,
} from '../src/features/omr/omrVoiceSerializationShadowReport.js'
import { extractFixtureMetrics } from '../src/features/omr/omrBenchmarkDashboard.js'
import { validateRhythmShadowPreservation } from '../src/features/omr/scoreGraphRhythmShadowConstraints.js'
import { coalesceSameVoiceChordEvents } from '../src/features/omr/scoreGraphRhythmShadowCoalesce.js'

const denseFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
)

/** Twinkle m10-like late accompaniment + melody pattern (divisions, 4/q). */
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
      (event.notes ?? []).map((note, noteIndex) => ({
        kind: SCORE_GRAPH_NODE.NOTEHEAD,
        eventIndex,
        onsetDivision: event.startDivision,
        durationDivisions: event.durationDivisions,
        midi: note.midi,
        clef: note.clef,
      })),
    ),
  }
}

describe('OMR V2 Phase 6 voice serialization shadow', () => {
  it('classifies staff lanes without hardcoded measure numbers', () => {
    const events = twinkleM10LikeEvents()
    const diag = buildMeasureStaffLaneDiagnostics(events)
    expect(diag.isGrandStaff).toBe(true)
    expect(diag.accompanimentCount).toBeGreaterThan(0)
    const bassG3 = classifyStaffLaneForNote(
      { midi: 55, clef: 'bass' },
      events[0],
      { isGrandStaff: true },
    )
    expect(bassG3.staffLane).toBe(STAFF_LANE.ACCOMPANIMENT)
    expect(bassG3.voiceId).toBe(VOICE_ID.BASS_ACCOMPANIMENT)
  })

  it('populates staff-lane fields on ScoreGraph nodes without mutating events', () => {
    const pages = [
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
                events: twinkleM10LikeEvents(),
              },
            ],
          },
        ],
      },
    ]
    const before = JSON.stringify(pages)
    const graph = buildScoreGraph(pages)
    expect(JSON.stringify(pages)).toBe(before)
    const noteheads = graph.measures[0].nodes.filter((node) => node.kind === SCORE_GRAPH_NODE.NOTEHEAD)
    const accomp = noteheads.filter((node) => node.accompanimentLane)
    expect(accomp.length).toBeGreaterThan(0)
    expect(noteheads[0].voiceId).toBeTruthy()
    expect(summarizeScoreGraph(graph).staffLaneObservation.grandStaffMeasures).toBe(1)
  })

  it('applies grand-staff-late adaptive phase without broad clef shift', () => {
    const events = twinkleM10LikeEvents()
    const shifted = applyLanePhaseShift(events, {
      target: 'grand-staff-late',
      mode: 'adaptive',
      totalDivisions: 16,
      measureContext: { isGrandStaff: true, hasTreble: true, hasBass: true },
    })
    expect(shifted).toBeTruthy()
    const coalesced = coalesceSameVoiceChordEvents(shifted)
    const bassG3 = coalesced.events.find(
      (event) => event.type === 'note' && event.notes?.[0]?.midi === 55,
    )
    expect(bassG3?.startDivision).toBe(2)
    const preservation = validateRhythmShadowPreservation(events, coalesced.events)
    expect(preservation.pass).toBe(true)
  })

  it('detects voice serialization family on Twinkle-like grand-staff measure', () => {
    const events = twinkleM10LikeEvents()
    const graph = twinkleM10LikeGraph()
    const family = detectVoiceSerializationCandidate(graph, events)
    expect(family.isCandidate).toBe(true)
    expect(family.reasons).toContain('accompaniment-lane')
  })

  it('structurally applies lane shift on Twinkle-like measure', () => {
    const solved = solveMeasureGraphVoiceSerializationShadow(twinkleM10LikeGraph())
    expect(solved.applied).toBe(true)
    expect(solved.variantId).toMatch(/grand-staff-late|accompaniment/)
    const bassStarts = solved.events
      .filter((event) => event.type === 'note' && event.notes?.[0]?.clef === 'bass')
      .map((event) => event.startDivision)
      .sort((left, right) => left - right)
    expect(bassStarts[0]).toBeLessThan(4)
  })

  it('does not mutate inputs when solving full score graph shadow', () => {
    const pages = [
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
                events: twinkleM10LikeEvents(),
              },
            ],
          },
        ],
      },
    ]
    const graph = buildScoreGraph(pages)
    const before = JSON.stringify(graph)
    solveScoreGraphVoiceSerializationShadow(graph)
    expect(JSON.stringify(graph)).toBe(before)
  })

  it('reports shadow comparison without promotion', () => {
    const comparison = buildVoiceSerializationShadowBenchmarkComparison({
      report: { generatedOmrDiagnostics: { pages: [] } },
      fixtureId: 'simple',
    })
    expect(comparison.promoted).toBe(false)
    expect(comparison.engine).toBe('v2-voice-serialization-shadow')
    expect(comparison.status).toBe('shadow-only-no-scoregraph')
    const md = formatVoiceSerializationShadowMarkdown(comparison)
    expect(md).toContain('Phase 7')
  })

  it('keeps frozen dense benchmark runtime metrics unchanged', () => {
    const metrics = extractFixtureMetrics(denseFixture)
    expect(metrics.wrongOnset).toBe(94)
    expect(metrics.wrongDuration).toBe(77)
    expect(metrics.chordMismatch).toBe(172)
    expect(metrics.wrongPitch).toBe(147)
  })
})
