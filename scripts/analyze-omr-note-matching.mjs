#!/usr/bin/env node
/**
 * Analyze OMR note detection vs emission and compare to ground truth.
 *
 * Usage:
 *   node scripts/analyze-omr-note-matching.mjs \
 *     --pdf ~/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf \
 *     --truth ~/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl \
 *     --out tmp/note-matching-report.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  groupTruthNotesByMeasure,
  summarizeNoteMatchingReport,
} from '../src/features/omr/omrNoteMatchingDiagnostics.js'
import {
  evaluateOmrAccuracy,
} from '../src/features/omr/omrAccuracyEvaluator.js'
import {
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const root = Object.keys(zip.files).find(
    (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
  )
  return zip.file(root).async('string')
}

async function makePdfTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_pdfSource, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    return (content.items ?? [])
      .map((item) => ({
        text: item.str ?? '',
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 0,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      }))
      .filter((item) => item.text.trim().length > 0)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const pdfPath = argValue(args, '--pdf')
  const truthPath = argValue(args, '--truth')
  const outPath = argValue(args, '--out')
  if (!pdfPath || !truthPath || !outPath) {
    throw new Error('Usage: --pdf <file> --truth <mxl> --out <json>')
  }
  if (!existsSync(pdfPath) || !existsSync(truthPath)) {
    throw new Error('PDF or truth file missing')
  }

  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  const omrResult = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    title: pdfPath.split('/').pop(),
  })

  const truthXml = await readScoreXml(truthPath)
  const truth = parseMusicXml(truthXml, truthPath)
  const truthByMeasure = groupTruthNotesByMeasure(truth.notes)

  let matching = omrResult.diagnostics?.noteMatching ?? summarizeNoteMatchingReport([], truthByMeasure)
  if (matching.perMeasure?.length && truthByMeasure.size) {
    matching = {
      ...matching,
      perMeasure: matching.perMeasure.map((entry) => {
        const truthCount = truthByMeasure.get(entry.measureNumber) ?? null
        return {
          ...entry,
          truthNoteheads: truthCount,
          generatedDelta: truthCount == null ? null : entry.emittedNoteheads - truthCount,
        }
      }),
    }
  }

  const accuracy = evaluateOmrAccuracy({
    generatedMusicXml: omrResult.musicXml,
    groundTruthMusicXml: truthXml,
    generatedFileName: 'generated.omr.xml',
    groundTruthFileName: truthPath.split('/').pop(),
  })

  const payload = {
    matching,
    accuracy: {
      noteDetectionF1: accuracy.metrics.noteDetectionF1,
      pitchAccuracy: accuracy.metrics.pitchAccuracy,
      missingNoteCount: accuracy.totals.missingNoteCount,
      extraNoteCount: accuracy.totals.extraNoteCount,
      generatedNoteCount: accuracy.totals.generatedNoteCount,
      truthNoteCount: accuracy.totals.truthNoteCount,
    },
    pipeline: {
      detectedNoteheads: omrResult.diagnostics?.notes,
      emittedNoteheads: omrResult.noteCount,
      groupingLoss: (omrResult.diagnostics?.notes ?? 0) - omrResult.noteCount,
    },
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.error(`Wrote ${outPath}`)
  console.error(JSON.stringify(payload.accuracy, null, 2))
  console.error('groupingLoss', payload.pipeline.groupingLoss)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
