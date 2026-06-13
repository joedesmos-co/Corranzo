/**
 * Convert user-marked system-start positions into AUTO_SYSTEM anchors.
 *
 * When PDF pixel analysis fails to detect staff systems automatically, the
 * user can tap the start of each visible grand-staff system instead. This
 * function takes those tapped positions and the MusicXML timing map and
 * produces system-start + system-end anchor pairs that the cursor resolver
 * can use to show an approximate moving cursor.
 *
 * The resulting anchors have source AUTO_SYSTEM so they:
 *   - pass filterTrustedAnchors
 *   - satisfy assessScoreFollowTrust (≥2 anchors → AUTO level, showCursor: true)
 *   - are overridden by any subsequent manual measure markers
 */
import { ANCHOR_SOURCE } from './anchorUtils.js'
import { createAnchorId } from './scoreFollowStorage.js'
import { groupMeasuresBySystemBreaks } from './allocateMeasuresToSystems.js'

/**
 * Estimated x of the right edge of a typical engraved score system.
 * Most PDFs end staves at 85–92 % of page width; 0.88 is a safe middle.
 */
const DEFAULT_SYSTEM_END_X = 0.88

/**
 * Evenly distribute measure numbers across `count` systems.
 * Returns an array of measure-number arrays, one per system.
 */
function evenDistribute(measureNumbers, count) {
  const groups = []
  const total = measureNumbers.length
  let start = 0
  for (let i = 0; i < count; i += 1) {
    const remaining = total - start
    const systemsLeft = count - i
    const size = Math.max(1, Math.ceil(remaining / systemsLeft))
    groups.push(measureNumbers.slice(start, start + size))
    start += size
    if (start >= total) {
      break
    }
  }
  return groups
}

/**
 * Build AUTO_SYSTEM anchors from user-tapped system-start positions.
 *
 * @param {Array<{id: string, page: number, x: number, y: number}>} systemStarts
 *   One entry per grand-staff system in reading order, from the user's taps.
 * @param {object} timingMap  MusicXML timing map (`measures[]`, optional `systemBreakBefore`).
 * @returns {Array<object>}  Sorted anchor array suitable for `setAutoAnchors()`.
 */
export function buildAnchorsFromSystemStarts(systemStarts, timingMap) {
  if (!systemStarts?.length || !timingMap?.measures?.length) {
    return []
  }

  // Sort tapped marks into reading order (page asc, then y asc on each page).
  const sorted = [...systemStarts].sort((a, b) =>
    a.page !== b.page ? a.page - b.page : a.y - b.y,
  )

  const measureNumbers = timingMap.measures.map((m) => m.number)

  // Prefer MusicXML system breaks for measure allocation; fall back to even
  // distribution when breaks are absent or outnumber the user's marks.
  let groups = groupMeasuresBySystemBreaks(measureNumbers, timingMap)
  if (groups.length < 2 || groups.length < sorted.length) {
    groups = evenDistribute(measureNumbers, sorted.length)
  }

  const anchors = []

  for (let i = 0; i < sorted.length; i += 1) {
    const mark = sorted[i]
    const group = groups[i]
    if (!group?.length) {
      continue
    }

    const measureStart = group[0]
    const measureEnd = group[group.length - 1]

    // System-start anchor: placed at the user-tapped position.
    anchors.push({
      id: createAnchorId(),
      page: mark.page,
      x: mark.x,
      y: mark.y,
      measureNumber: measureStart,
      source: ANCHOR_SOURCE.AUTO_SYSTEM,
      meta: {
        role: 'system-start',
        systemIndex: i,
        measuresInSpan: group.length,
        fromSystemStartFallback: true,
      },
    })

    // System-end anchor: estimated right edge of the same system.
    // Used by the cursor resolver for x-interpolation across the system.
    if (measureEnd !== measureStart) {
      anchors.push({
        id: createAnchorId(),
        page: mark.page,
        x: DEFAULT_SYSTEM_END_X,
        y: mark.y,
        measureNumber: measureEnd,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
        meta: {
          role: 'system-end',
          systemIndex: i,
          measuresInSpan: group.length,
          fromSystemStartFallback: true,
        },
      })
    }
  }

  return anchors.sort((a, b) => a.measureNumber - b.measureNumber)
}
