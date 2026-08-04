/**
 * Reproduce user recognition reports at current HEAD (read-only diagnostics).
 * Does not modify .local/ — writes only under tmp/user-omr-recognition/.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, DOMMatrix } from '@napi-rs/canvas'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildGeneratedSummaryJson } from '../src/features/omr/recognitionProblemReport/buildGeneratedSummary.js'
import {
  renderPdfToPages,
  makeRenderPageCallback,
  makePdfTextExtractor,
  makePdfCurveExtractor,
} from './lib/renderPdfPages.mjs'

// pdfjs-dist may touch DOMMatrix when imported transitively.
globalThis.DOMMatrix = globalThis.DOMMatrix ?? DOMMatrix

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const extracted = join(ROOT, '.local/recognition-reports/extracted')
const outRoot = join(ROOT, 'tmp/user-omr-recognition/baseline/reproductions')
mkdirSync(outRoot, { recursive: true })

const only = (process.env.ONLY_REPORT ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const maxPagesEnv = process.env.MAX_PAGES ? Number(process.env.MAX_PAGES) : null

const dirs = readdirSync(extracted)
  .filter((name) => existsSync(join(extracted, name, 'original-score.pdf')))
  .filter((name) => (only.length ? only.some((token) => name.includes(token)) : true))
  .sort()

function summarizeTies(timingMap) {
  const notes = timingMap?.notes ?? []
  const playable = notes.filter((n) => !n.isRest && n.midi != null)
  let starts = 0
  let stops = 0
  for (const n of playable) {
    if (n.tieStart) starts += 1
    if (n.tieStop) stops += 1
  }
  return { starts, stops, imbalance: starts - stops, playable: playable.length }
}

function summarizeRests(timingMap) {
  const notes = timingMap?.notes ?? []
  return {
    rests: notes.filter((n) => n.isRest).length,
    notes: notes.filter((n) => !n.isRest && n.midi != null).length,
    measures: timingMap?.measures?.length ?? 0,
  }
}

function reportedStructure(summaryPath) {
  if (!existsSync(summaryPath)) return null
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  const notes = summary?.notes ?? summary?.noteInventory ?? null
  const ties = summary?.ties ?? summary?.tieCounts ?? null
  return {
    rests: summary?.rests?.count ?? summary?.restCount ?? notes?.rests ?? null,
    tieStarts: ties?.starts ?? summary?.tieStarts ?? null,
    tieStops: ties?.stops ?? summary?.tieStops ?? null,
    chords: summary?.chords?.count ?? summary?.chordCount ?? null,
    accents: summary?.articulations?.accent ?? null,
    slurStarts: summary?.slurs?.starts ?? null,
  }
}

const results = []
for (const name of dirs) {
  const dir = join(extracted, name)
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'))
  const pdfPath = join(dir, 'original-score.pdf')
  const outDir = join(outRoot, name.replace(/[^\w.-]+/g, '_'))
  mkdirSync(outDir, { recursive: true })
  console.log(`\n=== Reproduce ${name} ===`)
  console.log(`PDF: ${report.score?.sanitizedSourceFilename}`)
  const started = Date.now()
  try {
    const rendered = await renderPdfToPages(pdfPath, {
      rootDir: ROOT,
      maxPages: maxPagesEnv,
    })
    const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
    const extractPageCurves = await makePdfCurveExtractor(pdfPath, { rootDir: ROOT })
    const pageCap = maxPagesEnv
      ? Math.min(rendered.numPages, maxPagesEnv)
      : rendered.numPages
    const result = await runPdfOmrPipeline(pdfPath, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      extractPageCurves,
      numPages: rendered.numPages,
      maxPages: pageCap,
      preprocessPages: true,
      instrumentId: report.score?.instrumentId ?? 'piano',
      title: name,
    })
    const musicXml = result?.musicXml ?? null
    if (musicXml) writeFileSync(join(outDir, 'generated.musicxml'), musicXml)
    const timingMap = musicXml ? parseMusicXml(musicXml, 'repro.musicxml') : null
    const summary = buildGeneratedSummaryJson({
      timingMap,
      omrMeta: result?.omrMeta ?? result?.meta ?? null,
      quality: result?.quality ?? null,
    })
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
    const ties = summarizeTies(timingMap)
    const rests = summarizeRests(timingMap)
    const reported = reportedStructure(join(dir, 'generated-summary.json'))
    const acceptance = result?.quality?.acceptance ?? summary.omrExtraction?.acceptance
    const confidence = result?.quality?.overallConfidence ?? summary.omrExtraction?.overallConfidence
    const tieImbalanceStillPresent = Math.abs(ties.imbalance) >= 5
    const zeroRestsDense =
      rests.rests === 0 && (report.recognition?.noteCount ?? 0) > 200
    const entry = {
      reportId: name,
      source: report.score?.sanitizedSourceFilename,
      ok: true,
      elapsedMs: Date.now() - started,
      pagesProcessed: pageCap,
      totalPages: rendered.numPages,
      reported: {
        measures: report.recognition?.measureCount,
        notes: report.recognition?.noteCount,
        confidence: report.recognition?.overallConfidence,
        acceptance: report.recognition?.acceptance,
        tieStarts: reported?.tieStarts,
        tieStops: reported?.tieStops,
        rests: reported?.rests,
      },
      reproduced: {
        measures: timingMap?.measures?.length ?? null,
        notes: ties.playable,
        rests: rests.rests,
        acceptance,
        confidence,
        tieStarts: ties.starts,
        tieStops: ties.stops,
        tieImbalance: ties.imbalance,
      },
      delta: {
        measures: (timingMap?.measures?.length ?? 0) - (report.recognition?.measureCount ?? 0),
        notes: ties.playable - (report.recognition?.noteCount ?? 0),
        tieImbalance:
          ties.imbalance -
          ((reported?.tieStarts ?? 0) - (reported?.tieStops ?? 0)),
      },
      reproducesIssue: {
        tieImbalance: tieImbalanceStillPresent,
        zeroRestsDense,
        any: tieImbalanceStillPresent || zeroRestsDense,
      },
      likelyPipelineStage: 'vector-tie-pairing (detectVectorTies.applyTieMarks)',
      sharedRootCauseCandidate: 'tie',
    }
    writeFileSync(join(outDir, 'repro.json'), JSON.stringify(entry, null, 2))
    results.push(entry)
    console.log(JSON.stringify(entry.reproduced), 'delta', entry.delta, `ms=${entry.elapsedMs}`)
  } catch (error) {
    const entry = {
      reportId: name,
      source: report.score?.sanitizedSourceFilename,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      elapsedMs: Date.now() - started,
    }
    results.push(entry)
    writeFileSync(join(outDir, 'repro.json'), JSON.stringify(entry, null, 2))
    console.error('FAIL', entry.error)
  }
}

writeFileSync(join(outRoot, 'all-reproductions.json'), JSON.stringify(results, null, 2))
console.log('\nDONE', results.filter((r) => r.ok).length, '/', results.length)
