const PDF_PATH_MOVE_TO = 0
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
    const points = cubicPathPoints(args?.[1], pageTransform)
    if (!points || pointDistance(points[0], points[6]) > closeTolerance) {
      continue
    }

    const xValues = points.map((point) => point[0])
    const yValues = points.map((point) => point[1])
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
      width < minWidth ||
      width > maxWidth ||
      height < minHeight ||
      height > maxHeight ||
      (aspect < 3 && !isShortContinuationLens)
    ) {
      continue
    }

    const forward = points[0][0] <= points[3][0]
    const start = forward ? points[0] : points[3]
    const startControl = forward ? points[1] : points[2]
    const endControl = forward ? points[2] : points[1]
    const end = forward ? points[3] : points[0]
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

  return curves
}
