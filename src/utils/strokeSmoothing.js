export function getPointerPressure(event) {
  if (typeof event.pressure === 'number' && event.pressure > 0) {
    return event.pressure
  }
  return 0.5
}

export function scaleWidth(baseWidth, pressure, tool) {
  if (tool === 'eraser') {
    return baseWidth
  }
  const minScale = 0.45
  const maxScale = 1.35
  const scale = minScale + pressure * (maxScale - minScale)
  return baseWidth * scale
}

/** Lightweight smoothing for freehand input */
export function smoothPoints(points, minDistance = 0.0015) {
  if (points.length <= 2) {
    return points
  }

  const smoothed = [points[0]]

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]
    const last = smoothed[smoothed.length - 1]
    const dx = point.x - last.x
    const dy = point.y - last.y
    const dist = Math.hypot(dx, dy)

    if (dist < minDistance) {
      continue
    }

    if (i < points.length - 1) {
      const next = points[i + 1]
      smoothed.push({
        x: (last.x + point.x + next.x) / 3,
        y: (last.y + point.y + next.y) / 3,
        pressure: point.pressure,
      })
    } else {
      smoothed.push(point)
    }
  }

  return smoothed
}
