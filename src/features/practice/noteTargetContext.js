import { getMeasureByNumber } from '../musicxml/measureNavigation.js'
import { sortAnchorsByMeasure } from '../score-follow/scoreFollowInterpolation.js'
import { clamp, lerp } from '../score-follow/scoreFollowEasing.js'

export function getMeasureTimingWindow(timingMap, measureNumber) {
  const measure = getMeasureByNumber(timingMap, measureNumber)
  if (!measure) {
    return null
  }

  const measures = timingMap.measures
  const index = measures.findIndex((candidate) => candidate.number === measureNumber)
  const next = index >= 0 ? measures[index + 1] : null
  const start = measure.startTimeSeconds
  const end = next?.startTimeSeconds ?? start + (measure.durationSeconds ?? 2)

  return {
    measure,
    startTimeSeconds: start,
    endTimeSeconds: Math.max(start + 0.05, end),
    durationSeconds: Math.max(0.05, end - start),
  }
}

export function getMeasureLayoutExtents(timingMap, measureNumber) {
  const notes = timingMap?.notes?.filter((note) => note.measureNumber === measureNumber) ?? []
  let minDefaultX = Infinity
  let maxDefaultX = 0
  let hasDefaultX = false

  for (const note of notes) {
    if (note.defaultX != null) {
      hasDefaultX = true
      minDefaultX = Math.min(minDefaultX, note.defaultX)
      maxDefaultX = Math.max(maxDefaultX, note.defaultX)
    }
  }

  return {
    hasDefaultX,
    minDefaultX: hasDefaultX ? minDefaultX : null,
    maxDefaultX: hasDefaultX && maxDefaultX > minDefaultX ? maxDefaultX : hasDefaultX ? maxDefaultX : null,
  }
}

function findSystemSpanAnchors(sorted, measureNumber) {
  const starts = sorted.filter((anchor) => anchor.meta?.role === 'system-start')
  for (const start of starts) {
    const end = sorted.find(
      (candidate) =>
        candidate.meta?.role === 'system-end' &&
        candidate.meta?.systemIndex === start.meta?.systemIndex &&
        candidate.page === start.page,
    )
    const spanEnd = end?.measureNumber ?? start.measureNumber
    if (measureNumber >= start.measureNumber && measureNumber <= spanEnd) {
      return { start, end: end ?? start, measuresInSpan: start.meta?.measuresInSpan ?? 1 }
    }
  }
  return null
}

function findNeighborAnchors(sorted, measureNumber) {
  let before = null
  let after = null

  for (const anchor of sorted) {
    if (anchor.measureNumber <= measureNumber) {
      before = anchor
    }
    if (anchor.measureNumber > measureNumber && !after) {
      after = anchor
      break
    }
  }

  return { before, after }
}

function inferPageForMeasure(sorted, timingMap, measureNumber) {
  const exact = sorted.find((anchor) => anchor.measureNumber === measureNumber)
  if (exact) {
    return exact.page
  }

  const systemStarts = sorted.filter((anchor) => anchor.meta?.role === 'system-start')
  if (!systemStarts.length) {
    return sorted[0]?.page ?? 1
  }

  const measures = timingMap?.measures ?? []
  let systemIndex = 0
  for (const measure of measures) {
    if (measure.number === measureNumber) {
      return systemStarts[Math.min(systemIndex, systemStarts.length - 1)]?.page ?? 1
    }
    if (measure.systemBreakBefore && systemIndex < systemStarts.length - 1) {
      systemIndex += 1
    }
  }

  return systemStarts[systemStarts.length - 1]?.page ?? 1
}

function measureXBoundsFromNeighbors(before, after, measureNumber) {
  if (!before) {
    return null
  }

  if (!after || after.page !== before.page || after.measureNumber <= before.measureNumber) {
    return {
      xStart: before.x,
      xEnd: before.x + 0.06,
      page: before.page,
      yRef: before.y,
    }
  }

  const span = after.measureNumber - before.measureNumber
  const t0 = (measureNumber - before.measureNumber) / span
  const t1 = (measureNumber - before.measureNumber + 1) / span

  return {
    xStart: lerp(before.x, after.x, clamp(t0, 0, 1)),
    xEnd: lerp(before.x, after.x, clamp(t1, 0, 1)),
    page: before.page,
    yRef: lerp(before.y, after.y, clamp((t0 + t1) * 0.5, 0, 1)),
  }
}

/**
 * Horizontal extent and staff corridor for a measure from score-follow anchors.
 */
export function buildMeasureAnchorGeometry(anchors, timingMap, measureNumber) {
  if (!anchors?.length || measureNumber == null) {
    return null
  }

  const sorted = sortAnchorsByMeasure(anchors, timingMap)
  const exact = sorted.find((anchor) => anchor.measureNumber === measureNumber)
  const systemSpan = findSystemSpanAnchors(sorted, measureNumber)
  const neighbors = findNeighborAnchors(sorted, measureNumber)
  const neighborBounds = measureXBoundsFromNeighbors(
    neighbors.before,
    neighbors.after,
    measureNumber,
  )

  const page =
    exact?.page ??
    neighborBounds?.page ??
    systemSpan?.start?.page ??
    inferPageForMeasure(sorted, timingMap, measureNumber)

  let xMeasureStart
  let xMeasureEnd
  let placement = 'system-span'

  if (exact) {
    placement = 'exact-anchor'
    xMeasureStart = exact.x
    xMeasureEnd = exact.x + 0.05
  } else if (neighborBounds && neighbors.after?.measureNumber > neighbors.before?.measureNumber) {
    placement = 'measure-bracket'
    xMeasureStart = neighborBounds.xStart
    xMeasureEnd = Math.max(neighborBounds.xEnd, neighborBounds.xStart + 0.03)
  } else if (systemSpan) {
    const startAnchor = systemSpan.start
    const endAnchor = systemSpan.end
    const xStart = startAnchor.x
    const xEnd = endAnchor.page === page ? endAnchor.x : startAnchor.x + 0.12
    const spanWidth = Math.max(0.04, xEnd - xStart)
    const measuresInSpan = systemSpan.measuresInSpan ?? 1
    const spanStartMeasure = startAnchor.measureNumber
    const measureIndex = Math.max(0, measureNumber - spanStartMeasure)
    const spanProgress =
      measuresInSpan <= 1 ? 0 : measureIndex / Math.max(1, measuresInSpan - 1)
    xMeasureStart = lerp(xStart, xEnd - spanWidth * 0.12, spanProgress)
    xMeasureEnd = xMeasureStart + spanWidth / Math.max(1, measuresInSpan)
  } else {
    const startAnchor = neighbors.before ?? exact
    if (!startAnchor) {
      return null
    }
    placement = 'single-anchor'
    xMeasureStart = startAnchor.x
    xMeasureEnd = startAnchor.x + 0.08
  }

  const yRef =
    exact?.y ??
    neighborBounds?.yRef ??
    lerp(
      systemSpan?.start?.y ?? neighbors.before?.y ?? 0.5,
      systemSpan?.end?.y ?? neighbors.after?.y ?? neighbors.before?.y ?? 0.5,
      0.5,
    )

  const ySpread = Math.max(
    0.05,
    Math.abs(
      (systemSpan?.end?.y ?? neighbors.after?.y ?? yRef) -
        (systemSpan?.start?.y ?? neighbors.before?.y ?? yRef),
    ) + 0.05,
  )

  const yCenter = yRef
  const yTop = clamp(yCenter - ySpread * 0.55, 0.06, 0.94)
  const yBottom = clamp(yCenter + ySpread * 0.55, 0.06, 0.94)
  const staffSplitY = clamp(yCenter, yTop, yBottom)

  return {
    page,
    xMeasureStart,
    xMeasureEnd,
    yTop,
    yBottom,
    yCenter,
    staffSplitY,
    placement,
    hasSystemSpan: Boolean(systemSpan),
    measuresInSpan: systemSpan?.measuresInSpan ?? 1,
    spanStartMeasure: systemSpan?.start?.measureNumber ?? neighbors.before?.measureNumber,
  }
}

export function measureProgressInSpan(geometry, measureNumber) {
  if (!geometry || geometry.measuresInSpan <= 1) {
    return 0
  }
  const index = Math.max(0, measureNumber - (geometry.spanStartMeasure ?? measureNumber))
  return clamp(index / Math.max(1, geometry.measuresInSpan - 1), 0, 1)
}
