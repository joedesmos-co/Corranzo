#!/usr/bin/env node
/**
 * Probe skipped rest glyphs: which measure/staff, preferred start vs occupied
 * note intervals, and whether the rest is on an empty staff vs shared staff.
 */
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'
import { restsForMeasure } from '../../src/features/omr/detectVectorRests.js'
import { textGlyphsToImage } from '../../src/features/omr/processVectorOmrPage.js'

const ROOT = process.cwd()
const DOWNLOADS = homedir() + '/Downloads'

const SOURCES = [
  ['evangelion', join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'), 1],
  ['gymnopedie', join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'), 1],
  ['la-campanella', join(DOWNLOADS, 'etude-s-1413-in-g-minor-la-campanella-liszt.pdf'), 2],
]

// Monkey-patch via re-running process internals is heavy; instead dump pipeline
// diagnostics.skippedReasons and compare generated vs truth rest counts.
for (const [id, pdfPath, maxPages] of SOURCES) {
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const result = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages,
    instrumentId: 'piano',
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
  })
  const rests = result?.diagnostics?.rests ?? {}
  console.log(id, JSON.stringify(rests))
}
process.exit(0)
