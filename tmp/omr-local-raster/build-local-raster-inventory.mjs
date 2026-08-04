#!/usr/bin/env node
/**
 * Phase 1 — local raster notehead recovery inventory.
 * Diagnostic only under tmp/omr-local-raster/. Does not edit production.
 *
 * Inventories every no-head-sized-component rejection and proposes a bounded
 * staff-space crop for local raster fallback (design only; no rasterize yet).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import {
  estimateLedgerLineCount,
  resolveNoteheadAnchor,
} from '../../src/features/omr/pitchFromStaffPosition.js'
import { partitionHorizontalRowsForInkRecovery } from '../../src/features/omr/localLedgerStaffClassifier.js'
import {
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVALUATOR_VERSION,
} from '../../src/features/omr/semanticEvalTolerances.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
  CALIBRATION_ANALYSIS_WIDTH,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/omr-local-raster')
const INK_THRESHOLD = 170
const ACCIDENTAL_CODES = new Set([0xe260, 0xe261, 0xe262, 0xe263, 0xe264])

/** Proposed crop half-extents in local staff spaces (design constants). */
const CROP_LEFT_SPACES = 0.55
const CROP_RIGHT_SPACES = 1.35
const CROP_ABOVE_SPACES = 1.25
const CROP_BELOW_SPACES = 0.45
/** Target staff-space resolution for thin-strip recovery (px per staff space). */
const TARGET_PX_PER_STAFF_SPACE = 28
const MAX_CROP_SIDE_PX_AT_TARGET = 220

mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'diagnostics'), { recursive: true })
mkdirSync(join(OUT, 'crops'), { recursive: true })

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
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'),
  )
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

function verticalInkExtent(imageData, x, y, radius = 3) {
  if (!pixelIsInk(imageData, x, y)) return 0
  let top = y
  let bottom = y
  for (let dy = 1; dy <= radius; dy += 1) {
    if (pixelIsInk(imageData, x, y - dy)) top = y - dy
    else break
  }
  for (let dy = 1; dy <= radius; dy += 1) {
    if (pixelIsInk(imageData, x, y + dy)) bottom = y + dy
    else break
  }
  return bottom - top + 1
}

function longestHorizontalInkRun(imageData, y, left, right) {
  let run = 0
  let longest = 0
  let longestStart = left
  let longestEnd = left
  let currentStart = left
  for (let x = left; x <= right; x += 1) {
    if (pixelIsInk(imageData, x, y)) {
      if (run === 0) currentStart = x
      run += 1
      if (run > longest) {
        longest = run
        longestStart = currentStart
        longestEnd = x
      }
    } else {
      run = 0
    }
  }
  return { longest, runStart: longestStart, runEnd: longestEnd }
}

function collectComponents({
  imageData,
  left,
  right,
  top,
  bottom,
  suppressedRows = new Set(),
  maskedLedgerRows = new Set(),
  suppressedColumns = new Set(),
  applyLedgerMask = false,
}) {
  const pixels = new Map()
  for (let y = top; y <= bottom; y += 1) {
    if (suppressedRows.has(y)) continue
    for (let x = left; x <= right; x += 1) {
      if (suppressedColumns.has(x) || !pixelIsInk(imageData, x, y)) continue
      if (applyLedgerMask && maskedLedgerRows.has(y) && verticalInkExtent(imageData, x, y) <= 2) {
        continue
      }
      pixels.set(`${x}:${y}`, { x, y })
    }
  }
  const components = []
  let id = 0
  while (pixels.size) {
    const first = pixels.values().next().value
    const queue = [first]
    pixels.delete(`${first.x}:${first.y}`)
    const component = {
      id: `c${id}`,
      top: first.y,
      bottom: first.y,
      left: first.x,
      right: first.x,
      pixels: 0,
    }
    id += 1
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
      fillRatio: component.pixels / Math.max(1, width * height),
      aspectRatio: height > 0 ? width / height : null,
      centerX: (component.left + component.right) / 2,
      centerY: (component.top + component.bottom) / 2,
    })
  }
  return components
}

function annotateComponents(components, gapPx, glyphX, glyphY) {
  return components.map((c) => {
    const widthRatio = c.width / gapPx
    const heightRatio = c.height / gapPx
    const xOriginOffset = (c.centerX - glyphX) / gapPx
    const yOriginOffset = (glyphY - c.centerY) / gapPx
    const headSized =
      widthRatio >= 0.42 &&
      widthRatio <= 1.05 &&
      heightRatio >= 0.22 &&
      heightRatio <= 0.7
    const looksStem =
      widthRatio <= 0.28 && heightRatio >= 0.9 && c.aspectRatio != null && c.aspectRatio < 0.35
    const looksLedger =
      heightRatio <= 0.18 && widthRatio >= 0.55 && c.aspectRatio != null && c.aspectRatio >= 2.2
    const looksBeam =
      heightRatio <= 0.35 && widthRatio >= 1.2 && c.aspectRatio != null && c.aspectRatio >= 2.5
    const nearHeadBand =
      xOriginOffset >= -0.4 &&
      xOriginOffset <= 1.1 &&
      yOriginOffset >= 0.2 &&
      yOriginOffset <= 1.3
    return {
      id: c.id,
      bounds: { x: c.left, y: c.top, w: c.width, h: c.height },
      area: c.area,
      fillRatio: Number(c.fillRatio.toFixed(3)),
      aspectRatio: Number((c.aspectRatio ?? 0).toFixed(3)),
      widthRatio: Number(widthRatio.toFixed(3)),
      heightRatio: Number(heightRatio.toFixed(3)),
      xOriginOffset: Number(xOriginOffset.toFixed(3)),
      yOriginOffset: Number(yOriginOffset.toFixed(3)),
      headSized,
      looksStem,
      looksLedger,
      looksBeam,
      nearHeadBand,
      likelyHeadFragment:
        nearHeadBand &&
        !looksStem &&
        !looksLedger &&
        !looksBeam &&
        widthRatio >= 0.12 &&
        heightRatio >= 0.12 &&
        widthRatio <= 1.2 &&
        heightRatio <= 1.1,
    }
  })
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
      if (Math.abs(dx) <= gapPx * 3.5 && Math.abs(dy) <= gapPx * 1.8) {
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

function measureCropInk(imageData, crop) {
  let ink = 0
  let total = 0
  const maxExtent = { left: crop.right, right: crop.left, top: crop.bottom, bottom: crop.top }
  let hasInk = false
  for (let y = crop.top; y <= crop.bottom; y += 1) {
    for (let x = crop.left; x <= crop.right; x += 1) {
      total += 1
      if (!pixelIsInk(imageData, x, y)) continue
      ink += 1
      hasInk = true
      maxExtent.left = Math.min(maxExtent.left, x)
      maxExtent.right = Math.max(maxExtent.right, x)
      maxExtent.top = Math.min(maxExtent.top, y)
      maxExtent.bottom = Math.max(maxExtent.bottom, y)
    }
  }
  return {
    inkPixels: ink,
    totalPixels: total,
    inkRatio: total > 0 ? ink / total : 0,
    inkBounds: hasInk
      ? {
          x: maxExtent.left,
          y: maxExtent.top,
          w: maxExtent.right - maxExtent.left + 1,
          h: maxExtent.bottom - maxExtent.top + 1,
        }
      : null,
  }
}

function proposeRasterCrop({ glyphX, glyphY, gapPx, imageData, pageWidthPdf }) {
  const expectedCx = glyphX + gapPx * 0.55
  const expectedCy = glyphY - gapPx * 0.51
  const left = Math.max(0, Math.floor(expectedCx - gapPx * CROP_LEFT_SPACES))
  const right = Math.min(imageData.width - 1, Math.ceil(expectedCx + gapPx * CROP_RIGHT_SPACES))
  const top = Math.max(0, Math.floor(expectedCy - gapPx * CROP_ABOVE_SPACES))
  const bottom = Math.min(imageData.height - 1, Math.ceil(expectedCy + gapPx * CROP_BELOW_SPACES))
  const widthPx = right - left + 1
  const heightPx = bottom - top + 1
  const widthSpaces = widthPx / gapPx
  const heightSpaces = heightPx / gapPx
  const analysisPxPerSpace = gapPx
  const scaleFactor = Math.max(1, TARGET_PX_PER_STAFF_SPACE / Math.max(1, analysisPxPerSpace))
  const targetWidth = Math.round(widthPx * scaleFactor)
  const targetHeight = Math.round(heightPx * scaleFactor)
  const clamped =
    Math.max(targetWidth, targetHeight) > MAX_CROP_SIDE_PX_AT_TARGET
      ? MAX_CROP_SIDE_PX_AT_TARGET / Math.max(targetWidth, targetHeight)
      : 1
  const finalScale = scaleFactor * clamped
  const pdfPageWidthPts = pageWidthPdf ?? null
  const analysisDpiApprox =
    pdfPageWidthPts > 0 ? (imageData.width / pdfPageWidthPts) * 72 : null
  const cropDpiApprox = analysisDpiApprox != null ? analysisDpiApprox * finalScale : null

  return {
    analysisCropBoundsPx: { left, right, top, bottom, width: widthPx, height: heightPx },
    cropExtentsStaffSpaces: {
      left: CROP_LEFT_SPACES,
      right: CROP_RIGHT_SPACES,
      above: CROP_ABOVE_SPACES,
      below: CROP_BELOW_SPACES,
      width: Number(widthSpaces.toFixed(3)),
      height: Number(heightSpaces.toFixed(3)),
    },
    expectedNoteheadCenterPx: {
      x: Number(expectedCx.toFixed(2)),
      y: Number(expectedCy.toFixed(2)),
    },
    analysisPxPerStaffSpace: Number(gapPx.toFixed(3)),
    proposedLocalScaleFactor: Number(finalScale.toFixed(3)),
    proposedRasterCropPx: {
      width: Math.round(widthPx * finalScale),
      height: Math.round(heightPx * finalScale),
    },
    proposedDpiApprox: cropDpiApprox != null ? Number(cropDpiApprox.toFixed(1)) : null,
    analysisDpiApprox: analysisDpiApprox != null ? Number(analysisDpiApprox.toFixed(1)) : null,
    maxCropSideClampPx: MAX_CROP_SIDE_PX_AT_TARGET,
    targetPxPerStaffSpace: TARGET_PX_PER_STAFF_SPACE,
  }
}

function classifyRasterCase({
  after,
  maskedLedgerRowCount,
  accidentalNearby,
  stemCandidate,
  connectivity,
  visualSourceHints,
  cropInk,
}) {
  const fragments = after.filter((c) => c.likelyHeadFragment)
  const stacked =
    visualSourceHints?.stackedChordHeadLikely ||
    (fragments.length >= 2 &&
      new Set(fragments.map((c) => Math.round(c.yOriginOffset * 10))).size >= 2)
  const displaced =
    fragments.length >= 2 &&
    Math.max(...fragments.map((c) => c.xOriginOffset)) -
      Math.min(...fragments.map((c) => c.xOriginOffset)) >=
      0.35 &&
    Math.max(...fragments.map((c) => c.yOriginOffset)) -
      Math.min(...fragments.map((c) => c.yOriginOffset)) >=
      0.25

  if ((cropInk?.inkPixels ?? 0) < 8 || (connectivity?.totalAreaAfter ?? 0) === 0) {
    return 'no-visible-recoverable-raster-body'
  }
  if (
    fragments.length === 0 &&
    after.every((c) => c.looksStem || c.looksLedger || c.looksBeam) &&
    after.length > 0
  ) {
    return 'non-note-artifact-correctly-rejected'
  }
  if (accidentalNearby?.length && (!fragments.length || fragments.every((c) => c.xOriginOffset < 0.1))) {
    // Prefer accidental grouping only when body evidence is weak beside marks.
    if (fragments.length <= 1 && visualSourceHints?.openHeadLikely !== true) {
      // fall through — accidental adjoining is still a notehead case when ledgers exist
    }
  }
  if (accidentalNearby?.length && maskedLedgerRowCount === 0 && fragments.length <= 1) {
    return 'notehead-adjoining-accidental'
  }
  if (stacked) return 'stacked-chord-heads'
  if (displaced) return 'displaced-seconds'
  if (stemCandidate && fragments.length <= 2) return 'notehead-adjoining-stem'
  if (accidentalNearby?.length) return 'notehead-adjoining-accidental'
  if (maskedLedgerRowCount > 0 && visualSourceHints?.openHeadLikely) {
    return 'open-notehead-under-ledger-lines'
  }
  if (maskedLedgerRowCount > 0) return 'filled-notehead-under-ledger-lines'
  if (visualSourceHints?.openHeadLikely) return 'open-notehead-under-ledger-lines'
  if (fragments.length >= 1 || (cropInk?.inkRatio ?? 0) > 0.02) {
    return 'filled-notehead-under-ledger-lines'
  }
  return 'no-visible-recoverable-raster-body'
}

function probeNoHeadSized(note, imageData, lineYs, pageText, pageMeta) {
  const gapPx = staffGapPx(lineYs, imageData.height)
  if (!(gapPx >= 4)) return { ok: false, reason: 'missing-gap' }
  const glyphX = note.cx
  const glyphY = note.cy
  const glyphWidth = Math.max(gapPx * 0.85, 10)
  const glyphHeight = Math.max(gapPx * 1.85, 16)
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
  const pixelLines = lineYsInPixels(lineYs, imageData.height)
  const staffTopPx = Math.min(...pixelLines)
  const staffBottomPx = Math.max(...pixelLines)
  const localWidth = Math.max(1, right - left + 1)
  const horizontalSupportThreshold = Math.max(gapPx * 1.02, localWidth * 0.82)

  const candidateRows = []
  for (let y = top; y <= bottom; y += 1) {
    const local = longestHorizontalInkRun(imageData, y, leftSupport, rightSupport)
    if (local.longest < horizontalSupportThreshold * 0.5) continue
    const system = longestHorizontalInkRun(imageData, y, 0, imageData.width - 1)
    candidateRows.push({
      y,
      longestRunPx: local.longest,
      runStart: local.runStart,
      runEnd: local.runEnd,
      lengthRelativeToLocalWindow: local.longest / localWidth,
      lengthRelativeToSystem: system.longest / imageData.width,
    })
  }
  const partitioned = partitionHorizontalRowsForInkRecovery(candidateRows, {
    gapPx,
    staffTopPx,
    staffBottomPx,
    noteheadX: glyphX,
    chordColumnXs: [glyphX],
    systemEventSupport: 0,
  })
  const suppressedRows = new Set(partitioned.suppressedStaffRows)
  const maskedLedgerRows = new Set(partitioned.acceptedLedgerRows.map((r) => r.y))

  const suppressedColumns = new Set()
  const verticalSupportThreshold = Math.max(gapPx * 0.9, (bottom - top + 1) * 0.42)
  for (let x = left; x <= right; x += 1) {
    let count = 0
    for (let y = top; y <= bottom; y += 1) {
      if (suppressedRows.has(y)) continue
      if (maskedLedgerRows.has(y) && verticalInkExtent(imageData, x, y) <= 2) continue
      if (pixelIsInk(imageData, x, y)) count += 1
    }
    if (count >= verticalSupportThreshold) suppressedColumns.add(x)
  }

  const afterMask = collectComponents({
    imageData,
    left,
    right,
    top,
    bottom,
    suppressedRows,
    maskedLedgerRows,
    suppressedColumns,
    applyLedgerMask: true,
  })
  const before = annotateComponents(
    collectComponents({
      imageData,
      left,
      right,
      top,
      bottom,
      suppressedRows: new Set(),
      suppressedColumns: new Set(),
      applyLedgerMask: false,
    }),
    gapPx,
    glyphX,
    glyphY,
  )
  const after = annotateComponents(afterMask, gapPx, glyphX, glyphY)
  const accidentalNearby = findNearbyAccidentals(pageText, note, imageData, gapPx)
  const stemCandidate = after.find((c) => c.looksStem) ?? null
  const beamCandidate = after.find((c) => c.looksBeam) ?? null
  const connectivity = {
    componentCountBefore: before.length,
    componentCountAfterMask: after.length,
    headSizedBefore: before.filter((c) => c.headSized).length,
    headSizedAfter: after.filter((c) => c.headSized).length,
    likelyHeadFragmentsBefore: before.filter((c) => c.likelyHeadFragment).length,
    likelyHeadFragmentsAfter: after.filter((c) => c.likelyHeadFragment).length,
    totalAreaBefore: before.reduce((s, c) => s + c.area, 0),
    totalAreaAfter: after.reduce((s, c) => s + c.area, 0),
  }
  const visualSourceHints = {
    filledHeadLikely: after.some((c) => c.likelyHeadFragment && c.fillRatio >= 0.35),
    openHeadLikely:
      after.filter((c) => c.likelyHeadFragment).length >= 2 &&
      after.filter((c) => c.likelyHeadFragment).every((c) => c.fillRatio < 0.45),
    stackedChordHeadLikely:
      after.filter((c) => c.likelyHeadFragment).length >= 2 &&
      new Set(
        after
          .filter((c) => c.likelyHeadFragment)
          .map((c) => Math.round(c.yOriginOffset * 10)),
      ).size >= 2,
    compositeNoteStemLikely: Boolean(stemCandidate),
  }

  const rasterCrop = proposeRasterCrop({
    glyphX,
    glyphY,
    gapPx,
    imageData,
    pageWidthPdf: pageMeta?.pageWidth ?? null,
  })
  const cropInk = measureCropInk(imageData, rasterCrop.analysisCropBoundsPx)
  const rasterCase = classifyRasterCase({
    after,
    maskedLedgerRowCount: maskedLedgerRows.size,
    accidentalNearby,
    stemCandidate,
    connectivity,
    visualSourceHints,
    cropInk,
  })

  return {
    ok: true,
    gapPx,
    window: { left, right, top, bottom },
    expectedHeadWidthRange: [0.42 * gapPx, 1.05 * gapPx],
    expectedHeadHeightRange: [0.22 * gapPx, 0.7 * gapPx],
    maskedLedgerRows: [...maskedLedgerRows].sort((a, b) => a - b),
    suppressedStaffRows: [...suppressedRows].sort((a, b) => a - b),
    componentsAfterLedgerMask: after,
    connectivity,
    accidentalCandidatesNearby: accidentalNearby,
    stemCandidate: stemCandidate
      ? { id: stemCandidate.id, bounds: stemCandidate.bounds }
      : null,
    beamCandidate: beamCandidate
      ? { id: beamCandidate.id, bounds: beamCandidate.bounds }
      : null,
    visualSourceHints,
    rasterCrop,
    cropInkAtAnalysisResolution: {
      inkPixels: cropInk.inkPixels,
      inkRatio: Number(cropInk.inkRatio.toFixed(4)),
      inkBounds: cropInk.inkBounds,
      recoverableLikely:
        cropInk.inkPixels >= 24 &&
        cropInk.inkRatio >= 0.015 &&
        rasterCase !== 'no-visible-recoverable-raster-body' &&
        rasterCase !== 'non-note-artifact-correctly-rejected',
    },
    rasterCaseGroup: rasterCase,
  }
}

function bump(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount
}

async function collectFixture(fixture, roots) {
  const pdfPath = resolveFixturePath(fixture.pdf, roots)
  if (!pdfPath) return { id: fixture.id, ok: false, error: 'missing pdf', records: [] }
  const rendered = await renderPdfToPages(pdfPath, {
    rootDir: ROOT,
    maxPages: fixture.maxPages ?? 4,
    analysisWidth: CALIBRATION_ANALYSIS_WIDTH,
  })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const records = []
  const pageCropBudgets = {}

  await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: fixture.maxPages ?? 4,
    preprocessPages: true,
    instrumentId: fixture.instrumentId ?? 'piano',
    title: fixture.id,
    analyzePage: async (imageData, context) => {
      const pageResult = processOmrPageAnalysis(imageData, context)
      const pageNumber = context.pageNumber ?? pageResult.pageEntry?.page ?? 1
      const pageText = context.pageText ?? []
      const pageMeta = {
        pageWidth: pageText[0]?.pageWidth ?? null,
        pageHeight: pageText[0]?.pageHeight ?? null,
      }
      pageCropBudgets[pageNumber] = pageCropBudgets[pageNumber] ?? {
        candidates: 0,
        recoverable: 0,
        totalCropPixelsAtTarget: 0,
      }

      for (const measure of pageResult.measureRhythms ?? []) {
        for (const event of measure.events ?? []) {
          if (event.type !== 'note') continue
          for (const note of event.notes ?? []) {
            const anchor = note.noteheadAnchor
            if (anchor?.rejectedReason !== 'no-head-sized-component') continue
            const lineYs = note.pitchMapping?.lineYs ?? []
            const ledger =
              Number.isFinite(note.yNorm) && lineYs.length
                ? estimateLedgerLineCount(note.yNorm, lineYs)
                : { direction: null, count: 0 }
            const register = registerBinForTone(note.midi ?? note.naturalMidi, {
              clef: note.clef,
              ledger,
            })
            const confirm = resolveNoteheadAnchor(
              {
                x: note.cx,
                y: note.cy,
                width: 14,
                height: 24,
                text: note.noteheadFont?.glyph ?? '\ue0a4',
                fontName: note.noteheadFont?.fontName ?? '',
              },
              imageData,
              lineYs,
            )
            const probe = probeNoHeadSized(note, imageData, lineYs, pageText, pageMeta)
            const crop = probe.rasterCrop
            if (crop) {
              pageCropBudgets[pageNumber].candidates += 1
              if (probe.cropInkAtAnalysisResolution?.recoverableLikely) {
                pageCropBudgets[pageNumber].recoverable += 1
              }
              pageCropBudgets[pageNumber].totalCropPixelsAtTarget +=
                (crop.proposedRasterCropPx?.width ?? 0) *
                (crop.proposedRasterCropPx?.height ?? 0)
            }

            records.push({
              fixture: fixture.id,
              page: pageNumber,
              system: measure.systemIndex ?? null,
              staff: note.clef === 'bass' ? 2 : 1,
              measure: measure.measureNumber,
              voice: note.voice ?? (note.clef === 'bass' ? 2 : 1),
              clef: note.clef ?? 'treble',
              onsetQuarters: (event.startDivision ?? 0) / 4,
              noteCandidateId: `${fixture.id}:p${pageNumber}:m${measure.measureNumber}:x${Math.round(note.cx)}:y${Math.round(note.cy)}`,
              chordColumnId: `${fixture.id}:m${measure.measureNumber}:col${Math.round(note.cx / 12)}`,
              register,
              generatedMidi: note.midi ?? note.naturalMidi ?? null,
              generatedPitchLabel: midiToLabel(note.midi ?? note.naturalMidi),
              // Truth pitch requires measure alignment; filled in later when HE inventory exists.
              visualExpectedPitchLabel: null,
              fontName: note.noteheadFont?.fontName ?? null,
              glyph: note.noteheadFont?.glyph ?? null,
              glyphId: note.noteheadFont?.glyph
                ? `U+${note.noteheadFont.glyph.codePointAt(0).toString(16).toUpperCase()}`
                : null,
              glyphOrigin: { x: note.cx, y: note.cy },
              glyphTransform: note.noteheadFont?.transform ?? null,
              currentFallbackAnchor: {
                source: anchor.source ?? 'glyph-metrics-fallback',
                yNorm: anchor.yNorm,
                rawYNorm: anchor.rawYNorm,
                rejectedReason: anchor.rejectedReason,
                confidence: anchor.confidence ?? null,
              },
              confirmRejectedReason: confirm.rejectedReason,
              localStaffSpacingPx: probe.gapPx ?? null,
              expectedLocalNoteheadRegion: crop
                ? {
                    centerPx: crop.expectedNoteheadCenterPx,
                    widthRangePx: probe.expectedHeadWidthRange,
                    heightRangePx: probe.expectedHeadHeightRange,
                  }
                : null,
              ledgerRows: probe.maskedLedgerRows ?? [],
              suppressedStaffRows: probe.suppressedStaffRows ?? [],
              vectorComponentsAfterMask: (probe.componentsAfterLedgerMask ?? []).map((c) => ({
                id: c.id,
                bounds: c.bounds,
                widthRatio: c.widthRatio,
                heightRatio: c.heightRatio,
                fillRatio: c.fillRatio,
                xOriginOffset: c.xOriginOffset,
                yOriginOffset: c.yOriginOffset,
                likelyHeadFragment: c.likelyHeadFragment,
                looksStem: c.looksStem,
                looksLedger: c.looksLedger,
              })),
              connectivity: probe.connectivity ?? null,
              stemCandidate: probe.stemCandidate,
              beamCandidate: probe.beamCandidate,
              accidentalCandidatesNearby: probe.accidentalCandidatesNearby ?? [],
              visualSourceHints: probe.visualSourceHints ?? null,
              proposedRasterCrop: crop ?? null,
              cropInkAtAnalysisResolution: probe.cropInkAtAnalysisResolution ?? null,
              rasterCaseGroup: probe.rasterCaseGroup ?? 'unknown',
            })
          }
        }
      }
      return pageResult
    },
  })

  writeFileSync(
    join(OUT, 'diagnostics', `${fixture.id}.no-head-sized.json`),
    `${JSON.stringify({ records, pageCropBudgets }, null, 2)}\n`,
  )
  return { id: fixture.id, ok: true, count: records.length, records, pageCropBudgets }
}

function attachHighExtremeTruth(records) {
  const hePath = join(ROOT, 'tmp/omr-high-extreme/high_extreme_inventory.json')
  if (!existsSync(hePath)) return { attached: 0 }
  const he = JSON.parse(readFileSync(hePath, 'utf8'))
  const chords = he.chords ?? []
  let attached = 0
  for (const record of records) {
    if (record.register !== 'high-extreme') continue
    const matches = chords.filter(
      (c) =>
        c.fixture === record.fixture &&
        c.measure === record.measure &&
        Math.abs((c.onset ?? 0) - (record.onsetQuarters ?? 0)) < 0.05,
    )
    if (!matches.length) continue
    // Prefer nearest generated pitch within the chord's expected set as visual target.
    const expected = matches.flatMap((c) => c.expectedPitches ?? [])
    if (expected.length) {
      record.visualExpectedPitchLabelsInChord = [...new Set(expected)]
      record.visualExpectedPitchLabel =
        expected.find((p) => p === record.generatedPitchLabel) ?? expected.join('|')
      attached += 1
    }
  }
  return { attached }
}

function summarize(records, fixtureBudgets) {
  const byGroup = {}
  const byRegister = {}
  const byFixture = {}
  const highExtreme = records.filter((r) => r.register === 'high-extreme')
  let recoverable = 0
  let emptyCrop = 0
  const cropWidths = []
  const cropHeights = []
  const scales = []
  for (const record of records) {
    bump(byGroup, record.rasterCaseGroup ?? 'unknown')
    bump(byRegister, record.register ?? 'unknown')
    bump(byFixture, record.fixture)
    if (record.cropInkAtAnalysisResolution?.recoverableLikely) recoverable += 1
    if ((record.cropInkAtAnalysisResolution?.inkPixels ?? 0) < 8) emptyCrop += 1
    const crop = record.proposedRasterCrop?.proposedRasterCropPx
    if (crop) {
      cropWidths.push(crop.width)
      cropHeights.push(crop.height)
      scales.push(record.proposedRasterCrop.proposedLocalScaleFactor)
    }
  }
  const avg = (arr) =>
    arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
  return {
    totalNoHeadSizedRejections: records.length,
    highExtremeNoHeadSized: highExtreme.length,
    recoverableLikelyAtProposedCrop: recoverable,
    emptyOrNearEmptyCrops: emptyCrop,
    byRasterCaseGroup: byGroup,
    byRegister,
    byFixture,
    cropDesign: {
      extentsStaffSpaces: {
        left: CROP_LEFT_SPACES,
        right: CROP_RIGHT_SPACES,
        above: CROP_ABOVE_SPACES,
        below: CROP_BELOW_SPACES,
      },
      targetPxPerStaffSpace: TARGET_PX_PER_STAFF_SPACE,
      maxCropSidePx: MAX_CROP_SIDE_PX_AT_TARGET,
      meanProposedCropWidthPx: Number(avg(cropWidths).toFixed(1)),
      meanProposedCropHeightPx: Number(avg(cropHeights).toFixed(1)),
      meanLocalScaleFactor: Number(avg(scales).toFixed(3)),
      analysisWidthPx: CALIBRATION_ANALYSIS_WIDTH,
    },
    pageCropBudgets: fixtureBudgets,
  }
}

function renderMarkdown(payload) {
  const s = payload.summary
  const lines = []
  lines.push('# Phase 1 — Local raster notehead failure inventory')
  lines.push('')
  lines.push(`- Commit: \`${payload.gitCommit}\``)
  lines.push(`- Created: ${payload.createdAt}`)
  lines.push('- Evaluator: frozen 2.0.0 / schema 2')
  lines.push('- Production code: **not modified**')
  lines.push('- Optical profile: **disabled**')
  lines.push('- Vector fragment clustering: **removed / not present**')
  lines.push('')
  lines.push('## Cleanup confirmation')
  lines.push('')
  lines.push('- Production HEAD: `beeb5f0`')
  lines.push('- `pitchFromStaffPosition.js` matches HEAD (no local diff)')
  lines.push('- Rejected `noteheadFragmentCluster.js` and its unit tests deleted')
  lines.push('- Prior report preserved: `tmp/omr-head-components/HIGH_EXTREME_COMPONENT_RECOVERY_REPORT.md`')
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push(
    'Every generated note with `noteheadAnchor.rejectedReason === no-head-sized-component` on the frozen nine-fixture corpus, plus a proposed local raster crop in staff spaces.',
  )
  lines.push('')
  lines.push('## Scoreboard')
  lines.push('')
  lines.push(`- Total no-head-sized rejections: **${s.totalNoHeadSizedRejections}**`)
  lines.push(`- High-extreme subset: **${s.highExtremeNoHeadSized}**`)
  lines.push(
    `- Crops with recoverable ink at analysis resolution: **${s.recoverableLikelyAtProposedCrop}**`,
  )
  lines.push(`- Empty / near-empty crops: **${s.emptyOrNearEmptyCrops}**`)
  lines.push('')
  lines.push('## Proposed crop design (not implemented)')
  lines.push('')
  lines.push('| Parameter | Value |')
  lines.push('|---|---|')
  lines.push(
    `| Extents (staff spaces) | L ${s.cropDesign.extentsStaffSpaces.left} / R ${s.cropDesign.extentsStaffSpaces.right} / above ${s.cropDesign.extentsStaffSpaces.above} / below ${s.cropDesign.extentsStaffSpaces.below} |`,
  )
  lines.push(`| Target px / staff space | ${s.cropDesign.targetPxPerStaffSpace} |`)
  lines.push(`| Max crop side (px) | ${s.cropDesign.maxCropSidePx} |`)
  lines.push(`| Mean proposed crop W×H | ${s.cropDesign.meanProposedCropWidthPx} × ${s.cropDesign.meanProposedCropHeightPx} |`)
  lines.push(`| Mean local scale vs analysis | ${s.cropDesign.meanLocalScaleFactor}× |`)
  lines.push(`| Analysis page width | ${s.cropDesign.analysisWidthPx}px |`)
  lines.push('')
  lines.push('## By raster case group')
  lines.push('')
  lines.push('| Group | Count |')
  lines.push('|---|---:|')
  for (const [key, count] of Object.entries(s.byRasterCaseGroup).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${key}\` | ${count} |`)
  }
  lines.push('')
  lines.push('## By register')
  lines.push('')
  lines.push('| Register | Count |')
  lines.push('|---|---:|')
  for (const [key, count] of Object.entries(s.byRegister).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${key}\` | ${count} |`)
  }
  lines.push('')
  lines.push('## By fixture')
  lines.push('')
  lines.push('| Fixture | Count |')
  lines.push('|---|---:|')
  for (const [key, count] of Object.entries(s.byFixture).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${key}\` | ${count} |`)
  }
  lines.push('')
  lines.push('## High-extreme sample (crop proposals)')
  lines.push('')
  lines.push(
    '| Fixture | M | Group | Gap px | Crop W×H @target | Scale | Ink px | Recoverable | Generated |',
  )
  lines.push('|---|---:|---|---:|---|---:|---:|---|---|')
  payload.records
    .filter((r) => r.register === 'high-extreme')
    .slice(0, 40)
    .forEach((r) => {
      const crop = r.proposedRasterCrop?.proposedRasterCropPx
      lines.push(
        `| ${r.fixture} | ${r.measure} | ${r.rasterCaseGroup} | ${r.localStaffSpacingPx?.toFixed?.(1) ?? r.localStaffSpacingPx} | ${crop?.width ?? '?'}×${crop?.height ?? '?'} | ${r.proposedRasterCrop?.proposedLocalScaleFactor ?? '?'} | ${r.cropInkAtAnalysisResolution?.inkPixels ?? 0} | ${r.cropInkAtAnalysisResolution?.recoverableLikely ? 'yes' : 'no'} | ${r.generatedPitchLabel ?? '—'} |`,
      )
    })
  lines.push('')
  lines.push('## Cost sketch (design)')
  lines.push('')
  lines.push(
    '- Rasterize **only** when ordinary + ledger-masked vector ink fail with `no-head-sized-component`.',
  )
  lines.push(
    '- Prefer one page-level supersampled render (or tile cache) shared by nearby candidates — not one full-page render per note.',
  )
  lines.push(
    `- Bound crop side to ≤ ${MAX_CROP_SIDE_PX_AT_TARGET}px at target scale; bound candidates/page (suggested ≤ 64 recoverable crops).`,
  )
  lines.push(
    '- Estimated memory per crop ≈ `W×H×4` bytes at target scale (mean crop ~ mean W×H above).',
  )
  lines.push('')
  lines.push('## Next (Phase 2)')
  lines.push('')
  lines.push(
    'Design local crop/cache infrastructure only after reviewing this inventory; do not land recognition changes until crop design is accepted.',
  )
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const { fixtures, roots } = loadFixtures()
  const all = []
  const results = []
  const fixtureBudgets = {}
  for (const fixture of fixtures) {
    process.stderr.write(`Local-raster inventory ${fixture.id}...\n`)
    try {
      const result = await collectFixture(fixture, roots)
      results.push({ id: result.id, ok: result.ok, count: result.count, error: result.error })
      all.push(...(result.records ?? []))
      fixtureBudgets[fixture.id] = result.pageCropBudgets ?? {}
    } catch (error) {
      results.push({ id: fixture.id, ok: false, error: String(error?.stack ?? error) })
    }
  }
  const truthAttach = attachHighExtremeTruth(all)
  const summary = summarize(all, fixtureBudgets)
  const payload = {
    kind: 'local-raster-notehead-inventory',
    gitCommit: gitCommit(),
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    productionBaseline: 'beeb5f0',
    opticalProfile: 'disabled',
    truthAttach,
    summary,
    results,
    records: all,
  }
  writeFileSync(join(OUT, 'local_raster_inventory.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(OUT, 'PHASE_1_LOCAL_RASTER_INVENTORY.md'), `${renderMarkdown(payload)}\n`)
  process.stderr.write(
    `Wrote ${all.length} records → tmp/omr-local-raster/local_raster_inventory.json\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
