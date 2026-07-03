/**
 * OMR Engine V2 Phase 5 — rollout gate and next-target selection.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildFixtureDashboardRecord,
  extractFixtureMetrics,
  summarizeOmrBenchmarkDashboard,
} from '../src/features/omr/omrBenchmarkDashboard.js'
import {
  buildRolloutGateReport,
  collectV2DiagnosticEvidence,
  FROZEN_BASELINE,
  formatRolloutGateDocument,
  rankSolverTargets,
  SOLVER_TARGET,
  TARGET_STATUS,
} from '../src/features/omr/omrRolloutGate.js'

const denseFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
)
const simpleFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/simple.json'), 'utf8'),
)
const cleanFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/clean.json'), 'utf8'),
)

function buildRecords() {
  return [
    buildFixtureDashboardRecord({ fixture: { id: 'clean', label: 'Gymnopédie' }, report: cleanFixture }),
    buildFixtureDashboardRecord({ fixture: { id: 'dense', label: 'Cruel Angel' }, report: denseFixture }),
    buildFixtureDashboardRecord({ fixture: { id: 'simple', label: 'Twinkle' }, report: simpleFixture }),
  ]
}

describe('OMR V2 Phase 5 rollout gate', () => {
  it('collects Phase 1–4 evidence from dashboard records', () => {
    const evidence = collectV2DiagnosticEvidence(buildRecords())
    expect(evidence.phase1.voiceSerializationShift).toBe(35)
    expect(evidence.phase1.onsetPhaseShift).toBe(94)
    expect(evidence.phase2.exhausted).toBe(true)
    expect(evidence.phase3.onsetCoupledDuration).toBe(44)
    expect(evidence.phase4.expectedCrossMeasureTie).toBe(42)
    expect(evidence.canaries.twinkleFalseTieGuard?.clean).toBe(true)
  })

  it('ranks voice-aware serialization as recommended and blocks exhausted clef phase shifts', () => {
    const evidence = collectV2DiagnosticEvidence(buildRecords())
    const ranking = rankSolverTargets(evidence)
    expect(ranking.recommended.target).toBe(SOLVER_TARGET.VOICE_AWARE_SERIALIZATION)
    expect(ranking.recommended.status).toBe(TARGET_STATUS.RECOMMENDED)
    const measureSolver = ranking.ranked.find(
      (entry) => entry.target === SOLVER_TARGET.MEASURE_LEVEL_SOLVER,
    )
    expect(measureSolver?.status).toBe(TARGET_STATUS.BLOCKED_EXHAUSTED)
    const durationSolver = ranking.ranked.find(
      (entry) => entry.target === SOLVER_TARGET.WRITTEN_SOUNDING_DURATION,
    )
    expect(durationSolver?.status).toBe(TARGET_STATUS.BLOCKED_PREMATURE)
  })

  it('builds rollout gate report with Phase 6 prompt without mutating fixtures', () => {
    const records = buildRecords()
    const before = JSON.stringify(denseFixture.metrics)
    const gate = buildRolloutGateReport(records)
    expect(JSON.stringify(denseFixture.metrics)).toBe(before)
    expect(gate.phase).toBe(5)
    expect(gate.recommendation.target).toBe(SOLVER_TARGET.VOICE_AWARE_SERIALIZATION)
    expect(gate.phase6Prompt).toContain('shadow-only')
    expect(gate.phase6Prompt).toContain('Twinkle m10')
    expect(gate.baselineFrozen?.wrongOnset).toBe(true)
  })

  it('includes rollout gate in dashboard summary', () => {
    const summary = summarizeOmrBenchmarkDashboard(buildRecords())
    expect(summary.rolloutGate?.recommendation?.target).toBe(
      SOLVER_TARGET.VOICE_AWARE_SERIALIZATION,
    )
    expect(summary.rolloutGate?.ranking?.ranked?.length).toBe(5)
  })

  it('generates rollout gate document markdown', () => {
    const gate = buildRolloutGateReport(buildRecords())
    const doc = formatRolloutGateDocument(gate)
    expect(doc).toContain('# OMR Engine V2 — Rollout Gate (Phase 5)')
    expect(doc).toContain('voice-aware-serialization')
    expect(doc).toContain(String(FROZEN_BASELINE.dense.wrongOnset))
    expect(doc).toContain('Phase 6 prompt')
  })

  it('keeps frozen dense benchmark runtime metrics unchanged', () => {
    const metrics = extractFixtureMetrics(denseFixture)
    expect(metrics.wrongOnset).toBe(FROZEN_BASELINE.dense.wrongOnset)
    expect(metrics.wrongDuration).toBe(FROZEN_BASELINE.dense.wrongDuration)
    expect(metrics.chordMismatch).toBe(FROZEN_BASELINE.dense.chordMismatch)
    expect(metrics.wrongPitch).toBe(FROZEN_BASELINE.dense.wrongPitch)
  })
})
