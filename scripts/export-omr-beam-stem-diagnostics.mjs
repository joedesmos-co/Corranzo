#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { buildBeamStemDiagnosticsSvg } from '../src/features/omr/beamStemReconstructionDiagnostics.js'
import {
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function usage() {
  return [
    'Export OMR beam/stem reconstruction diagnostics',
    '',
    'Required:',
    '  --pdf <score.pdf>',
    '  --out <dir>',
    '',
    'Optional:',
    '  --max-pages <n>    Limit pages, default 24',
    '  --no-preprocess    Disable preprocessing',
  ].join('\n')
}

function requireExisting(path, label) {
  if (!path) {
    throw new Error(`Missing ${label}.`)
  }
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`)
  }
}

async function makePdfTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_pdfSource, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1, rotation: 0 })
    const content = await page.getTextContent()
    return (content.items ?? [])
      .map((item) => ({
        text: item.str ?? '',
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 0,
        fontName: item.fontName ?? '',
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      }))
      .filter((item) => item.text.trim().length > 0)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(usage())
    return
  }

  const pdfPath = argValue(args, '--pdf')
  const outDir = argValue(args, '--out')
  const maxPages = Math.max(1, Number(argValue(args, '--max-pages') ?? 24))
  const preprocessPages = !hasFlag(args, '--no-preprocess')

  requireExisting(pdfPath, 'PDF')
  if (!outDir) {
    throw new Error('Missing output directory.')
  }
  mkdirSync(outDir, { recursive: true })

  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  const result = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages,
    preprocessPages,
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
  })

  const diagnostics = result.diagnostics?.beamStemReconstruction ?? null
  const payload = {
    version: 1,
    pdfPath,
    maxPages,
    preprocessPages,
    exportedAt: new Date().toISOString(),
    diagnostics,
  }
  const jsonPath = join(outDir, 'beam-stem-diagnostics.json')
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`)

  const visualSamples = diagnostics?.visualSamples ?? []
  const byPage = new Map()
  for (const graph of visualSamples) {
    const page = graph.page ?? 1
    if (!byPage.has(page)) {
      byPage.set(page, [])
    }
    byPage.get(page).push(graph)
  }
  const svgPaths = []
  for (const [page, graphs] of byPage) {
    const svg = buildBeamStemDiagnosticsSvg(graphs)
    const svgPath = join(outDir, `beam-stem-page-${page}.svg`)
    writeFileSync(svgPath, svg)
    svgPaths.push(svgPath)
  }

  console.log(
    [
      `JSON diagnostics: ${jsonPath}`,
      ...svgPaths.map((path) => `SVG diagnostics: ${path}`),
    ].join('\n'),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  console.error('')
  console.error(usage())
  process.exitCode = 1
})
