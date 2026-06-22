/**
 * Map written measures from MusicXML onto detected PDF staff systems.
 * Uses MusicXML system breaks when present, otherwise even distribution.
 */
export function allocateMeasureSpansToSystems(systemEntries, measureNumbers, timingMap = null) {
  if (!systemEntries.length || !measureNumbers.length) {
    return []
  }

  const measureGroups = groupMeasuresBySystemBreaks(measureNumbers, timingMap)
  const spans = []

  if (measureGroups.length > 0) {
    let systemIndex = 0
    for (const group of measureGroups) {
      if (systemIndex >= systemEntries.length) {
        break
      }
      spans.push({
        systemIndex,
        page: systemEntries[systemIndex].page,
        measureStart: group[0],
        measureEnd: group[group.length - 1],
        measuresInSpan: group.length,
        measureNumbers: group,
      })
      systemIndex += 1
    }

    while (systemIndex < systemEntries.length && spans.length > 0) {
      const last = spans[spans.length - 1]
      const remainingMeasures = measureNumbers.length - measureNumbers.indexOf(last.measureEnd) - 1
      if (remainingMeasures <= 0) {
        break
      }
      const remainingSystems = systemEntries.length - systemIndex
      const measuresInSpan = Math.max(1, Math.ceil(remainingMeasures / remainingSystems))
      const startIndex = measureNumbers.indexOf(last.measureEnd) + 1
      const slice = measureNumbers.slice(startIndex, startIndex + measuresInSpan)
      if (slice.length === 0) {
        break
      }
      spans.push({
        systemIndex,
        page: systemEntries[systemIndex].page,
        measureStart: slice[0],
        measureEnd: slice[slice.length - 1],
        measuresInSpan: slice.length,
        measureNumbers: slice,
      })
      systemIndex += 1
    }
  }

  if (spans.length === 0) {
    return allocateWeightedMeasureSpans(systemEntries, measureNumbers)
  }

  if (spans.length < systemEntries.length) {
    const padded = [...spans]
    let measureIndex = measureNumbers.indexOf(padded[padded.length - 1].measureEnd) + 1
    for (let systemIndex = padded.length; systemIndex < systemEntries.length; systemIndex += 1) {
      if (measureIndex >= measureNumbers.length) {
        break
      }
      const remainingMeasures = measureNumbers.length - measureIndex
      const remainingSystems = systemEntries.length - systemIndex
      const measuresInSpan = Math.max(1, Math.ceil(remainingMeasures / remainingSystems))
      const slice = measureNumbers.slice(measureIndex, measureIndex + measuresInSpan)
      measureIndex += measuresInSpan
      padded.push({
        systemIndex,
        page: systemEntries[systemIndex].page,
        measureStart: slice[0],
        measureEnd: slice[slice.length - 1],
        measuresInSpan: slice.length,
        measureNumbers: slice,
      })
    }
    return padded
  }

  return spans.slice(0, systemEntries.length)
}

export function groupMeasuresBySystemBreaks(measureNumbers, timingMap) {
  const measures = timingMap?.measures
  if (!measures?.length) {
    return []
  }

  const groups = []
  let current = []

  for (const measureNumber of measureNumbers) {
    const record = measures.find((measure) => measure.number === measureNumber)
    if (record?.systemBreakBefore && current.length > 0) {
      groups.push(current)
      current = []
    }
    current.push(measureNumber)
  }

  if (current.length > 0) {
    groups.push(current)
  }

  return groups.length > 1 ? groups : []
}

/**
 * Integer measures-per-system from per-system weights (largest-remainder method).
 * Every system gets ≥1 measure when measures ≥ systems; otherwise the first
 * `total` systems get one each. Falls back to even weighting when no usable
 * widths are supplied.
 */
export function computeWeightedMeasureCounts(weights, total) {
  const n = weights.length
  if (n === 0 || total <= 0) {
    return new Array(n).fill(0)
  }
  if (total <= n) {
    return weights.map((_, index) => (index < total ? 1 : 0))
  }

  const safeWeights = weights.map((weight) => {
    const value = Number(weight)
    return Number.isFinite(value) && value > 0 ? value : 0
  })
  const positiveSum = safeWeights.reduce((sum, weight) => sum + weight, 0)
  // No usable widths → even weighting.
  const effective = positiveSum > 0 ? safeWeights : weights.map(() => 1)
  const effectiveSum = positiveSum > 0 ? positiveSum : n

  const remaining = total - n
  const ideal = effective.map((weight) => (weight / effectiveSum) * remaining)
  const extra = ideal.map((value) => Math.floor(value))
  let assignedExtra = extra.reduce((sum, value) => sum + value, 0)

  const byRemainder = ideal
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac)

  let cursor = 0
  while (assignedExtra < remaining && byRemainder.length > 0) {
    extra[byRemainder[cursor % byRemainder.length].index] += 1
    assignedExtra += 1
    cursor += 1
  }

  return effective.map((_, index) => 1 + extra[index])
}

/**
 * Distribute measures across systems by visual system width (Stage 4), using
 * each entry's `inkWidth` as the weight. Equal/absent widths reduce to even
 * distribution, preserving prior behaviour.
 */
function allocateWeightedMeasureSpans(systemEntries, measureNumbers) {
  const weights = systemEntries.map((entry) => entry?.inkWidth)
  const counts = computeWeightedMeasureCounts(weights, measureNumbers.length)

  const spans = []
  let measureIndex = 0

  for (let systemIndex = 0; systemIndex < systemEntries.length; systemIndex += 1) {
    const measuresInSpan = counts[systemIndex]
    if (!measuresInSpan || measureIndex >= measureNumbers.length) {
      continue
    }
    const slice = measureNumbers.slice(measureIndex, measureIndex + measuresInSpan)
    measureIndex += slice.length
    if (slice.length === 0) {
      continue
    }

    spans.push({
      systemIndex,
      page: systemEntries[systemIndex].page,
      measureStart: slice[0],
      measureEnd: slice[slice.length - 1],
      measuresInSpan: slice.length,
      measureNumbers: slice,
    })
  }

  return spans
}

/**
 * Reconcile per-system measure counts (e.g. from barline detection) to an exact
 * total, preserving their shape. When the raw counts already sum to the total
 * they are returned unchanged; otherwise they are scaled proportionally and
 * rounded (largest-remainder) so the sum equals the total exactly.
 */
export function reconcileCountsToTotal(counts, total) {
  const n = counts.length
  if (n === 0 || total <= 0) {
    return new Array(n).fill(0)
  }
  const clean = counts.map((c) => {
    const value = Number(c)
    return Number.isFinite(value) && value > 0 ? value : 0
  })
  const rawTotal = clean.reduce((a, b) => a + b, 0)
  if (rawTotal === total && clean.every((c) => c >= 1)) {
    return clean
  }
  if (rawTotal <= 0) {
    return computeWeightedMeasureCounts(counts.map(() => 1), total)
  }
  if (total <= n) {
    return clean.map((_, i) => (i < total ? 1 : 0))
  }

  const scaled = clean.map((c) => (c / rawTotal) * total)
  const floored = scaled.map((v) => Math.max(1, Math.floor(v)))
  let assigned = floored.reduce((a, b) => a + b, 0)
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  let cursor = 0
  // Add measures to the largest fractional remainders until we hit the total.
  while (assigned < total && cursor < order.length * 4) {
    floored[order[cursor % order.length].i] += 1
    assigned += 1
    cursor += 1
  }
  // Remove from the smallest counts if we overshot (keeping every system ≥1).
  const removeOrder = floored
    .map((v, i) => ({ i, v }))
    .sort((a, b) => a.v - b.v)
  cursor = 0
  while (assigned > total && cursor < removeOrder.length * 4) {
    const idx = removeOrder[cursor % removeOrder.length].i
    if (floored[idx] > 1) {
      floored[idx] -= 1
      assigned -= 1
    }
    cursor += 1
  }
  return floored
}

/**
 * Build spans by assigning each system a fixed number of consecutive measures.
 * Used by the staff-line + barline detection path, where per-system measure
 * counts come from the PDF itself (not from MusicXML break hints).
 */
export function allocateSpansByCounts(systemEntries, measureNumbers, perSystemCounts) {
  const counts = reconcileCountsToTotal(perSystemCounts, measureNumbers.length)
  const spans = []
  let measureIndex = 0
  for (let systemIndex = 0; systemIndex < systemEntries.length; systemIndex += 1) {
    const take = counts[systemIndex]
    if (!take || measureIndex >= measureNumbers.length) {
      continue
    }
    const slice = measureNumbers.slice(measureIndex, measureIndex + take)
    measureIndex += slice.length
    if (slice.length === 0) {
      continue
    }
    spans.push({
      systemIndex,
      page: systemEntries[systemIndex].page,
      measureStart: slice[0],
      measureEnd: slice[slice.length - 1],
      measuresInSpan: slice.length,
      measureNumbers: slice,
    })
  }
  return spans
}

/**
 * Group systems + spans for overlay rendering per page.
 */
export function buildSystemsByPage(systemEntries, spans) {
  const byPage = new Map()

  spans.forEach((span, index) => {
    const entry = systemEntries[index]
    if (!entry) {
      return
    }
    const page = entry.page
    const list = byPage.get(page) ?? []
    list.push({
      id: `p${page}-s${index}`,
      y0: entry.system.y0,
      y1: entry.system.y1,
      x0: entry.contentBounds.x0,
      x1: entry.contentBounds.x1,
      measureStart: span.measureStart,
      measureEnd: span.measureEnd,
      measuresInSpan: span.measuresInSpan,
      label:
        span.measureStart === span.measureEnd
          ? `M${span.measureStart}`
          : `M${span.measureStart}–${span.measureEnd}`,
    })
    byPage.set(page, list)
  })

  return Object.fromEntries(byPage)
}
