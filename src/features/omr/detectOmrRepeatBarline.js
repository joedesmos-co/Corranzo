import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'

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
 * Repeat dots form a colon (:).
 * Multi-staff systems prefer the inter-staff gap (system-wide colon).
 * Per-staff colons are accepted after rejecting staff-line Y samples.
 */
function repeatColonNear(imageData, x, y0, y1, threshold, musicDirection = 0) {
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
export function detectRepeatBarline(imageData, measureBox, inkThreshold, edge = 'right') {
  const { width, height } = imageData
  const box = normalizeMeasureBox(measureBox)
  const xNorm = edge === 'right' ? box.x1 : box.x0
  const cx = Math.round(xNorm * width)
  const y0 = box.y0 * height
  const y1 = box.y1 * height

  const pair = findDoubleBarNearEdge(imageData, cx, y0, y1, inkThreshold)
  if (!pair) {
    return null
  }

  const leftBarX = Math.min(pair.left.peakX, pair.right.peakX)
  const rightBarX = Math.max(pair.left.peakX, pair.right.peakX)

  if (edge === 'right') {
    // Backward: dots left of the thin bar (closer to music).
    const candidates = [
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
      !candidates.some((x) => repeatColonNear(imageData, x, y0, y1, inkThreshold, -1))
    ) {
      return null
    }
    return { backwardRepeat: true, confidence: 0.84 }
  }

  // Forward: dots right of the double bar — never sample inside the bar runs.
  const candidates = [
    rightBarX + 5,
    rightBarX + 7,
    rightBarX + 9,
    rightBarX + 11,
    rightBarX + 14,
    rightBarX + 18,
  ]
  const hasDots = candidates.some((x) =>
    repeatColonNear(imageData, x, y0, y1, inkThreshold, 1),
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
 * Prefer PDF text labels ("1.", "2."). Ink-only digit heuristics are too
 * weak on clean scores and create false endings — leave them off for now.
 */
export function detectVoltaEnding(imageData, measureBox, inkThreshold, pageText = null) {
  const fromText = detectVoltaFromText(pageText, measureBox, imageData)
  if (!fromText) {
    return null
  }
  const endingStop = detectVoltaStopHook(imageData, measureBox, inkThreshold)
  return {
    ...fromText,
    endingStop: endingStop || undefined,
    confidence: Math.max(fromText.confidence, endingStop ? 0.9 : fromText.confidence),
  }
}

export function shouldEmitEnding(ending) {
  return (ending?.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ENDING
}

/**
 * Combine left/right repeat detections and optional volta into measure fields.
 */
export function detectMeasureStructureMarkings(
  imageData,
  measureBox,
  inkThreshold,
  { isFirstInSystem = false, pageText = null } = {},
) {
  const repeatRight = detectRepeatBarline(imageData, measureBox, inkThreshold, 'right')
  const repeatLeft = isFirstInSystem
    ? detectRepeatBarline(imageData, measureBox, inkThreshold, 'left')
    : null
  const repeatMarking =
    repeatRight || repeatLeft
      ? {
          ...(repeatLeft ?? {}),
          ...(repeatRight ?? {}),
          confidence: Math.max(repeatLeft?.confidence ?? 0, repeatRight?.confidence ?? 0),
        }
      : null
  const endingMarking = detectVoltaEnding(imageData, measureBox, inkThreshold, pageText)
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
