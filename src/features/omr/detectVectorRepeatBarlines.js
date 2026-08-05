/**
 * Vector-native repeat barline recognition.
 *
 * Primary evidence comes from PDF path/glyph geometry (vertical bars + compact
 * filled dots). Raster pixels may corroborate but must not drive decisions for
 * vector PDFs — anti-aliased thick bars defeat run-separation heuristics.
 */

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
      points.push(transformPoint([x, y], transform))
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
      points.push(transformPoint([x, y], transform))
      continue
    }
    if (command === PDF_PATH_CURVE_TO) {
      curveCount += 1
      const coords = raw.slice(cursor, cursor + 6)
      cursor += 6
      if (coords.some((value) => !Number.isFinite(value))) {
        return null
      }
      points.push(transformPoint([coords[4], coords[5]], transform))
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
    bounds: { x0, x1, y0, y1, width: x1 - x0, height: y1 - y0 },
    moveCount,
    lineCount,
    curveCount,
    closeCount,
  }
}

function normalizeMeasureBox(measureBox) {
  return {
    x0: measureBox.x0 ?? measureBox.xStart ?? 0,
    x1: measureBox.x1 ?? measureBox.xEnd ?? 1,
    y0: measureBox.y0 ?? measureBox.yTop ?? 0,
    y1: measureBox.y1 ?? measureBox.yBottom ?? 1,
  }
}

export function staffGapFromLines(staffLineYs, fallback = 12) {
  if (!Array.isArray(staffLineYs) || staffLineYs.length < 2) {
    return fallback
  }
  const sorted = staffLineYs.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length < 2) {
    return fallback
  }
  const gaps = []
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(sorted[i] - sorted[i - 1])
  }
  gaps.sort((a, b) => a - b)
  return Math.max(4, gaps[Math.floor(gaps.length / 2)] || fallback)
}

/** MuseScore / SMuFL repeat-dot codepoints observed on holdout PDFs. */
export const REPEAT_DOT_CODEPOINTS = new Set([0xe043, 0xe044])

/**
 * Extract vertical bar candidates and compact filled dots from a pdf.js
 * operator list. Coordinates are in the same pixel space as the rendered page.
 *
 * MuseScore thick/thin barlines are often zero-width stroked paths whose visual
 * weight comes from setLineWidth (e.g. lw=25 thick vs lw=8 thin) — path bbox
 * width alone is not enough.
 */
export function extractPdfVectorBarlineComponentsFromOperatorList({
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
    return { verticalBars: [], compactDots: [] }
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
  const strokeOperations = new Set(
    [
      ops.stroke,
      ops.closeStroke,
      ops.fillStroke,
      ops.eoFillStroke,
      ops.closeFillStroke,
      ops.closeEOFillStroke,
    ].filter(Number.isFinite),
  )
  const paintOperations = new Set([...fillOperations, ...strokeOperations])

  let currentTransform = [1, 0, 0, 1, 0, 0]
  let lineWidth = 1
  const transformStack = []
  const verticalBars = []
  const compactDots = []
  const staffGapGuess = Math.max(8, targetWidth * 0.014)

  for (let operatorIndex = 0; operatorIndex < operatorList.fnArray.length; operatorIndex += 1) {
    const operation = operatorList.fnArray[operatorIndex]
    const args = operatorList.argsArray[operatorIndex]
    if (operation === ops.save) {
      transformStack.push({ transform: [...currentTransform], lineWidth })
      continue
    }
    if (operation === ops.restore) {
      const restored = transformStack.pop()
      if (restored) {
        currentTransform = restored.transform
        lineWidth = restored.lineWidth
      }
      continue
    }
    if (operation === ops.transform) {
      currentTransform = multiplyTransforms(currentTransform, args)
      continue
    }
    if (operation === ops.setLineWidth) {
      lineWidth = Number(args?.[0]) || lineWidth
      continue
    }
    if (operation !== ops.constructPath) {
      continue
    }

    const paintOperation = args?.[0]
    if (paintOperations.size && !paintOperations.has(paintOperation)) {
      continue
    }
    const filled = fillOperations.has(paintOperation)
    const stroked = strokeOperations.has(paintOperation)
    const pageTransform = multiplyTransforms(viewportTransform, currentTransform)
    const parsed = parseTransformedPath(args?.[1], pageTransform)
    if (!parsed?.bounds) {
      continue
    }
    const { bounds } = parsed
    let { width, height } = bounds
    // Effective stroke width in page pixels (CTM scale × lineWidth).
    const strokeScale = Math.hypot(currentTransform[0], currentTransform[1])
    const pageLineWidth = stroked
      ? Math.abs(lineWidth * strokeScale * (viewportTransform[0] || 1))
      : 0
    const effectiveWidth = Math.max(width, pageLineWidth)
    if (!(height > 0) || !(effectiveWidth > 0)) {
      continue
    }

    const cx = (bounds.x0 + bounds.x1) / 2
    const cy = (bounds.y0 + bounds.y1) / 2
    const expandedBounds = {
      x0: cx - effectiveWidth / 2,
      x1: cx + effectiveWidth / 2,
      y0: bounds.y0,
      y1: bounds.y1,
      width: effectiveWidth,
      height,
    }

    // Compact filled dots: circular paths or small filled outline rectangles.
    const nearSquare = width / Math.max(height, 1e-6)
    const compact =
      filled &&
      width >= staffGapGuess * 0.12 &&
      height >= staffGapGuess * 0.12 &&
      width <= staffGapGuess * 0.7 &&
      height <= staffGapGuess * 0.7 &&
      nearSquare >= 0.55 &&
      nearSquare <= 1.8 &&
      height / Math.max(width, 1e-6) < 2.2
    if (compact) {
      compactDots.push({
        candidateId: `pdf-rpt-dot-p${pageNumber}-op${operatorIndex}`,
        source: 'vector-path',
        page: pageNumber,
        operatorIndex,
        paintOperation,
        filled: true,
        x: cx,
        y: cy,
        radius: Math.max(width, height) / 2,
        bounds,
        curveCount: parsed.curveCount,
        lineCount: parsed.lineCount,
        closeCount: parsed.closeCount,
      })
    }

    // Vertical bar components: tall filled rects OR tall stroked lines.
    const aspect = height / Math.max(effectiveWidth, 1e-6)
    const isVertical =
      aspect >= 3.5 &&
      height >= staffGapGuess * 2.8 &&
      effectiveWidth <= staffGapGuess * 1.8 &&
      effectiveWidth >= Math.max(0.35, staffGapGuess * 0.02) &&
      // Nearly vertical segment (path width tiny or already a thin rect).
      (width <= staffGapGuess * 0.5 || width <= effectiveWidth * 1.2)
    if (!isVertical) {
      continue
    }
    // Reject wavy arpeggio-like paths.
    if (
      (parsed.curveCount ?? 0) > 2 &&
      !((parsed.lineCount ?? 0) >= 3 && (parsed.curveCount ?? 0) <= 4)
    ) {
      continue
    }

    verticalBars.push({
      candidateId: `pdf-rpt-bar-p${pageNumber}-op${operatorIndex}`,
      source: 'vector-path',
      page: pageNumber,
      operatorIndex,
      paintOperation,
      filled,
      stroked,
      lineWidth,
      pageLineWidth,
      x: cx,
      y: cy,
      bounds: expandedBounds,
      width: effectiveWidth,
      height,
      aspect,
      curveCount: parsed.curveCount,
      lineCount: parsed.lineCount,
      closeCount: parsed.closeCount,
    })
  }

  return { verticalBars, compactDots }
}

/**
 * Convert PDF text-layer SMuFL repeat dots into compactDot candidates in image
 * pixel space (same convention as textGlyphsToImage).
 *
 * MuseScore often emits two U+E043/U+E044 chars in one run for a colon; we
 * synthesize a vertical pair around the glyph center.
 */
export function extractRepeatDotGlyphsFromPageText(
  pageText,
  imageWidth,
  imageHeight,
  { staffGap = 12 } = {},
) {
  if (!Array.isArray(pageText) || !imageWidth || !imageHeight) {
    return []
  }
  const dots = []
  let glyphIndex = 0
  for (const item of pageText) {
    const text = String(item.text ?? '')
    if (!text.length || !Number.isFinite(item.pageWidth) || !Number.isFinite(item.pageHeight)) {
      continue
    }
    const codes = [...text].map((ch) => ch.codePointAt(0))
    const repeatCodes = codes.filter((cp) => REPEAT_DOT_CODEPOINTS.has(cp))
    if (!repeatCodes.length) {
      continue
    }
    const scaleX = imageWidth / item.pageWidth
    const scaleY = imageHeight / item.pageHeight
    const x = (item.x + (item.width ?? 0) / 2) * scaleX
    const y = imageHeight - (item.y ?? 0) * scaleY
    const radius = Math.max(staffGap * 0.18, Math.min(staffGap * 0.35, (item.height ?? 0) * scaleY * 0.12 || staffGap * 0.2))

    if (repeatCodes.length >= 2) {
      const upper = y - staffGap * 0.5
      const lower = y + staffGap * 0.5
      for (const [yy, suffix] of [
        [upper, 'a'],
        [lower, 'b'],
      ]) {
        dots.push({
          candidateId: `pdf-rpt-glyph-p${item.page ?? 0}-${glyphIndex}-${suffix}`,
          source: 'vector-glyph',
          x,
          y: yy,
          radius,
          bounds: {
            x0: x - radius,
            x1: x + radius,
            y0: yy - radius,
            y1: yy + radius,
            width: radius * 2,
            height: radius * 2,
          },
          codepoint: repeatCodes[0],
        })
      }
    } else {
      dots.push({
        candidateId: `pdf-rpt-glyph-p${item.page ?? 0}-${glyphIndex}`,
        source: 'vector-glyph',
        x,
        y,
        radius,
        bounds: {
          x0: x - radius,
          x1: x + radius,
          y0: y - radius,
          y1: y + radius,
          width: radius * 2,
          height: radius * 2,
        },
        codepoint: repeatCodes[0],
      })
    }
    glyphIndex += 1
  }
  return dots
}

/**
 * Merge adjacent vertical fragments that clearly form one bar (vector geometry
 * only — never because raster pixels touch).
 */
export function normalizeVectorBarComponents(verticalBars = [], { staffGap = 12 } = {}) {
  const bars = [...verticalBars].sort((a, b) => a.x - b.x)
  if (!bars.length) {
    return []
  }

  const merged = []
  let group = [bars[0]]
  const flush = () => {
    const rawX0 = Math.min(...group.map((bar) => bar.bounds.x0))
    const rawX1 = Math.max(...group.map((bar) => bar.bounds.x1))
    const y0 = Math.min(...group.map((bar) => bar.bounds.y0))
    const y1 = Math.max(...group.map((bar) => bar.bounds.y1))
    const width = Math.max(
      rawX1 - rawX0,
      ...group.map((bar) => bar.width ?? bar.bounds.width ?? 0),
    )
    const height = y1 - y0
    const cx = (rawX0 + rawX1) / 2
    const x0 = cx - width / 2
    const x1 = cx + width / 2
    const kind =
      width >= staffGap * 0.28
        ? 'thick'
        : width <= staffGap * 0.2
          ? 'thin'
          : width >= staffGap * 0.24
            ? 'thick'
            : 'uncertain'
    merged.push({
      kind,
      x: cx,
      width,
      height,
      bounds: { x0, x1, y0, y1, width, height },
      filled: group.some((bar) => bar.filled),
      stroked: group.some((bar) => bar.stroked),
      members: group.map((bar) => bar.candidateId),
      staffCoverage: height / Math.max(staffGap * 4, 1),
    })
  }

  for (let i = 1; i < bars.length; i += 1) {
    const prev = group[group.length - 1]
    const next = bars[i]
    const xGap = next.bounds.x0 - prev.bounds.x1
    const yOverlap =
      Math.min(prev.bounds.y1, next.bounds.y1) - Math.max(prev.bounds.y0, next.bounds.y0)
    const sameColumn =
      Math.abs(next.x - prev.x) <= Math.max(2, staffGap * 0.12) &&
      yOverlap >= staffGap * 1.5
    // Adjacent filled fragments that together form one thick bar.
    const adjacentThickParts =
      xGap <= Math.max(2, staffGap * 0.12) &&
      xGap >= -1 &&
      yOverlap >= staffGap * 2 &&
      prev.width <= staffGap * 0.35 &&
      next.width <= staffGap * 0.35
    if (sameColumn || adjacentThickParts) {
      group.push(next)
    } else {
      flush()
      group = [next]
    }
  }
  flush()
  return merged
}

/**
 * Classify a local column of normalized bars near a measure edge.
 */
export function classifyNormalizedBarStructure(normalizedBars = [], { staffGap = 12 } = {}) {
  if (!normalizedBars.length) {
    return { structure: 'none', bars: [] }
  }
  const sorted = [...normalizedBars].sort((a, b) => a.x - b.x)
  if (sorted.length === 1) {
    return {
      structure: sorted[0].kind === 'thick' ? 'uncertain' : 'thin',
      bars: sorted,
    }
  }

  const kinds = sorted.map((bar) => bar.kind)
  const gaps = []
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(sorted[i].bounds.x0 - sorted[i - 1].bounds.x1)
  }
  const close = gaps.every((gap) => gap <= staffGap * 0.55)

  if (!close) {
    return { structure: 'uncertain', bars: sorted }
  }

  if (sorted.length === 2 && kinds[0] === 'thin' && kinds[1] === 'thin') {
    return { structure: 'double-thin', bars: sorted }
  }
  if (sorted.length === 2 && kinds[0] === 'thin' && kinds[1] === 'thick') {
    return { structure: 'thin-thick', bars: sorted }
  }
  if (sorted.length === 2 && kinds[0] === 'thick' && kinds[1] === 'thin') {
    return { structure: 'thick-thin', bars: sorted }
  }
  if (
    sorted.length === 3 &&
    kinds[0] === 'thin' &&
    kinds[1] === 'thick' &&
    kinds[2] === 'thin'
  ) {
    return { structure: 'thin-thick-thin', bars: sorted }
  }
  if (sorted.length >= 2 && kinds.includes('thick') && kinds.includes('thin')) {
    const firstThick = kinds.indexOf('thick')
    const firstThin = kinds.indexOf('thin')
    return {
      structure: firstThick < firstThin ? 'thick-thin' : 'thin-thick',
      bars: sorted,
    }
  }
  return { structure: 'uncertain', bars: sorted }
}

/**
 * Find a valid repeat-dot pair beside a bar structure.
 */
export function findVectorRepeatDotPair(
  compactDots = [],
  {
    barX,
    side, // 'left' | 'right'
    staffLineYs = null,
    staffGap = 12,
    maxDistance = null,
    bandY0 = null,
    bandY1 = null,
  } = {},
) {
  if (!Number.isFinite(barX) || !['left', 'right'].includes(side)) {
    return null
  }
  const maxDist = maxDistance ?? staffGap * 1.6
  const lines = Array.isArray(staffLineYs)
    ? staffLineYs.filter(Number.isFinite).sort((a, b) => a - b)
    : null

  const sideDots = compactDots.filter((dot) => {
    const dx = side === 'left' ? barX - dot.x : dot.x - barX
    if (dx < staffGap * 0.12 || dx > maxDist) {
      return false
    }
    if (dot.radius > staffGap * 0.45 || dot.radius < staffGap * 0.08) {
      return false
    }
    if (Number.isFinite(bandY0) && Number.isFinite(bandY1)) {
      if (dot.y < bandY0 - staffGap * 0.6 || dot.y > bandY1 + staffGap * 0.6) {
        return false
      }
    }
    return true
  })
  if (sideDots.length < 2) {
    return null
  }

  // Prefer pairs with nearly identical x and staff-space separation.
  let best = null
  for (let i = 0; i < sideDots.length; i += 1) {
    for (let j = i + 1; j < sideDots.length; j += 1) {
      const a = sideDots[i]
      const b = sideDots[j]
      const xSep = Math.abs(a.x - b.x)
      const ySep = Math.abs(a.y - b.y)
      const sizeRatio =
        Math.max(a.radius, b.radius) / Math.max(Math.min(a.radius, b.radius), 1e-6)
      if (xSep > staffGap * 0.35 || sizeRatio > 1.85) {
        continue
      }
      if (ySep < staffGap * 0.55 || ySep > staffGap * 1.55) {
        continue
      }
      const midY = (a.y + b.y) / 2
      if (lines?.length >= 5) {
        const staffTop = lines[0]
        const staffBottom = lines[Math.min(4, lines.length - 1)]
        if (midY < staffTop - staffGap * 0.4 || midY > staffBottom + staffGap * 0.4) {
          continue
        }
        // Each dot must sit in a staff space (not on a staff line). The pair
        // midpoint often lands on the middle line — that is expected.
        // Glyph-synthesized pairs are already placed in spaces; skip line gate.
        const glyphSourced =
          a.source === 'vector-glyph' || b.source === 'vector-glyph'
        if (!glyphSourced) {
          const dotOnLine = (dotY) =>
            lines.some((line) => Math.abs(dotY - line) < staffGap * 0.18)
          if (dotOnLine(a.y) || dotOnLine(b.y)) {
            continue
          }
        }
      }
      const score = 1 / (1 + xSep) + 1 / (1 + Math.abs(ySep - staffGap))
      if (!best || score > best.score) {
        best = { score, dots: [a, b].sort((left, right) => left.y - right.y), side, midY }
      }
    }
  }
  return best
}

function evidenceFamilies({ structure, dotSide, multiStaffAgreement, voltaContext }) {
  const families = []
  if (
    (structure === 'thin-thick' || structure === 'thin-thick-thin') &&
    dotSide === 'left'
  ) {
    families.push('bar-order+dot-side')
  }
  if (
    (structure === 'thick-thin' || structure === 'thin-thick-thin') &&
    dotSide === 'right'
  ) {
    families.push('bar-order+dot-side')
  }
  if (dotSide && multiStaffAgreement) {
    families.push('dot-side+multi-staff')
  }
  if (
    (structure === 'thin-thick' ||
      structure === 'thick-thin' ||
      structure === 'thin-thick-thin') &&
    voltaContext
  ) {
    families.push('bar-order+volta')
  }
  if (dotSide && voltaContext) {
    families.push('dot-side+volta')
  }
  return [...new Set(families)]
}

/**
 * Joint classify repeat direction from normalized bars + dots.
 */
export function classifyVectorRepeatDirection({
  structure,
  bars = [],
  leftDots = null,
  rightDots = null,
  edge = 'right',
  multiStaffAgreement = false,
  voltaContext = false,
} = {}) {
  if (structure === 'double-thin' || structure === 'thin' || structure === 'none') {
    return null
  }
  // Final thin+thick without dots is not a repeat.
  if (
    (structure === 'thin-thick' || structure === 'thick-thin') &&
    !leftDots &&
    !rightDots
  ) {
    return null
  }

  let forward = false
  let backward = false

  if (structure === 'thin-thick-thin') {
    if (leftDots) backward = true
    if (rightDots) forward = true
    if (!leftDots && !rightDots) {
      return null
    }
  } else if (structure === 'thin-thick') {
    // Canonical backward: thin then thick, dots on the left.
    if (leftDots) backward = true
  } else if (structure === 'thick-thin') {
    // Canonical forward: thick then thin, dots on the right.
    if (rightDots) forward = true
  }

  if (!forward && !backward) {
    return null
  }

  const dotSide = leftDots ? 'left' : rightDots ? 'right' : null
  const families = evidenceFamilies({
    structure,
    dotSide,
    multiStaffAgreement,
    voltaContext,
  })
  if (families.length < 2 && !(forward && backward && leftDots && rightDots)) {
    // Back-to-back with both dot sides counts as strong dual evidence.
    if (!(leftDots && rightDots && structure === 'thin-thick-thin')) {
      // Allow single-staff strong bar-order+dot-side alone when confidence high path.
      if (!families.includes('bar-order+dot-side')) {
        return null
      }
    }
  }

  const confidence =
    0.88 +
    (multiStaffAgreement ? 0.04 : 0) +
    (voltaContext ? 0.02 : 0) +
    (leftDots && rightDots ? 0.03 : 0)

  return {
    forwardRepeat: forward,
    backwardRepeat: backward,
    confidence: Math.min(0.98, confidence),
    source: 'vector-path',
    structure,
    evidenceFamilies: families.length
      ? families
      : leftDots && rightDots
        ? ['bar-order+dot-side', 'dual-dot-sides']
        : ['bar-order+dot-side'],
    bars: bars.map((bar) => ({ kind: bar.kind, x: bar.x, width: bar.width })),
  }
}

/**
 * Detect a vector-native repeat at one measure edge.
 */
export function detectVectorRepeatAtEdge({
  verticalBars = [],
  compactDots = [],
  measureBox,
  imageWidth,
  imageHeight,
  edge = 'right',
  staffLineYs = null,
  structureBand = null,
  voltaContext = false,
  multiStaffBars = null,
} = {}) {
  if (!imageWidth || !measureBox) {
    return null
  }
  const box = normalizeMeasureBox(measureBox)
  const band = structureBand ? normalizeMeasureBox(structureBand) : box
  const y0 = band.y0 * imageHeight
  const y1 = band.y1 * imageHeight
  const edgeX = (edge === 'right' ? box.x1 : box.x0) * imageWidth
  const staffGap = staffGapFromLines(
    (staffLineYs ?? []).map((value) => (value <= 1 ? value * imageHeight : value)),
    Math.max(8, imageWidth * 0.014),
  )
  const searchPad = staffGap * 1.8

  const nearBars = verticalBars.filter((bar) => {
    const overlapsY =
      bar.bounds.y1 >= y0 - staffGap * 0.5 && bar.bounds.y0 <= y1 + staffGap * 0.5
    const nearX = Math.abs(bar.x - edgeX) <= searchPad
    return overlapsY && nearX
  })
  if (!nearBars.length) {
    return null
  }

  const normalized = normalizeVectorBarComponents(nearBars, { staffGap })
  // Keep only bars clustered at the edge column.
  const edgeCluster = normalized.filter((bar) => Math.abs(bar.x - edgeX) <= searchPad)
  const classified = classifyNormalizedBarStructure(edgeCluster, { staffGap })
  if (
    classified.structure === 'none' ||
    classified.structure === 'thin' ||
    classified.structure === 'double-thin' ||
    classified.structure === 'uncertain'
  ) {
    // Still allow thin-thick when kinds were uncertain but widths differ.
    if (edgeCluster.length >= 2) {
      const sorted = [...edgeCluster].sort((a, b) => a.x - b.x)
      const widths = sorted.map((bar) => bar.width)
      const minW = Math.min(...widths)
      const maxW = Math.max(...widths)
      if (maxW >= minW * 2.2 && maxW >= staffGap * 0.28) {
        const thickIndex = widths.indexOf(maxW)
        classified.structure =
          thickIndex === 0
            ? sorted.length >= 3
              ? 'thick-thin'
              : 'thick-thin'
            : sorted.length >= 3 && thickIndex === 1
              ? 'thin-thick-thin'
              : 'thin-thick'
        classified.bars = sorted.map((bar, index) => ({
          ...bar,
          kind: index === thickIndex || bar.width === maxW ? 'thick' : 'thin',
        }))
      } else {
        return null
      }
    } else {
      return null
    }
  }

  const bars = classified.bars
  const leftBarX = Math.min(...bars.map((bar) => bar.bounds.x0))
  const rightBarX = Math.max(...bars.map((bar) => bar.bounds.x1))
  const pixelStaffYs = (staffLineYs ?? [])
    .map((value) => (value <= 1 ? value * imageHeight : value))
    .filter(Number.isFinite)

  const leftDots = findVectorRepeatDotPair(compactDots, {
    barX: leftBarX,
    side: 'left',
    staffLineYs: pixelStaffYs,
    staffGap,
    bandY0: y0,
    bandY1: y1,
  })
  const rightDots = findVectorRepeatDotPair(compactDots, {
    barX: rightBarX,
    side: 'right',
    staffLineYs: pixelStaffYs,
    staffGap,
    bandY0: y0,
    bandY1: y1,
  })

  // Edge role must match structure: forward only on left edge, backward on right
  // (thin-thick-thin may emit both for back-to-back boundaries).
  if (edge === 'left' && classified.structure === 'thin-thick' && !rightDots) {
    // thin-thick without right dots is a backward form — not a left-edge forward.
  }
  if (edge === 'right' && classified.structure === 'thick-thin' && !leftDots) {
    // thick-thin without left dots is a forward form — not a right-edge backward.
  }

  let multiStaffAgreement = false
  if (Array.isArray(multiStaffBars) && multiStaffBars.length) {
    const otherNear = multiStaffBars.filter(
      (bar) =>
        Math.abs(bar.x - edgeX) <= searchPad &&
        Math.abs(bar.x - (bars[0]?.x ?? edgeX)) <= staffGap * 0.4,
    )
    multiStaffAgreement = otherNear.length > 0
  }

  const marking = classifyVectorRepeatDirection({
    structure: classified.structure,
    bars,
    leftDots,
    rightDots,
    edge,
    multiStaffAgreement,
    voltaContext,
  })
  if (!marking) {
    return null
  }
  // Shared bar columns sit on both adjacent measure boxes. Keep the hit only
  // when the bar cluster is nearer this edge than the opposite measure edge.
  const clusterX =
    bars.reduce((sum, bar) => sum + bar.x, 0) / Math.max(bars.length, 1)
  const leftEdgeX = box.x0 * imageWidth
  const rightEdgeX = box.x1 * imageWidth
  const distLeft = Math.abs(clusterX - leftEdgeX)
  const distRight = Math.abs(clusterX - rightEdgeX)
  if (edge === 'left' && distRight + staffGap * 0.15 < distLeft) {
    return null
  }
  if (edge === 'right' && distLeft + staffGap * 0.15 < distRight) {
    return null
  }
  const backToBack =
    classified.structure === 'thin-thick-thin' && Boolean(leftDots) && Boolean(rightDots)
  if (backToBack) {
    marking.backToBack = true
  }
  // Keep only the direction that belongs on this edge unless back-to-back.
  if (edge === 'left' && marking.backwardRepeat && !marking.forwardRepeat) {
    return null
  }
  if (edge === 'right' && marking.forwardRepeat && !marking.backwardRepeat) {
    return null
  }
  if (edge === 'left' && marking.forwardRepeat && marking.backwardRepeat) {
    return {
      forwardRepeat: true,
      confidence: marking.confidence,
      source: marking.source,
      structure: marking.structure,
      evidenceFamilies: marking.evidenceFamilies,
      bars: marking.bars,
      backToBack,
    }
  }
  if (edge === 'right' && marking.forwardRepeat && marking.backwardRepeat) {
    return {
      backwardRepeat: true,
      confidence: marking.confidence,
      source: marking.source,
      structure: marking.structure,
      evidenceFamilies: marking.evidenceFamilies,
      bars: marking.bars,
      backToBack,
    }
  }
  return marking
}

/**
 * Fuse per-staff vector repeat hits sharing a boundary into one semantic mark.
 */
export function fuseVectorRepeatMarkings(markings = []) {
  const usable = markings.filter(Boolean)
  if (!usable.length) {
    return null
  }
  const forward = usable.some((mark) => mark.forwardRepeat)
  const backward = usable.some((mark) => mark.backwardRepeat)
  const confidence = Math.min(
    0.98,
    Math.max(...usable.map((mark) => mark.confidence ?? 0)) + (usable.length > 1 ? 0.03 : 0),
  )
  return {
    forwardRepeat: forward || undefined,
    backwardRepeat: backward || undefined,
    confidence,
    source: 'vector-path',
    staffCount: usable.length,
    structure: usable.find((mark) => mark.structure)?.structure,
    backToBack: usable.some((mark) => mark.backToBack) || undefined,
    evidenceFamilies: [
      ...new Set(usable.flatMap((mark) => mark.evidenceFamilies ?? [])),
      ...(usable.length > 1 ? ['multi-staff-fusion'] : []),
    ],
  }
}

/**
 * Convenience: components object for pipeline wiring.
 */
export function emptyVectorBarlineComponents() {
  return { verticalBars: [], compactDots: [] }
}
