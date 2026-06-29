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
    durationType: durationDivisions === 2 ? 'eighth' : 'quarter',
    confidence: 0.5,
    uncertain: true,
  }
}

/**
 * Validate that rhythmic events fill a 4/4 measure; pad gaps with rests when safe.
 */
export function validateAndNormalizeMeasureRhythm(events) {
  const sorted = sortEvents(events)
  const normalized = []
  let cursor = 0
  let overlap = false

  for (const event of sorted) {
    const start = Math.max(0, Math.min(OMR_MEASURE_DIVISIONS - 1, event.startDivision ?? 0))
    const duration = Math.max(1, event.durationDivisions ?? OMR_DURATION_DIVISIONS.quarter)

    if (start > cursor) {
      normalized.push(buildRestEvent(cursor, start - cursor))
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
  if (gapDivisions > 0) {
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
  }
}
