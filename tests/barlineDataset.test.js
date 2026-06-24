import { describe, expect, it } from 'vitest'
import {
  BARLINE_DATASET_VERSION,
  BARLINE_LABEL,
  BARLINE_LABEL_VALUES,
  DETECTOR_DECISION,
  buildBarlineSampleId,
  buildBarlineSampleRecord,
  buildCropRelativePath,
  mergeBarlineLabels,
  summarizeBarlineLabels,
  validateBarlineDatasetManifest,
  validateBarlineLabelsFile,
  validateBarlineSample,
} from '../src/features/score-follow/barlineDataset.js'
import { exportBarlineSamplesFromPage } from '../scripts/lib/barlineDatasetExport.mjs'
import { cleanPianoPage } from './helpers/syntheticScore.js'

describe('barlineDataset schema', () => {
  it('defines six human label categories', () => {
    expect(BARLINE_LABEL_VALUES).toHaveLength(6)
    expect(BARLINE_LABEL_VALUES).toContain(BARLINE_LABEL.REAL_BARLINE)
    expect(BARLINE_LABEL_VALUES).toContain(BARLINE_LABEL.FAKE_STEM)
    expect(BARLINE_LABEL_VALUES).toContain(BARLINE_LABEL.MISSING_BARLINE)
  })

  it('builds stable sample ids and crop paths', () => {
    const id = buildBarlineSampleId({ pieceId: 'minuet-in-g', page: 1, systemIndex: 0, xPx: 234 })
    expect(id).toBe('minuet-in-g-p1-s0-x234')
    expect(buildCropRelativePath(id)).toBe('crops/minuet-in-g-p1-s0-x234.png')
  })

  it('validates manifest samples', () => {
    const sample = buildBarlineSampleRecord({
      pieceId: 'synthetic-clean-1page',
      page: 1,
      systemIndex: 0,
      x: 0.42,
      xPx: 420,
      expectedMeasuresPerSystem: 4,
      features: {
        treble: { maxRunFrac: 0.9, inkFrac: 0.2, transitions: 2 },
        bass: { maxRunFrac: 0.88, inkFrac: 0.18, transitions: 2 },
        gap: { maxRunFrac: 0.3, inkFrac: 0.05, transitions: 4 },
        full: { maxRunFrac: 0.95, inkFrac: 0.25, transitions: 6 },
        stemSignals: 0,
        trebleStrong: true,
        bassStrong: true,
        gapStrong: false,
        fullStrong: true,
        hasBarlineShape: true,
        score: 2.4,
      },
      detector: {
        decision: DETECTOR_DECISION.ACCEPTED_HIGH,
        confidence: 'high',
        rejectReason: null,
        finalAccepted: true,
      },
    })

    expect(validateBarlineSample(sample).ok).toBe(true)

    const manifest = {
      version: BARLINE_DATASET_VERSION,
      generatedAt: new Date().toISOString(),
      samples: [sample],
    }
    expect(validateBarlineDatasetManifest(manifest).ok).toBe(true)
  })

  it('rejects invalid labels', () => {
    const result = validateBarlineLabelsFile({
      version: BARLINE_DATASET_VERSION,
      labels: { 'sample-1': 'not-a-label' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/invalid label/)
  })

  it('merges and summarizes labels', () => {
    const merged = mergeBarlineLabels(
      { version: 1, labels: { a: BARLINE_LABEL.REAL_BARLINE } },
      { b: BARLINE_LABEL.FAKE_STEM },
    )
    expect(validateBarlineLabelsFile(merged).ok).toBe(true)
    const summary = summarizeBarlineLabels(merged)
    expect(summary.total).toBe(2)
    expect(summary.counts[BARLINE_LABEL.REAL_BARLINE]).toBe(1)
  })
})

describe('barlineDataset export', () => {
  it('exports manifest-shaped samples from a synthetic page (dry-run)', async () => {
    const page = cleanPianoPage({ systems: 2, measuresPerSystem: 4 })
    const samples = await exportBarlineSamplesFromPage({
      imageData: page,
      pieceId: 'synthetic-clean-1page',
      pageNumber: 1,
      expectedMeasuresPerSystem: 4,
      options: { dryRun: true, maxPerSystem: 20 },
    })

    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every((s) => s.id && s.features && s.detector)).toBe(true)
    expect(samples.some((s) => s.detector.decision === DETECTOR_DECISION.ACCEPTED_HIGH)).toBe(true)

    const manifest = {
      version: BARLINE_DATASET_VERSION,
      generatedAt: new Date().toISOString(),
      samples,
    }
    expect(validateBarlineDatasetManifest(manifest).ok).toBe(true)
  })
})
