import {
  ANCHOR_SOURCE,
  anchorPriority,
  isManualAnchorSource,
} from './anchorUtils.js'

/**
 * Anchors that may drive the visible cursor (never auto-system PDF guesses).
 */
export function filterTrustedAnchors(anchors) {
  if (!anchors?.length) {
    return []
  }

  return anchors.filter((anchor) => {
    const source = anchor.source
    if (source === ANCHOR_SOURCE.DEMO) {
      return true
    }
    if (isManualAnchorSource(source)) {
      return true
    }
    if (source === ANCHOR_SOURCE.MUSICXML_LAYOUT) {
      return true
    }
    return false
  })
}

/** One anchor per measure — highest priority source wins. */
export function dedupeTrustedAnchorsByMeasure(anchors) {
  const byMeasure = new Map()

  for (const anchor of anchors) {
    const measureNumber = Number(anchor.measureNumber)
    if (!Number.isFinite(measureNumber)) {
      continue
    }
    const existing = byMeasure.get(measureNumber)
    if (!existing || anchorPriority(anchor) > anchorPriority(existing)) {
      byMeasure.set(measureNumber, anchor)
    }
  }

  return [...byMeasure.values()].sort((left, right) => left.measureNumber - right.measureNumber)
}

/**
 * First written measure anchor only — no playback-time sort, no sorted[0] fallback.
 */
export function resolveFirstMeasureTrustedAnchor(trustedAnchors, timingMap) {
  const deduped = dedupeTrustedAnchorsByMeasure(trustedAnchors)
  const firstMeasureNumber = timingMap?.measures?.[0]?.number
  if (firstMeasureNumber == null) {
    return null
  }

  return deduped.find((anchor) => anchor.measureNumber === firstMeasureNumber) ?? null
}

export function resolveTrustedAnchorForMeasure(trustedAnchors, measureNumber) {
  const deduped = dedupeTrustedAnchorsByMeasure(trustedAnchors)
  return deduped.find((anchor) => anchor.measureNumber === measureNumber) ?? null
}
