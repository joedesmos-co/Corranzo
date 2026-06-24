/**
 * Export barline candidate crops + manifest from benchmark corpus pages.
 * Script-only — Node + @napi-rs/canvas.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectBarlineCandidates } from '../../src/features/score-follow/detectBarlinesInSystem.js'
import { detectContentBounds } from '../../src/features/score-follow/detectStaffSystems.js'
import {
  detectStaffLineSystems,
  estimateInkThreshold,
} from '../../src/features/score-follow/detectStaffLines.js'
import {
  BARLINE_DATASET_VERSION,
  buildBarlineSampleRecord,
  validateBarlineDatasetManifest,
  DETECTOR_DECISION,
} from '../../src/features/score-follow/barlineDataset.js'
import {
  annotateFinalAcceptedColumns,
  scanBarlineColumnCandidates,
} from '../../src/features/score-follow/barlineDatasetScan.js'
import { selectManifestEntries } from '../../src/features/score-follow/alignmentBenchmark.js'
import { resolveEntryAssets } from './benchmarkCorpusRunners.mjs'

const DEFAULT_CROP_HALF_WIDTH = 14
const DEFAULT_MAX_PER_SYSTEM = 48

function priorityForColumn(column) {
  const decision = column.detector.decision
  if (decision === DETECTOR_DECISION.ACCEPTED_HIGH) return 0
  if (decision === DETECTOR_DECISION.ACCEPTED_LOW) return 1
  if (decision === DETECTOR_DECISION.THINNED) return 2
  if (decision === DETECTOR_DECISION.REJECTED) return 3
  return 4
}

function selectColumnsForExport(columns, maxPerSystem) {
  const sorted = [...columns].sort((a, b) => {
    const pa = priorityForColumn(a)
    const pb = priorityForColumn(b)
    if (pa !== pb) return pa - pb
    return (b.features.score ?? 0) - (a.features.score ?? 0)
  })
  return sorted.slice(0, maxPerSystem)
}

export async function exportBarlineSamplesFromPage({
  imageData,
  pieceId,
  pageNumber,
  expectedMeasuresPerSystem = null,
  stavesPerSystem = 2,
  options = {},
}) {
  const {
    cropHalfWidth = DEFAULT_CROP_HALF_WIDTH,
    maxPerSystem = DEFAULT_MAX_PER_SYSTEM,
    includeMargin = false,
    darkThreshold = null,
    dryRun = false,
    createCanvas = null,
  } = options

  const bounds = detectContentBounds(imageData)
  const inkThreshold = darkThreshold ?? estimateInkThreshold(imageData, bounds)
  const barlineThreshold = Math.min(inkThreshold, Math.max(150, inkThreshold - 20))
  const { systems } = detectStaffLineSystems(imageData, bounds, {
    stavesPerSystem,
    darkThreshold: inkThreshold,
  })

  const samples = []

  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const system = systems[systemIndex]
    const systemBand = { y0: system.y0, y1: system.y1 }
    const { positions, diagnostics } = detectBarlineCandidates(imageData, bounds, systemBand, {
      darkThreshold: barlineThreshold,
    })
    const scan = scanBarlineColumnCandidates(imageData, bounds, systemBand, {
      darkThreshold: barlineThreshold,
      includeMargin,
    })
    annotateFinalAcceptedColumns(
      scan.columns,
      positions,
      imageData.width,
      scan.mergeGapPx,
    )

    const selected = selectColumnsForExport(scan.columns, maxPerSystem)
    const { width, height, data } = imageData
    const y0Px = Math.max(0, Math.floor(system.y0 * height))
    const y1Px = Math.min(height - 1, Math.ceil(system.y1 * height))

    for (const column of selected) {
      const sample = buildBarlineSampleRecord({
        pieceId,
        page: pageNumber,
        systemIndex,
        x: column.x,
        xPx: column.xPx,
        expectedMeasuresPerSystem,
        features: column.features,
        detector: column.detector,
        bands: scan.bands,
      })

      if (!dryRun && createCanvas) {
        const x0 = Math.max(0, column.xPx - cropHalfWidth)
        const x1 = Math.min(width - 1, column.xPx + cropHalfWidth)
        const cropW = x1 - x0 + 1
        const cropH = y1Px - y0Px + 1
        const canvas = createCanvas(cropW, cropH)
        const ctx = canvas.getContext('2d')
        const cropData = ctx.createImageData(cropW, cropH)
        for (let y = 0; y < cropH; y += 1) {
          for (let x = 0; x < cropW; x += 1) {
            const src = ((y0Px + y) * width + (x0 + x)) * 4
            const dst = (y * cropW + x) * 4
            cropData.data[dst] = data[src]
            cropData.data[dst + 1] = data[src + 1]
            cropData.data[dst + 2] = data[src + 2]
            cropData.data[dst + 3] = data[src + 3]
          }
        }
        ctx.putImageData(cropData, 0, 0)
        sample._pngBuffer = canvas.toBuffer('image/png')
      }

      sample._systemDiagnostics = {
        barlineCount: positions.length,
        densityAmbiguous: diagnostics.densityAmbiguous,
        thinningRemoved: diagnostics.thinningRemoved,
      }
      samples.push(sample)
    }
  }

  return samples
}

export async function exportBarlineDataset(manifest, rootDir, outDir, options = {}) {
  const {
    ciOnly = true,
    download = false,
    dryRun = false,
    maxPerSystem = DEFAULT_MAX_PER_SYSTEM,
    includeMargin = false,
    pieceIds = null,
  } = options

  let entries = selectManifestEntries(manifest, { ciOnly })
  if (pieceIds?.length) {
    const allow = new Set(pieceIds)
    entries = entries.filter((e) => allow.has(e.id))
  }

  const cropsDir = join(outDir, 'crops')
  if (!dryRun) {
    mkdirSync(cropsDir, { recursive: true })
  }

  let createCanvas = null
  if (!dryRun) {
    const { createCanvas: cc } = await import('@napi-rs/canvas')
    createCanvas = cc
  }

  const allSamples = []
  const pieces = []

  for (const entry of entries) {
    const assets = await resolveEntryAssets(entry, rootDir, { download })
    if (!assets.ok) {
      pieces.push({ id: entry.id, status: 'skipped', reason: assets.skipReason ?? assets.detail })
      continue
    }

    const expectedMeasures =
      entry.expected?.systems && entry.expected?.measures
        ? Math.round(entry.expected.measures / entry.expected.systems)
        : entry.expected?.measuresPerSystem ?? null

    const pieceSamples = []
    for (let pageNumber = 1; pageNumber <= assets.numPages; pageNumber += 1) {
      const { imageData } = await assets.renderPage(assets.pdfPath ?? entry.id, pageNumber)
      const pageSamples = await exportBarlineSamplesFromPage({
        imageData,
        pieceId: entry.id,
        pageNumber,
        expectedMeasuresPerSystem: expectedMeasures,
        stavesPerSystem: 2,
        options: {
          dryRun,
          createCanvas,
          maxPerSystem,
          includeMargin,
        },
      })
      pieceSamples.push(...pageSamples)
    }

    for (const sample of pieceSamples) {
      if (!dryRun && sample._pngBuffer) {
        const cropPath = join(outDir, sample.cropPath)
        writeFileSync(cropPath, sample._pngBuffer)
      }
      delete sample._pngBuffer
      delete sample._systemDiagnostics
      allSamples.push(sample)
    }

    pieces.push({
      id: entry.id,
      status: 'ok',
      samples: pieceSamples.length,
      title: entry.title ?? entry.id,
    })
  }

  const manifestOut = {
    version: BARLINE_DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    export: {
      ciOnly,
      dryRun,
      maxPerSystem,
      includeMargin,
    },
    pieces,
    samples: allSamples,
  }

  const validation = validateBarlineDatasetManifest(manifestOut)
  if (!validation.ok) {
    throw new Error(`Invalid export manifest:\n  - ${validation.errors.join('\n  - ')}`)
  }

  if (!dryRun) {
    writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifestOut, null, 2)}\n`)
  }

  return manifestOut
}
