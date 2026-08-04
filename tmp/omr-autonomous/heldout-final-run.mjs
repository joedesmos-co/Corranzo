#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMMatrix } from '@napi-rs/canvas'

globalThis.DOMMatrix = globalThis.DOMMatrix ?? DOMMatrix

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/omr-autonomous')

const SCORES = [
  {
    id: 'twinkle-chord-substitutions',
    title: '5 Levels of Chord Substitutions with Twinkle Twinkle Little Star',
    pdf: '/Users/ryland/Downloads/5-levels-of-chords-substitutions-with-twinkle-twinkle-little-star.pdf',
  },
  {
    id: 'ao-no-sumika',
    title: 'Ao no Sumika (Piano)',
    pdf: '/Users/ryland/Downloads/Ao no Sumika (Piano).pdf',
  },
  {
    id: 'aria-math',
    title: 'Aria Math — C418 from Minecraft',
    pdf: '/Users/ryland/Downloads/aria-math-c418-from-minecraft.pdf',
  },
  {
    id: 'aizo',
    title: 'Jujutsu Kaisen Season 3 Opening 1 — AIZO',
    pdf: '/Users/ryland/Downloads/jujutsu-kaisen-season-3-opening-1-aizo-king-gnu.pdf',
  },
  {
    id: 'merry-go-round-of-life',
    title: 'Merry-Go-Round of Life — Howl’s Moving Castle',
    pdf: '/Users/ryland/Downloads/merry-go-round-of-life-howls-moving-castle-piano-tutorial.pdf',
  },
  {
    id: 'sweden',
    title: 'Minecraft Theme — Sweden / Calm',
    pdf: '/Users/ryland/Downloads/minecraft-theme-sweden-calm.pdf',
  },
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sourceFingerprint() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim()
  const diff = execFileSync(
    'git',
    ['diff', '--no-ext-diff', '--binary', '--', 'src/features/omr'],
    { cwd: ROOT },
  )
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', 'src/features/omr'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort()
  const untrackedPayload = untracked.map((path) => {
    const absolute = join(ROOT, path)
    return `${path}\0${sha256(readFileSync(absolute))}`
  })
  const workingTreeSha256 = sha256(
    Buffer.concat([
      diff,
      Buffer.from(`\0${untrackedPayload.join('\0')}\0`),
    ]),
  )
  return {
    head,
    workingTreeSha256,
    id: `${head}:${workingTreeSha256}`,
    untrackedProductionFiles: untracked,
  }
}

function pdfSha256(path) {
  return sha256(readFileSync(path))
}

function compactNoteheadDiagnostics(value = {}) {
  return {
    scope: value.scope ?? null,
    eligibleSampleCount: value.eligibleSampleCount ?? 0,
    accepted: value.accepted ?? [],
    rejected: value.rejected ?? [],
    appliedCount: value.appliedCount ?? 0,
    byInkRejectionReason: value.byInkRejectionReason ?? {},
  }
}

function compactAccidentalDiagnostics(value = {}) {
  return {
    scope: value.scope ?? null,
    attempted: Boolean(value.attempted),
    directCandidateCount: value.directCandidateCount ?? 0,
    rawSampleCount: value.rawSampleCount ?? 0,
    eligibleSampleCount: value.eligibleSampleCount ?? 0,
    accepted: value.accepted ?? [],
    rejected: value.rejected ?? [],
    appliedCount: value.appliedCount ?? 0,
  }
}

function sumCalibrationPages(pages) {
  const notehead = {
    eligibleSampleCount: 0,
    acceptedModelCount: 0,
    rejectedModelCount: 0,
    appliedCount: 0,
    byInkRejectionReason: {},
  }
  const accidentalPath = {
    attemptedPageCount: 0,
    directCandidateCount: 0,
    rawSampleCount: 0,
    eligibleSampleCount: 0,
    acceptedModelCount: 0,
    rejectedModelCount: 0,
    appliedCount: 0,
  }
  for (const page of pages) {
    const n = page.noteheadFallbackCalibration
    notehead.eligibleSampleCount += n.eligibleSampleCount
    notehead.acceptedModelCount += n.accepted.length
    notehead.rejectedModelCount += n.rejected.length
    notehead.appliedCount += n.appliedCount
    for (const [reason, count] of Object.entries(n.byInkRejectionReason)) {
      notehead.byInkRejectionReason[reason] =
        (notehead.byInkRejectionReason[reason] ?? 0) + count
    }
    const a = page.accidentalPathCalibration
    accidentalPath.attemptedPageCount += Number(a.attempted)
    accidentalPath.directCandidateCount += a.directCandidateCount
    accidentalPath.rawSampleCount += a.rawSampleCount
    accidentalPath.eligibleSampleCount += a.eligibleSampleCount
    accidentalPath.acceptedModelCount += a.accepted.length
    accidentalPath.rejectedModelCount += a.rejected.length
    accidentalPath.appliedCount += a.appliedCount
  }
  return { notehead, accidentalPath }
}

async function runWorker(score) {
  const startedAt = new Date().toISOString()
  const startedNs = process.hrtime.bigint()
  const sourceAtStart = sourceFingerprint()
  const pageCalibrations = []
  let expectedPageCount = 0
  let result = null
  let fatalError = null

  try {
    const {
      makePdfCurveExtractor,
      makePdfTextExtractor,
      makeRenderPageCallback,
      renderPdfToPages,
    } = await import('../../scripts/lib/renderPdfPages.mjs')
    const { runPdfOmrPipeline } = await import(
      '../../src/features/omr/runPdfOmrPipeline.js'
    )
    const { processOmrPageAnalysis } = await import(
      '../../src/features/omr/processOmrPage.js'
    )

    const rendered = await renderPdfToPages(score.pdf, { rootDir: ROOT })
    expectedPageCount = rendered.numPages
    const extractPageText = await makePdfTextExtractor(score.pdf, {
      rootDir: ROOT,
    })
    const extractPageCurves = await makePdfCurveExtractor(score.pdf, {
      rootDir: ROOT,
    })
    result = await runPdfOmrPipeline(score.pdf, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      extractPageCurves,
      numPages: rendered.numPages,
      maxPages: rendered.numPages,
      instrumentId: 'piano',
      title: score.title,
      analyzePage(imageData, context) {
        const pageResult = processOmrPageAnalysis(imageData, context)
        pageCalibrations.push({
          page: context.page,
          source: pageResult.source ?? null,
          systems: pageResult.stats?.systems ?? 0,
          notes: pageResult.stats?.notes ?? 0,
          measures: pageResult.stats?.measures ?? 0,
          uncertainMeasures: pageResult.stats?.uncertainMeasures ?? 0,
          noteheadFallbackCalibration: compactNoteheadDiagnostics(
            pageResult.noteheadFallbackCalibrationDiagnostics,
          ),
          accidentalPathCalibration: compactAccidentalDiagnostics(
            pageResult.accidentalPathCalibrationDiagnostics,
          ),
        })
        return pageResult
      },
    })
  } catch (error) {
    fatalError = {
      name: error?.name ?? null,
      code: error?.code ?? null,
      message: String(error?.message ?? error),
      stack: error?.stack ?? null,
    }
  }

  const elapsedMs = Number(process.hrtime.bigint() - startedNs) / 1e6
  const sourceAtEnd = sourceFingerprint()
  const partialFailures = result?.diagnostics?.partialRecovery?.failedPages ?? []
  const calibration = sumCalibrationPages(pageCalibrations)
  const pageConfidenceRows = Array.isArray(result?.diagnostics?.pages)
    ? result.diagnostics.pages
        .map((page) => Number(page?.confidence))
        .filter(Number.isFinite)
    : []
  const meanPageConfidence = pageConfidenceRows.length
    ? pageConfidenceRows.reduce((sum, value) => sum + value, 0) /
      pageConfidenceRows.length
    : null
  const record = {
    version: 1,
    kind: 'heldout-final-pdf-omr-audit',
    generatedAt: new Date().toISOString(),
    startedAt,
    id: score.id,
    title: score.title,
    pdf: score.pdf,
    pdfBasename: basename(score.pdf),
    pdfSha256: pdfSha256(score.pdf),
    sourceAtStart,
    sourceAtEnd,
    sourceStable: sourceAtStart.id === sourceAtEnd.id,
    pages: expectedPageCount || pageCalibrations.length,
    processedPages: result?.diagnostics?.partialRecovery?.successfulPages ?? 0,
    notes: result?.noteCount ?? 0,
    measures: result?.measureCount ?? 0,
    confidence: meanPageConfidence,
    pipelineOverallConfidence: result?.overallConfidence ?? null,
    uncertainMeasures: result?.uncertainMeasures ?? 0,
    acceptance: result?.acceptance ?? null,
    warnings: result?.warnings ?? [],
    fatalFailureCount: fatalError ? 1 : 0,
    partialFailureCount: partialFailures.length,
    failureCount: Number(Boolean(fatalError)) + partialFailures.length,
    fatalError,
    partialFailures,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    peakRssKiB: process.resourceUsage().maxRSS,
    peakRssMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(3)),
    calibration,
    pageCalibrations,
    performance: result?.diagnostics?.performance ?? null,
  }
  writeFileSync(
    join(OUT, `heldout-final-${score.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  )
  process.stdout.write(
    `${score.id}: pages=${record.pages} notes=${record.notes} measures=${record.measures} uncertain=${record.uncertainMeasures} failures=${record.failureCount} elapsed=${(record.elapsedMs / 1000).toFixed(3)}s rss=${record.peakRssMiB.toFixed(1)}MiB\n`,
  )
  return record
}

function markdown(summary) {
  const lines = [
    '# Final held-out user-PDF OMR audit',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    `Source: \`${summary.sourceAtStart.head}\` with production working-tree fingerprint \`${summary.sourceAtStart.workingTreeSha256}\`. Source stable across run: **${summary.sourceStable ? 'yes' : 'NO'}**.`,
    '',
    '| PDF | Pages | Notes | Measures | Confidence | Uncertain | Failures | Elapsed | Peak RSS | Notehead models/applied | Accidental models/applied |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ]
  for (const r of summary.records) {
    lines.push(
      `| ${r.pdfBasename.replaceAll('|', '\\|')} | ${r.pages} | ${r.notes} | ${r.measures} | ${r.confidence == null ? 'n/a' : r.confidence.toFixed(4)} | ${r.uncertainMeasures} | ${r.failureCount} | ${(r.elapsedMs / 1000).toFixed(3)}s | ${r.peakRssMiB.toFixed(1)} MiB | ${r.calibration.notehead.acceptedModelCount}/${r.calibration.notehead.appliedCount} | ${r.calibration.accidentalPath.acceptedModelCount}/${r.calibration.accidentalPath.appliedCount} |`,
    )
  }
  lines.push(
    `| **Total** | **${summary.totals.pages}** | **${summary.totals.notes}** | **${summary.totals.measures}** | — | **${summary.totals.uncertainMeasures}** | **${summary.totals.failures}** | **${(summary.totals.elapsedMs / 1000).toFixed(3)}s** | — | **${summary.totals.noteheadAcceptedModels}/${summary.totals.noteheadApplied}** | **${summary.totals.accidentalAcceptedModels}/${summary.totals.accidentalApplied}** |`,
    '',
    '## Preliminary comparison',
    '',
    `- Notes: 6,912 → ${summary.totals.notes} (${summary.comparison.notesDelta >= 0 ? '+' : ''}${summary.comparison.notesDelta})`,
    `- Measures: 613 → ${summary.totals.measures} (${summary.comparison.measuresDelta >= 0 ? '+' : ''}${summary.comparison.measuresDelta})`,
    `- Uncertain measures: 6 → ${summary.totals.uncertainMeasures} (${summary.comparison.uncertainDelta >= 0 ? '+' : ''}${summary.comparison.uncertainDelta})`,
    `- Failures: 0 → ${summary.totals.failures} (${summary.comparison.failuresDelta >= 0 ? '+' : ''}${summary.comparison.failuresDelta})`,
    `- Elapsed: 21.08s → ${(summary.totals.elapsedMs / 1000).toFixed(3)}s (${summary.comparison.elapsedSecondsDelta >= 0 ? '+' : ''}${summary.comparison.elapsedSecondsDelta.toFixed(3)}s; independently rounded per-file timings)`,
    '',
    '## Calibration safety',
    '',
    `- Notehead fallback: ${summary.totals.noteheadEligibleSamples} eligible samples, ${summary.totals.noteheadAcceptedModels} accepted models, ${summary.totals.noteheadApplied} applied corrections.`,
    `- Accidental path offset: attempted on ${summary.totals.accidentalAttemptedPages} pages from ${summary.totals.accidentalDirectCandidates} direct path candidates; ${summary.totals.accidentalEligibleSamples} eligible samples, ${summary.totals.accidentalAcceptedModels} accepted models, ${summary.totals.accidentalApplied} calibrated attachments.`,
    '',
    'Per-page accepted/rejected model details are preserved in the JSON records.',
    '',
  )
  return `${lines.join('\n')}\n`
}

async function runController() {
  mkdirSync(OUT, { recursive: true })
  for (const score of SCORES) {
    if (!existsSync(score.pdf)) {
      throw new Error(`Missing held-out PDF: ${score.pdf}`)
    }
  }
  const sourceAtStart = sourceFingerprint()
  const rawLog = []
  for (const score of SCORES) {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), '--worker', score.id],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    rawLog.push(`\n===== ${score.id} stdout =====\n${child.stdout ?? ''}`)
    rawLog.push(`\n===== ${score.id} stderr =====\n${child.stderr ?? ''}`)
    const statusLine = (child.stdout ?? '')
      .split('\n')
      .find((line) => line.startsWith(`${score.id}:`))
    if (statusLine) process.stdout.write(`${statusLine}\n`)
    if (child.status !== 0) {
      throw new Error(`Held-out worker ${score.id} exited ${child.status}`)
    }
  }
  const records = SCORES.map((score) =>
    JSON.parse(
      readFileSync(join(OUT, `heldout-final-${score.id}.json`), 'utf8'),
    ),
  )
  writeFileSync(join(OUT, 'heldout-final-run.log'), rawLog.join(''))
  const sourceAtEnd = sourceFingerprint()
  const fingerprints = new Set([
    sourceAtStart.id,
    sourceAtEnd.id,
    ...records.flatMap((r) => [r.sourceAtStart.id, r.sourceAtEnd.id]),
  ])
  const totals = {
    pages: records.reduce((sum, r) => sum + r.pages, 0),
    processedPages: records.reduce((sum, r) => sum + r.processedPages, 0),
    notes: records.reduce((sum, r) => sum + r.notes, 0),
    measures: records.reduce((sum, r) => sum + r.measures, 0),
    uncertainMeasures: records.reduce((sum, r) => sum + r.uncertainMeasures, 0),
    failures: records.reduce((sum, r) => sum + r.failureCount, 0),
    elapsedMs: Number(
      records.reduce((sum, r) => sum + r.elapsedMs, 0).toFixed(3),
    ),
    noteheadEligibleSamples: records.reduce(
      (sum, r) => sum + r.calibration.notehead.eligibleSampleCount,
      0,
    ),
    noteheadAcceptedModels: records.reduce(
      (sum, r) => sum + r.calibration.notehead.acceptedModelCount,
      0,
    ),
    noteheadApplied: records.reduce(
      (sum, r) => sum + r.calibration.notehead.appliedCount,
      0,
    ),
    accidentalAttemptedPages: records.reduce(
      (sum, r) => sum + r.calibration.accidentalPath.attemptedPageCount,
      0,
    ),
    accidentalDirectCandidates: records.reduce(
      (sum, r) => sum + r.calibration.accidentalPath.directCandidateCount,
      0,
    ),
    accidentalEligibleSamples: records.reduce(
      (sum, r) => sum + r.calibration.accidentalPath.eligibleSampleCount,
      0,
    ),
    accidentalAcceptedModels: records.reduce(
      (sum, r) => sum + r.calibration.accidentalPath.acceptedModelCount,
      0,
    ),
    accidentalApplied: records.reduce(
      (sum, r) => sum + r.calibration.accidentalPath.appliedCount,
      0,
    ),
  }
  const summary = {
    version: 1,
    kind: 'heldout-final-user-pdf-omr-summary',
    generatedAt: new Date().toISOString(),
    sourceAtStart,
    sourceAtEnd,
    sourceStable: fingerprints.size === 1,
    sourceFingerprints: [...fingerprints],
    preliminary: {
      notes: 6912,
      measures: 613,
      uncertainMeasures: 6,
      failures: 0,
      elapsedSeconds: 21.08,
    },
    totals,
    comparison: {
      notesDelta: totals.notes - 6912,
      measuresDelta: totals.measures - 613,
      uncertainDelta: totals.uncertainMeasures - 6,
      failuresDelta: totals.failures,
      elapsedSecondsDelta: totals.elapsedMs / 1000 - 21.08,
    },
    records,
  }
  writeFileSync(
    join(OUT, 'heldout-final-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  writeFileSync(
    join(OUT, 'heldout-final-summary.md'),
    markdown(summary),
  )
  process.stdout.write(
    `summary: pages=${totals.pages} notes=${totals.notes} measures=${totals.measures} uncertain=${totals.uncertainMeasures} failures=${totals.failures} elapsed=${(totals.elapsedMs / 1000).toFixed(3)}s stable=${summary.sourceStable}\n`,
  )
}

const workerIndex = process.argv.indexOf('--worker')
if (workerIndex >= 0) {
  const id = process.argv[workerIndex + 1]
  const score = SCORES.find((candidate) => candidate.id === id)
  if (!score) throw new Error(`Unknown held-out score: ${id}`)
  await runWorker(score)
} else {
  await runController()
}
