#!/usr/bin/env node
/**
 * Developer-only OMR accuracy evaluation.
 *
 * Usage:
 *   node scripts/evaluate-omr-accuracy.mjs --pdf score.pdf --truth score.mxl --json report.json --text report.txt
 *   node scripts/evaluate-omr-accuracy.mjs --generated generated.musicxml --truth score.musicxml --text report.txt
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  evaluateOmrAccuracy,
  formatOmrAccuracyReport,
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

function hasFlag(args, flag) {
  return args.includes(flag)
}

function usage() {
  return [
    'OMR accuracy evaluator',
    '',
    'Required:',
    '  --truth <score.musicxml|score.xml|score.mxl>',
    '  one of:',
    '    --pdf <score.pdf>          Run OMR first, then compare.',
    '    --generated <omr.musicxml> Compare an existing generated file.',
    '',
    'Optional:',
    '  --json <report.json>         Write machine-readable report.',
    '  --text <report.txt>          Write text summary.',
    '  --save-generated <out.xml>   Save generated OMR MusicXML when --pdf is used.',
    '  --max-pages <n>              Limit PDF pages for OMR, default 24.',
    '  --no-preprocess             Disable OMR preprocessing for A/B debugging.',
  ].join('\n')
}

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }

  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  let rootPath = null
  if (container) {
    const xml = await container.async('string')
    rootPath = xml.match(/full-path="([^"]+)"/)?.[1] ?? null
  }
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
  }
  if (!rootPath || !zip.file(rootPath)) {
    throw new Error(`MXL archive has no MusicXML root: ${scorePath}`)
  }
  return zip.file(rootPath).async('string')
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
}

function writeText(filePath, content) {
  ensureParent(filePath)
  writeFileSync(filePath, content)
}

function requireExisting(path, label) {
  if (!path) {
    throw new Error(`Missing ${label}.`)
  }
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`)
  }
}

async function generateOmrFromPdf(pdfPath, { maxPages, preprocessPages }) {
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  return runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages,
    preprocessPages,
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
  })
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
  const generatedPath = argValue(args, '--generated')
  const truthPath = argValue(args, '--truth')
  const jsonPath = argValue(args, '--json')
  const textPath = argValue(args, '--text')
  const saveGeneratedPath = argValue(args, '--save-generated')
  const maxPages = Math.max(1, Number(argValue(args, '--max-pages') ?? 24))
  const preprocessPages = !hasFlag(args, '--no-preprocess')

  requireExisting(truthPath, 'ground-truth MusicXML/MXL')
  if (!pdfPath && !generatedPath) {
    throw new Error('Provide --pdf to run OMR or --generated to compare an existing file.')
  }
  if (pdfPath && generatedPath) {
    throw new Error('Use either --pdf or --generated, not both.')
  }
  if (pdfPath) {
    requireExisting(pdfPath, 'PDF')
  }
  if (generatedPath) {
    requireExisting(generatedPath, 'generated MusicXML')
  }

  const groundTruthMusicXml = await readScoreXml(truthPath)
  let generatedMusicXml
  let generatedOmrDiagnostics = null
  let omrResult = null

  if (generatedPath) {
    generatedMusicXml = await readScoreXml(generatedPath)
  } else {
    console.error(`Running experimental OMR: ${pdfPath}`)
    omrResult = await generateOmrFromPdf(pdfPath, { maxPages, preprocessPages })
    generatedMusicXml = omrResult.musicXml
    generatedOmrDiagnostics = omrResult.diagnostics
    if (saveGeneratedPath) {
      writeText(saveGeneratedPath, generatedMusicXml)
    }
  }

  const report = evaluateOmrAccuracy({
    generatedMusicXml,
    groundTruthMusicXml,
    generatedFileName: generatedPath ? basename(generatedPath) : `${basename(pdfPath)}.omr.musicxml`,
    groundTruthFileName: basename(truthPath),
    generatedOmrDiagnostics,
  })

  const output = {
    ...report,
    run: {
      pdfPath: pdfPath ?? null,
      generatedPath: generatedPath ?? null,
      truthPath,
      maxPages: pdfPath ? maxPages : null,
      preprocessPages: pdfPath ? preprocessPages : null,
      omrNoteCount: omrResult?.noteCount ?? null,
      omrMeasureCount: omrResult?.measureCount ?? null,
      omrWarnings: omrResult?.warnings ?? [],
      savedGeneratedPath: saveGeneratedPath ?? null,
    },
  }
  const text = formatOmrAccuracyReport(output)

  if (jsonPath) {
    writeText(jsonPath, `${JSON.stringify(output, null, 2)}\n`)
  }
  if (textPath) {
    writeText(textPath, `${text}\n`)
  }
  if (!jsonPath && !textPath) {
    console.log(text)
  } else {
    console.log(
      [
        jsonPath ? `JSON report: ${jsonPath}` : null,
        textPath ? `Text report: ${textPath}` : null,
        saveGeneratedPath ? `Generated MusicXML: ${saveGeneratedPath}` : null,
      ].filter(Boolean).join('\n'),
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  console.error('')
  console.error(usage())
  process.exitCode = 1
})
