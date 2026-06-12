import { MAX_SYSTEMS_PER_PAGE } from './detectStaffSystems.js'

const MAX_ANCHORS_VS_MEASURES_RATIO = 0.45
const MIN_ANCHORS_FOR_LONG_SCORE = 2
const LONG_SCORE_MEASURE_THRESHOLD = 12
const SAME_ROW_Y_TOLERANCE = 0.018
const MAX_MARKERS_ON_SAME_ROW = 2

function findSystemForAnchor(anchor, systemEntries) {
  return systemEntries.find(
    (entry) =>
      entry.page === anchor.page &&
      anchor.y >= entry.system.y0 - 0.015 &&
      anchor.y <= entry.system.y1 + 0.015,
  )
}

/**
 * Reject misleading marker layouts before showing them to the user.
 */
export function validateAutoAlignResult({
  anchors,
  systemEntries,
  measureCount,
  mode = 'system-start',
}) {
  if (!anchors.length || !systemEntries.length) {
    return {
      ok: false,
      reason: 'No staff systems were detected reliably enough to place markers.',
    }
  }

  if (mode === 'system-span') {
    if (anchors.length < systemEntries.length) {
      return {
        ok: false,
        reason: 'Not every detected staff system received markers.',
      }
    }
    if (anchors.length > systemEntries.length * 2) {
      return {
        ok: false,
        reason: 'Too many markers for the detected staff systems.',
      }
    }
  } else if (anchors.length !== systemEntries.length) {
    return {
      ok: false,
      reason: 'Marker layout did not match detected staff systems.',
    }
  }

  if (measureCount > LONG_SCORE_MEASURE_THRESHOLD && anchors.length < MIN_ANCHORS_FOR_LONG_SCORE) {
    return {
      ok: false,
      reason: 'Too few staff systems were found for the length of this piece.',
    }
  }

  if (anchors.length > measureCount) {
    return {
      ok: false,
      reason: 'More markers were generated than measures in the score.',
    }
  }

  const anchorRatio = anchors.length / measureCount
  if (anchorRatio > MAX_ANCHORS_VS_MEASURES_RATIO) {
    return {
      ok: false,
      reason: 'Too many markers would be placed for reliable alignment.',
    }
  }

  const firstStaffY0 = Math.min(...systemEntries.map((entry) => entry.system.y0))
  for (const anchor of anchors) {
    if (anchor.y < firstStaffY0 - 0.01) {
      return {
        ok: false,
        reason: 'Markers would appear above the first staff system.',
      }
    }

    const entry = findSystemForAnchor(anchor, systemEntries)
    if (!entry) {
      return {
        ok: false,
        reason: 'Markers were not aligned to detected staff systems.',
      }
    }

    if (anchor.y < entry.system.y0 - 0.02 || anchor.y > entry.system.y1 + 0.02) {
      return {
        ok: false,
        reason: 'Markers would sit outside staff system bounds.',
      }
    }
  }

  const perPage = new Map()
  for (const anchor of anchors) {
    const list = perPage.get(anchor.page) ?? []
    list.push(anchor)
    perPage.set(anchor.page, list)
  }

  for (const [page, pageAnchors] of perPage) {
    if (pageAnchors.length > MAX_SYSTEMS_PER_PAGE) {
      return {
        ok: false,
        reason: `Too many staff systems detected on page ${page}.`,
      }
    }

    const rowBuckets = new Map()
    for (const anchor of pageAnchors) {
      const key = Math.round(anchor.y / SAME_ROW_Y_TOLERANCE)
      rowBuckets.set(key, (rowBuckets.get(key) ?? 0) + 1)
    }
    if (mode === 'system-span') {
      const rowAnchors = new Map()
      for (const anchor of pageAnchors) {
        const key = Math.round(anchor.y / SAME_ROW_Y_TOLERANCE)
        const bucket = rowAnchors.get(key) ?? []
        bucket.push(anchor)
        rowAnchors.set(key, bucket)
      }
      for (const bucket of rowAnchors.values()) {
        if (bucket.length > MAX_SYSTEMS_PER_PAGE * 2) {
          return {
            ok: false,
            reason: 'Too many markers on one staff line.',
          }
        }
        if (bucket.length > 2) {
          const xs = bucket.map((anchor) => anchor.x).sort((a, b) => a - b)
          const minSpread = xs[xs.length - 1] - xs[0]
          if (minSpread < 0.2) {
            return {
              ok: false,
              reason: 'Markers would form a misleading row instead of staff spans.',
            }
          }
        }
      }
    } else {
      for (const count of rowBuckets.values()) {
        if (count > MAX_MARKERS_ON_SAME_ROW) {
          return {
            ok: false,
            reason: 'Markers would form a misleading row instead of measure starts.',
          }
        }
      }
    }
  }

  if (
    (mode === 'system-start' || mode === 'system-span') &&
    systemEntries.length < 2 &&
    measureCount > 8
  ) {
    return {
      ok: false,
      reason: 'Not enough staff systems were detected to align this score.',
    }
  }

  return { ok: true }
}
