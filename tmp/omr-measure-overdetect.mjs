#!/usr/bin/env node
// Throwaway measurement (NOT app code): quantify raster notehead over-detection.
// For each "pdf|truth" pair: raw detected noteheads vs ground-truth note count.
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { hasVectorOmrNoteheads } from '../src/features/omr/processVectorOmrPage.js'
import { makeRenderPageCallback, renderPdfToPages } from '../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function truthNoteCount(path) {
  let xml
  if (path.toLowerCase().endsWith('.mxl')) {
    const zip = await JSZip.loadAsync(readFileSync(path))
    const container = await zip.file('META-INF/container.xml')?.async('string')
    let rootPath = container?.match(/full-path="([^"]+)"/)?.[1]
    if (!rootPath || !zip.file(rootPath)) {
      rootPath = Object.keys(zip.files).find(
        (e) => e.toLowerCase().endsWith('.xml') && !e.startsWith('META-INF/'),
      )
    }
    xml = await zip.file(rootPath).async('string')
  } else {
    xml = readFileSync(path, 'utf8')
  }
  const notes = (xml.match(/<note[\s>]/g) || []).length
  const rests = (xml.match(/<rest[\s/>]/g) || []).length
  return notes - rests
}

async function pageTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), isEvalSupported: false }).promise
  const firstPageItems = []
  const fn = async (_s, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = (content.items ?? []).map((i) => ({ text: i.str ?? '', x: i.transform?.[4] ?? 0, y: i.transform?.[5] ?? 0 }))
    if (pageNumber === 1) firstPageItems.push(...items)
    return items
  }
  return { fn, firstPageItems }
}

async function measure(pdfPath, truthPath) {
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const { fn, firstPageItems } = await pageTextExtractor(pdfPath)
  const truth = await truthNoteCount(truthPath)
  let detected = null
  let measures = null
  let ok = false
  let reasons = []
  try {
    const r = await runPdfOmrPipeline(pdfPath, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText: fn,
      numPages: rendered.numPages,
      maxPages: 24,
      preprocessPages: true,
      title: basename(pdfPath),
    })
    detected = r.diagnostics?.notes
    measures = r.diagnostics?.measures
    reasons = r.diagnostics?.failureReasons ?? []
    ok = true
  } catch (e) {
    detected = e.diagnostics?.notes
    measures = e.diagnostics?.measures
    reasons = e.difficulty?.reasons ?? []
  }
  const vector = hasVectorOmrNoteheads(firstPageItems)
  return { detected, truth, measures, ok, reasons, vector, ratio: detected != null && truth ? detected / truth : null }
}

const pairs = process.argv.slice(2)
const rows = []
for (const pair of pairs) {
  const [pdf, truth] = pair.split('||')
  try {
    const r = await measure(pdf, truth)
    rows.push({ piece: basename(dirname(pdf)) === 'cache' ? basename(pdf) : (basename(dirname(pdf)) || basename(pdf)), ...r })
  } catch (e) {
    rows.push({ piece: pdf, fatal: String(e?.message ?? e).slice(0, 60) })
  }
}
rows.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
const out = []
out.push([ 'piece'.padEnd(30), 'path'.padEnd(7), 'detected'.padStart(9), 'truth'.padStart(7), 'ratio'.padStart(6), 'pass'.padStart(5), '  reasons' ].join(' '))
for (const r of rows) {
  if (r.fatal) { out.push(r.piece.padEnd(30) + ' FATAL ' + r.fatal); continue }
  out.push([
    String(r.piece).slice(0, 29).padEnd(30),
    (r.vector ? 'vector' : 'raster').padEnd(7),
    String(r.detected).padStart(9),
    String(r.truth).padStart(7),
    (r.ratio != null ? r.ratio.toFixed(2) + 'x' : '-').padStart(6),
    (r.ok ? 'yes' : 'NO').padStart(5),
    '  ' + (r.reasons.join(',') || '-'),
  ].join(' '))
}
const { appendFileSync } = await import('node:fs')
appendFileSync(process.env.OUT_FILE || 'tmp/omr-overdetect-table.txt', out.join('\n') + '\n')
