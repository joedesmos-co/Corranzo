const NEARBY_AUTO_DISTANCE = 0.07

export const ANCHOR_SOURCE = {
  MANUAL: 'manual',
  /** @deprecated Use AUTO_SYSTEM — kept for persisted anchors. */
  AUTO: 'auto',
  AUTO_SYSTEM: 'auto-system',
  AUTO_MEASURE: 'auto-measure',
  DEMO: 'demo',
  MUSICXML_LAYOUT: 'musicxml-layout',
}

const AUTOMATIC_SOURCES = new Set([
  ANCHOR_SOURCE.AUTO,
  ANCHOR_SOURCE.AUTO_SYSTEM,
  ANCHOR_SOURCE.AUTO_MEASURE,
  ANCHOR_SOURCE.DEMO,
  ANCHOR_SOURCE.MUSICXML_LAYOUT,
])

export function isAutomaticAnchorSource(source) {
  return AUTOMATIC_SOURCES.has(source)
}

export function isManualAnchorSource(source) {
  return source === ANCHOR_SOURCE.MANUAL
}

export function normalizeAnchorSource(anchor) {
  const source = anchor?.source
  if (source === ANCHOR_SOURCE.MANUAL) {
    return ANCHOR_SOURCE.MANUAL
  }
  if (source === ANCHOR_SOURCE.DEMO) {
    return ANCHOR_SOURCE.DEMO
  }
  if (source === ANCHOR_SOURCE.MUSICXML_LAYOUT) {
    return ANCHOR_SOURCE.MUSICXML_LAYOUT
  }
  if (source === ANCHOR_SOURCE.AUTO_MEASURE) {
    return ANCHOR_SOURCE.AUTO_MEASURE
  }
  if (
    source === ANCHOR_SOURCE.AUTO_SYSTEM ||
    source === ANCHOR_SOURCE.AUTO ||
    anchor?.meta?.role === 'system-start' ||
    anchor?.meta?.role === 'system-end'
  ) {
    return ANCHOR_SOURCE.AUTO_SYSTEM
  }
  return ANCHOR_SOURCE.MANUAL
}

/**
 * Remove automatic anchors replaced by a manual placement (same measure or nearby on same page).
 */
export function filterAutoAnchorsReplacedByManual(anchors, { page, x, y, measureNumber }) {
  return anchors.filter((anchor) => {
    if (!isAutomaticAnchorSource(anchor.source)) {
      return true
    }
    if (anchor.measureNumber === measureNumber) {
      return false
    }
    if (
      anchor.page === page &&
      Math.hypot(anchor.x - x, anchor.y - y) < NEARBY_AUTO_DISTANCE
    ) {
      return false
    }
    return true
  })
}

/**
 * Merge automatic anchors; manual anchors on the same measure win.
 */
export function mergeAutomaticAnchors(anchorGroups) {
  const manualMeasures = new Set()
  const merged = []

  for (const group of anchorGroups) {
    for (const anchor of group) {
      if (isManualAnchorSource(anchor.source)) {
        manualMeasures.add(anchor.measureNumber)
        merged.push(anchor)
      }
    }
  }

  const byMeasure = new Map()

  for (const group of anchorGroups) {
    for (const anchor of group) {
      if (isManualAnchorSource(anchor.source)) {
        continue
      }
      if (manualMeasures.has(anchor.measureNumber)) {
        continue
      }
      const existing = byMeasure.get(anchor.measureNumber)
      if (!existing || anchorPriority(anchor) > anchorPriority(existing)) {
        byMeasure.set(anchor.measureNumber, anchor)
      }
    }
  }

  merged.push(...byMeasure.values())
  return merged.sort((left, right) => left.measureNumber - right.measureNumber)
}

/** Higher wins when two automatic anchors share a measure. Manual always wins via mergeAutomaticAnchors. */
export function anchorPriority(anchor) {
  switch (anchor.source) {
    case ANCHOR_SOURCE.MANUAL:
      return 100
    case ANCHOR_SOURCE.DEMO:
      return 50
    case ANCHOR_SOURCE.MUSICXML_LAYOUT:
      return 40
    case ANCHOR_SOURCE.AUTO_MEASURE:
      return 35
    case ANCHOR_SOURCE.AUTO_SYSTEM:
    case ANCHOR_SOURCE.AUTO:
      return 20
    default:
      return 10
  }
}

export function countAnchorsBySource(anchors) {
  let manual = 0
  let autoSystem = 0
  let autoMeasure = 0
  let demo = 0
  let musicxmlLayout = 0

  for (const anchor of anchors) {
    const source = anchor.source ?? normalizeAnchorSource(anchor)
    if (source === ANCHOR_SOURCE.MANUAL) {
      manual += 1
    } else if (source === ANCHOR_SOURCE.DEMO) {
      demo += 1
    } else if (source === ANCHOR_SOURCE.MUSICXML_LAYOUT) {
      musicxmlLayout += 1
    } else if (source === ANCHOR_SOURCE.AUTO_MEASURE) {
      autoMeasure += 1
    } else if (source === ANCHOR_SOURCE.AUTO_SYSTEM || source === ANCHOR_SOURCE.AUTO) {
      autoSystem += 1
    } else {
      manual += 1
    }
  }

  return {
    manual,
    auto: autoSystem + autoMeasure,
    autoSystem,
    autoMeasure,
    demo,
    musicxmlLayout,
  }
}
