import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assessFixtureThresholds,
  buildFixtureDashboardRecord,
  extractFixtureMetrics,
  formatOmrBenchmarkMarkdown,
  OMR_BENCHMARK_STATUS,
  parseChecksum,
  resolveFixtureAssetPath,
  summarizeOmrBenchmarkDashboard,
  validateOmrBenchmarkManifest,
  verifyChecksum,
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
    const ids = manifest.fixtures.map((fixture) => fixture.id)
    expect(ids).toContain('clean')
    expect(ids).toContain('dense')
    expect(ids).toContain('simple')
  })

  it('includes La Campanella as optional, diagnostic-only fixtures with checksums', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'benchmarks/omr-benchmark.manifest.json'), 'utf8'),
    )
    const campanella = manifest.fixtures.filter((fixture) => fixture.id.startsWith('campanella'))
    expect(campanella.length).toBeGreaterThanOrEqual(1)
    for (const fixture of campanella) {
      expect(fixture.optional).toBe(true)
      expect(fixture.diagnosticOnly).toBe(true)
      // Diagnostic-only fixtures must not carry pass/fail thresholds.
      expect(fixture.thresholds).toBeUndefined()
      expect(fixture.checksums?.pdf).toMatch(/^sha256:/)
      expect(fixture.checksums?.truth).toMatch(/^sha256:/)
    }
  })

  it('every fixture declares stable checksums for integrity', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'benchmarks/omr-benchmark.manifest.json'), 'utf8'),
    )
    expect(Array.isArray(manifest.fixtureSearchPaths)).toBe(true)
    for (const fixture of manifest.fixtures) {
      expect(fixture.checksums?.pdf).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(fixture.checksums?.truth).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
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
    expect(metrics.topPitchErrorCategory?.category).toBeTruthy()
    expect(metrics.errorGrouping?.primarySource).toBe('rhythm-inference')
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
    expect(markdown).toContain('Aggregated duration error histogram')
    expect(summary.fixtureCount).toBe(2)
    expect(summary.version).toBe(2)
    expect(summary.aggregatedDurationTop?.length).toBeGreaterThan(0)
  })

  it('surfaces ScoreGraph clip promotion diagnostics when present', () => {
    const record = buildFixtureDashboardRecord({
      fixture: { id: 'dense', label: 'Dense', pdf: '~/y.pdf', truth: '~/y.mxl' },
      report: {
        ...sampleDenseReport,
        generatedOmrDiagnostics: {
          ...sampleDenseReport.generatedOmrDiagnostics,
          scoreGraphClipPromotion: {
            enabled: true,
            promotedMeasureCount: 2,
            promotedDecisions: 3,
            skippedCount: 1,
            promotedMeasureNumbers: [5, 9],
          },
        },
      },
    })
    const summary = summarizeOmrBenchmarkDashboard([record])
    const markdown = formatOmrBenchmarkMarkdown(summary)

    expect(record.scoreGraphClipPromotion.promotedMeasureNumbers).toEqual([5, 9])
    expect(markdown).toContain('ScoreGraph clip promotion: 2 measures, 3 decisions, skipped 1')
    expect(markdown).toContain('promoted measures: 5, 9')
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

  it('resolves fixture assets across search paths, honoring existence', () => {
    const present = new Set(['/root/tmp/sprint1/song.pdf'])
    const resolved = resolveFixtureAssetPath({
      fileName: 'song.pdf',
      searchPaths: ['benchmarks/omr-fixtures', '~/Downloads', 'tmp/sprint1'],
      rootDir: '/root',
      homeDir: '/home/me',
      exists: (candidate) => present.has(candidate),
    })
    expect(resolved.candidates).toEqual([
      '/root/benchmarks/omr-fixtures/song.pdf',
      '/home/me/Downloads/song.pdf',
      '/root/tmp/sprint1/song.pdf',
    ])
    expect(resolved.resolvedPath).toBe('/root/tmp/sprint1/song.pdf')
  })

  it('falls back to a legacy absolute path when provided', () => {
    const resolved = resolveFixtureAssetPath({
      fileName: 'song.pdf',
      legacyPath: '~/Downloads/song.pdf',
      searchPaths: ['benchmarks/omr-fixtures'],
      rootDir: '/root',
      homeDir: '/home/me',
      exists: (candidate) => candidate === '/home/me/Downloads/song.pdf',
    })
    expect(resolved.resolvedPath).toBe('/home/me/Downloads/song.pdf')
  })

  it('parses and verifies sha256 checksums', () => {
    expect(parseChecksum('sha256:ABCDEF')).toEqual({ algorithm: 'sha256', digest: 'abcdef' })
    expect(parseChecksum('abcdef')).toEqual({ algorithm: 'sha256', digest: 'abcdef' })
    expect(verifyChecksum('sha256:abc', 'ABC')).toMatchObject({ ok: true })
    expect(verifyChecksum('sha256:abc', 'def')).toMatchObject({ ok: false })
    expect(verifyChecksum(null, 'def')).toBeNull()
  })

  it('treats diagnostic-only fixtures as non-blocking (skipped) even when metrics are poor', () => {
    const record = buildFixtureDashboardRecord({
      fixture: {
        id: 'campanella-grandes',
        label: 'La Campanella',
        optional: true,
        diagnosticOnly: true,
        thresholds: { pitchAccuracy: 0.99 },
      },
      report: sampleDenseReport,
    })
    expect(record.status).toBe(OMR_BENCHMARK_STATUS.SKIPPED)
    expect(record.diagnosticOnly).toBe(true)
    expect(record.thresholdFailures).toEqual([])
    // Metrics are still observed for diagnostics.
    expect(record.metrics?.namedErrorBuckets).toBeTruthy()
  })

  it('skips optional fixtures when assets are missing', () => {
    const missing = new Error('Missing assets: pdf x')
    missing.code = 'missing-assets'
    const record = buildFixtureDashboardRecord({
      fixture: { id: 'campanella-etude', label: 'La Campanella (etude)', optional: true },
      error: missing,
    })
    expect(record.status).toBe(OMR_BENCHMARK_STATUS.SKIPPED)
  })

  it('surfaces the largest remaining error bucket in the summary + markdown', () => {
    const summary = summarizeOmrBenchmarkDashboard([
      buildFixtureDashboardRecord({
        fixture: { id: 'dense', label: 'Dense' },
        report: sampleDenseReport,
      }),
    ])
    expect(summary.largestNamedBucket).toBeTruthy()
    expect(summary.largestNamedBucket.count).toBeGreaterThan(0)
    expect(summary.rankedNamedBuckets.length).toBeGreaterThan(0)
    const markdown = formatOmrBenchmarkMarkdown(summary)
    expect(markdown).toContain('Largest remaining error bucket')
    expect(markdown).toContain('## Error buckets (across fixtures)')
  })

  it('includes V2 rhythm attribution and hotspot traces for dense fixtures', () => {
    const currentDense = JSON.parse(
      readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
    )
    const record = buildFixtureDashboardRecord({
      fixture: { id: 'dense', label: "A Cruel Angel's Thesis (dense)" },
      report: currentDense,
    })
    expect(record.metrics.rhythmErrorAttribution?.ranked?.length).toBeGreaterThan(0)
    expect(record.hotspotDiagnostics?.measureNumbers).toEqual([7, 9, 121])
    const markdown = formatOmrBenchmarkMarkdown(summarizeOmrBenchmarkDashboard([record]))
    expect(markdown).toContain('Rhythm/voice attribution (V2 Phase 1)')
    expect(markdown).toContain('Hotspot measures (dense)')
    expect(markdown).toContain('m9: 18 wrong onsets')
  })
})
