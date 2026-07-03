/**
 * OMR Engine V2 Phase 4 — tie & sustain constraint diagnostics.
 * Diagnostic/shadow only: proves the classifiers never mutate their inputs and
 * that frozen benchmark metrics stay unchanged.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildScoreGraph } from '../src/features/omr/scoreGraph.js'
import { extractFixtureMetrics } from '../src/features/omr/omrBenchmarkDashboard.js'
import {
  buildTieSustainConstraintDiagnostics,
  classifyBrokenTieContinuations,
  classifyExpectedCrossMeasureTies,
  classifyTieGlyphOrphans,
  classifyWrittenCorrectSustainWrong,
  traceScoreGraphTieChains,
  TIE_SUSTAIN_CONSTRAINT,
} from '../src/features/omr/omrTieSustainConstraintDiagnostics.js'

const denseFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
)

function tiedPages() {
  const events = [
    {
      type: 'note',
      startDivision: 0,
      durationDivisions: 8,
      notes: [{ midi: 60, clef: 'treble', tieStart: true }],
    },
    {
      type: 'note',
      startDivision: 8,
      durationDivisions: 8,
      notes: [{ midi: 60, clef: 'treble', tieStop: true }],
    },
    {
      type: 'note',
      startDivision: 0,
      durationDivisions: 16,
      notes: [{ midi: 48, clef: 'bass' }],
    },
  ]
  return [
    {
      page: 1,
      systems: [
        {
          systemIndex: 0,
          measures: [{ measureNumber: 1, page: 1, systemIndex: 0, events }],
        },
      ],
    },
  ]
}

describe('OMR V2 Phase 4 tie/sustain constraints', () => {
  it('classifies expected cross-measure ties without mutating the rows', () => {
    const wrongDurations = [
      {
        measureNumber: 4,
        onsetDiffQuarters: 0,
        durationDiffQuarters: 2,
        pitchDeltaSemitones: 0,
        truth: { measureNumber: 4, midi: 67, onsetQuarters: 2, durationQuarters: 2 },
        generated: { measureNumber: 4, midi: 67, onsetQuarters: 2, durationQuarters: 0.5 },
      },
    ]
    const before = JSON.stringify(wrongDurations)
    const candidates = classifyExpectedCrossMeasureTies(wrongDurations, [])
    expect(JSON.stringify(wrongDurations)).toBe(before)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].sustainDeficitQuarters).toBeCloseTo(1.5)
    expect(candidates[0].alreadyTied).toBe(false)
  })

  it('marks candidates already covered by applied tie pairs', () => {
    const wrongDurations = [
      {
        pitchDeltaSemitones: 0,
        truth: { measureNumber: 4, midi: 67, onsetQuarters: 2, durationQuarters: 2 },
        generated: { measureNumber: 4, midi: 67, onsetQuarters: 2, durationQuarters: 0.5 },
      },
    ]
    const applied = [{ fromMeasure: 4, toMeasure: 5, midi: 67 }]
    const candidates = classifyExpectedCrossMeasureTies(wrongDurations, applied)
    expect(candidates[0].alreadyTied).toBe(true)
  })

  it('splits detected vs applied tie glyphs into slur-like/unresolved buckets', () => {
    const orphans = classifyTieGlyphOrphans({
      detectedTieCount: 27,
      appliedTieCount: 11,
      uncertainSlurCount: 10,
    })
    expect(orphans.slurLikeArcPitchDiffers).toBe(10)
    expect(orphans.unresolvedArcCount).toBe(6)
  })

  it('finds broken tie continuations from missing/extra notes', () => {
    const missing = [{ measureNumber: 5, midi: 43, onsetQuarters: 2, partId: 'P1' }]
    const extra = [{ measureNumber: 6, midi: 43, onsetQuarters: 0, partId: 'P1' }]
    const beforeMissing = JSON.stringify(missing)
    const beforeExtra = JSON.stringify(extra)
    const result = classifyBrokenTieContinuations(missing, extra)
    expect(JSON.stringify(missing)).toBe(beforeMissing)
    expect(JSON.stringify(extra)).toBe(beforeExtra)
    expect(result.continuationWithoutStart).toHaveLength(1)
    expect(result.startWithoutContinuation).toHaveLength(0)
  })

  it('flags written-correct-but-sustain-wrong rows', () => {
    const rows = classifyWrittenCorrectSustainWrong([
      {
        onsetDiffQuarters: 0,
        durationDiffQuarters: 1.5,
        pitchDeltaSemitones: 0,
        truth: { measureNumber: 3, midi: 60, onsetQuarters: 0, durationQuarters: 2 },
        generated: { measureNumber: 3, midi: 60, onsetQuarters: 0, durationQuarters: 0.5 },
      },
      {
        onsetDiffQuarters: 0.5,
        durationDiffQuarters: 1,
        pitchDeltaSemitones: 0,
        truth: { measureNumber: 3, midi: 62, onsetQuarters: 1, durationQuarters: 1 },
        generated: { measureNumber: 3, midi: 62, onsetQuarters: 1.5, durationQuarters: 0.5 },
      },
    ])
    // Only the onset-aligned row counts as written-correct/sustain-wrong.
    expect(rows).toHaveLength(1)
    expect(rows[0].midi).toBe(60)
  })

  it('traces ScoreGraph tie chains from Phase 3 IR fields without mutation', () => {
    const pages = tiedPages()
    const before = JSON.stringify(pages)
    const graph = buildScoreGraph(pages)
    expect(JSON.stringify(pages)).toBe(before)
    const chains = traceScoreGraphTieChains(graph.measures[0])
    const tied = chains.find((chain) => chain.pitchKey.startsWith('60'))
    expect(tied).toBeTruthy()
    expect(tied.hasStart).toBe(true)
    expect(tied.hasStop).toBe(true)
    expect(tied.wellFormed).toBe(true)
  })

  it('builds a diagnostic bundle for dense without changing runtime metrics', () => {
    const before = JSON.stringify(denseFixture.metrics)
    const diagnostics = buildTieSustainConstraintDiagnostics(denseFixture, { fixtureId: 'dense' })
    expect(JSON.stringify(denseFixture.metrics)).toBe(before)
    expect(diagnostics.phase).toBe(4)
    expect(diagnostics.constraintHistogram).toHaveProperty(
      TIE_SUSTAIN_CONSTRAINT.SLUR_LIKE_ARC_PITCH_DIFFERS,
    )
    expect(diagnostics.tieGlyphOrphans.detectedTieCount).toBeGreaterThanOrEqual(
      diagnostics.tieGlyphOrphans.appliedTieCount,
    )
  })

  it('keeps frozen dense benchmark runtime metrics unchanged', () => {
    const metrics = extractFixtureMetrics(denseFixture)
    expect(metrics.wrongOnset).toBe(94)
    expect(metrics.wrongDuration).toBe(77)
    expect(metrics.chordMismatch).toBe(172)
    expect(metrics.wrongPitch).toBe(147)
  })
})
