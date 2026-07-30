/**
 * Conservative vector path / ink accidental detection.
 *
 * Recovers sharp, flat, and natural marks that are drawn as PDF paths or ink
 * geometry rather than SMuFL text-layer glyphs. Candidates are synthesized as
 * glyph-shaped objects for assignLocalAccidentals — never applied as raw alters.
 */

import { isInk } from './omrInk.js'
import {
  accidentalMatchScore,
  accidentalMatchWindow,
} from './omrPitchAlteration.js'

export const PATH_ACCIDENTAL_GLYPHS = {
  sharp: '\uE262',
  natural: '\uE261',
  flat: '\uE260',
}
export const PATH_AUGMENTATION_DOT_GLYPH = '\uE1E7'

const PDF_PATH_MOVE_TO = 0
const PDF_PATH_LINE_TO = 1
const PDF_PATH_CURVE_TO = 2
const PDF_PATH_CLOSE = 3

function multiplyTransforms(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function transformPoint(point, transform) {
  return [
    point[0] * transform[0] + point[1] * transform[2] + transform[4],
    point[0] * transform[1] + point[1] * transform[3] + transform[5],
  ]
}

function pathChunks(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) =>
    ArrayBuffer.isView(entry) ? Array.from(entry) : Array.isArray(entry) ? entry : [],
  )
}

function parseTransformedPath(rawPath, transform) {
  const raw = pathChunks(rawPath)
  let cursor = 0
  let moveCount = 0
  let lineCount = 0
  let curveCount = 0
  let closeCount = 0
  const points = []
  const segments = []
  let previous = null

  while (cursor < raw.length) {
    const command = raw[cursor]
    cursor += 1
    if (command === PDF_PATH_MOVE_TO) {
      moveCount += 1
      const x = raw[cursor]
      const y = raw[cursor + 1]
      cursor += 2
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }
      previous = transformPoint([x, y], transform)
      points.push(previous)
      continue
    }
    if (command === PDF_PATH_LINE_TO) {
      lineCount += 1
      const x = raw[cursor]
      const y = raw[cursor + 1]
      cursor += 2
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }
      const next = transformPoint([x, y], transform)
      if (previous) {
        segments.push({ x0: previous[0], y0: previous[1], x1: next[0], y1: next[1] })
      }
      previous = next
      points.push(next)
      continue
    }
    if (command === PDF_PATH_CURVE_TO) {
      curveCount += 1
      const coords = raw.slice(cursor, cursor + 6)
      cursor += 6
      if (coords.some((value) => !Number.isFinite(value))) {
        return null
      }
      const end = transformPoint([coords[4], coords[5]], transform)
      if (previous) {
        segments.push({ x0: previous[0], y0: previous[1], x1: end[0], y1: end[1] })
      }
      previous = end
      points.push(end)
      continue
    }
    if (command === PDF_PATH_CLOSE) {
      closeCount += 1
      continue
    }
    return null
  }

  if (!points.length) {
    return null
  }

  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  return {
    points,
    segments,
    moveCount,
    lineCount,
    curveCount,
    closeCount,
    bounds: { x0, x1, y0, y1, width: x1 - x0, height: y1 - y0 },
  }
}

function staffGapPixels(lineYs, imageData) {
  if (!lineYs?.length || !imageData?.height) {
    return 12
  }
  const sorted = [...lineYs].sort((a, b) => a - b)
  return Math.max(6, ((sorted[sorted.length - 1] - sorted[0]) / 4) * imageData.height)
}

/**
 * Identify a compact filled Bézier circle. Engravers commonly emit
 * augmentation dots as PDF paths instead of text-layer SMuFL glyphs.
 * Size, fill, curvature, closure, and near-square aspect are all required so
 * noteheads, open circles, staff scraps, and line caps do not qualify.
 */
export function classifyAugmentationDotPathGeometry(
  path,
  { staffGap = 12, filled = false } = {},
) {
  if (!filled || !path?.bounds) {
    return null
  }
  const { width, height } = path.bounds
  const aspect = width / Math.max(height, 1e-6)
  if (
    width < staffGap * 0.18 ||
    height < staffGap * 0.18 ||
    width > staffGap * 0.52 ||
    height > staffGap * 0.52 ||
    aspect < 0.72 ||
    aspect > 1.38 ||
    (path.curveCount ?? 0) < 3 ||
    ((path.closeCount ?? 0) < 1 && (path.curveCount ?? 0) < 4)
  ) {
    return null
  }
  return {
    text: PATH_AUGMENTATION_DOT_GLYPH,
    confidence: 0.94,
    reason: 'filled-circular-path',
  }
}

/**
 * Classify accidental type from path stroke geometry (not bbox alone).
 */
export function classifyAccidentalPathGeometry(path, { staffGap = 12 } = {}) {
  if (!path?.bounds) {
    return null
  }
  const { width, height } = path.bounds
  if (
    width < staffGap * 0.25 ||
    height < staffGap * 0.55 ||
    width > staffGap * 2.4 ||
    height > staffGap * 3.2
  ) {
    return null
  }

  const aspect = width / Math.max(height, 1e-6)
  const segments = path.segments ?? []
  let vertical = 0
  let horizontal = 0
  let slanted = 0
  for (const segment of segments) {
    const dx = Math.abs(segment.x1 - segment.x0)
    const dy = Math.abs(segment.y1 - segment.y0)
    const length = Math.hypot(dx, dy)
    if (length < 1) {
      continue
    }
    if (dy > dx * 2.2) {
      vertical += 1
    } else if (dx > dy * 2.2) {
      horizontal += 1
    } else if (dx > staffGap * 0.2 && dy > staffGap * 0.08) {
      slanted += 1
    }
  }

  const closed = (path.closeCount ?? 0) > 0 || (path.moveCount ?? 0) >= 2
  const curveHeavy = (path.curveCount ?? 0) >= Math.max(2, (path.lineCount ?? 0))

  // Sharp: cross of verticals + (near-)horizontals, roughly square.
  if (
    aspect >= 0.35 &&
    aspect <= 1.15 &&
    vertical >= 2 &&
    (horizontal + slanted) >= 2 &&
    height >= staffGap * 0.7
  ) {
    return {
      type: 'sharp',
      alter: 1,
      text: PATH_ACCIDENTAL_GLYPHS.sharp,
      confidence: Math.min(0.92, 0.62 + vertical * 0.05 + (horizontal + slanted) * 0.04),
      reason: 'path-cross',
    }
  }

  // Natural before flat: two verticals with sparse connectors, not curve-lobed.
  if (
    aspect >= 0.32 &&
    aspect <= 0.95 &&
    vertical >= 2 &&
    (horizontal + slanted) >= 1 &&
    height >= staffGap * 0.75 &&
    !curveHeavy
  ) {
    return {
      type: 'natural',
      alter: 0,
      text: PATH_ACCIDENTAL_GLYPHS.natural,
      confidence: Math.min(0.88, 0.55 + vertical * 0.05),
      reason: 'path-natural-posts',
    }
  }

  // Flat: narrow, taller, dominant vertical + lower/right lobe (curves or closed).
  if (
    aspect >= 0.28 &&
    aspect <= 0.78 &&
    vertical >= 1 &&
    vertical <= 2 &&
    (curveHeavy || closed || slanted >= 1) &&
    height >= staffGap * 0.85
  ) {
    return {
      type: 'flat',
      alter: -1,
      text: PATH_ACCIDENTAL_GLYPHS.flat,
      confidence: Math.min(0.9, 0.58 + vertical * 0.06 + (curveHeavy ? 0.08 : 0.04)),
      reason: 'path-flat-lobe',
    }
  }

  return null
}

/**
 * Extract accidental-sized path candidates from a pdf.js operator list.
 * Also clusters nearby thin vertical/horizontal fragments into sharp composites
 * when engravers emit separate stroke paths.
 */
export function extractPdfVectorPathSymbolsFromOperatorList({
  operatorList,
  ops,
  viewportTransform,
  pageNumber = 1,
  targetWidth = 1000,
} = {}) {
  if (
    !operatorList?.fnArray?.length ||
    !operatorList?.argsArray?.length ||
    !ops ||
    !Array.isArray(viewportTransform)
  ) {
    return { accidentalPaths: [], augmentationDotPaths: [] }
  }

  const fillOperations = new Set(
    [
      ops.fill,
      ops.eoFill,
      ops.fillStroke,
      ops.eoFillStroke,
      ops.closeFillStroke,
      ops.closeEOFillStroke,
    ].filter(Number.isFinite),
  )
  const paintOperations = new Set(
    [
      ops.fill,
      ops.eoFill,
      ops.fillStroke,
      ops.eoFillStroke,
      ops.closeFillStroke,
      ops.closeEOFillStroke,
      ops.stroke,
      ops.closeStroke,
    ].filter(Number.isFinite),
  )

  let currentTransform = [1, 0, 0, 1, 0, 0]
  const transformStack = []
  const candidates = []
  const augmentationDotPaths = []
  const fragments = []
  const staffGapGuess = Math.max(8, targetWidth * 0.014)

  for (let operatorIndex = 0; operatorIndex < operatorList.fnArray.length; operatorIndex += 1) {
    const operation = operatorList.fnArray[operatorIndex]
    const args = operatorList.argsArray[operatorIndex]
    if (operation === ops.save) {
      transformStack.push([...currentTransform])
      continue
    }
    if (operation === ops.restore) {
      if (transformStack.length) {
        currentTransform = transformStack.pop()
      }
      continue
    }
    if (operation === ops.transform) {
      currentTransform = multiplyTransforms(currentTransform, args)
      continue
    }
    if (operation !== ops.constructPath) {
      continue
    }

    const paintOperation = args?.[0]
    if (paintOperations.size && !paintOperations.has(paintOperation)) {
      continue
    }

    const pageTransform = multiplyTransforms(viewportTransform, currentTransform)
    const parsed = parseTransformedPath(args?.[1], pageTransform)
    if (!parsed) {
      continue
    }

    const { bounds } = parsed
    const dotClassification = classifyAugmentationDotPathGeometry(parsed, {
      staffGap: staffGapGuess,
      filled: fillOperations.has(paintOperation),
    })
    if (dotClassification) {
      augmentationDotPaths.push({
        candidateId: `pdf-dot-p${pageNumber}-op${operatorIndex}`,
        source: 'vector-path',
        page: pageNumber,
        operatorIndex,
        paintOperation,
        text: dotClassification.text,
        confidence: dotClassification.confidence,
        reason: dotClassification.reason,
        x: (bounds.x0 + bounds.x1) / 2,
        y: (bounds.y0 + bounds.y1) / 2,
        bounds,
        moveCount: parsed.moveCount,
        lineCount: parsed.lineCount,
        curveCount: parsed.curveCount,
        closeCount: parsed.closeCount,
      })
    }
    if (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.width < staffGapGuess * 3.5 &&
      bounds.height < staffGapGuess * 4
    ) {
      fragments.push({
        operatorIndex,
        paintOperation,
        ...parsed,
      })
    }

    const classification = classifyAccidentalPathGeometry(parsed, {
      staffGap: staffGapGuess,
    })
    if (!classification || classification.confidence < 0.62) {
      continue
    }

    candidates.push({
      candidateId: `pdf-acc-p${pageNumber}-op${operatorIndex}`,
      source: 'vector-path',
      page: pageNumber,
      operatorIndex,
      paintOperation,
      type: classification.type,
      alter: classification.alter,
      text: classification.text,
      confidence: classification.confidence,
      reason: classification.reason,
      x: (bounds.x0 + bounds.x1) / 2,
      y: (bounds.y0 + bounds.y1) / 2,
      bounds,
      moveCount: parsed.moveCount,
      lineCount: parsed.lineCount,
      curveCount: parsed.curveCount,
      closeCount: parsed.closeCount,
    })
  }

  // Cluster fragmented sharp strokes (separate vertical + horizontal fills).
  const used = new Set()
  for (let i = 0; i < fragments.length; i += 1) {
    if (used.has(i)) {
      continue
    }
    const seed = fragments[i]
    const group = [i]
    for (let j = i + 1; j < fragments.length; j += 1) {
      if (used.has(j)) {
        continue
      }
      const other = fragments[j]
      const cx = Math.abs(
        (seed.bounds.x0 + seed.bounds.x1) / 2 - (other.bounds.x0 + other.bounds.x1) / 2,
      )
      const cy = Math.abs(
        (seed.bounds.y0 + seed.bounds.y1) / 2 - (other.bounds.y0 + other.bounds.y1) / 2,
      )
      if (cx <= staffGapGuess * 1.4 && cy <= staffGapGuess * 1.4) {
        group.push(j)
      }
    }
    if (group.length < 3) {
      continue
    }
    const members = group.map((index) => fragments[index])
    const x0 = Math.min(...members.map((member) => member.bounds.x0))
    const x1 = Math.max(...members.map((member) => member.bounds.x1))
    const y0 = Math.min(...members.map((member) => member.bounds.y0))
    const y1 = Math.max(...members.map((member) => member.bounds.y1))
    const composite = {
      bounds: { x0, x1, y0, y1, width: x1 - x0, height: y1 - y0 },
      segments: members.flatMap((member) => member.segments ?? []),
      moveCount: members.reduce((sum, member) => sum + (member.moveCount ?? 0), 0),
      lineCount: members.reduce((sum, member) => sum + (member.lineCount ?? 0), 0),
      curveCount: members.reduce((sum, member) => sum + (member.curveCount ?? 0), 0),
      closeCount: members.reduce((sum, member) => sum + (member.closeCount ?? 0), 0),
    }
    const classification = classifyAccidentalPathGeometry(composite, {
      staffGap: staffGapGuess,
    })
    if (!classification || classification.type !== 'sharp') {
      continue
    }
    for (const index of group) {
      used.add(index)
    }
    candidates.push({
      candidateId: `pdf-acc-p${pageNumber}-cluster-${i}`,
      source: 'vector-path',
      page: pageNumber,
      operatorIndex: seed.operatorIndex,
      type: classification.type,
      alter: classification.alter,
      text: classification.text,
      confidence: classification.confidence,
      reason: 'path-cluster-sharp',
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      bounds: composite.bounds,
      moveCount: composite.moveCount,
      lineCount: composite.lineCount,
      curveCount: composite.curveCount,
      closeCount: composite.closeCount,
    })
  }

  // Repeat barlines use a vertical pair of equal filled circles. Preserve the
  // candidates for diagnostics, but tag the pair so note-level augmentation
  // ownership can reject it without rejecting a legitimate single dot merely
  // because that note is engraved near a measure boundary.
  for (let i = 0; i < augmentationDotPaths.length; i += 1) {
    for (let j = i + 1; j < augmentationDotPaths.length; j += 1) {
      const left = augmentationDotPaths[i]
      const right = augmentationDotPaths[j]
      const dx = Math.abs(left.x - right.x)
      const dy = Math.abs(left.y - right.y)
      if (
        dx <= staffGapGuess * 0.3 &&
        dy >= staffGapGuess * 0.55 &&
        dy <= staffGapGuess * 1.25
      ) {
        left.repeatPairCandidate = true
        right.repeatPairCandidate = true
      }
    }
  }

  return {
    accidentalPaths: candidates,
    augmentationDotPaths,
  }
}

export function extractPdfVectorAccidentalPathsFromOperatorList(options = {}) {
  return extractPdfVectorPathSymbolsFromOperatorList(options).accidentalPaths
}

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

/**
 * Classify a filled ink blob left of a notehead using stroke probes.
 * Rejects stems, staff-line scraps, barlines, and articulation dots.
 */
export function classifyAccidentalInkBlob(imageData, blob, threshold, { staffGap = 12 } = {}) {
  const { x0, x1, y0, y1, width, height } = blob
  if (
    width < staffGap * 0.28 ||
    height < staffGap * 0.55 ||
    width > staffGap * 2.4 ||
    height > staffGap * 3.2
  ) {
    return null
  }

  const aspect = width / Math.max(height, 1e-6)
  if (aspect < 0.18 && height > staffGap * 1.8) {
    return null
  }
  if (aspect > 2.4 && height < staffGap * 0.45) {
    return null
  }
  if (width < staffGap * 0.35 && height < staffGap * 0.45 && Math.abs(aspect - 1) < 0.35) {
    return null
  }

  let totalInk = 0
  const colInk = new Array(width).fill(0)
  const rowInk = new Array(height).fill(0)
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!inkAt(imageData, x, y, threshold)) {
        continue
      }
      totalInk += 1
      colInk[x - x0] += 1
      rowInk[y - y0] += 1
    }
  }
  if (totalInk < 14) {
    return null
  }

  const strongCols = []
  for (let i = 0; i < colInk.length; i += 1) {
    if (colInk[i] >= height * 0.35) {
      strongCols.push(i)
    }
  }
  const strongRows = []
  for (let i = 0; i < rowInk.length; i += 1) {
    if (rowInk[i] >= width * 0.35) {
      strongRows.push(i)
    }
  }

  // Collapse adjacent strong columns/rows into stroke centers.
  const cluster = (indices) => {
    if (!indices.length) {
      return []
    }
    const groups = [[indices[0]]]
    for (let i = 1; i < indices.length; i += 1) {
      if (indices[i] - groups[groups.length - 1].at(-1) <= 2) {
        groups[groups.length - 1].push(indices[i])
      } else {
        groups.push([indices[i]])
      }
    }
    return groups.map((group) => group.reduce((a, b) => a + b, 0) / group.length)
  }
  const verticalStrokes = cluster(strongCols)
  const horizontalStrokes = cluster(strongRows)

  let lowerRightLobe = 0
  const midX = x0 + width * 0.45
  const midY = y0 + height * 0.45
  for (let y = midY; y <= y1; y += 1) {
    for (let x = midX; x <= x1; x += 1) {
      if (inkAt(imageData, x, y, threshold)) {
        lowerRightLobe += 1
      }
    }
  }

  if (
    aspect >= 0.35 &&
    aspect <= 1.2 &&
    verticalStrokes.length >= 2 &&
    horizontalStrokes.length >= 2
  ) {
    return {
      type: 'sharp',
      alter: 1,
      text: PATH_ACCIDENTAL_GLYPHS.sharp,
      confidence: Math.min(
        0.92,
        0.58 + verticalStrokes.length * 0.08 + horizontalStrokes.length * 0.06,
      ),
      reason: 'ink-sharp-cross',
    }
  }

  if (
    aspect >= 0.32 &&
    aspect <= 0.95 &&
    verticalStrokes.length >= 2 &&
    horizontalStrokes.length >= 1 &&
    horizontalStrokes.length <= 2 &&
    lowerRightLobe < totalInk * 0.42
  ) {
    return {
      type: 'natural',
      alter: 0,
      text: PATH_ACCIDENTAL_GLYPHS.natural,
      confidence: Math.min(0.88, 0.54 + verticalStrokes.length * 0.08),
      reason: 'ink-natural-posts',
    }
  }

  if (
    aspect >= 0.28 &&
    aspect <= 0.78 &&
    verticalStrokes.length >= 1 &&
    verticalStrokes.length <= 2 &&
    lowerRightLobe >= totalInk * 0.28 &&
    horizontalStrokes.length <= 2
  ) {
    return {
      type: 'flat',
      alter: -1,
      text: PATH_ACCIDENTAL_GLYPHS.flat,
      confidence: Math.min(0.9, 0.55 + lowerRightLobe / Math.max(totalInk, 1) * 0.28),
      reason: 'ink-flat-lobe',
    }
  }

  return null
}

function floodInkBlob(imageData, startX, startY, threshold, visited) {
  const { width, height } = imageData
  const stack = [[startX, startY]]
  visited[startY * width + startX] = 1
  let minX = startX
  let maxX = startX
  let minY = startY
  let maxY = startY
  let count = 0

  while (stack.length) {
    const [x, y] = stack.pop()
    count += 1
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue
      }
      const index = ny * width + nx
      if (visited[index]) {
        continue
      }
      if (!inkAt(imageData, nx, ny, threshold)) {
        continue
      }
      visited[index] = 1
      stack.push([nx, ny])
    }
  }

  return {
    x0: minX,
    x1: maxX,
    y0: minY,
    y1: maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    count,
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  }
}

function collectInkBlobsInBand(imageData, band, threshold, staffGap) {
  const { width, height } = imageData
  const visited = new Uint8Array(width * height)
  const blobs = []
  const x0 = Math.max(0, Math.floor(band.x0))
  const x1 = Math.min(width - 1, Math.ceil(band.x1))
  const y0 = Math.max(0, Math.floor(band.y0))
  const y1 = Math.min(height - 1, Math.ceil(band.y1))

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = y * width + x
      if (visited[index] || !inkAt(imageData, x, y, threshold)) {
        continue
      }
      const blob = floodInkBlob(imageData, x, y, threshold, visited)
      if (blob.count < 10 || blob.count > staffGap * staffGap * 8) {
        continue
      }
      blobs.push(blob)
    }
  }
  return blobs
}

function noteHasTextAccidentalCandidate(note, textGlyphs, measureBox, imageData, accidentalGlyphs) {
  if (!textGlyphs?.length || !accidentalGlyphs?.has) {
    return false
  }
  const lineYs =
    note.clef === 'treble' ? measureBox.staffLines?.treble : measureBox.staffLines?.bass
  const window = accidentalMatchWindow(measureBox, lineYs, imageData)
  for (const glyph of textGlyphs) {
    if (!accidentalGlyphs.has(glyph.text)) {
      continue
    }
    if (glyph.source === 'vector-path' || glyph.source === 'vector-ink') {
      continue
    }
    if (glyph.x < window.minX) {
      continue
    }
    if (accidentalMatchScore(note, glyph, window, lineYs, imageData) != null) {
      return true
    }
  }
  return false
}

/**
 * Build synthetic accidental glyphs from path candidates + left-of-note ink.
 * Skips notes that already have a text-layer accidental candidate.
 */
export function detectVectorPathAccidentals({
  imageData,
  notes,
  measureBox,
  inkThreshold = 170,
  pathCandidates = [],
  textAccidentalGlyphs = [],
  accidentalGlyphs = null,
} = {}) {
  if (!imageData?.data?.length || !notes?.length || !measureBox) {
    return { glyphs: [], diagnostics: { pathCandidates: 0, inkCandidates: 0, accepted: 0 } }
  }

  const glyphs = []
  const diagnostics = {
    pathCandidates: 0,
    inkCandidates: 0,
    accepted: 0,
    rejected: [],
  }

  const playableStart = (measureBox.playableX0 ?? measureBox.x0) * imageData.width
  const measureLeft = measureBox.x0 * imageData.width
  const measureRight = measureBox.x1 * imageData.width
  const measureTop = Math.min(
    ...(measureBox.staffLines?.treble ?? [measureBox.y0]).map((y) => y * imageData.height),
    ...(measureBox.staffLines?.bass ?? [measureBox.y1]).map((y) => y * imageData.height),
  )
  const measureBottom = Math.max(
    ...(measureBox.staffLines?.treble ?? [measureBox.y0]).map((y) => y * imageData.height),
    ...(measureBox.staffLines?.bass ?? [measureBox.y1]).map((y) => y * imageData.height),
  )

  const glyphMap =
    accidentalGlyphs ??
    new Map([
      [PATH_ACCIDENTAL_GLYPHS.sharp, { alter: 1, type: 'sharp' }],
      [PATH_ACCIDENTAL_GLYPHS.natural, { alter: 0, type: 'natural' }],
      [PATH_ACCIDENTAL_GLYPHS.flat, { alter: -1, type: 'flat' }],
    ])

  for (const candidate of pathCandidates) {
    if (candidate.x < playableStart - 2) {
      diagnostics.rejected.push({ id: candidate.candidateId, reason: 'key-signature-region' })
      continue
    }
    if (candidate.x < measureLeft - 4 || candidate.x > measureRight + 4) {
      continue
    }
    if (candidate.y < measureTop - 30 || candidate.y > measureBottom + 30) {
      continue
    }
    diagnostics.pathCandidates += 1
    glyphs.push({
      text: candidate.text,
      x: candidate.x,
      y: candidate.y,
      source: 'vector-path',
      confidence: candidate.confidence,
      pathCandidateId: candidate.candidateId,
      accidentalType: candidate.type,
      alter: candidate.alter,
      bounds: candidate.bounds,
    })
  }

  for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
    const note = notes[noteIndex]
    if (
      noteHasTextAccidentalCandidate(
        note,
        textAccidentalGlyphs,
        measureBox,
        imageData,
        glyphMap,
      )
    ) {
      continue
    }

    const lineYs =
      note.clef === 'treble' ? measureBox.staffLines?.treble : measureBox.staffLines?.bass
    const staffGap = staffGapPixels(lineYs, imageData)
    const window = accidentalMatchWindow(measureBox, lineYs, imageData)
    if (note.cx < window.minX) {
      continue
    }

    // Prefer an already-extracted path candidate near this note.
    const nearbyPath = glyphs.find((glyph) => {
      if (glyph.source !== 'vector-path') {
        return false
      }
      return accidentalMatchScore(note, glyph, window, lineYs, imageData) != null
    })
    if (nearbyPath) {
      continue
    }

    const band = {
      x0: note.cx - Math.min(window.maxDx, staffGap * 3.0),
      x1: note.cx - staffGap * 0.35,
      y0: note.cy - staffGap * 1.35,
      y1: note.cy + staffGap * 1.35,
    }
    if (band.x1 <= band.x0) {
      continue
    }

    const blobs = collectInkBlobsInBand(imageData, band, inkThreshold, staffGap)
    let best = null
    for (const blob of blobs) {
      if (blob.x >= note.cx - 1) {
        continue
      }
      // Ignore stem-aligned thin marks at notehead x.
      if (Math.abs(blob.x - note.cx) < staffGap * 0.2 && blob.width < staffGap * 0.35) {
        diagnostics.rejected.push({ noteIndex, reason: 'stem-like' })
        continue
      }
      const classification = classifyAccidentalInkBlob(imageData, blob, inkThreshold, {
        staffGap,
      })
      if (!classification || classification.confidence < 0.64) {
        continue
      }
      const synthetic = {
        text: classification.text,
        x: blob.x,
        y: blob.y,
        source: 'vector-ink',
        confidence: classification.confidence,
        accidentalType: classification.type,
        alter: classification.alter,
        bounds: {
          x0: blob.x0,
          x1: blob.x1,
          y0: blob.y0,
          y1: blob.y1,
          width: blob.width,
          height: blob.height,
        },
        reason: classification.reason,
        noteIndexHint: noteIndex,
      }
      if (accidentalMatchScore(note, synthetic, window, lineYs, imageData) == null) {
        continue
      }
      if (!best || synthetic.confidence > best.confidence) {
        best = synthetic
      }
    }
    if (best) {
      diagnostics.inkCandidates += 1
      glyphs.push(best)
    }
  }

  diagnostics.accepted = glyphs.length
  return { glyphs, diagnostics }
}

export function summarizeVectorPathAccidentalDiagnostics(entries = []) {
  const totals = {
    pathCandidates: 0,
    inkCandidates: 0,
    accepted: 0,
    measures: entries.length,
  }
  for (const entry of entries) {
    totals.pathCandidates += entry?.pathCandidates ?? 0
    totals.inkCandidates += entry?.inkCandidates ?? 0
    totals.accepted += entry?.accepted ?? 0
  }
  return totals
}
