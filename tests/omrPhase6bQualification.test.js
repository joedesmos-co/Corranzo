/**
 * OMR Engine V2 Phase 6B — live voice-serialization qualification.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildCorpusVoiceSerializationQualification,
  buildVoiceSerializationQualification,
  QUALIFICATION_BLOCKER,
} from '../src/features/omr/omrVoiceSerializationQualification.js'
import { extractFixtureMetrics } from '../src/features/omr/omrBenchmarkDashboard.js'

const denseFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
)

describe('OMR V2 Phase 6B voice serialization qualification', () => {
  it('flags missing ScoreGraph on cached from-reports shadow', () => {
    const qualification = buildVoiceSerializationQualification(
      {
        status: 'shadow-only-no-scoregraph',
        fixtureId: 'dense',
      },
      { fixtureId: 'dense' },
    )
    expect(qualification.anyTruthApproved).toBe(false)
    expect(qualification.blocker).toBe(QUALIFICATION_BLOCKER.NO_SCOREGRAPH)
    expect(qualification.hotspotQualification.map((entry) => entry.measureNumber)).toEqual(
      expect.arrayContaining([7, 9, 121]),
    )
  })

  it('reports truth-approved measures when shadow comparison includes them', () => {
    const qualification = buildVoiceSerializationQualification(
      {
        status: 'shadow-improved',
        scoreGraphSource: 'passed',
        structurallyAppliedCount: 2,
        structuralAppliedMeasures: [
          { measureNumber: 10, variantId: 'grand-staff-late-minus-2' },
          { measureNumber: 7, variantId: 'accompaniment-minus-2' },
        ],
        changedMeasures: [{ measureNumber: 10, variantId: 'grand-staff-late-minus-2', softScoreDelta: 0.04 }],
        acceptedCandidateMeasures: [{ measureNumber: 10, variantId: 'grand-staff-late-minus-2' }],
        rejectedByTruth: [
          {
            measureNumber: 7,
            variantId: 'accompaniment-minus-2',
            rejections: ['chord-regression'],
          },
        ],
        hotspotMeasures: [10],
        perMeasureDelta: [{ measureNumber: 10, wrongOnsetDelta: -2, wrongDurationDelta: 0, chordMismatchDelta: 0 }],
        runtime: { wrongOnset: 6, wrongDuration: 3 },
        shadow: { wrongOnset: 4, wrongDuration: 3 },
        delta: { wrongOnset: -2, wrongDuration: 0, chordMismatch: 0 },
      },
      { fixtureId: 'simple' },
    )
    expect(qualification.anyTruthApproved).toBe(true)
    expect(qualification.truthApprovedCount).toBe(1)
    expect(qualification.structuralAppliedCount).toBe(2)
    const m10 = qualification.hotspotQualification.find((entry) => entry.measureNumber === 10)
    expect(m10?.status).toBe('truth-approved')
    const m7 = qualification.measures.find((entry) => entry.measureNumber === 7)
    expect(m7?.blocker).toBe(QUALIFICATION_BLOCKER.CHORD_REGRESSION)
  })

  it('builds corpus qualification across enforced fixtures', () => {
    const corpus = buildCorpusVoiceSerializationQualification([
      {
        id: 'simple',
        voiceSerializationShadow: {
          status: 'shadow-no-qualifying-measures',
          scoreGraphSource: 'passed',
          structurallyAppliedCount: 0,
          changedMeasures: [],
          hotspotMeasures: [10],
        },
      },
    ])
    expect(corpus.enforcedFixtures).toEqual(['clean', 'dense', 'simple'])
    expect(corpus.verdict).toContain('NO')
    expect(corpus.phase7Recommendation).toBeTruthy()
  })

  it('keeps frozen dense benchmark runtime metrics unchanged', () => {
    const metrics = extractFixtureMetrics(denseFixture)
    expect(metrics.wrongOnset).toBe(94)
    expect(metrics.wrongDuration).toBe(77)
    expect(metrics.chordMismatch).toBe(172)
    expect(metrics.wrongPitch).toBe(147)
  })
})
