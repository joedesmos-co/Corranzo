import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROMOTION_STATUS } from '../src/features/score-follow/anchorComparison.js'
import {
  validateManifest,
  selectManifestEntries,
  buildPieceBenchmarkRecord,
  categorizeBlockers,
  summarizeBenchmarkResults,
  formatBenchmarkSummaryText,
  pieceRecordsToCsv,
  serializeBenchmarkReport,
  BLOCKER_CATEGORIES,
} from '../src/features/score-follow/alignmentBenchmark.js'

const manifestPath = fileURLToPath(
  new URL('../benchmarks/alignment-corpus.manifest.json', import.meta.url),
)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

describe('alignmentBenchmark manifest', () => {
  it('validates the bundled corpus manifest', () => {
    const result = validateManifest(manifest)
    expect(result.ok).toBe(true)
    expect(manifest.entries.length).toBeGreaterThanOrEqual(25)
  })

  it('selects CI-safe entries without remote-only pieces', () => {
    const ci = selectManifestEntries(manifest, { ciOnly: true })
    expect(ci.length).toBeGreaterThanOrEqual(5)
    expect(ci.every((e) => e.runInCi !== false)).toBe(true)
    expect(ci.some((e) => e.runner === 'synthetic')).toBe(true)
  })
})

describe('alignmentBenchmark reporting', () => {
  it('builds piece records with blocker categories', () => {
    const record = buildPieceBenchmarkRecord({
      entry: { id: 'test', title: 'Test', license: 'PD', tags: ['dense'] },
      status: 'ok',
      setup: { ok: true },
      calibration: { ok: true, allocationMode: 'hybrid-reconciled' },
      diagnostics: {
        expectedMeasures: 128,
        detectedMeasures: 147,
        measureDelta: 19,
        calibrationOk: true,
        allocationMode: 'hybrid-reconciled',
        source: {
          indicators: ['measure-count-mismatch', 'midi-derived-timing'],
          editionConflictLikely: true,
          pdfPages: 5,
        },
        systems: {
          total: 27,
          weak: 2,
          extraBarlineEstimate: 19,
          perSystem: [
            {
              systemIndex: 25,
              barlineConfident: false,
              status: 'weak+mismatch',
              rejectedSummary: 'stem-like=46, too-dense=11',
              notes: ['likely 2 extra barlines'],
            },
          ],
        },
        readiness: {
          status: PROMOTION_STATUS.NEEDS_REVIEW,
          reasons: ['PDF vs timing edition conflict detected.'],
        },
        warnings: [],
      },
      alignmentReport: {
        decision: { action: 'confirm' },
        warnings: ['Detected 147 barlines but the score has 128 measures.'],
      },
    })

    expect(record.readiness).toBe(PROMOTION_STATUS.NEEDS_REVIEW)
    expect(record.alignmentAction).toBe('confirm')
    expect(record.blockers).toContain(BLOCKER_CATEGORIES.MEASURE_COUNT_MISMATCH)
    expect(record.blockers).toContain(BLOCKER_CATEGORIES.DENSE_FALSE_BARLINES)
    expect(record.falsePositiveHints.tooDense).toBeGreaterThan(0)
  })

  it('summarizes readiness counts and top blockers', () => {
    const summary = summarizeBenchmarkResults([
      {
        id: 'a',
        status: 'ok',
        readiness: PROMOTION_STATUS.READY,
        alignmentAction: 'auto',
        blockers: [],
      },
      {
        id: 'b',
        status: 'ok',
        readiness: PROMOTION_STATUS.NOT_SAFE,
        alignmentAction: 'manual',
        blockers: [BLOCKER_CATEGORIES.MEASURE_COUNT_MISMATCH, BLOCKER_CATEGORIES.SOURCE_MISMATCH],
      },
      { id: 'c', status: 'skipped', skipReason: 'missing-assets' },
    ])

    expect(summary.ran).toBe(2)
    expect(summary.skipped).toBe(1)
    expect(summary.readiness[PROMOTION_STATUS.READY]).toBe(1)
    expect(summary.topBlockers[0].category).toBe(BLOCKER_CATEGORIES.MEASURE_COUNT_MISMATCH)
    expect(formatBenchmarkSummaryText(summary)).toContain('Alignment corpus benchmark')
  })

  it('exports CSV and JSON reports', () => {
    const records = [
      {
        id: 'synthetic-clean',
        title: 'Clean',
        status: 'ok',
        readiness: PROMOTION_STATUS.READY,
        alignmentAction: 'auto',
        pages: 1,
        measures: 12,
        blockers: [],
        tags: ['simple'],
      },
    ]
    const summary = summarizeBenchmarkResults(records)
    const csv = pieceRecordsToCsv(records)
    const json = serializeBenchmarkReport(summary)

    expect(csv).toContain('id,title,status')
    expect(csv).toContain('synthetic-clean')
    expect(JSON.parse(json).pieces).toHaveLength(1)
  })

  it('categorizes blockers from diagnostics fields', () => {
    const blockers = categorizeBlockers({
      source: { indicators: ['page-count-mismatch'], editionConflictLikely: false },
      systems: { weak: 1, perSystem: [{ rejectedSummary: 'too-dense=3' }] },
      calibrationOk: false,
      setupOk: true,
    })
    expect(blockers).toContain(BLOCKER_CATEGORIES.PAGE_MISMATCH)
    expect(blockers).toContain(BLOCKER_CATEGORIES.DENSE_FALSE_BARLINES)
    expect(blockers).toContain(BLOCKER_CATEGORIES.CALIBRATION_INCOMPLETE)
  })
})
