export function pointDistance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy

  if (lengthSq === 0) {
    return pointDistance(point, start)
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq),
  )

  return pointDistance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy,
  })
}

function strokeHitByPoint(stroke, point, radius) {
  const { points } = stroke
  if (points.length === 0) {
    return false
  }

  for (const strokePoint of points) {
    if (pointDistance(point, strokePoint) <= radius) {
      return true
    }
  }

  for (let i = 1; i < points.length; i += 1) {
    if (distancePointToSegment(point, points[i - 1], points[i]) <= radius) {
      return true
    }
  }

  return false
}

export function findStrokesToErase(strokes, eraserPoints, radius) {
  const ids = new Set()

  for (const stroke of strokes) {
    for (const eraserPoint of eraserPoints) {
      if (strokeHitByPoint(stroke, eraserPoint, radius)) {
        ids.add(stroke.id)
        break
      }
    }
  }

  return [...ids]
}

export function pointsToSvgPath(points) {
  if (points.length === 0) {
    return ''
  }
  if (points.length === 1) {
    const { x, y } = points[0]
    return `M ${x} ${y} L ${x} ${y}`
  }

  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i]
    const next = points[i + 1]
    const cx = (current.x + next.x) / 2
    const cy = (current.y + next.y) / 2
    path += ` Q ${current.x} ${current.y} ${cx} ${cy}`
  }
  const last = points[points.length - 1]
  path += ` L ${last.x} ${last.y}`
  return path
}
