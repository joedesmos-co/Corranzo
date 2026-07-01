#!/usr/bin/env node
/**
 * ScoreGraph shadow emitter report (Phase 2) — developer/diagnostics only.
 *
 * Runs the OMR pipeline with the full ScoreGraph IR exposed, emits SHADOW
 * MusicXML from that IR, and compares it against the runtime MusicXML (note /
 * measure diffs + evaluator agreement). Writes results under
 * tmp/omr-scoregraph-shadow/. Never changes runtime output.
 *
 * Usage:
 *   node scripts/omr-scoregraph-shadow.mjs                 # benchmark manifest fixtures
 *   node scripts/omr-scoregraph-shadow.mjs --allow-missing # skip absent fixtures
 *   node scripts/omr-scoregraph-shadow.mjs --pdf a.pdf --truth a.mxl --id demo
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  emitMusicXmlFromScoreGraph,
  buildScoreGraphShadowReport,
  formatScoreGraphShadowMarkdown,
} from '../src/features/omr/scoreGraphEmit.js'
import {
  buildSolverShadowReport,
  formatSolverShadowMarkdown,
} from '../src/features/omr/scoreGraphSolver.js'
import { expandHomePath } from '../src/features/omr/omrBenchmarkDashboard.js'
import { makeRenderPageCallback, renderPdfToPages } from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'tmp', 'omr-scoregraph-shadow')

function arg(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  let rootPath = container ? (await container.async('string')).match(/full-path="([^"]+)"/)?.[1] : null
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
  }
  return zip.file(rootPath).async('string')
}

async function makePdfTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), isEvalSupported: false })
    .promise
  return async (_source, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1, rotation: 0 })
    const content = await page.getTextContent()
    return (content.items ?? []).map((item) => ({
      text: item.str ?? '',
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
      width: item.width,
      height: item.height,
      fontName: item.fontName,
    }))
  }
}

async function runFixture({ id, pdfPath, truthPath }) {
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  const omr = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: 24,
    preprocessPages: true,
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
    includeScoreGraph: true, // dev-only: expose the full IR
  })

  const scoreGraph = omr.diagnostics?.scoreGraphFull
  if (!scoreGraph) {
    throw new Error('scoreGraphFull missing — includeScoreGraph did not take effect')
  }
  const shadowXml = emitMusicXmlFromScoreGraph(scoreGraph, { musical: omr.musical, title: id })
  const truthXml = truthPath && existsSync(truthPath) ? await readScoreXml(truthPath) : null
  const report = buildScoreGraphShadowReport({ id, runtimeXml: omr.musicXml, shadowXml, truthXml })
  const solverReport = buildSolverShadowReport({
    id,
    runtimeXml: omr.musicXml,
    scoreGraph,
    musical: omr.musical,
    truthXml,
  })

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, `${id}.shadow.musicxml`), shadowXml)
  writeFileSync(join(OUT_DIR, `${id}.runtime.musicxml`), omr.musicXml)
  writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(report, null, 2))
  writeFileSync(join(OUT_DIR, `${id}.solver.json`), JSON.stringify(solverReport, null, 2))
  return { emit: report, solver: solverReport }
}

async function main() {
  const args = process.argv.slice(2)
  const allowMissing = args.includes('--allow-missing')
  const home = homedir()

  let fixtures
  const pdfArg = arg(args, '--pdf')
  if (pdfArg) {
    fixtures = [{ id: arg(args, '--id') ?? basename(pdfArg).replace(/\.pdf$/i, ''), pdfPath: pdfArg, truthPath: arg(args, '--truth') }]
  } else {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', 'omr-benchmark.manifest.json'), 'utf8'))
    fixtures = manifest.fixtures.map((fixture) => ({
      id: fixture.id,
      pdfPath: expandHomePath(fixture.pdf, home),
      truthPath: expandHomePath(fixture.truth, home),
    }))
  }

  const reports = []
  for (const fixture of fixtures) {
    if (!existsSync(fixture.pdfPath)) {
      const message = `Missing PDF for "${fixture.id}": ${fixture.pdfPath}`
      if (allowMissing) {
        console.error(`skip: ${message}`)
        continue
      }
      throw new Error(message)
    }
    console.error(`shadow: ${fixture.id}`)
    reports.push(await runFixture(fixture))
  }

  if (!reports.length) {
    console.error('No fixtures processed.')
    return
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const emitMarkdown = formatScoreGraphShadowMarkdown(reports.map((report) => report.emit))
  const solverMarkdown = formatSolverShadowMarkdown(reports.map((report) => report.solver))
  writeFileSync(join(OUT_DIR, 'report.md'), emitMarkdown)
  writeFileSync(join(OUT_DIR, 'solver-report.md'), solverMarkdown)
  console.log(emitMarkdown)
  console.log(solverMarkdown)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
