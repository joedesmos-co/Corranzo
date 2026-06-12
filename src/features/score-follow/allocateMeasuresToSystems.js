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
    return allocateEvenMeasureSpans(systemEntries, measureNumbers)
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

function allocateEvenMeasureSpans(systemEntries, measureNumbers) {
  const spans = []
  let measureIndex = 0

  for (let systemIndex = 0; systemIndex < systemEntries.length; systemIndex += 1) {
    if (measureIndex >= measureNumbers.length) {
      break
    }

    const remainingMeasures = measureNumbers.length - measureIndex
    const remainingSystems = systemEntries.length - systemIndex
    const measuresInSpan = Math.max(1, Math.ceil(remainingMeasures / remainingSystems))
    const slice = measureNumbers.slice(measureIndex, measureIndex + measuresInSpan)
    measureIndex += measuresInSpan

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
