import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import { detectUnsafeRepeatExpansion } from '../musicxml/parseMeasureRepeats.js'
import { detectVoltaFromRaster } from './detectRasterVoltaEnding.js'
import {
  detectVectorRepeatAtEdge,
  extractRepeatDotGlyphsFromPageText,
  fuseVectorRepeatMarkings,
  staffGapFromLines,
} from './detectVectorRepeatBarlines.js'

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function verticalBarStrength(imageData, x, y0, y1, threshold) {
  const top = Math.floor(y0)
  const bottom = Math.ceil(y1)
  let run = 0
  for (let y = top; y <= bottom; y += 1) {
    if (inkAt(imageData, x, y, threshold)) {
      run += 1
    }
  }
  return run / Math.max(1, bottom - top + 1)
}

function normalizeMeasureBox(measureBox) {
  return {
    x0: measureBox.x0 ?? measureBox.xStart ?? 0,
    x1: measureBox.x1 ?? measureBox.xEnd ?? 1,
    y0: measureBox.y0 ?? measureBox.yTop ?? 0,
    y1: measureBox.y1 ?? measureBox.yBottom ?? 1,
  }
}

function structureDetectionBox(measureBox, structureBand = null) {
  const box = normalizeMeasureBox(measureBox)
  if (!structureBand) {
    return box
  }
  const band = normalizeMeasureBox(structureBand)
  return {
    ...box,
    y0: band.y0,
    y1: band.y1,
  }
}

function normalizedStaffLineYs(staffLineYs, imageHeight) {
  if (!Array.isArray(staffLineYs) || staffLineYs.length < 5 || !imageHeight) {
    return null
  }
  return staffLineYs
    .filter(Number.isFinite)
    .map((value) => (value <= 1 ? value * imageHeight : value))
    .sort((left, right) => left - right)
}

/**
 * Compact blob suitable for a repeat colon dot.
 * Rejects staff-line Y positions by probing horizontally into the measure
 * (staff lines continue; dots sit in spaces).
 */
function dotNear(imageData, x, y, threshold, musicDirection = 0) {
  let dark = 0
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (inkAt(imageData, x + dx, y + dy, threshold)) {
        dark += 1
      }
    }
  }
  if (dark < 8 || dark > 18) {
    return false
  }

  let horizontal = 0
  for (let dx = -7; dx <= 7; dx += 1) {
    if (inkAt(imageData, x + dx, y, threshold)) {
      horizontal += 1
    }
  }
  let vertical = 0
  for (let dy = -7; dy <= 7; dy += 1) {
    if (inkAt(imageData, x, y + dy, threshold)) {
      vertical += 1
    }
  }
  if (horizontal >= 10 || vertical >= 10) {
    return false
  }

  if (musicDirection !== 0) {
    let alongStaff = 0
    for (let step = 6; step <= 34; step += 2) {
      if (inkAt(imageData, x + musicDirection * step, y, threshold)) {
        alongStaff += 1
      }
    }
    if (alongStaff >= 7) {
      return false
    }
  }

  return true
}

/**
 * Find a repeat colon (:) inside a vertical band at column x.
 * Require a clean pair (exactly two isolated blobs) with staff-space separation.
 */
function colonInBand(imageData, x, bandTop, bandBottom, threshold, musicDirection = 0) {
  const top = Math.floor(bandTop)
  const bottom = Math.ceil(bandBottom)
  if (bottom - top < 8) {
    return false
  }

  const hitYs = []
  for (let y = top; y <= bottom; y += 1) {
    if (dotNear(imageData, x, y, threshold, musicDirection)) {
      hitYs.push(y)
    }
  }
  if (!hitYs.length) {
    return false
  }

  const centers = []
  let runStart = hitYs[0]
  let runEnd = hitYs[0]
  for (let i = 1; i <= hitYs.length; i += 1) {
    const y = hitYs[i]
    if (y === runEnd + 1) {
      runEnd = y
      continue
    }
    if (runEnd - runStart <= 5) {
      centers.push((runStart + runEnd) / 2)
    }
    runStart = y
    runEnd = y
  }

  if (centers.length !== 2) {
    return false
  }
  const sep = Math.abs(centers[1] - centers[0])
  return sep >= 5 && sep <= 16
}

/**
 * TAB and other dense single-staff bands fake many dot blobs on staff lines.
 * Restrict colon search to staff spaces when line geometry is known.
 */
function colonInStaffSpaces(imageData, x, staffLineYs, threshold, musicDirection = 0) {
  const lines = normalizedStaffLineYs(staffLineYs, imageData.height)
  if (!lines || lines.length < 6) {
    return false
  }
  const spaceCenters = []
  for (let index = 0; index < lines.length - 1; index += 1) {
    const centerY = (lines[index] + lines[index + 1]) / 2
    let bestY = null
    let bestDist = Infinity
    for (let y = Math.round(centerY) - 3; y <= Math.round(centerY) + 3; y += 1) {
      // TAB strings are horizontal — skip along-staff rejection used for notation.
      if (!dotNear(imageData, x, y, threshold, 0)) {
        continue
      }
      const dist = Math.abs(y - centerY)
      if (dist < bestDist) {
        bestDist = dist
        bestY = y
      }
    }
    if (bestY != null) {
      spaceCenters.push(bestY)
    }
  }
  if (spaceCenters.length < 2) {
    return false
  }
  let best = null
  for (let i = 0; i < spaceCenters.length; i += 1) {
    for (let j = i + 1; j < spaceCenters.length; j += 1) {
      const sep = Math.abs(spaceCenters[j] - spaceCenters[i])
      if (sep < 5 || sep > 16) {
        continue
      }
      if (!best || sep > best.sep) {
        best = { sep }
      }
    }
  }
  return Boolean(best)
}

/**
 * Repeat dots form a colon (:).
 * Multi-staff systems prefer the inter-staff gap (system-wide colon).
 * Per-staff colons are accepted after rejecting staff-line Y samples.
 */
function repeatColonNear(
  imageData,
  x,
  y0,
  y1,
  threshold,
  musicDirection = 0,
  staffLineYs = null,
) {
  if (verticalBarStrength(imageData, x, y0, y1, threshold) >= 0.4) {
    return false
  }
  const top = Math.floor(y0)
  const bottom = Math.ceil(y1)
  const height = Math.max(1, bottom - top)
  const multiStaff = height >= 100

  if (multiStaff) {
    const gapTop = top + height * 0.42
    const gapBottom = top + height * 0.58
    if (colonInBand(imageData, x, gapTop, gapBottom, threshold, musicDirection)) {
      return true
    }
    // Grand-staff repeats put a colon on both staves; require both so
    // accents/rests on one staff cannot fake a forward repeat.
    return (
      colonInBand(imageData, x, top, top + height * 0.4, threshold, musicDirection) &&
      colonInBand(imageData, x, top + height * 0.6, bottom, threshold, musicDirection)
    )
  }

  if (
    (normalizedStaffLineYs(staffLineYs, imageData.height)?.length ?? 0) >= 6 &&
    colonInStaffSpaces(imageData, x, staffLineYs, threshold, musicDirection)
  ) {
    return true
  }

  // Single-staff / synthetic: short along-staff probe rejects line crossings
  // without reaching deep into neighboring measure content.
  return colonInBand(imageData, x, top, bottom, threshold, musicDirection || 0)
}

/**
 * Find thin+thick (or thin+thin) vertical bar pairs near a measure edge.
 * Real engraved scores often space the pair ~5–8px at analysis width 1000;
 * synthetic fixtures use ~3px — accept a bounded clearance range.
 */
function findDoubleBarNearEdge(imageData, cx, y0, y1, threshold) {
  const strengths = []
  for (let offset = -22; offset <= 12; offset += 1) {
    strengths.push({
      offset,
      x: cx + offset,
      strength: verticalBarStrength(imageData, cx + offset, y0, y1, threshold),
    })
  }

  const runs = []
  let index = 0
  while (index < strengths.length) {
    if (strengths[index].strength < 0.42) {
      index += 1
      continue
    }
    let end = index
    while (end + 1 < strengths.length && strengths[end + 1].strength >= 0.42) {
      end += 1
    }
    const slice = strengths.slice(index, end + 1)
    const peak = slice.reduce((best, row) => (row.strength > best.strength ? row : best), slice[0])
    runs.push({
      startOffset: strengths[index].offset,
      endOffset: strengths[end].offset,
      width: end - index + 1,
      peakX: peak.x,
      peakStrength: peak.strength,
    })
    index = end + 1
  }

  let best = null
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const left = runs[i]
      const right = runs[j]
      const clearance = right.startOffset - left.endOffset
      if (clearance < 2 || clearance > 10) {
        continue
      }
      const score = left.peakStrength + right.peakStrength - clearance * 0.01
      if (!best || score > best.score) {
        best = { left, right, clearance, score }
      }
    }
  }
  return best
}

/**
 * Detect obvious repeat barlines at measure edges (local pixels only).
 * Requires a double bar pair AND a vertically stacked repeat colon.
 * Ordinary final/double barlines without dots do not match.
 */
export function detectRepeatBarline(
  imageData,
  measureBox,
  inkThreshold,
  edge = 'right',
  { structureBand = null, staffLineYs = null } = {},
) {
  const { width, height } = imageData
  const box = normalizeMeasureBox(measureBox)
  const band = structureDetectionBox(measureBox, structureBand)
  const xNorm = edge === 'right' ? box.x1 : box.x0
  const cx = Math.round(xNorm * width)
  const y0 = band.y0 * height
  const y1 = band.y1 * height

  const pair = findDoubleBarNearEdge(imageData, cx, y0, y1, inkThreshold)
  if (!pair) {
    return null
  }

  const leftBarX = Math.min(pair.left.peakX, pair.right.peakX)
  const rightBarX = Math.max(pair.left.peakX, pair.right.peakX)
  const tabStaff =
    (normalizedStaffLineYs(staffLineYs, imageData.height)?.length ?? 0) >= 6

  if (edge === 'right') {
    // Backward: dots left of the thin bar (closer to music).
    const candidates = tabStaff
      ? [
          leftBarX - 1,
          leftBarX - 2,
          leftBarX - 3,
          leftBarX - 4,
          leftBarX - 5,
          leftBarX - 6,
          leftBarX - 8,
          leftBarX - 10,
        ]
      : [
          leftBarX - 5,
          leftBarX - 6,
          leftBarX - 7,
          leftBarX - 8,
          leftBarX - 9,
          leftBarX - 10,
          leftBarX - 12,
          leftBarX - 14,
        ]
    if (
      !candidates.some((x) =>
        repeatColonNear(imageData, x, y0, y1, inkThreshold, -1, staffLineYs),
      )
    ) {
      return null
    }
    return { backwardRepeat: true, confidence: 0.84 }
  }

  // Forward: dots right of the double bar — never sample inside the bar runs.
  const candidates = tabStaff
    ? [
        rightBarX + 1,
        rightBarX + 2,
        rightBarX + 3,
        rightBarX + 4,
        rightBarX + 5,
        rightBarX + 7,
        rightBarX + 9,
        rightBarX + 11,
      ]
    : [rightBarX + 5, rightBarX + 7, rightBarX + 9, rightBarX + 11, rightBarX + 14, rightBarX + 18]
  const hasDots = candidates.some((x) =>
    repeatColonNear(imageData, x, y0, y1, inkThreshold, 1, staffLineYs),
  )
  if (!hasDots) {
    return null
  }
  return { forwardRepeat: true, confidence: 0.84 }
}

export function shouldEmitRepeat(marking) {
  return (marking?.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.REPEAT
}

function pdfTextToNorm(item, imageData) {
  const pageWidth = item.pageWidth || item.page?.width || 1
  const pageHeight = item.pageHeight || item.page?.height || 1
  // PDF text y is from bottom-left; ImageData y is from top-left.
  const x0 = (item.x ?? 0) / pageWidth
  const x1 = ((item.x ?? 0) + (item.width ?? 0)) / pageWidth
  const yTopPdf = (item.y ?? 0) + (item.height ?? 0)
  const yBottomPdf = item.y ?? 0
  const y0 = 1 - yTopPdf / pageHeight
  const y1 = 1 - yBottomPdf / pageHeight
  return { x0, x1, y0, y1, text: String(item.text ?? '').trim() }
}

/**
 * Ending labels like "1." / "2." appear in the PDF text layer above the staff.
 * Measure numbers are bare digits without a trailing period — ignore those.
 */
function detectVoltaFromText(pageText, measureBox, imageData) {
  if (!Array.isArray(pageText) || !pageText.length || !imageData?.width) {
    return null
  }
  const box = normalizeMeasureBox(measureBox)
  let best = null
  for (const item of pageText) {
    const norm = pdfTextToNorm(item, imageData)
    const match = /^([1-9])\.$/.exec(norm.text)
    if (!match) {
      continue
    }
    const midX = (norm.x0 + norm.x1) / 2
    // Ending labels sit at the start of the volta measure — bind to the
    // measure whose left edge is nearest without crossing into the prior span.
    if (midX < box.x0 - 0.005 || midX > box.x1) {
      continue
    }
    // Ending numerals sit just above the staff top.
    if (norm.y1 < box.y0 - 0.08 || norm.y0 > box.y0 + 0.04) {
      continue
    }
    const number = Number(match[1])
    const edgeDist = Math.abs(midX - box.x0)
    if (!best || edgeDist < best.edgeDist) {
      best = {
        endingStartNumbers: [number],
        confidence: 0.88,
        edgeDist,
      }
    }
  }
  if (!best) {
    return null
  }
  // Reject labels that clearly belong to a later measure in the same system
  // when this measure's left edge is far from the label (mid-measure bleed).
  if (best.edgeDist > (box.x1 - box.x0) * 0.45) {
    return null
  }
  return {
    endingStartNumbers: best.endingStartNumbers,
    confidence: best.confidence,
  }
}

function detectVoltaStopHook(imageData, measureBox, inkThreshold) {
  const { width, height } = imageData
  const box = normalizeMeasureBox(measureBox)
  const right = Math.round(box.x1 * width)
  const top = Math.floor(box.y0 * height) - 18
  let vertical = 0
  for (let y = top; y <= top + 14; y += 1) {
    if (inkAt(imageData, right - 2, y, inkThreshold) || inkAt(imageData, right - 5, y, inkThreshold)) {
      vertical += 1
    }
  }
  return vertical >= 4
}

/**
 * Detect a simple first/second ending bracket above the system.
 * Prefer PDF text labels ("1.", "2."). When the text layer is empty (scans),
 * fall back to joint raster evidence: bracket + start hook + local digit.
 * Bare ink-digit heuristics without a bracket remain disabled (FP-prone).
 */
export function detectVoltaEnding(
  imageData,
  measureBox,
  inkThreshold,
  pageText = null,
  { structureBand = null, voltaBand = null, staffLineYs = null } = {},
) {
  const bandBox = structureDetectionBox(measureBox, voltaBand ?? structureBand)
  const fromText = detectVoltaFromText(pageText, bandBox, imageData)
  if (fromText) {
    const endingStop = detectVoltaStopHook(imageData, measureBox, inkThreshold)
    return {
      ...fromText,
      endingStop: endingStop || undefined,
      confidence: Math.max(fromText.confidence, endingStop ? 0.9 : fromText.confidence),
    }
  }
  return detectVoltaFromRaster(imageData, measureBox, inkThreshold, { staffLineYs })
}

export function shouldEmitEnding(ending) {
  return (ending?.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ENDING
}

/**
 * Drop OMR repeat marks that cannot expand safely (multiple orphans, multiple
 * closers for one forward without endings). Keeps well-formed pairs and a
 * single repeat-to-beginning. Does not invent replacements.
 */
export function sanitizeOmrRepeatMarkings(measureRecords) {
  if (!Array.isArray(measureRecords) || measureRecords.length === 0) {
    return { measures: measureRecords, stripped: false, reason: null }
  }

  const markings = measureRecords.map((measure) => {
    const marking = measure?.repeatMarking
    if (!marking || !shouldEmitRepeat(marking)) {
      return {}
    }
    return {
      forwardRepeat: Boolean(marking.forwardRepeat),
      backwardRepeat: Boolean(marking.backwardRepeat),
      endingStartNumbers: measure?.endingMarking?.endingStartNumbers,
      endingStop: measure?.endingMarking?.endingStop,
      endingDiscontinue: measure?.endingMarking?.endingDiscontinue,
    }
  })

  const unsafe = detectUnsafeRepeatExpansion(markings)
  if (!unsafe.unsafe) {
    return { measures: measureRecords, stripped: false, reason: null }
  }

  const sanitized = measureRecords.map((measure) => {
    if (!measure?.repeatMarking) {
      return measure
    }
    return {
      ...measure,
      repeatMarking: null,
      repeatMarkingQuarantined: {
        reason: unsafe.reason,
        prior: measure.repeatMarking,
      },
    }
  })

  return {
    measures: sanitized,
    stripped: true,
    reason: unsafe.reason,
    atMeasureIndex: unsafe.atMeasureIndex ?? null,
  }
}

function isProtectedVectorRepeat(marking) {
  return (
    marking?.source === 'vector-path' &&
    (marking.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.REPEAT
  )
}

/**
 * Combine left/right repeat detections and optional volta into measure fields.
 * Vector path/glyph evidence is preferred when available; raster remains the
 * fallback (and the only path for scan fixtures).
 */
export function detectMeasureStructureMarkings(
  imageData,
  measureBox,
  inkThreshold,
  {
    isFirstInSystem = false,
    pageText = null,
    structureBand = null,
    voltaBand = null,
    staffLineYs = null,
    vectorBarlineComponents = null,
    enableVectorRepeatBarlines = true,
  } = {},
) {
  const structureOptions = { structureBand, voltaBand, staffLineYs }
  const endingMarking = detectVoltaEnding(
    imageData,
    measureBox,
    inkThreshold,
    pageText,
    structureOptions,
  )
  const voltaContext = Boolean(endingMarking?.endingStartNumbers?.length)

  let repeatMarking = null
  const enableVector = enableVectorRepeatBarlines !== false
  const baseComponents = enableVector ? vectorBarlineComponents : null
  const staffGap = staffGapFromLines(
    (staffLineYs ?? []).map((value) =>
      value <= 1 && imageData?.height ? value * imageData.height : value,
    ),
    Math.max(8, (imageData?.width ?? 1000) * 0.014),
  )
  const glyphDots = enableVector
    ? extractRepeatDotGlyphsFromPageText(pageText, imageData?.width, imageData?.height, {
        staffGap,
      })
    : []
  const components =
    enableVector && (baseComponents || glyphDots.length)
      ? {
          verticalBars: baseComponents?.verticalBars ?? [],
          compactDots: [...(baseComponents?.compactDots ?? []), ...glyphDots],
        }
      : null
  if (
    components &&
    (components.verticalBars?.length || components.compactDots?.length) &&
    imageData?.width
  ) {
    const vectorRight = detectVectorRepeatAtEdge({
      verticalBars: components.verticalBars,
      compactDots: components.compactDots,
      measureBox,
      imageWidth: imageData.width,
      imageHeight: imageData.height,
      edge: 'right',
      staffLineYs,
      structureBand,
      voltaContext,
      multiStaffBars: components.verticalBars,
    })
    const vectorLeft = detectVectorRepeatAtEdge({
      verticalBars: components.verticalBars,
      compactDots: components.compactDots,
      measureBox,
      imageWidth: imageData.width,
      imageHeight: imageData.height,
      edge: 'left',
      staffLineYs,
      structureBand,
      voltaContext,
      multiStaffBars: components.verticalBars,
    })
    // Left-edge hits are only forward (or forward half of back-to-back).
    const leftHit = vectorLeft?.forwardRepeat ? vectorLeft : null
    repeatMarking = fuseVectorRepeatMarkings([leftHit, vectorRight].filter(Boolean))
  }

  if (!repeatMarking) {
    const repeatRight = detectRepeatBarline(
      imageData,
      measureBox,
      inkThreshold,
      'right',
      structureOptions,
    )
    const repeatLeft = isFirstInSystem
      ? detectRepeatBarline(imageData, measureBox, inkThreshold, 'left', structureOptions)
      : null
    repeatMarking =
      repeatRight || repeatLeft
        ? {
            ...(repeatLeft ?? {}),
            ...(repeatRight ?? {}),
            confidence: Math.max(repeatLeft?.confidence ?? 0, repeatRight?.confidence ?? 0),
          }
        : null
  }

  return { repeatMarking, endingMarking }
}

/**
 * When consecutive measures open different endings, close the previous ending.
 */
export function finalizeEndingStops(measureRecords) {
  for (let index = 0; index < measureRecords.length; index += 1) {
    const current = measureRecords[index]
    const ending = current?.endingMarking
    if (!ending?.endingStartNumbers?.length || ending.endingStop) {
      continue
    }
    const next = measureRecords[index + 1]
    const nextNumbers = next?.endingMarking?.endingStartNumbers
    const nextDifferent =
      !nextNumbers?.length ||
      nextNumbers.join(',') !== ending.endingStartNumbers.join(',')
    if (nextDifferent) {
      current.endingMarking = {
        ...ending,
        endingStop: true,
        confidence: Math.max(ending.confidence ?? 0, 0.86),
      }
    }
  }
  return measureRecords
}

/**
 * Suppress repeat marks that match system-break barlines instead of repeat sections.
 * TAB layouts often engrave double bars at system breaks that resemble repeats.
 * High-confidence vector-native repeats keep system-boundary marks (Korobeiniki /
 * Mario section repeats are source-faithful at system ends/starts).
 *
 * Also completes back-to-back :||: boundaries: when measure N owns a vector
 * thin-thick-thin backward with right-side dots, measure N+1 receives the
 * matching forward on its left barline.
 */
export function finalizeRepeatMarkings(measureRecords) {
  if (!Array.isArray(measureRecords) || !measureRecords.length) {
    return measureRecords
  }

  for (let index = 0; index < measureRecords.length; index += 1) {
    const measure = measureRecords[index]
    const repeat = measure?.repeatMarking
    if (!repeat) {
      continue
    }
    if (isProtectedVectorRepeat(repeat)) {
      continue
    }

    const prev = measureRecords[index - 1]
    const isFirstInSystem = !prev || prev.systemIndex !== measure.systemIndex
    const next = measureRecords[index + 1]
    const systemBreak = Boolean(next && next.systemIndex !== measure.systemIndex)
    const hasEnding = Boolean(measure.endingMarking?.endingStartNumbers?.length)

    if (repeat.forwardRepeat && measure.systemIndex > 0 && isFirstInSystem) {
      if (repeat.backwardRepeat) {
        measure.repeatMarking = {
          backwardRepeat: true,
          confidence: repeat.confidence,
          ...(repeat.source ? { source: repeat.source } : {}),
        }
      } else {
        measure.repeatMarking = null
      }
      continue
    }

    if (repeat.backwardRepeat && systemBreak && !hasEnding) {
      if (repeat.forwardRepeat) {
        measure.repeatMarking = {
          forwardRepeat: true,
          confidence: repeat.confidence,
          ...(repeat.source ? { source: repeat.source } : {}),
        }
      } else {
        measure.repeatMarking = null
      }
    }
  }

  // Propagate forward half of vector back-to-back repeats onto the next measure.
  for (let index = 0; index < measureRecords.length - 1; index += 1) {
    const measure = measureRecords[index]
    const next = measureRecords[index + 1]
    const repeat = measure?.repeatMarking
    if (!isProtectedVectorRepeat(repeat) || !repeat?.backwardRepeat || !repeat?.backToBack) {
      continue
    }
    if (next.repeatMarking?.forwardRepeat) {
      continue
    }
    const forwardMark = {
      forwardRepeat: true,
      confidence: repeat.confidence,
      source: 'vector-path',
      structure: repeat.structure,
      backToBack: true,
      evidenceFamilies: [
        ...new Set([...(repeat.evidenceFamilies || []), 'back-to-back-propagate']),
      ],
    }
    next.repeatMarking = fuseVectorRepeatMarkings([next.repeatMarking, forwardMark].filter(Boolean))
  }

  return measureRecords
}
