import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assessFixtureThresholds,
  buildFixtureDashboardRecord,
  extractFixtureMetrics,
  formatOmrBenchmarkMarkdown,
  OMR_BENCHMARK_STATUS,
  summarizeOmrBenchmarkDashboard,
  validateOmrBenchmarkManifest,
} from '../src/features/omr/omrBenchmarkDashboard.js'

const sampleDenseReport = JSON.parse(
  readFileSync(
    join(process.cwd(), 'tmp/omr-benchmark-iter/rhythm-voice2/after-dense.json'),
    'utf8',
  ),
)

const sampleCleanReport = JSON.parse(
  readFileSync(
    join(process.cwd(), 'tmp/omr-benchmark-iter/rhythm-voice2/after-medium.json'),
    'utf8',
  ),
)

describe('omrBenchmarkDashboard', () => {
  it('validates the bundled manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'benchmarks/omr-benchmark.manifest.json'), 'utf8'),
    )
    const validation = validateOmrBenchmarkManifest(manifest)
    expect(validation.ok).toBe(true)
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual(['clean', 'dense'])
  })

  it('extracts dashboard metrics from an accuracy report', () => {
    const metrics = extractFixtureMetrics(sampleDenseReport)
    expect(metrics.pitchAccuracy).toBe(0.3434)
    expect(metrics.durationAccuracy).toBe(0.8025)
    expect(metrics.onsetAccuracy).toBe(0.7181)
    expect(metrics.noteDetectionF1).toBe(0.8893)
    expect(metrics.measureCountDiff).toBe(2)
    expect(metrics.noteCountDiff).toBe(-2)
    expect(metrics.wrongDuration).toBe(243)
    expect(metrics.topErrorCategory?.source).toBe('rhythm-inference')
    expect(metrics.topDurationErrorCategory?.category).toBeTruthy()
  })

  it('marks dense fixture fail when thresholds are too high', () => {
    const record = buildFixtureDashboardRecord({
      fixture: {
        id: 'dense',
        label: 'Dense',
        thresholds: {
          pitchAccuracy: 0.9,
          durationAccuracy: 0.9,
          onsetAccuracy: 0.9,
          chordGroupingAccuracy: 0.9,
          noteDetectionF1: 0.9,
          maxMeasureCountDiff: 0,
          maxNoteCountDiff: 0,
        },
      },
      report: sampleDenseReport,
    })
    expect(record.status).toBe(OMR_BENCHMARK_STATUS.FAIL)
    expect(record.thresholdFailures.length).toBeGreaterThan(0)
    expect(record.metrics.wrongPitch).toBe(1533)
    expect(record.metrics.chordMismatch).toBe(1154)
  })

  it('marks clean fixture pass at manifest thresholds', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'benchmarks/omr-benchmark.manifest.json'), 'utf8'),
    )
    const cleanFixture = manifest.fixtures.find((fixture) => fixture.id === 'clean')
    const record = buildFixtureDashboardRecord({
      fixture: cleanFixture,
      report: sampleCleanReport,
    })
    expect(record.status).toBe(OMR_BENCHMARK_STATUS.PASS)
  })

  it('marks rejected pipeline runs separately from fail', () => {
    const record = buildFixtureDashboardRecord({
      fixture: { id: 'dense', label: 'Dense' },
      error: {
        message: 'Too difficult',
        code: 'rejected',
        difficulty: { tooDifficult: true, reasons: ['low-confidence'], confidence: 0.2 },
      },
    })
    expect(record.status).toBe(OMR_BENCHMARK_STATUS.REJECTED)
    expect(record.failureReasons).toContain('low-confidence')
  })

  it('formats a markdown dashboard summary', () => {
    const records = [
      buildFixtureDashboardRecord({
        fixture: { id: 'clean', label: 'Clean', pdf: '~/x.pdf', truth: '~/x.mxl' },
        report: sampleCleanReport,
      }),
      buildFixtureDashboardRecord({
        fixture: { id: 'dense', label: 'Dense', pdf: '~/y.pdf', truth: '~/y.mxl' },
        report: sampleDenseReport,
      }),
    ]
    const summary = summarizeOmrBenchmarkDashboard(records)
    const markdown = formatOmrBenchmarkMarkdown(summary)
    expect(markdown).toContain('# OMR benchmark dashboard')
    expect(markdown).toContain('### Clean (`pass`)')
    expect(markdown).toContain('top error category:')
    expect(summary.fixtureCount).toBe(2)
  })

  it('reports threshold failures with readable reasons', () => {
    const failures = assessFixtureThresholds(
      { pitchAccuracy: 0.5, measureCountDiff: 3, noteCountDiff: -2 },
      { pitchAccuracy: 0.8, maxMeasureCountDiff: 1, maxNoteCountDiff: 1 },
    )
    expect(failures.map((entry) => entry.metric)).toEqual([
      'pitchAccuracy',
      'measureCountDiff',
      'noteCountDiff',
    ])
  })
})
