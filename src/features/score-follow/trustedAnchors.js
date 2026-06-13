import {
  ANCHOR_SOURCE,
  anchorPriority,
  isManualAnchorSource,
} from './anchorUtils.js'

/**
 * Anchors that may drive the visible cursor.
 *
 * AUTO_SYSTEM anchors (system-start/end pairs from the PDF pixel analyser) are
 * now included so that a user who uploads PDF + MusicXML gets an approximate
 * cursor immediately after auto-setup, without needing manual measure markers.
 * The cursor will be less precise than manually-marked anchors but is far
 * better than no cursor at all.
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
    // Auto-detected system anchors: approximate but useful for uploaded scores.
    if (source === ANCHOR_SOURCE.AUTO_SYSTEM || source === ANCHOR_SOURCE.AUTO) {
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
