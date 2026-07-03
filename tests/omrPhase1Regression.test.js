/**
 * OMR Engine V2 Phase 1 — prove diagnostics/IR changes did not alter runtime metrics.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildOmrDiagnostics } from '../src/features/omr/buildOmrDiagnostics.js'
import { extractFixtureMetrics } from '../src/features/omr/omrBenchmarkDashboard.js'
import { buildScoreGraph, summarizeScoreGraph } from '../src/features/omr/scoreGraph.js'

const denseFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
)
const cleanFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/clean.json'), 'utf8'),
)

function samplePages() {
  return [
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
                  notes: [{ midi: 60, clef: 'treble', cx: 10, cy: 20 }],
                },
              ],
            },
          ],
        },
      ],
    },
  ]
}

describe('OMR V2 Phase 1 regression guards', () => {
  it('keeps frozen dense benchmark metrics identical when adding attribution fields', () => {
    const metrics = extractFixtureMetrics(denseFixture)
    expect(metrics.wrongOnset).toBe(94)
    expect(metrics.wrongDuration).toBe(77)
    expect(metrics.chordMismatch).toBe(172)
    expect(metrics.wrongPitch).toBe(147)
    expect(metrics.noteCountDiff).toBe(0)
    expect(metrics.measureCountDiff).toBe(0)
    expect(metrics.pitchAccuracy).toBe(0.9377)
    expect(metrics.durationAccuracy).toBe(0.9626)
    expect(metrics.onsetAccuracy).toBe(0.9566)
  })

  it('keeps clean fixture at zero errors', () => {
    const metrics = extractFixtureMetrics(cleanFixture)
    expect(metrics.wrongOnset).toBe(0)
    expect(metrics.wrongDuration).toBe(0)
    expect(metrics.chordMismatch).toBe(0)
    expect(metrics.wrongPitch).toBe(0)
    expect(metrics.noteCountDiff).toBe(0)
  })

  it('adds ScoreGraph IR fields without mutating runtime page inputs', () => {
    const pages = samplePages()
    const before = JSON.stringify(pages)
    const diagnostics = buildOmrDiagnostics({ pages, totalMeasures: 1 })
    const fullGraph = buildScoreGraph(pages)
    expect(JSON.stringify(pages)).toBe(before)
    expect(diagnostics.scoreGraph.version).toBe(2)
    expect(diagnostics.scoreGraph.voiceBudgetDiagnostics).toBeTruthy()
    expect(fullGraph.measures[0].voiceBudget.totalDivisions).toBe(4)
    expect(fullGraph.measures[0].nodes[0].writtenDurationDivisions).toBe(4)
    expect(fullGraph.measures[0].nodes[0].soundingReleaseDivision).toBe(4)
    expect(fullGraph.measures[0].nodes[0].durationSource).toBeTruthy()
    expect(summarizeScoreGraph(fullGraph).version).toBe(2)
  })
})
