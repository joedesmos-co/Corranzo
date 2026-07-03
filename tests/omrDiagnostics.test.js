import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  analyzeChordMismatchCoupling,
  analyzeOnsetErrorCoupling,
  clusterFixtureFailures,
  groupAccuracyReportErrors,
  mergeHistograms,
  NAMED_ERROR_BUCKET,
  rankRhythmRootCauses,
  summarizeDetectionErrors,
  summarizeNamedErrorBuckets,
  summarizeTierBreakdown,
  topHistogramEntries,
} from '../src/features/omr/omrDiagnosticGrouping.js'
import {
  getOmrDiagnosticFlags,
  OMR_DIAGNOSTIC_FLAG,
  setOmrDiagnosticFlag,
} from '../src/features/omr/omrDiagnosticFlags.js'
import {
  buildOmrDiagnosticExport,
  serializeOmrDiagnosticExport,
} from '../src/features/omr/omrDevTools.js'
import {
  NOTE_COUNT_ROOT_CAUSE,
  summarizeMissingExtraRootCauses,
} from '../src/features/omr/omrMissingExtraAnalysis.js'
import {
  ONSET_VOICE_ERROR_CLASS,
  buildMeasureOnsetTrace,
  summarizeOnsetVoicePhaseDiagnosis,
} from '../src/features/omr/omrOnsetVoiceTrace.js'
import {
  buildHotspotDiagnostics,
  OMR_V2_HOTSPOT_MEASURES_BY_FIXTURE,
} from '../src/features/omr/omrHotspotDiagnostics.js'
import {
  buildRhythmErrorAttribution,
  RHYTHM_ERROR_ATTRIBUTION,
} from '../src/features/omr/omrRhythmErrorAttribution.js'
import { extractFixtureMetrics } from '../src/features/omr/omrBenchmarkDashboard.js'
import { createOmrPhaseTracer } from '../src/features/omr/omrTrace.js'

const sampleDenseReport = JSON.parse(
  readFileSync(
    join(process.cwd(), 'tmp/omr-benchmark-iter/rhythm-voice2/after-dense.json'),
    'utf8',
  ),
)

const currentDenseReport = JSON.parse(
  readFileSync(
    join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'),
    'utf8',
  ),
)

describe('omrDiagnosticGrouping', () => {
  it('groups pitch, duration, and detection errors from an accuracy report', () => {
    const grouping = groupAccuracyReportErrors(sampleDenseReport)
    expect(grouping.primarySource).toBe('rhythm-inference')
    expect(grouping.pitch.total).toBeGreaterThan(0)
    expect(grouping.duration.total).toBeGreaterThan(0)
    expect(grouping.pitch.top.length).toBeGreaterThan(0)
    expect(grouping.duration.top.length).toBeGreaterThan(0)
    expect(grouping.detection.buckets['missing-notes']).toBeGreaterThan(0)
    expect(grouping.rankedSources.length).toBeGreaterThan(0)
  })

  it('merges histograms across fixtures', () => {
    const merged = mergeHistograms([
      { 'too-short': 2, 'too-long': 1 },
      { 'too-short': 3, other: 1 },
    ])
    expect(merged['too-short']).toBe(5)
    expect(merged['too-long']).toBe(1)
    expect(merged.other).toBe(1)
  })

  it('ranks histogram entries', () => {
    expect(topHistogramEntries({ a: 1, b: 5, c: 2 })).toEqual([
      { category: 'b', count: 5 },
      { category: 'c', count: 2 },
      { category: 'a', count: 1 },
    ])
  })

  it('summarizes detection error buckets', () => {
    const summary = summarizeDetectionErrors({
      missingNoteCount: 4,
      extraNoteCount: 2,
      chordMismatchCount: 1,
    })
    expect(summary.total).toBe(7)
    expect(summary.top[0].category).toBe('missing-notes')
  })

  it('rolls up named error buckets and identifies the largest remaining bucket', () => {
    const grouping = summarizeNamedErrorBuckets({
      totals: {
        wrongPitchCount: 10,
        wrongDurationCount: 3,
        wrongOnsetCount: 2,
        chordMismatchCount: 5,
        missingNoteCount: 4,
        extraNoteCount: 1,
      },
      debug: {
        wrongPitches: [
          { pitchDeltaSemitones: 1 },
          { pitchDeltaSemitones: 1 },
          { pitchDeltaSemitones: 12 },
        ],
      },
      generatedOmrDiagnostics: {
        ties: { detectedTieCount: 14, appliedTieCount: 6, uncertainSlurCount: 8 },
        rests: { detectedRestGlyphCount: 10, appliedRestEventCount: 7, skippedMixedRestCount: 2 },
      },
    })

    expect(grouping.buckets[NAMED_ERROR_BUCKET.PITCH]).toBe(10)
    expect(grouping.buckets[NAMED_ERROR_BUCKET.CHORD]).toBe(5)
    expect(grouping.buckets[NAMED_ERROR_BUCKET.TIES]).toBe(8) // 14 detected - 6 applied
    expect(grouping.buckets[NAMED_ERROR_BUCKET.SLURS]).toBe(8) // uncertainSlurCount
    expect(grouping.buckets[NAMED_ERROR_BUCKET.ACCIDENTALS]).toBe(2) // two ±1 deltas
    expect(grouping.buckets[NAMED_ERROR_BUCKET.RESTS]).toBe(5) // (10-7) + 2 skipped
    expect(grouping.buckets[NAMED_ERROR_BUCKET['EXTRA_MISSING'] ?? 'extra/missing-notes']).toBe(5)
    expect(grouping.largestBucket.bucket).toBe(NAMED_ERROR_BUCKET.PITCH)
    expect(grouping.largestBucket.count).toBe(10)
    expect(grouping.largestBucket.share).toBeGreaterThan(0)
  })

  it('reports no largest bucket when there are no errors', () => {
    const grouping = summarizeNamedErrorBuckets({ totals: {}, generatedOmrDiagnostics: {} })
    expect(grouping.total).toBe(0)
    expect(grouping.largestBucket).toBeNull()
    expect(grouping.ranked).toEqual([])
  })

  it('includes named buckets in the per-report error grouping', () => {
    const grouping = groupAccuracyReportErrors(sampleDenseReport)
    expect(grouping.namedBuckets).toBeTruthy()
    expect(grouping.namedBuckets.ranked.length).toBeGreaterThan(0)
    expect(grouping.namedBuckets.largestBucket).toBeTruthy()
  })
})

// Root-cause diagnosis for the OMR Accuracy Sprint: on the enforced fixtures the
// chord bucket is the largest PROVEN accuracy bucket, but the evidence shows it
// is a DOWNSTREAM SYMPTOM of onset/detection errors — not a primary chord-
// grouping defect. These tests pin that finding so a future onset/rhythm fix can
// be measured against it, and so nobody "fixes" chord grouping in isolation.
describe('chord mismatch coupling diagnosis', () => {
  it('attributes coupled vs isolated chord mismatches from a report', () => {
    const coupling = analyzeChordMismatchCoupling({
      debug: {
        chordGroupMismatches: [
          { measureNumber: 1, truthCount: 2, generatedCount: 1 }, // coupled (onset err below)
          { measureNumber: 2, truthCount: 2, generatedCount: 1 }, // isolated (no other errors)
        ],
      },
      perMeasure: [
        { measureNumber: 1, wrongOnsetCount: 1, missingNoteCount: 0, extraNoteCount: 0 },
        { measureNumber: 2, wrongOnsetCount: 0, missingNoteCount: 0, extraNoteCount: 0 },
      ],
    })
    expect(coupling.coupledExamples).toBe(1)
    expect(coupling.isolatedExamples).toBe(1)
    expect(coupling.isolatedMeasures).toEqual([2])
    expect(coupling.coupledShare).toBe(0.5)
  })

  it('handles reports with no chord mismatches', () => {
    const coupling = analyzeChordMismatchCoupling({ debug: {}, perMeasure: [] })
    expect(coupling.exampleCount).toBe(0)
    expect(coupling.coupledShare).toBeNull()
  })

  it('confirms dense chord mismatches are overwhelmingly onset/detection-coupled (symptom, not root cause)', () => {
    const coupling = analyzeChordMismatchCoupling(sampleDenseReport)
    expect(coupling.exampleCount).toBeGreaterThan(0)
    // The dominant share of chord mismatches occur in measures that ALSO have
    // onset or note-detection errors — i.e. they are a downstream symptom.
    expect(coupling.coupledShare).toBeGreaterThanOrEqual(0.8)
    // Very few mismatches are genuinely isolated chord-grouping-logic errors.
    expect(coupling.isolatedExamples).toBeLessThan(coupling.coupledExamples)
  })
})

// Sprint 2 rhythm diagnosis: onset/rhythm is the proven root cause on dense;
// chord is a downstream symptom. These tests pin the rerank so future rhythm
// fixes are measured against the right bucket.
describe('onset error coupling diagnosis', () => {
  it('attributes strict-independent vs pitch/duration-coupled onsets', () => {
    const coupling = analyzeOnsetErrorCoupling({
      debug: {
        wrongOnsets: [
          {
            truth: { onsetQuarters: 1 },
            generated: { onsetQuarters: 1.5 },
            pitchDeltaSemitones: 0,
            durationDiffQuarters: 0,
          },
          {
            truth: { onsetQuarters: 2 },
            generated: { onsetQuarters: 2.5 },
            pitchDeltaSemitones: -2,
            durationDiffQuarters: 0,
          },
        ],
      },
    })
    expect(coupling.exampleCount).toBe(2)
    expect(coupling.strictIndependent).toBe(1)
    expect(coupling.pitchOrDurationCoupled).toBe(1)
    expect(coupling.coupledShare).toBe(0.5)
  })

  it('handles reports with no wrong onsets', () => {
    const coupling = analyzeOnsetErrorCoupling({ debug: {} })
    expect(coupling.exampleCount).toBe(0)
    expect(coupling.coupledShare).toBeNull()
  })

  it('confirms dense wrong onsets are mostly ±0.5q / ±0.75q voice-phase shifts', () => {
    const coupling = analyzeOnsetErrorCoupling(currentDenseReport)
    expect(coupling.exampleCount).toBe(94)
    expect(coupling.strictIndependent).toBeGreaterThanOrEqual(15)
    expect(coupling.pitchOrDurationCoupled).toBeGreaterThan(coupling.strictIndependent)
    const absCounts = Object.fromEntries(
      coupling.dominantAbsDeltas.map((entry) => [entry.category, entry.count]),
    )
    expect(absCounts['0.50']).toBeGreaterThanOrEqual(55)
    expect(absCounts['0.75']).toBeGreaterThanOrEqual(25)
  })
})

describe('rhythm root-cause ranking', () => {
  it('promotes onset/rhythm over chord on the current dense fixture', () => {
    const ranking = rankRhythmRootCauses(currentDenseReport)
    expect(ranking.primaryRhythmRootCause?.bucket).toBe('onset/rhythm')
    expect(ranking.primaryRhythmRootCause?.count).toBe(94)
    expect(ranking.durationOnsetCoupled).toBeGreaterThanOrEqual(40)
    expect(ranking.symptoms[0]?.bucket).toBe('chord')
    expect(ranking.symptoms[0]?.coupledShare).toBeGreaterThanOrEqual(0.85)
  })
})

// Missing/extra sprint: on enforced fixtures dense missing+extra are balanced
// (noteΔ=0) and dominated by onset serialization slips — not detection loss or
// dedupe regressions. Twinkle/clean stay at zero.
describe('missing/extra note root-cause diagnosis', () => {
  it('labels same-pitch onset slips as serialization mistakes', () => {
    const summary = summarizeMissingExtraRootCauses({
      totals: { noteCountDifference: 0 },
      debug: {
        missingNotes: [
          { measureNumber: 61, onsetQuarters: 3, midi: 46, label: 'A#2' },
        ],
        extraNotes: [
          { measureNumber: 61, onsetQuarters: 1.5, midi: 46, label: 'A#2' },
        ],
      },
      generatedOmrDiagnostics: { noteMatching: { perMeasure: [] } },
    })
    expect(summary.primaryRootCause?.bucket).toBe(NOTE_COUNT_ROOT_CAUSE.SERIALIZATION_MISTAKE)
    expect(summary.balancedMismatch).toBe(true)
  })

  it('labels measure-level grouping loss separately from matcher artifacts', () => {
    const summary = summarizeMissingExtraRootCauses({
      totals: { noteCountDifference: -1 },
      debug: {
        missingNotes: [{ measureNumber: 4, onsetQuarters: 1, midi: 60, label: 'C4' }],
        extraNotes: [],
      },
      generatedOmrDiagnostics: {
        noteMatching: {
          perMeasure: [
            {
              measureNumber: 4,
              page: 1,
              detectedNoteheads: 5,
              emittedNoteheads: 4,
              dedupedDuringGrouping: 1,
            },
          ],
        },
      },
    })
    expect(summary.histogram[NOTE_COUNT_ROOT_CAUSE.GROUPING_MISTAKE]).toBe(1)
  })

  it('confirms dense missing/extra are balanced matcher/serialization artifacts, not detection loss', () => {
    const summary = summarizeMissingExtraRootCauses(currentDenseReport)
    expect(summary.missingCount).toBe(28)
    expect(summary.extraCount).toBe(28)
    expect(summary.noteCountDifference).toBe(0)
    expect(summary.balancedMismatch).toBe(true)
    expect(summary.groupingLossDuringEmission).toBe(0)
    expect(summary.histogram[NOTE_COUNT_ROOT_CAUSE.DEDUPE_MISTAKE]).toBe(0)
    expect(summary.histogram[NOTE_COUNT_ROOT_CAUSE.GROUPING_MISTAKE]).toBe(0)
    expect(summary.histogram[NOTE_COUNT_ROOT_CAUSE.DETECTION_LOSS]).toBeLessThan(12)
    expect(summary.histogram[NOTE_COUNT_ROOT_CAUSE.SERIALIZATION_MISTAKE]).toBeGreaterThan(30)
    expect(summary.missingHotspots[0]?.measureNumber).toBe(7)
    expect(summary.missingHotspots[0]?.count).toBe(11)
  })

  it('keeps Twinkle and Gymnopédie at zero missing/extra notes', () => {
    const simple = JSON.parse(
      readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/simple.json'), 'utf8'),
    )
    const clean = JSON.parse(
      readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/clean.json'), 'utf8'),
    )
    expect(summarizeMissingExtraRootCauses(simple).missingCount).toBe(0)
    expect(summarizeMissingExtraRootCauses(simple).extraCount).toBe(0)
    expect(summarizeMissingExtraRootCauses(clean).missingCount).toBe(0)
    expect(summarizeMissingExtraRootCauses(clean).extraCount).toBe(0)
  })
})

describe('onset voice-phase trace diagnosis', () => {
  it('classifies same-label voice shifts separately from slot shifts', () => {
    const trace = buildMeasureOnsetTrace(
      {
        debug: {
          wrongOnsets: [
            {
              measureNumber: 10,
              onsetDiffQuarters: 0.5,
              pitchDeltaSemitones: 0,
              truth: { label: 'G3', onsetQuarters: 0.5, voice: 5 },
              generated: { label: 'G3', onsetQuarters: 1, voice: 2 },
            },
            {
              measureNumber: 10,
              onsetDiffQuarters: 0.75,
              pitchDeltaSemitones: 0,
              truth: { label: 'B3', onsetQuarters: 1.5, voice: 5 },
              generated: { label: 'B3', onsetQuarters: 2.25, voice: 2 },
            },
          ],
        },
      },
      10,
    )
    expect(trace.rows.every((row) => row.errorClass === ONSET_VOICE_ERROR_CLASS.SERIALIZATION_VOICE_SHIFT)).toBe(true)
  })

  it('pins dense onset hotspots and error-class mix on enforced fixtures', () => {
    const summary = summarizeOnsetVoicePhaseDiagnosis(currentDenseReport, {
      measureNumbers: [7, 8, 9, 121],
    })
    expect(summary.totalWrongOnsets).toBe(94)
    expect(summary.strictIndependent).toBe(19)
    expect(summary.rankedMeasures[0]?.measureNumber).toBe(9)
    expect(summary.rankedMeasures[0]?.wrongOnsetCount).toBe(18)
    expect(summary.perMeasure.find((entry) => entry.measureNumber === 7)?.wrongOnsetCount).toBe(8)
    expect(summary.errorClassHistogram[ONSET_VOICE_ERROR_CLASS.CROSS_VOICE_MATCHER]).toBeGreaterThan(30)
    expect(summary.signedDeltaHistogram['0.5']).toBeGreaterThanOrEqual(55)
    expect(summary.signedDeltaHistogram['0.75']).toBeGreaterThanOrEqual(25)
  })

  it('pins Twinkle m10 as serialization voice-shift canary', () => {
    const simple = JSON.parse(
      readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/simple.json'), 'utf8'),
    )
    const trace = buildMeasureOnsetTrace(simple, 10)
    expect(trace.wrongOnsetCount).toBe(6)
    expect(trace.histogram[ONSET_VOICE_ERROR_CLASS.SERIALIZATION_VOICE_SHIFT]).toBe(4)
    expect(trace.histogram[ONSET_VOICE_ERROR_CLASS.UNIQUE_PITCH_SLOT_SHIFT]).toBe(2)
    expect(trace.rows.every((row) => Math.abs(row.onsetDiffQuarters ?? 0) === 0.5 || Math.abs(row.onsetDiffQuarters ?? 0) === 0.75)).toBe(true)
  })
})

describe('omrDiagnosticGrouping clustering', () => {
  it('clusters fixtures with the same failure signature', () => {
    const clusters = clusterFixtureFailures([
      {
        id: 'a',
        status: 'fail',
        metrics: {
          topErrorCategory: { source: 'pitch-mapping' },
          topDurationErrorCategory: { category: 'too-short' },
          topPitchErrorCategory: { category: '±1-accidental' },
        },
        failureReasons: ['pitchAccuracy low'],
      },
      {
        id: 'b',
        status: 'fail',
        metrics: {
          topErrorCategory: { source: 'pitch-mapping' },
          topDurationErrorCategory: { category: 'too-short' },
          topPitchErrorCategory: { category: '±1-accidental' },
        },
        failureReasons: ['pitchAccuracy low'],
      },
      {
        id: 'c',
        status: 'pass',
        metrics: {},
      },
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].fixtures).toEqual(['a', 'b'])
  })

  it('summarizes tier breakdown', () => {
    const tiers = summarizeTierBreakdown([
      { id: 'clean', tier: 'medium', status: 'pass' },
      { id: 'dense', tier: 'hard', status: 'fail' },
    ])
    expect(tiers).toHaveLength(2)
    expect(tiers.find((tier) => tier.tier === 'hard')?.failing).toEqual(['dense'])
  })
})

describe('omrDiagnosticFlags', () => {
  it('reads and writes local diagnostic flags', () => {
    const original = getOmrDiagnosticFlags()
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
    expect(getOmrDiagnosticFlags().trace).toBe(false)
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, true)
    expect(getOmrDiagnosticFlags().trace).toBe(true)
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, original.trace)
  })
})

describe('omrDevTools', () => {
  it('builds a compact diagnostic export payload', () => {
    const bundle = buildOmrDiagnosticExport({
      diagnostics: { pages: 2, systems: 4, measures: 16 },
      accuracyReport: sampleDenseReport,
      runMeta: { runId: 1 },
    })
    const text = serializeOmrDiagnosticExport(bundle)
    expect(text).toContain('"version": 1')
    expect(text).toContain('"errorGrouping"')
    expect(text).toContain('"primarySource": "rhythm-inference"')
  })
})

describe('omrTrace phases', () => {
  it('runs sync phases without throwing when trace is disabled', () => {
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
    const tracer = createOmrPhaseTracer(99)
    const value = tracer.sync('test-phase', () => 42)
    expect(value).toBe(42)
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, true)
  })
})

describe('OMR V2 Phase 1 — rhythm error attribution', () => {
  it('attributes dense errors into planning buckets without changing core metrics', () => {
    const metricsBefore = {
      wrongPitch: currentDenseReport.totals.wrongPitchCount,
      wrongDuration: currentDenseReport.totals.wrongDurationCount,
      wrongOnset: currentDenseReport.totals.wrongOnsetCount,
      chordMismatch: currentDenseReport.totals.chordMismatchCount,
    }
    const metrics = extractFixtureMetrics(currentDenseReport)
    expect(metrics.wrongPitch).toBe(metricsBefore.wrongPitch)
    expect(metrics.wrongDuration).toBe(metricsBefore.wrongDuration)
    expect(metrics.wrongOnset).toBe(metricsBefore.wrongOnset)
    expect(metrics.chordMismatch).toBe(metricsBefore.chordMismatch)

    const attribution = buildRhythmErrorAttribution(currentDenseReport)
    expect(attribution.buckets[RHYTHM_ERROR_ATTRIBUTION.ONSET_PHASE_SHIFT]).toBeGreaterThanOrEqual(55)
    expect(attribution.buckets[RHYTHM_ERROR_ATTRIBUTION.VOICE_SERIALIZATION_SHIFT]).toBeGreaterThanOrEqual(30)
    expect(attribution.buckets[RHYTHM_ERROR_ATTRIBUTION.ONSET_COUPLED_DURATION]).toBe(44)
    expect(attribution.buckets[RHYTHM_ERROR_ATTRIBUTION.CHORD_GROUPING_SYMPTOM]).toBeGreaterThanOrEqual(80)
    expect(attribution.supporting.chordMismatchTotal).toBe(172)
    expect(attribution.buckets[RHYTHM_ERROR_ATTRIBUTION.PITCH_GROUPING_SYMPTOM]).toBeGreaterThan(40)
    expect(
      attribution.buckets[RHYTHM_ERROR_ATTRIBUTION.BALANCED_MISSING_EXTRA_SERIALIZATION],
    ).toBeGreaterThan(30)
    expect(metrics.rhythmErrorAttribution.primaryBucket?.count).toBeGreaterThan(0)
  })

  it('exports hotspot traces for Cruel Angel and Twinkle canaries', () => {
    const simple = JSON.parse(
      readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/simple.json'), 'utf8'),
    )
    const denseHotspots = buildHotspotDiagnostics(currentDenseReport, { fixtureId: 'dense' })
    const twinkleHotspots = buildHotspotDiagnostics(simple, { fixtureId: 'simple' })

    expect(OMR_V2_HOTSPOT_MEASURES_BY_FIXTURE.dense).toEqual([7, 9, 121])
    expect(OMR_V2_HOTSPOT_MEASURES_BY_FIXTURE.simple).toEqual([10])
    expect(denseHotspots.measureNumbers).toEqual([7, 9, 121])
    expect(denseHotspots.onsetVoicePhase.perMeasure.find((m) => m.measureNumber === 9)?.wrongOnsetCount).toBe(18)
    expect(twinkleHotspots.onsetVoicePhase.perMeasure[0]?.measureNumber).toBe(10)
    expect(twinkleHotspots.onsetVoicePhase.perMeasure[0]?.wrongOnsetCount).toBe(6)
  })
})
