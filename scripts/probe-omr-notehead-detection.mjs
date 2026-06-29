#!/usr/bin/env node
/**
 * Full-score vector notehead detection funnel (page → measure → pitch).
 */
import JSZip from 'jszip'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'
import { buildMeasureBoxesForSystemWithDiagnostics } from '../src/features/omr/buildOmrMeasureGrid.js'
import { OMR_PIANO_STAVES_PER_SYSTEM } from '../src/features/omr/omrConstants.js'
import {
  textGlyphsToImage,
  hasVectorOmrNoteheads,
  buildVectorMeasureRecord,
} from '../src/features/omr/processVectorOmrPage.js'
import { detectStaffClefsFromGlyphs, resolvePitchFromGrandStaff } from '../src/features/omr/pitchFromStaffPosition.js'
import { vectorGlyphInMeasure } from '../src/features/omr/vectorGlyphMeasureBounds.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { makeRenderPageCallback, renderPdfToPages } from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOTEHEAD_GLYPHS = new Set(['\ue0a3', '\ue0a4', '\ue0a2'])

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

function argValue(args, flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
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
        fontName: item.fontName ?? '',
      }))
      .filter((item) => item.text.trim().length > 0)
  }
}

function glyphHitsMeasure(glyph, measureBox, imageData, measureIndex, measureCount) {
  return vectorGlyphInMeasure(glyph, measureBox, imageData, {
    isLastInSystem: measureIndex === measureCount - 1,
  })
}

function isNoteheadGlyph(glyph) {
  return NOTEHEAD_GLYPHS.has(glyph.text)
}

async function analyzePage(imageData, page, pageText, measureNumberStart) {
  const contentBounds = detectContentBounds(imageData)
  const { systems, inkThreshold } = detectStaffLineSystems(imageData, contentBounds, {
    stavesPerSystem: OMR_PIANO_STAVES_PER_SYSTEM,
    countBarlines: true,
  })
  const glyphs = textGlyphsToImage(pageText, imageData)
  const pageNoteheads = glyphs.filter(isNoteheadGlyph)

  let measureCounter = measureNumberStart
  const measureBoxes = []
  const systemMeasureCounts = []
  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const { measureBoxes: boxes } = buildMeasureBoxesForSystemWithDiagnostics({
      page,
      systemIndex,
      system: systems[systemIndex],
      contentBounds,
      imageData,
      measureNumberStart: measureCounter,
      darkThreshold: Math.min(inkThreshold, Math.max(145, inkThreshold - 22)),
    })
    measureCounter += boxes.length
    systemMeasureCounts.push(boxes.length)
    for (const box of boxes) {
      measureBoxes.push(box)
    }
  }

  const measurePlacement = new Map()
  let offset = measureNumberStart
  for (const count of systemMeasureCounts) {
    for (let index = 0; index < count; index += 1) {
      measurePlacement.set(offset + index, {
        isLastInSystem: index === count - 1,
      })
    }
    offset += count
  }

  const staffClefsBySystem = new Map()
  let assigned = 0
  let inAnyBox = 0
  let pitchRejected = 0
  let outsideAllBoxes = 0
  const outsideSamples = []
  const pitchRejectedSamples = []
  const perMeasure = new Map()

  for (const glyph of pageNoteheads) {
    const hits = measureBoxes.filter((box) =>
      glyphHitsMeasure(glyph, box, imageData, box.measureIndex, systemMeasureCounts[box.systemIndex]),
    )
    if (!hits.length) {
      outsideAllBoxes += 1
      if (outsideSamples.length < 8) {
        outsideSamples.push({ x: glyph.x, y: glyph.y, glyph: glyph.text })
      }
      continue
    }
    inAnyBox += 1
    const box = hits.sort((a, b) => hits.length > 1 ? (a.x1 - a.x0) - (b.x1 - b.x0) : 0)[0]
    const yNorm = glyph.y / imageData.height
    const pitch = resolvePitchFromGrandStaff(yNorm, box.staffLines, box.staffClefs)
    if (pitch.midi == null) {
      pitchRejected += 1
      if (pitchRejectedSamples.length < 8) {
        pitchRejectedSamples.push({ measure: box.measureNumber, x: glyph.x, y: glyph.y })
      }
      continue
    }
    assigned += 1
    const entry = perMeasure.get(box.measureNumber) ?? { inBox: 0, assigned: 0 }
    entry.inBox += 1
    entry.assigned += 1
    perMeasure.set(box.measureNumber, entry)
  }

  return {
    page,
    pageNoteheads: pageNoteheads.length,
    measureCount: measureBoxes.length,
    inAnyBox,
    assigned,
    outsideAllBoxes,
    pitchRejected,
    outsideSamples,
    pitchRejectedSamples,
    perMeasure,
    measureBoxes,
    glyphs,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const pdfPath = argValue(args, '--pdf')
  const outPath = argValue(args, '--out')
  if (!pdfPath) {
    throw new Error('Usage: --pdf <file> [--out json]')
  }

  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT })
  const extractPageText = await makePdfTextExtractor(pdfPath)

  const totals = {
    pageNoteheads: 0,
    inAnyBox: 0,
    assigned: 0,
    outsideAllBoxes: 0,
    pitchRejected: 0,
    pipelineDetected: 0,
  }
  const pageReports = []
  let measureCounter = 1

  for (let page = 1; page <= rendered.numPages; page += 1) {
    const imageData = rendered.pages[page - 1]
    const pageText = await extractPageText(pdfPath, page)
    const report = await analyzePage(imageData, page, pageText, measureCounter)
    measureCounter += report.measureCount
    totals.pageNoteheads += report.pageNoteheads
    totals.inAnyBox += report.inAnyBox
    totals.assigned += report.assigned
    totals.outsideAllBoxes += report.outsideAllBoxes
    totals.pitchRejected += report.pitchRejected

    const pageResult = processOmrPageAnalysis(imageData, { page, measureNumberStart: report.page === 1 ? 1 : measureCounter - report.measureCount, pageText })
    totals.pipelineDetected += pageResult.stats?.notes ?? 0

    pageReports.push({
      page: report.page,
      pageNoteheads: report.pageNoteheads,
      assigned: report.assigned,
      outsideAllBoxes: report.outsideAllBoxes,
      pitchRejected: report.pitchRejected,
      pipelineDetected: pageResult.stats?.notes ?? 0,
      outsideSamples: report.outsideSamples,
      pitchRejectedSamples: report.pitchRejectedSamples,
    })
  }

  const payload = { totals, pages: pageReports }
  console.log(JSON.stringify(payload, null, 2))
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
