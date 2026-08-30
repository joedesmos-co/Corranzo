const PDF_PATH_MOVE_TO = 0
const PDF_PATH_LINE_TO = 1
const PDF_PATH_CURVE_TO = 2
const PDF_PATH_CLOSE = 3
const MAX_SOURCE_VECTOR_PATHS_PER_PAGE = 12000

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

function vectorScale(transform) {
  if (!Array.isArray(transform)) return 1
  const xScale = Math.hypot(transform[0] ?? 1, transform[1] ?? 0)
  const yScale = Math.hypot(transform[2] ?? 0, transform[3] ?? 1)
  return (xScale + yScale) / 2
}

function boundsForPoints(points) {
  const xValues = points.map((point) => point?.[0]).filter(Number.isFinite)
  const yValues = points.map((point) => point?.[1]).filter(Number.isFinite)
  if (!xValues.length || !yValues.length) return null
  const x0 = Math.min(...xValues)
  const x1 = Math.max(...xValues)
  const y0 = Math.min(...yValues)
  const y1 = Math.max(...yValues)
  return { x0, x1, y0, y1, width: x1 - x0, height: y1 - y0 }
}

function sourceVectorSubpaths(rawPath, transform) {
  const raw = pathChunks(rawPath)
  const subpaths = []
  let cursor = 0
  let current = null
  let lastPoint = null
  while (cursor < raw.length) {
    const command = raw[cursor]
    cursor += 1
    if (command === PDF_PATH_MOVE_TO) {
      const next = transformPoint([raw[cursor], raw[cursor + 1]], transform)
      cursor += 2
      if (!next.every(Number.isFinite)) break
      current = { commands: ['move'], points: [next], segments: [], closed: false }
      subpaths.push(current)
      lastPoint = next
      continue
    }
    if (!current || !lastPoint) break
    if (command === PDF_PATH_LINE_TO) {
      const next = transformPoint([raw[cursor], raw[cursor + 1]], transform)
      cursor += 2
      if (!next.every(Number.isFinite)) break
      current.commands.push('line')
      current.points.push(next)
      current.segments.push({ kind: 'line', from: lastPoint, to: next })
      lastPoint = next
      continue
    }
    if (command === PDF_PATH_CURVE_TO) {
      const c1 = transformPoint([raw[cursor], raw[cursor + 1]], transform)
      const c2 = transformPoint([raw[cursor + 2], raw[cursor + 3]], transform)
      const next = transformPoint([raw[cursor + 4], raw[cursor + 5]], transform)
      cursor += 6
      if (![c1, c2, next].every((point) => point.every(Number.isFinite))) break
      current.commands.push('curve')
      current.points.push(c1, c2, next)
      current.segments.push({ kind: 'cubic', from: lastPoint, c1, c2, to: next })
      lastPoint = next
      continue
    }
    if (command === PDF_PATH_CLOSE) {
      current.commands.push('close')
      current.closed = true
      const first = current.points[0]
      if (first && lastPoint) {
        current.segments.push({ kind: 'line', from: lastPoint, to: first })
      }
      lastPoint = first
      continue
    }
    break
  }
  return subpaths
}

/**
 * Preserve neutral PDF path/operator provenance at the OMR viewport scale.
 *
 * These records deliberately do not call a path a stem, beam, bracket, tie, or
 * owner. Those meanings require measure-local physical geometry and are added
 * later by the shadow relation graph. pdf.js does not expose original indirect
 * PDF object ids here, so page/operator/subpath identity is the strongest stable
 * page-local identifier available.
 */
export function extractPdfVectorSourcePathsFromOperatorList({
  operatorList,
  ops,
  viewportTransform,
  pageNumber = 1,
  maxPaths = MAX_SOURCE_VECTOR_PATHS_PER_PAGE,
} = {}) {
  if (
    !operatorList?.fnArray?.length ||
    !operatorList?.argsArray?.length ||
    !ops ||
    !Array.isArray(viewportTransform)
  ) {
    return []
  }

  const paintOperations = acceptedPaintOperations(ops)
  let currentTransform = [1, 0, 0, 1, 0, 0]
  let sourceLineWidth = 1
  const stateStack = []
  const paths = []
  let eligibleSubpaths = 0

  for (let operatorIndex = 0; operatorIndex < operatorList.fnArray.length; operatorIndex += 1) {
    const operation = operatorList.fnArray[operatorIndex]
    const args = operatorList.argsArray[operatorIndex]
    if (operation === ops.save) {
      stateStack.push({ transform: [...currentTransform], sourceLineWidth })
      continue
    }
    if (operation === ops.restore) {
      const restored = stateStack.pop()
      if (restored) {
        currentTransform = restored.transform
        sourceLineWidth = restored.sourceLineWidth
      }
      continue
    }
    if (operation === ops.transform) {
      currentTransform = multiplyTransforms(currentTransform, args)
      continue
    }
    if (operation === ops.setLineWidth) {
      const next = Number(args?.[0])
      if (next > 0) sourceLineWidth = next
      continue
    }
    if (operation !== ops.constructPath) continue

    const paintOperation = args?.[0]
    if (paintOperations.size && !paintOperations.has(paintOperation)) continue
    const pageTransform = multiplyTransforms(viewportTransform, currentTransform)
    const subpaths = sourceVectorSubpaths(args?.[1], pageTransform)
    for (let subpathIndex = 0; subpathIndex < subpaths.length; subpathIndex += 1) {
      const subpath = subpaths[subpathIndex]
      const bounds = boundsForPoints(subpath.points)
      if (!bounds) continue
      eligibleSubpaths += 1
      if (paths.length >= maxPaths) continue
      paths.push({
        pathId: `pdf-path-p${pageNumber}-op${operatorIndex}-sub${subpathIndex}`,
        operatorPathId: `pdf-path-p${pageNumber}-op${operatorIndex}`,
        source: 'pdf-vector-operator-path',
        page: pageNumber,
        operatorIndex,
        subpathIndex,
        drawOrder: operatorIndex,
        paintOperation,
        sourceTransform: [...currentTransform],
        viewportTransform: [...viewportTransform],
        sourceLineWidth,
        effectiveLineWidth: sourceLineWidth * vectorScale(pageTransform),
        commands: subpath.commands,
        closed: subpath.closed,
        segments: subpath.segments.map((segment) => ({
          kind: segment.kind,
          from: { x: segment.from[0], y: segment.from[1] },
          to: { x: segment.to[0], y: segment.to[1] },
          ...(segment.c1 ? { c1: { x: segment.c1[0], y: segment.c1[1] } } : {}),
          ...(segment.c2 ? { c2: { x: segment.c2[0], y: segment.c2[1] } } : {}),
        })),
        bounds,
      })
    }
  }

  paths.diagnostics = {
    page: pageNumber,
    eligibleSubpaths,
    retainedSubpaths: paths.length,
    truncated: eligibleSubpaths > paths.length,
    maxPaths,
    originalPdfObjectIdsAvailable: false,
  }
  return paths
}

function cubicPathPoints(rawPath, transform) {
  const raw = pathChunks(rawPath)
  let cursor = 0
  const commands = []
  const points = []
  while (cursor < raw.length) {
    const command = raw[cursor]
    cursor += 1
    commands.push(command)
    const coordinateCount =
      command === PDF_PATH_MOVE_TO
        ? 2
        : command === PDF_PATH_CURVE_TO
          ? 6
          : 0
    for (let offset = 0; offset < coordinateCount; offset += 2) {
      const x = raw[cursor + offset]
      const y = raw[cursor + offset + 1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }
      points.push(transformPoint([x, y], transform))
    }
    cursor += coordinateCount
  }

  const isClosedCubicLens =
    commands.length === 4 &&
    commands[0] === PDF_PATH_MOVE_TO &&
    commands[1] === PDF_PATH_CURVE_TO &&
    commands[2] === PDF_PATH_CURVE_TO &&
    commands[3] === PDF_PATH_CLOSE &&
    points.length === 7
  return isClosedCubicLens ? points : null
}

/** MuseScore draws many ties as one open cubic stroke (move + curve), not a closed lens. */
function openCubicStrokePoints(rawPath, transform) {
  const raw = pathChunks(rawPath)
  if (raw.length !== 10 || raw[0] !== PDF_PATH_MOVE_TO || raw[3] !== PDF_PATH_CURVE_TO) {
    return null
  }
  const p0 = transformPoint([raw[1], raw[2]], transform)
  const p1 = transformPoint([raw[4], raw[5]], transform)
  const p2 = transformPoint([raw[6], raw[7]], transform)
  const p3 = transformPoint([raw[8], raw[9]], transform)
  if (![p0, p1, p2, p3].every((point) => point.every(Number.isFinite))) {
    return null
  }
  return [p0, p1, p2, p3]
}

function pointDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

function tangent(from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dx, dy)
  if (!length) {
    return { dx: 0, dy: 0 }
  }
  return { dx: dx / length, dy: dy / length }
}

function acceptedPaintOperations(ops) {
  return new Set(
    [
      ops?.fill,
      ops?.eoFill,
      ops?.fillStroke,
      ops?.eoFillStroke,
      ops?.closeFillStroke,
      ops?.closeEOFillStroke,
      ops?.stroke,
      ops?.closeStroke,
      ops?.fillStroke,
    ].filter(Number.isFinite),
  )
}

/**
 * Extract thin closed cubic lenses from a pdf.js operator list.
 *
 * Engravers normally draw ties and slurs as two cubic Béziers that share their
 * endpoints and close into a filled lens. Keeping this source geometry avoids
 * re-detecting clean vector curves from raster pixels.
 */
export function extractPdfVectorCurvesFromOperatorList({
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
    return []
  }

  const paintOperations = acceptedPaintOperations(ops)
  let currentTransform = [1, 0, 0, 1, 0, 0]
  const transformStack = []
  const curves = []
  const minWidth = Math.max(12, targetWidth * 0.012)
  const maxWidth = targetWidth * 0.92
  const minHeight = Math.max(1.5, targetWidth * 0.0015)
  const maxHeight = targetWidth * 0.06
  const closeTolerance = Math.max(3, targetWidth * 0.004)

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
    const closedPoints = cubicPathPoints(args?.[1], pageTransform)
    if (closedPoints && pointDistance(closedPoints[0], closedPoints[6]) <= closeTolerance) {
      const xValues = closedPoints.map((point) => point[0])
      const yValues = closedPoints.map((point) => point[1])
      const x0 = Math.min(...xValues)
      const x1 = Math.max(...xValues)
      const y0 = Math.min(...yValues)
      const y1 = Math.max(...yValues)
      const width = x1 - x0
      const height = y1 - y0
      const aspect = width / height
      const isShortContinuationLens =
        width <= targetWidth * 0.035 &&
        height <= targetWidth * 0.015 &&
        aspect >= 1.8
      if (
        width >= minWidth &&
        width <= maxWidth &&
        height >= minHeight &&
        height <= maxHeight &&
        (aspect >= 3 || isShortContinuationLens)
      ) {
        const forward = closedPoints[0][0] <= closedPoints[3][0]
        const start = forward ? closedPoints[0] : closedPoints[3]
        const startControl = forward ? closedPoints[1] : closedPoints[2]
        const endControl = forward ? closedPoints[2] : closedPoints[1]
        const end = forward ? closedPoints[3] : closedPoints[0]
        const baselineY = (start[1] + end[1]) / 2
        const controlY = (startControl[1] + endControl[1]) / 2

        curves.push({
          candidateId: `pdf-path-p${pageNumber}-op${operatorIndex}`,
          source: 'pdf-vector-path',
          sourcePriority: 1,
          page: pageNumber,
          operatorIndex,
          paintOperation,
          start: {
            x: start[0],
            y: start[1],
            tangent: tangent(start, startControl),
          },
          end: {
            x: end[0],
            y: end[1],
            tangent: tangent(endControl, end),
          },
          bounds: { x0, x1, y0, y1, width, height },
          archDirection: controlY < baselineY ? 'above' : 'below',
          confidence: 0.99,
        })
      }
      continue
    }

    const openPoints = openCubicStrokePoints(args?.[1], pageTransform)
    if (!openPoints) {
      continue
    }
    const [p0, p1, p2, p3] = openPoints
    const forward = p0[0] <= p3[0]
    const start = forward ? p0 : p3
    const startControl = forward ? p1 : p2
    const endControl = forward ? p2 : p1
    const end = forward ? p3 : p0
    const xValues = openPoints.map((point) => point[0])
    const yValues = openPoints.map((point) => point[1])
    const x0 = Math.min(...xValues)
    const x1 = Math.max(...xValues)
    const y0 = Math.min(...yValues)
    const y1 = Math.max(...yValues)
    const width = x1 - x0
    const height = y1 - y0
    const aspect = width / Math.max(height, 0.1)
    const openMinWidth = Math.max(12, targetWidth * 0.012)
    const openMaxWidth = targetWidth * 0.45
    const openMinHeight = Math.max(0.4, targetWidth * 0.0008)
    const openMaxHeight = targetWidth * 0.03
    if (
      width < openMinWidth ||
      width > openMaxWidth ||
      height < openMinHeight ||
      height > openMaxHeight ||
      aspect < 1.8
    ) {
      continue
    }
    const baselineY = (start[1] + end[1]) / 2
    const controlY = (startControl[1] + endControl[1]) / 2
    curves.push({
      candidateId: `pdf-open-p${pageNumber}-op${operatorIndex}`,
      source: 'pdf-vector-path',
      sourcePriority: 1,
      page: pageNumber,
      operatorIndex,
      paintOperation,
      strokeStyle: 'open-cubic',
      start: {
        x: start[0],
        y: start[1],
        tangent: tangent(start, startControl),
      },
      end: {
        x: end[0],
        y: end[1],
        tangent: tangent(endControl, end),
      },
      bounds: { x0, x1, y0, y1, width, height },
      archDirection: controlY < baselineY ? 'above' : 'below',
      confidence: 0.96,
    })
  }

  return curves
}
