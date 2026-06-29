#!/usr/bin/env node
// Throwaway diagnostic probe (NOT app code): report OMR detection + difficulty per piece.
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { makeRenderPageCallback, renderPdfToPages } from '../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function makePdfTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_s, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    return (content.items ?? []).map((i) => ({ text: i.str ?? '', x: i.transform?.[4] ?? 0, y: i.transform?.[5] ?? 0 }))
  }
}

async function probe(pdfPath) {
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  try {
    const r = await runPdfOmrPipeline(pdfPath, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.numPages,
      maxPages: 24,
      preprocessPages: true,
      title: basename(pdfPath),
    })
    const d = r.diagnostics ?? {}
    return { ok: true, notes: d.notes, systems: d.systems, measures: d.measures, conf: d.overallConfidence, reasons: d.failureReasons ?? [] }
  } catch (e) {
    const d = e.diagnostics ?? {}
    const diff = e.difficulty ?? {}
    return { ok: false, msg: e.message, notes: d.notes, systems: d.systems, measures: d.measures, conf: diff.confidence, npm: diff.notesPerMeasure, reasons: diff.reasons ?? [] }
  }
}

const pieces = process.argv.slice(2)
for (const p of pieces) {
  try {
    const r = await probe(p)
    console.log(JSON.stringify({ piece: basename(dirname(p)) || basename(p), ...r }))
  } catch (e) {
    console.log(JSON.stringify({ piece: p, fatal: String(e?.message ?? e) }))
  }
}
