/** Padding before the first note / after the last note as a fraction of measure width. */
export const OMR_VISUAL_NOTE_PADDING_FRAC = 0.012
/** Absolute cap on visual padding in normalized page coordinates. */
export const OMR_VISUAL_NOTE_PADDING_MAX = 0.015

function finite(value) {
  return value != null && Number.isFinite(Number(value))
}

function clampBetween(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)))
}

function rounded(value) {
  return Math.round(value * 10000) / 10000
}

function normalizedX(value, imageWidth) {
  if (finite(value) && value >= 0 && value <= 1) {
    return Number(value)
  }
  if (finite(value) && finite(imageWidth) && imageWidth > 0) {
    return Number(value) / imageWidth
  }
  return null
}

/**
 * Collect normalized x positions for every note/rest event in a measure.
 */
export function collectOmrEventXPositions(events, imageWidth) {
  const positions = []
  const push = (value) => {
    const x = normalizedX(value, imageWidth)
    if (finite(x)) {
      positions.push(x)
    }
  }

  for (const event of events ?? []) {
    push(event.xNorm)
    push(event.cx)
    if (Array.isArray(event.notes)) {
      for (const note of event.notes) {
        push(note.xNorm)
        push(note.cx)
      }
    }
  }

  return [...new Set(positions.map((x) => rounded(x)))].sort((left, right) => left - right)
}

/**
 * Derive cursor-friendly measure extents from detected note/rest columns.
 * Falls back to the barline measure box when no playable ink is available.
 */
export function computeOmrMeasureVisualExtents({
  measureBox,
  events = [],
  imageWidth = null,
} = {}) {
  const rawMeasureXStart = finite(measureBox?.x0) ? Number(measureBox.x0) : null
  const rawMeasureXEnd = finite(measureBox?.x1) ? Number(measureBox.x1) : null
  const fallbackStart = finite(measureBox?.playableX0)
    ? Number(measureBox.playableX0)
    : rawMeasureXStart
  const fallbackEnd = rawMeasureXEnd

  if (!finite(rawMeasureXStart) || !finite(rawMeasureXEnd) || !(rawMeasureXEnd > rawMeasureXStart)) {
    return {
      rawMeasureXStart: fallbackStart,
      rawMeasureXEnd: fallbackEnd,
      firstNoteX: null,
      lastNoteX: null,
      visualMeasureStartX: fallbackStart,
      visualMeasureEndX: fallbackEnd,
      noteXPositions: [],
    }
  }

  const noteXPositions = collectOmrEventXPositions(events, imageWidth)
  if (!noteXPositions.length) {
    const visualMeasureStartX = rounded(
      clampBetween(fallbackStart ?? rawMeasureXStart, rawMeasureXStart, rawMeasureXEnd),
    )
    const visualMeasureEndX = rounded(
      clampBetween(fallbackEnd ?? rawMeasureXEnd, visualMeasureStartX, rawMeasureXEnd),
    )
    return {
      rawMeasureXStart: rounded(rawMeasureXStart),
      rawMeasureXEnd: rounded(rawMeasureXEnd),
      firstNoteX: null,
      lastNoteX: null,
      visualMeasureStartX,
      visualMeasureEndX,
      noteXPositions,
    }
  }

  const firstNoteX = noteXPositions[0]
  const lastNoteX = noteXPositions[noteXPositions.length - 1]
  const measureWidth = rawMeasureXEnd - rawMeasureXStart
  const padding = Math.min(
    OMR_VISUAL_NOTE_PADDING_MAX,
    measureWidth * OMR_VISUAL_NOTE_PADDING_FRAC,
  )

  let visualMeasureStartX = rounded(
    clampBetween(firstNoteX - padding, rawMeasureXStart, rawMeasureXEnd),
  )
  let visualMeasureEndX = rounded(
    clampBetween(lastNoteX + padding, visualMeasureStartX, rawMeasureXEnd),
  )

  if (!(visualMeasureEndX > visualMeasureStartX)) {
    visualMeasureEndX = rounded(
      clampBetween(
        visualMeasureStartX + Math.max(measureWidth * 0.2, padding * 2),
        visualMeasureStartX,
        rawMeasureXEnd,
      ),
    )
  }

  return {
    rawMeasureXStart: rounded(rawMeasureXStart),
    rawMeasureXEnd: rounded(rawMeasureXEnd),
    firstNoteX: rounded(firstNoteX),
    lastNoteX: rounded(lastNoteX),
    visualMeasureStartX,
    visualMeasureEndX,
    noteXPositions,
  }
}
