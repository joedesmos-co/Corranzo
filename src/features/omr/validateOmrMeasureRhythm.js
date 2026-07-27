import { OMR_DURATION_DIVISIONS, OMR_MEASURE_DIVISIONS } from './omrRhythmConstants.js'

function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (a.startDivision !== b.startDivision) {
      return a.startDivision - b.startDivision
    }
    return (a.cx ?? 0) - (b.cx ?? 0)
  })
}

function buildRestEvent(startDivision, durationDivisions) {
  return {
    type: 'rest',
    startDivision,
    durationDivisions,
    durationType:
      durationDivisions <= 1
        ? 'sixteenth'
        : durationDivisions === 2
          ? 'eighth'
          : durationDivisions >= 16
            ? 'whole'
            : durationDivisions >= 8
              ? 'half'
              : 'quarter',
    confidence: 0.5,
    uncertain: true,
    source: 'measure-balancing',
  }
}

/**
 * Validate rhythmic events against a 4/4 measure grid.
 *
 * By default does NOT invent rests to fill gaps — phantom balancing rests were
 * the dominant extra-rest source on scan PDFs with no rest glyphs. Pass
 * `inventRests: true` only for explicit legacy/test padding.
 */
export function validateAndNormalizeMeasureRhythm(events, { inventRests = false } = {}) {
  const sorted = sortEvents(events)
  const normalized = []
  let cursor = 0
  let overlap = false

  for (const event of sorted) {
    const start = Math.max(0, Math.min(OMR_MEASURE_DIVISIONS - 1, event.startDivision ?? 0))
    const duration = Math.max(1, event.durationDivisions ?? OMR_DURATION_DIVISIONS.quarter)

    if (start > cursor) {
      if (inventRests) {
        normalized.push(buildRestEvent(cursor, start - cursor))
      }
      cursor = start
    }
    if (start < cursor) {
      overlap = true
      continue
    }

    const clippedDuration = Math.min(duration, OMR_MEASURE_DIVISIONS - cursor)
    if (clippedDuration <= 0) {
      overlap = true
      continue
    }

    normalized.push({
      ...event,
      startDivision: cursor,
      durationDivisions: clippedDuration,
    })
    cursor += clippedDuration
  }

  const gapDivisions = OMR_MEASURE_DIVISIONS - cursor
  if (gapDivisions > 0 && inventRests) {
    normalized.push(buildRestEvent(cursor, gapDivisions))
  }

  const totalDivisions = normalized.reduce(
    (sum, event) => sum + event.durationDivisions,
    0,
  )

  return {
    valid: totalDivisions === OMR_MEASURE_DIVISIONS && !overlap,
    normalizedEvents: normalized,
    totalDivisions,
    expectedDivisions: OMR_MEASURE_DIVISIONS,
    gapDivisions: Math.max(0, gapDivisions),
    overfill: overlap || totalDivisions > OMR_MEASURE_DIVISIONS,
    uncertain: overlap || gapDivisions > 0,
    inventedRests: inventRests,
  }
}
