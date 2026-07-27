#!/usr/bin/env node
/** Run the OMR pipeline and print rest diagnostics for selected sources. */
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = process.cwd()
const DOWNLOADS = homedir() + '/Downloads'
const FIXTURES = 'benchmarks/omr-fixtures'

const SOURCES = [
  ['minecraft', join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.pdf'), 1],
  ['evangelion', join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'), 1],
  ['gymnopedie', join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'), 1],
  ['piano-rhythm-tuplets-vector', join(FIXTURES, 'piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf'), 1],
  ['la-campanella', join(DOWNLOADS, 'etude-s-1413-in-g-minor-la-campanella-liszt.pdf'), 2],
  ['fantaisie-impromptu', join(DOWNLOADS, 'fantaisie-impromptu-in-c-minor-chopin.pdf'), 2],
]

const only = process.argv[2]
for (const [id, pdfPath, maxPages] of SOURCES) {
  if (only && id !== only) continue
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
  console.log(id, JSON.stringify(result?.diagnostics?.rests ?? null))
}
process.exit(0)
