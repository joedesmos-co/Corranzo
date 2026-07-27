#!/usr/bin/env node
/** Dump per-measure rest skip details via processOmrPageAnalysis. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import {
  loadPdfRenderDependencies,
  makePdfTextExtractor,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = process.cwd()
const pdfPath = join(homedir(), 'Downloads', process.argv[2] ?? 'gymnopedie-no-1-satie.pdf')
const maxPages = Number(process.argv[3] ?? 1)

const { createCanvas, pdfjs } = await loadPdfRenderDependencies(ROOT)
const data = new Uint8Array(readFileSync(pdfPath))
const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })

for (let page = 1; page <= Math.min(maxPages, doc.numPages); page += 1) {
  const pdfPage = await doc.getPage(page)
  const base = pdfPage.getViewport({ scale: 1 })
  const viewport = pdfPage.getViewport({ scale: 1000 / base.width })
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await pdfPage.render({ canvasContext: context, viewport }).promise
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const pageText = await extractPageText(null, page)

  const result = processOmrPageAnalysis(imageData, {
    page,
    startMeasureNumber: page === 1 ? 1 : undefined,
    pageText,
    instrumentId: 'piano',
  })

  console.log('page', page, 'keys', Object.keys(result ?? {}))
  const measures = result?.measures ?? []
  console.log('measures', measures.length, 'source', result?.source)
  let skippedTotal = 0
  for (const measure of measures) {
    const skipped = measure.vectorRestDiagnostics?.skipped ?? []
    const applied = measure.vectorRestDiagnostics?.appliedCount ?? 0
    const glyphs = measure.vectorRestGlyphCount ?? 0
    if (!glyphs && !skipped.length) continue
    const noteSummary = (measure.events ?? [])
      .filter((e) => e.type === 'note')
      .map((e) => `${e.clef ?? '?'}@${e.startDivision}+${e.durationDivisions}`)
    const restSummary = (measure.events ?? [])
      .filter((e) => e.type === 'rest')
      .map((e) => `${e.clef ?? '?'}rest@${e.startDivision}+${e.durationDivisions}`)
    console.log(
      `m${measure.measureNumber} glyphs=${glyphs} applied=${applied} skipped=${skipped.length}`,
      'notes=[' + noteSummary.join(' ') + ']',
      'rests=[' + restSummary.join(' ') + ']',
    )
    for (const entry of skipped) {
      skippedTotal += 1
      console.log('  SKIP', JSON.stringify(entry))
    }
  }
  console.log('page skipped total', skippedTotal)
  console.log('restDiagnostics', JSON.stringify(result?.restDiagnostics ?? null))
}
process.exit(0)
