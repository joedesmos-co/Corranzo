#!/usr/bin/env node
/**
 * Phase 1 — dense-ledger ink rejection inventory.
 * Diagnostic only under tmp/omr-dense-ledger/. Does not edit production.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import {
  estimateLedgerLineCount,
  midiFromStaffPosition,
  resolveNoteheadAnchor,
} from '../../src/features/omr/pitchFromStaffPosition.js'
import {
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVALUATOR_VERSION,
  resolveSemanticEvalOptions,
} from '../../src/features/omr/semanticEvalTolerances.js'
import { normalizeSemanticNotes } from '../../src/features/omr/semanticMusicXmlEvaluator.js'
import {
  buildMeasureFingerprint,
  alignMeasureSequences,
} from '../../src/features/omr/semanticMeasureAlignment.js'
import { matchSemanticEvents } from '../../src/features/omr/semanticEventMatching.js'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
  CALIBRATION_ANALYSIS_WIDTH,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/omr-dense-ledger')
const INK_THRESHOLD = 170
const ACCIDENTAL_CODES = new Set([
  0xe260, 0xe261, 0xe262, 0xe263, 0xe264, // flat, natural, sharp, double-sharp, double-flat
])

mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'diagnostics'), { recursive: true })

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()
  } catch {
    return null
  }
}

function expandHome(pathValue) {
  if (!pathValue) return pathValue
  if (pathValue.startsWith('~/')) return join(homedir(), pathValue.slice(2))
  return pathValue
}

function resolveFixturePath(relativePath, searchPaths) {
  for (const root of searchPaths) {
    const candidate = resolve(expandHome(root), relativePath)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function loadFixtures() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'))
  const roots = (manifest.fixtureSearchPaths ?? ['benchmarks/omr-fixtures']).map((path) =>
    path.startsWith('~/') || path.startsWith('/') ? expandHome(path) : join(ROOT, path),
  )
  if (!roots.includes(join(ROOT, 'benchmarks/omr-fixtures'))) {
    roots.unshift(join(ROOT, 'benchmarks/omr-fixtures'))
  }
  const fixtures = (manifest.fixtures ?? []).filter((fixture) => {
    if (!fixture.truth || !fixture.pdf) return false
    if (fixture.expectedRejectionCodes) return false
    if (!fixture.thresholds) return false
    if (String(fixture.tier ?? '').startsWith('real-')) return false
    if (String(fixture.tier ?? '').startsWith('legacy')) return false
    return true
  })
  return { fixtures, roots }
}

async function readScoreXml(scorePath) {
  if (/\.mxl$/i.test(scorePath)) {
    const zip = await JSZip.loadAsync(readFileSync(scorePath))
    const entry =
      Object.keys(zip.files).find((name) => /score\.xml$/i.test(name)) ??
      Object.keys(zip.files).find((name) => /\.xml$/i.test(name) && !name.includes('META-INF'))
    if (!entry) throw new Error(`No MusicXML entry in ${scorePath}`)
    return zip.file(entry).async('string')
  }
  return readFileSync(scorePath, 'utf8')
}

function midiToLabel(midi) {
  if (!Number.isFinite(midi)) return null
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const rounded = Math.round(midi)
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`
}

function registerBinForTone(midi, { clef = null, ledger = null } = {}) {
  if (ledger?.direction === 'above' && (ledger.count ?? 0) >= 1 && clef === 'treble') {
    return 'high-extreme'
  }
  if (ledger?.direction === 'below' && (ledger.count ?? 0) >= 1 && clef === 'bass') {
    return 'low-extreme'
  }
  if (!Number.isFinite(midi)) return 'middle'
  if (midi < 41) return 'low-extreme'
  if (midi <= 59) return 'low-normal'
  if (midi < 64) return 'middle'
  if (midi <= 79) return 'high-normal'
  return 'high-extreme'
}

function pixelIsInk(imageData, x, y, threshold = INK_THRESHOLD) {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return false
  const index = (y * imageData.width + x) * 4
  const alpha = imageData.data[index + 3] / 255
  const luminance =
    (0.299 * imageData.data[index] +
      0.587 * imageData.data[index + 1] +
      0.114 * imageData.data[index + 2]) *
      alpha +
    255 * (1 - alpha)
  return luminance < threshold
}

function lineYsInPixels(lineYs, imageHeight) {
  if (!Array.isArray(lineYs) || !lineYs.length) return []
  const scale = lineYs.every((value) => Math.abs(value) <= 1.5) ? imageHeight : 1
  return lineYs.map((value) => value * scale)
}

function staffGapPx(lineYs, imageHeight) {
  const pixels = lineYsInPixels(lineYs, imageHeight)
  if (pixels.length < 2) return 0
  const sorted = [...pixels].sort((a, b) => a - b)
  return (sorted[sorted.length - 1] - sorted[0]) / 4
}

function collectComponents({ imageData, left, right, top, bottom, suppressedRows, suppressedColumns }) {
  const pixels = new Map()
  for (let y = top; y <= bottom; y += 1) {
    if (suppressedRows?.has(y)) continue
    for (let x = left; x <= right; x += 1) {
      if (suppressedColumns?.has(x) || !pixelIsInk(imageData, x, y)) continue
      pixels.set(`${x}:${y}`, { x, y })
    }
  }
  const components = []
  while (pixels.size) {
    const first = pixels.values().next().value
    const queue = [first]
    pixels.delete(`${first.x}:${first.y}`)
    const component = {
      top: first.y,
      bottom: first.y,
      left: first.x,
      right: first.x,
      pixels: 0,
    }
    for (let index = 0; index < queue.length; index += 1) {
      const point = queue[index]
      component.top = Math.min(component.top, point.y)
      component.bottom = Math.max(component.bottom, point.y)
      component.left = Math.min(component.left, point.x)
      component.right = Math.max(component.right, point.x)
      component.pixels += 1
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const key = `${point.x + dx}:${point.y + dy}`
          const neighbor = pixels.get(key)
          if (neighbor) {
            pixels.delete(key)
            queue.push(neighbor)
          }
        }
      }
    }
    const width = component.right - component.left + 1
    const height = component.bottom - component.top + 1
    components.push({
      ...component,
      width,
      height,
      area: component.pixels,
      aspectRatio: height > 0 ? width / height : null,
      centerX: (component.left + component.right) / 2,
      centerY: (component.top + component.bottom) / 2,
    })
  }
  return components
}

function analyzeHorizontalRows({ imageData, left, right, top, bottom, systemLeft, systemRight, gapPx }) {
  const rows = []
  for (let y = top; y <= bottom; y += 1) {
    let run = 0
    let longest = 0
    let runStart = null
    let bestStart = null
    let bestEnd = null
    let inkCount = 0
    for (let x = left; x <= right; x += 1) {
      if (pixelIsInk(imageData, x, y)) {
        inkCount += 1
        if (run === 0) runStart = x
        run += 1
        if (run > longest) {
          longest = run
          bestStart = runStart
          bestEnd = x
        }
      } else {
        run = 0
        runStart = null
      }
    }
    if (longest < Math.max(3, gapPx * 0.35)) continue
    const localWidth = right - left + 1
    const systemWidth = Math.max(1, systemRight - systemLeft + 1)
    rows.push({
      y,
      longestRunPx: longest,
      runStart: bestStart,
      runEnd: bestEnd,
      inkCount,
      lengthRelativeToLocalWindow: longest / localWidth,
      lengthRelativeToSystem: longest / systemWidth,
      thicknessLikely: inkCount / Math.max(1, longest) <= 1.35,
    })
  }
  // Cluster nearby y into ledger-row candidates
  const clustered = []
  for (const row of rows) {
    const prev = clustered[clustered.length - 1]
    if (prev && Math.abs(row.y - prev.yCenter) <= 1) {
      prev.memberYs.push(row.y)
      prev.yCenter = prev.memberYs.reduce((s, v) => s + v, 0) / prev.memberYs.length
      prev.longestRunPx = Math.max(prev.longestRunPx, row.longestRunPx)
      prev.lengthRelativeToSystem = Math.max(prev.lengthRelativeToSystem, row.lengthRelativeToSystem)
      prev.lengthRelativeToLocalWindow = Math.max(
        prev.lengthRelativeToLocalWindow,
        row.lengthRelativeToLocalWindow,
      )
      prev.runStart = Math.min(prev.runStart ?? row.runStart, row.runStart)
      prev.runEnd = Math.max(prev.runEnd ?? row.runEnd, row.runEnd)
    } else {
      clustered.push({
        yCenter: row.y,
        memberYs: [row.y],
        longestRunPx: row.longestRunPx,
        lengthRelativeToSystem: row.lengthRelativeToSystem,
        lengthRelativeToLocalWindow: row.lengthRelativeToLocalWindow,
        runStart: row.runStart,
        runEnd: row.runEnd,
      })
    }
  }
  const spacings = []
  for (let i = 1; i < clustered.length; i += 1) {
    spacings.push(clustered[i].yCenter - clustered[i - 1].yCenter)
  }
  return { rawRows: rows, clusteredRows: clustered, verticalSpacingsPx: spacings }
}

function classifyRowSpan(clusteredRows, gapPx, chordColumnXs, noteheadX) {
  if (!clusteredRows.length) return 'none'
  const avgLenLocal =
    clusteredRows.reduce((s, r) => s + r.lengthRelativeToLocalWindow, 0) / clusteredRows.length
  const avgLenSystem =
    clusteredRows.reduce((s, r) => s + r.lengthRelativeToSystem, 0) / clusteredRows.length
  const avgCenterX =
    clusteredRows.reduce((s, r) => s + ((r.runStart ?? 0) + (r.runEnd ?? 0)) / 2, 0) /
    clusteredRows.length
  const nearNote = Math.abs(avgCenterX - noteheadX) <= gapPx * 1.6
  const nearColumn =
    chordColumnXs?.length &&
    chordColumnXs.some((x) => Math.abs(avgCenterX - x) <= gapPx * 1.8)
  if (avgLenSystem >= 0.45 && clusteredRows.length >= 4) return 'most-of-system'
  if (avgLenSystem >= 0.22) return 'local-phrase'
  if (nearColumn && avgLenLocal >= 0.55) return 'one-chord-column'
  if (nearNote) return 'one-notehead'
  return 'local-phrase'
}

function classifyFailureMode({
  rejectedReason,
  suppressedRowCount,
  rowSpanClass,
  clusteredRows,
  gapPx,
  headSizedBeforeSuppress,
  headSizedAfterSuppress,
  verticallyCompeting,
  componentsAfter,
  staffTopPx,
  windowTop,
  accidentalNearby,
  staffStepErrorApprox,
}) {
  const rowsAboveStaff = clusteredRows.filter((r) => r.yCenter < staffTopPx - gapPx * 0.25)
  const shortLocalLedgers =
    rowsAboveStaff.length >= 2 &&
    rowsAboveStaff.every((r) => r.lengthRelativeToSystem < 0.35) &&
    (rowSpanClass === 'one-notehead' || rowSpanClass === 'one-chord-column')

  if (rejectedReason === 'no-head-sized-component') {
    if (shortLocalLedgers && suppressedRowCount >= 2 && headSizedBeforeSuppress > 0) {
      return 'local-ledger-run-incorrectly-classified-as-staff'
    }
    if (rowSpanClass === 'most-of-system' && clusteredRows.length >= 4) {
      return 'real-staff-geometry-correctly-suppressed'
    }
    if (headSizedBeforeSuppress > 0 && headSizedAfterSuppress === 0) {
      return 'ledger-fragments-masking-notehead-body'
    }
    if (componentsAfter.some((c) => c.heightRatio < 0.22 && c.widthRatio > 0.6)) {
      return 'notehead-merged-with-ledger-fragments'
    }
    if (headSizedBeforeSuppress === 0 && componentsAfter.length === 0) {
      return 'true-absence-of-usable-notehead-ink'
    }
    return 'ledger-fragments-masking-notehead-body'
  }
  if (rejectedReason === 'ambiguous-components') {
    if (verticallyCompeting) return 'several-chord-heads-treated-as-ambiguous-group'
    return 'stem-beam-components-creating-ambiguity'
  }
  if (rejectedReason === 'component-outside-font-origin-range') {
    if (shortLocalLedgers) return 'ledger-fragments-masking-notehead-body'
    return 'notehead-merged-with-ledger-fragments'
  }
  if (
    Number.isFinite(staffStepErrorApprox) &&
    staffStepErrorApprox === 0 &&
    accidentalNearby?.length
  ) {
    return 'accidental-shaped-residual-after-staff-position-correct'
  }
  return `other:${rejectedReason ?? 'unknown'}`
}

function probeAnchorGeometry(glyph, imageData, lineYs, { systemBounds = null, chordColumnXs = [] } = {}) {
  const pixelLines = lineYsInPixels(lineYs, imageData.height)
  const gapPx = staffGapPx(lineYs, imageData.height)
  if (!(gapPx >= 4)) {
    return { ok: false, reason: 'missing-local-staff-spacing' }
  }
  const glyphX = Number(glyph.x)
  const glyphY = Number(glyph.y)
  const glyphWidth = Math.max(1, Number(glyph.width) || gapPx * 0.8)
  const glyphHeight = Math.max(1, Number(glyph.height) || gapPx)
  const metricY = glyphY - gapPx * 0.32
  const supportRadius = Math.ceil(Math.max(gapPx * 1.7, glyphWidth * 1.1))
  const leftSupport = Math.max(0, Math.floor(glyphX - supportRadius))
  const rightSupport = Math.min(imageData.width - 1, Math.ceil(glyphX + supportRadius))
  const left = Math.max(0, Math.floor(glyphX - gapPx * 0.3))
  const right = Math.min(imageData.width - 1, Math.ceil(glyphX + gapPx * 1.15))
  const top = Math.max(
    0,
    Math.floor(Math.min(metricY, glyphY) - Math.max(gapPx * 1.35, glyphHeight * 0.9)),
  )
  const bottom = Math.min(imageData.height - 1, Math.ceil(glyphY + gapPx * 0.3))
  const systemLeft = systemBounds?.left ?? 0
  const systemRight = systemBounds?.right ?? imageData.width - 1
  const staffTopPx = pixelLines.length ? Math.min(...pixelLines) : bottom

  const rowAnalysis = analyzeHorizontalRows({
    imageData,
    left: leftSupport,
    right: rightSupport,
    top,
    bottom,
    systemLeft,
    systemRight,
    gapPx,
  })

  const suppressedRows = new Set()
  const horizontalSupportThreshold = Math.max(gapPx * 1.02, (right - left + 1) * 0.82)
  for (const row of rowAnalysis.rawRows) {
    if (row.y < top || row.y > bottom) continue
    if (row.longestRunPx >= horizontalSupportThreshold) suppressedRows.add(row.y)
  }

  const suppressedColumns = new Set()
  const verticalSupportThreshold = Math.max(gapPx * 0.9, (bottom - top + 1) * 0.42)
  for (let x = left; x <= right; x += 1) {
    let count = 0
    for (let y = top; y <= bottom; y += 1) {
      if (!suppressedRows.has(y) && pixelIsInk(imageData, x, y)) count += 1
    }
    if (count >= verticalSupportThreshold) suppressedColumns.add(x)
  }

  const before = collectComponents({
    imageData,
    left,
    right,
    top,
    bottom,
    suppressedRows: new Set(),
    suppressedColumns: new Set(),
  }).map((c) => ({
    ...c,
    widthRatio: c.width / gapPx,
    heightRatio: c.height / gapPx,
  }))
  const after = collectComponents({
    imageData,
    left,
    right,
    top,
    bottom,
    suppressedRows,
    suppressedColumns,
  }).map((c) => ({
    ...c,
    widthRatio: c.width / gapPx,
    heightRatio: c.height / gapPx,
    xOriginOffset: (c.centerX - glyphX) / gapPx,
    yOriginOffset: (glyphY - c.centerY) / gapPx,
  }))

  const isHeadSized = (c) =>
    c.widthRatio >= 0.42 && c.widthRatio <= 1.05 && c.heightRatio >= 0.22 && c.heightRatio <= 0.7
  const headBefore = before.filter(isHeadSized)
  const headAfter = after.filter(isHeadSized)
  const verticallyCompeting = headAfter.some((component, index) =>
    headAfter.some(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        Math.abs(candidate.centerY - component.centerY) >= gapPx * 0.35 &&
        Math.abs(candidate.centerY - component.centerY) <= gapPx * 1.25 &&
        Math.abs(candidate.centerX - component.centerX) <= gapPx * 0.18 &&
        Math.abs(candidate.width - component.width) <= gapPx * 0.25,
    ),
  )

  const rowSpanClass = classifyRowSpan(rowAnalysis.clusteredRows, gapPx, chordColumnXs, glyphX)
  const localSlope =
    pixelLines.length >= 2
      ? (pixelLines[pixelLines.length - 1] - pixelLines[0]) / Math.max(1, systemRight - systemLeft)
      : 0

  return {
    ok: true,
    window: { left, right, top, bottom, leftSupport, rightSupport },
    gapPx,
    staffTopPx,
    localStaffSlopeApprox: localSlope,
    suppressedRowCount: suppressedRows.size,
    suppressedColumnCount: suppressedColumns.size,
    horizontalSupportThreshold,
    ledgerRowCandidates: rowAnalysis.clusteredRows.map((r) => ({
      y: Math.round(r.yCenter),
      longestRunPx: r.longestRunPx,
      lengthRelativeToSystem: Number(r.lengthRelativeToSystem.toFixed(4)),
      lengthRelativeToLocalWindow: Number(r.lengthRelativeToLocalWindow.toFixed(4)),
      runStart: r.runStart,
      runEnd: r.runEnd,
      aboveStaff: r.yCenter < staffTopPx - gapPx * 0.2,
      halfSpaceAligned:
        gapPx > 0
          ? Math.min(
              Math.abs((staffTopPx - r.yCenter) / gapPx) % 0.5,
              0.5 - (Math.abs((staffTopPx - r.yCenter) / gapPx) % 0.5),
            ) < 0.12
          : false,
    })),
    rowVerticalSpacingsPx: rowAnalysis.verticalSpacingsPx.map((v) => Number(v.toFixed(2))),
    rowSpanClass,
    componentsBeforeSuppress: before.map((c) => ({
      bounds: { x: c.left, y: c.top, w: c.width, h: c.height },
      area: c.area,
      aspectRatio: Number((c.aspectRatio ?? 0).toFixed(3)),
      widthRatio: Number(c.widthRatio.toFixed(3)),
      heightRatio: Number(c.heightRatio.toFixed(3)),
      headSized: isHeadSized(c),
    })),
    componentsAfterSuppress: after.map((c) => ({
      bounds: { x: c.left, y: c.top, w: c.width, h: c.height },
      area: c.area,
      aspectRatio: Number((c.aspectRatio ?? 0).toFixed(3)),
      widthRatio: Number(c.widthRatio.toFixed(3)),
      heightRatio: Number(c.heightRatio.toFixed(3)),
      xOriginOffset: Number(c.xOriginOffset.toFixed(3)),
      yOriginOffset: Number(c.yOriginOffset.toFixed(3)),
      headSized: isHeadSized(c),
    })),
    headSizedBeforeSuppress: headBefore.length,
    headSizedAfterSuppress: headAfter.length,
    verticallyCompeting,
  }
}

function findNearbyAccidentals(pageText, note, imageData, gapPx) {
  const found = []
  for (const item of pageText ?? []) {
    const text = item.text ?? ''
    if (!text.length || !item.pageWidth || !item.pageHeight) continue
    const scaleX = imageData.width / item.pageWidth
    const scaleY = imageData.height / item.pageHeight
    const charWidth = (item.width ?? 0) / Math.max(1, text.length)
    for (let index = 0; index < text.length; index += 1) {
      const code = text.codePointAt(index)
      if (!ACCIDENTAL_CODES.has(code)) continue
      const gx = (item.x + charWidth * (index + 0.5)) * scaleX
      const gy = imageData.height - item.y * scaleY
      const dx = note.cx - gx
      const dy = note.cy - gy
      if (Math.abs(dx) <= gapPx * 3.5 && Math.abs(dy) <= gapPx * 1.8 && dx > -gapPx * 0.2) {
        found.push({
          code: `U+${code.toString(16).toUpperCase()}`,
          x: Number(gx.toFixed(1)),
          y: Number(gy.toFixed(1)),
          dxSpaces: Number((dx / gapPx).toFixed(3)),
          dySpaces: Number((dy / gapPx).toFixed(3)),
        })
      }
    }
  }
  return found
}

function staffPositionFromY(yNorm, lineYs) {
  if (!Number.isFinite(yNorm) || !Array.isArray(lineYs) || lineYs.length < 2) return null
  const sorted = [...lineYs].sort((a, b) => a - b)
  const gap = (sorted[sorted.length - 1] - sorted[0]) / 4
  if (!(gap > 0)) return null
  return Math.round(((sorted[sorted.length - 1] - yNorm) / gap) * 2)
}

function bump(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount
}

async function collectFixture(fixture, roots) {
  const pdfPath = resolveFixturePath(fixture.pdf, roots)
  const truthPath = resolveFixturePath(fixture.truth, roots)
  if (!pdfPath || !truthPath) {
    return { id: fixture.id, ok: false, error: 'missing files', records: [] }
  }
  const rendered = await renderPdfToPages(pdfPath, {
    rootDir: ROOT,
    maxPages: fixture.maxPages ?? 4,
    analysisWidth: CALIBRATION_ANALYSIS_WIDTH,
  })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const rejected = []
  const imageByPage = new Map()
  const textByPage = new Map()

  const omr = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: fixture.maxPages ?? 4,
    preprocessPages: true,
    instrumentId: fixture.instrumentId ?? 'piano',
    title: fixture.id,
    includeScoreGraph: true,
    analyzePage: async (imageData, context) => {
      const pageResult = processOmrPageAnalysis(imageData, context)
      const pageNumber = context.pageNumber ?? pageResult.pageEntry?.page ?? 1
      imageByPage.set(pageNumber, imageData)
      textByPage.set(pageNumber, context.pageText ?? [])

      // Chord columns by rounded x within each measure
      const columnsByMeasure = new Map()
      for (const measure of pageResult.measureRhythms ?? []) {
        const xs = []
        for (const event of measure.events ?? []) {
          if (event.type !== 'note') continue
          for (const note of event.notes ?? []) {
            if (Number.isFinite(note.cx)) xs.push(note.cx)
          }
        }
        columnsByMeasure.set(measure.measureNumber, xs)
      }

      for (const measure of pageResult.measureRhythms ?? []) {
        const system =
          (pageResult.systems ?? []).find((s) =>
            (s.staves ?? []).some((st) =>
              (measure.staffIndex != null ? st.index === measure.staffIndex : true),
            ),
          ) ?? pageResult.systems?.[measure.systemIndex ?? 0]
        const systemBounds = system
          ? {
              left: Math.floor((system.x0 ?? 0) * imageData.width),
              right: Math.ceil((system.x1 ?? 1) * imageData.width),
            }
          : { left: 0, right: imageData.width - 1 }

        for (const event of measure.events ?? []) {
          if (event.type !== 'note') continue
          for (const note of event.notes ?? []) {
            const lineYs = note.pitchMapping?.lineYs ?? []
            const ledger = Number.isFinite(note.yNorm) && lineYs.length
              ? estimateLedgerLineCount(note.yNorm, lineYs)
              : { direction: null, count: 0 }
            const bin = registerBinForTone(note.midi ?? note.naturalMidi, {
              clef: note.clef,
              ledger,
            })
            if (bin !== 'high-extreme') continue
            const anchor = note.noteheadAnchor
            if (!anchor || anchor.source === 'ink-notehead-geometry') continue

            const glyph = {
              x: note.cx,
              y: note.cy,
              width: note.noteheadFont ? undefined : undefined,
              height: undefined,
              text: note.noteheadFont?.glyph ?? '\ue0a4',
              fontName: note.noteheadFont?.fontName ?? '',
              // Prefer stored visual bounds width/height if present via re-probe defaults
            }
            // Re-resolve to confirm reject, then deep-probe using note dimensions from anchor window heuristics
            const confirm = resolveNoteheadAnchor(
              {
                x: note.cx,
                y: note.cy,
                width: Math.max(8, (note.noteheadAnchor?.visualBounds?.width ?? 0) || 14),
                height: Math.max(10, ((note.cy - (note.yNorm ?? note.cy / imageData.height) * imageData.height) || 24)),
                text: note.noteheadFont?.glyph ?? '\ue0a4',
                fontName: note.noteheadFont?.fontName ?? '',
              },
              imageData,
              lineYs,
            )

            // Use a more faithful glyph size from font metric if available via note fields
            const probeGlyph = {
              x: note.cx,
              y: note.cy,
              width: 14,
              height: 24,
              text: note.noteheadFont?.glyph ?? '\ue0a4',
              fontName: note.noteheadFont?.fontName ?? '',
            }
            // Derive height from raw vs metric if possible
            const gapPx = staffGapPx(lineYs, imageData.height)
            if (gapPx > 0 && Number.isFinite(anchor.rawYNorm) && Number.isFinite(anchor.yNorm)) {
              probeGlyph.height = Math.max(gapPx * 1.5, gapPx * 1.85)
              probeGlyph.width = Math.max(8, gapPx * 0.85)
            }

            const probe = probeAnchorGeometry(probeGlyph, imageData, lineYs, {
              systemBounds,
              chordColumnXs: columnsByMeasure.get(measure.measureNumber) ?? [],
            })
            const accidentalNearby = findNearbyAccidentals(
              textByPage.get(pageNumber),
              note,
              imageData,
              gapPx || 12,
            )
            const generatedStaffPosition = staffPositionFromY(note.yNorm, lineYs)
            const failureClass =
              probe.ok
                ? classifyFailureMode({
                    rejectedReason: anchor.rejectedReason ?? confirm.rejectedReason,
                    suppressedRowCount: probe.suppressedRowCount,
                    rowSpanClass: probe.rowSpanClass,
                    clusteredRows: probe.ledgerRowCandidates,
                    gapPx: probe.gapPx,
                    headSizedBeforeSuppress: probe.headSizedBeforeSuppress,
                    headSizedAfterSuppress: probe.headSizedAfterSuppress,
                    verticallyCompeting: probe.verticallyCompeting,
                    componentsAfter: probe.componentsAfterSuppress,
                    staffTopPx: probe.staffTopPx,
                    windowTop: probe.window.top,
                    accidentalNearby,
                  })
                : `probe-failed:${probe.reason}`

            rejected.push({
              fixture: fixture.id,
              page: pageNumber,
              system: measure.systemIndex ?? null,
              staff: note.clef === 'bass' ? 2 : 1,
              measure: measure.measureNumber,
              voice: note.voice ?? (note.clef === 'bass' ? 2 : 1),
              clef: note.clef ?? 'treble',
              onsetQuarters: (event.startDivision ?? 0) / 4,
              noteCandidateId: `${fixture.id}:p${pageNumber}:m${measure.measureNumber}:x${Math.round(note.cx)}:y${Math.round(note.cy)}`,
              glyphId: note.noteheadFont?.glyph
                ? `U+${note.noteheadFont.glyph.codePointAt(0).toString(16).toUpperCase()}`
                : null,
              pathId: null,
              chordColumnId: `${fixture.id}:m${measure.measureNumber}:col${Math.round(note.cx / Math.max(1, gapPx || 12))}`,
              midi: note.midi ?? note.naturalMidi ?? null,
              pitchLabel: midiToLabel(note.midi ?? note.naturalMidi),
              accidental: note.accidental ?? null,
              register: bin,
              ledger,
              finalFallbackSource: anchor.source,
              inkRejectedReason: anchor.rejectedReason ?? confirm.rejectedReason,
              suppressionRuleTriggered:
                (probe.suppressedRowCount ?? 0) > 0
                  ? 'horizontal-run>=max(gap*1.02, localWindow*0.82)'
                  : null,
              ambiguityRuleTriggered: probe.verticallyCompeting
                ? 'vertically-competing-head-sized-components'
                : null,
              generatedStaffPosition,
              localStaffSpacingPx: probe.gapPx ?? null,
              localStaffSlopeApprox: probe.localStaffSlopeApprox ?? null,
              ledgerRowCandidates: probe.ledgerRowCandidates ?? [],
              rowLengthsRelativeToSystem: (probe.ledgerRowCandidates ?? []).map(
                (r) => r.lengthRelativeToSystem,
              ),
              rowVerticalSpacingPx: probe.rowVerticalSpacingsPx ?? [],
              rowHorizontalOverlapWithNotehead: (probe.ledgerRowCandidates ?? []).map((r) => {
                const runStart = r.runStart ?? 0
                const runEnd = r.runEnd ?? 0
                const headLeft = note.cx - (probeGlyph.width / 2)
                const headRight = note.cx + (probeGlyph.width / 2)
                const overlap = Math.max(0, Math.min(runEnd, headRight) - Math.max(runStart, headLeft))
                return Number((overlap / Math.max(1, headRight - headLeft)).toFixed(3))
              }),
              repeatedRowCount: probe.ledgerRowCandidates?.length ?? 0,
              rowSpanClass: probe.rowSpanClass ?? null,
              rawInkComponents: probe.componentsBeforeSuppress ?? [],
              componentsAfterSuppress: probe.componentsAfterSuppress ?? [],
              headSizedBeforeSuppress: probe.headSizedBeforeSuppress ?? 0,
              headSizedAfterSuppress: probe.headSizedAfterSuppress ?? 0,
              suppressedStaffOrLedgerRows: probe.suppressedRowCount ?? anchor.suppressedStaffOrLedgerRows ?? 0,
              suppressedStemColumns: probe.suppressedColumnCount ?? anchor.suppressedStemColumns ?? 0,
              accidentalCandidatesNearby: accidentalNearby,
              failureClass,
              window: probe.window ?? null,
            })
          }
        }
      }
      return pageResult
    },
  })

  // Attach truth staff-position / accidental when alignable
  try {
    const truthXml = await readScoreXml(truthPath)
    const options = resolveSemanticEvalOptions({ mode: 'written' })
    const truthTiming = parseMusicXml(truthXml, `${fixture.id}.truth.musicxml`)
    const generatedTiming = parseMusicXml(omr.musicXml, `${fixture.id}.omr.musicxml`)
    const truthNotes = normalizeSemanticNotes(truthTiming, options).filter((n) => !n.isRest)
    const generatedNotes = normalizeSemanticNotes(generatedTiming, options).filter((n) => !n.isRest)
    const truthMeasures = truthTiming?.measures ?? []
    const generatedMeasures = generatedTiming?.measures ?? []
    const groupByIndex = (notes, measures) => {
      const byIndex = new Map(measures.map((_, index) => [index, []]))
      const byNumber = new Map(measures.map((measure, index) => [measure.number, index]))
      for (const note of notes) {
        const index = byNumber.get(note.measureNumber)
        if (index == null) continue
        byIndex.get(index).push(note)
      }
      return byIndex
    }
    const truthByIndex = groupByIndex(truthNotes, truthMeasures)
    const generatedByIndex = groupByIndex(generatedNotes, generatedMeasures)
    const alignment = alignMeasureSequences(
      truthMeasures.map((measure, index) =>
        buildMeasureFingerprint(measure, truthByIndex.get(index) ?? []),
      ),
      generatedMeasures.map((measure, index) =>
        buildMeasureFingerprint(measure, generatedByIndex.get(index) ?? []),
      ),
      options,
    )
    const byMeasure = new Map()
    for (const record of rejected) {
      if (!byMeasure.has(record.measure)) byMeasure.set(record.measure, [])
      byMeasure.get(record.measure).push(record)
    }
    for (const link of alignment.pairs ?? []) {
      if (link.kind !== 'match') continue
      const truthIndex = link.truthIndexes?.[0]
      const generatedIndex = link.generatedIndexes?.[0]
      const truthMeasureNumber = (link.truthMeasureNumbers ?? [])[0]
      if (truthIndex == null || truthMeasureNumber == null) continue
      const matched = matchSemanticEvents(
        truthByIndex.get(truthIndex) ?? [],
        generatedByIndex.get(generatedIndex) ?? [],
        options,
      )
      const candidates = byMeasure.get(truthMeasureNumber) ?? []
      for (const pair of matched.matches ?? []) {
        if (pair.truth?.isRest) continue
        let best = null
        let bestScore = Infinity
        for (const candidate of candidates) {
          if (candidate.truthAligned) continue
          const onsetDelta = Math.abs(
            (candidate.onsetQuarters ?? 0) - (pair.generated?.onsetQuarters ?? pair.truth.onsetQuarters ?? 0),
          )
          const score =
            onsetDelta * 4 +
            Math.abs((candidate.midi ?? 0) - (pair.generated?.midi ?? pair.truth.midi ?? 0)) * 0.05
          if (score < bestScore) {
            best = candidate
            bestScore = score
          }
        }
        if (!best || bestScore > 3) continue
        best.truthAligned = true
        best.expectedMidi = pair.truth.midi
        best.expectedPitchLabel = midiToLabel(pair.truth.midi)
        best.expectedAccidental = pair.truth.accidental ?? null
        best.pitchErrorSemitones =
          Number.isFinite(best.midi) && Number.isFinite(pair.truth.midi)
            ? best.midi - pair.truth.midi
            : null
        best.staffStepErrorApprox = best.pitchErrorSemitones
        if (
          best.failureClass !== 'accidental-shaped-residual-after-staff-position-correct' &&
          Number.isFinite(best.pitchErrorSemitones) &&
          Math.abs(best.pitchErrorSemitones) === 1 &&
          (best.accidentalCandidatesNearby?.length || best.accidental || pair.truth.accidental)
        ) {
          // Likely accidental residual if only ±1 and accidentals in play
          best.failureClassHint = 'possible-accidental-shaped-residual'
        }
      }
    }
  } catch (error) {
    for (const record of rejected) {
      record.truthAlignError = String(error?.message ?? error)
    }
  }

  writeFileSync(
    join(OUT, 'diagnostics', `${fixture.id}.rejections.json`),
    `${JSON.stringify(rejected, null, 2)}\n`,
  )
  return { id: fixture.id, ok: true, records: rejected, rejectedCount: rejected.length }
}

function summarize(records) {
  const byReject = {}
  const byFailure = {}
  const bySpan = {}
  const byFixture = {}
  let withAccidentalsNearby = 0
  for (const record of records) {
    bump(byReject, record.inkRejectedReason ?? 'none')
    bump(byFailure, record.failureClass ?? 'unknown')
    bump(bySpan, record.rowSpanClass ?? 'none')
    bump(byFixture, record.fixture)
    if (record.accidentalCandidatesNearby?.length) withAccidentalsNearby += 1
  }
  return {
    totalHighExtremeInkRejections: records.length,
    withAccidentalsNearby,
    byInkRejectReason: byReject,
    byFailureClass: byFailure,
    byRowSpanClass: bySpan,
    byFixture,
  }
}

function renderMarkdown(payload) {
  const lines = []
  lines.push('# Phase 1 — Dense ledger ink rejection inventory')
  lines.push('')
  lines.push(`- Commit: \`${payload.gitCommit}\``)
  lines.push(`- Created: ${payload.createdAt}`)
  lines.push('- Evaluator: frozen 2.0.0 / schema 2')
  lines.push('- Production code: **not modified**')
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push(
    'Every high-extreme generated tone whose notehead ink anchor was rejected (fallback ≠ `ink-notehead-geometry`) across the frozen nine-fixture corpus.',
  )
  lines.push('')
  lines.push('## Scoreboard')
  lines.push('')
  lines.push(`- High-extreme ink rejections: **${payload.summary.totalHighExtremeInkRejections}**`)
  lines.push(`- With nearby accidental glyph candidates: **${payload.summary.withAccidentalsNearby}**`)
  lines.push('')
  const section = (title, obj) => {
    lines.push(`## ${title}`)
    lines.push('')
    lines.push('| Key | Count |')
    lines.push('|---|---:|')
    for (const [key, count] of Object.entries(obj).sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${key}\` | ${count} |`)
    }
    lines.push('')
  }
  section('By ink rejection reason', payload.summary.byInkRejectReason)
  section('By failure class', payload.summary.byFailureClass)
  section('By row-span class', payload.summary.byRowSpanClass)
  section('By fixture', payload.summary.byFixture)
  lines.push('## Failure taxonomy (campaign)')
  lines.push('')
  lines.push('1. `local-ledger-run-incorrectly-classified-as-staff`')
  lines.push('2. `real-staff-geometry-correctly-suppressed`')
  lines.push('3. `notehead-merged-with-ledger-fragments`')
  lines.push('4. `several-chord-heads-treated-as-ambiguous-group`')
  lines.push('5. `ledger-fragments-masking-notehead-body`')
  lines.push('6. `stem-beam-components-creating-ambiguity`')
  lines.push('7. `true-absence-of-usable-notehead-ink`')
  lines.push('8. `accidental-shaped-residual-after-staff-position-correct`')
  lines.push('')
  lines.push('## Sample rejections')
  lines.push('')
  lines.push('| Fixture | M | Reject | Failure | Span | Rows | Heads before/after | Acc nearby |')
  lines.push('|---|---:|---|---|---|---:|---|---:|')
  payload.records.slice(0, 40).forEach((r) => {
    lines.push(
      `| ${r.fixture} | ${r.measure} | ${r.inkRejectedReason} | ${r.failureClass} | ${r.rowSpanClass} | ${r.repeatedRowCount} | ${r.headSizedBeforeSuppress}/${r.headSizedAfterSuppress} | ${r.accidentalCandidatesNearby?.length ?? 0} |`,
    )
  })
  lines.push('')
  lines.push('## Notes for Phase 2')
  lines.push('')
  lines.push(
    '- Classifier must use joint features (span vs system, staff continuity, notehead overlap), not row count alone.',
  )
  lines.push(
    '- Local ledger runs incorrectly suppressed as staff are the primary recovery target; preserve real system-spanning staff suppression.',
  )
  lines.push(
    '- Ambiguous stacked heads need per-glyph ownership, not broad chord ownership widening.',
  )
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const { fixtures, roots } = loadFixtures()
  const all = []
  const results = []
  for (const fixture of fixtures) {
    process.stderr.write(`Dense-ledger rejection inventory ${fixture.id}...\n`)
    try {
      const result = await collectFixture(fixture, roots)
      results.push({
        id: result.id,
        ok: result.ok,
        rejectedCount: result.rejectedCount,
        error: result.error,
      })
      all.push(...(result.records ?? []))
    } catch (error) {
      results.push({ id: fixture.id, ok: false, error: String(error?.stack ?? error) })
    }
  }
  const summary = summarize(all)
  const payload = {
    kind: 'dense-ledger-ink-rejection-inventory',
    gitCommit: gitCommit(),
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    summary,
    results,
    records: all,
  }
  writeFileSync(join(OUT, 'rejection_inventory.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(OUT, 'PHASE_1_REJECTION_INVENTORY.md'), `${renderMarkdown(payload)}\n`)
  process.stderr.write(
    `Wrote ${all.length} high-extreme ink rejections → tmp/omr-dense-ledger/rejection_inventory.json\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
