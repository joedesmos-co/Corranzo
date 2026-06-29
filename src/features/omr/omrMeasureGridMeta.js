export const OMR_MEASURE_GRID_SCHEMA_VERSION = 1

function finite(value) {
  return Number.isFinite(Number(value))
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value)))
}

function rounded(value) {
  return Math.round(value * 10000) / 10000
}

function cleanNormalized(value) {
  return rounded(clamp01(value))
}

function clampBetween(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)))
}

export function serializeOmrMeasureBox(box, { confidence = null, source = null } = {}) {
  if (!box || !finite(box.page) || !finite(box.measureNumber)) {
    return null
  }

  const measureStartX = cleanNormalized(box.x0)
  const xEnd = cleanNormalized(box.x1)
  const yTop = cleanNormalized(box.y0)
  const yBottom = cleanNormalized(box.y1)
  if (!(xEnd > measureStartX) || !(yBottom > yTop)) {
    return null
  }

  const playableRaw = finite(box.playableX0) ? Number(box.playableX0) : measureStartX
  const playableStartX = rounded(clampBetween(playableRaw, measureStartX, xEnd))
  const entry = {
    page: Number(box.page),
    systemIndex: finite(box.systemIndex) ? Number(box.systemIndex) : 0,
    measureIndex: finite(box.measureIndex) ? Number(box.measureIndex) : null,
    measureNumber: Number(box.measureNumber),
    xStart: measureStartX,
    xEnd,
    yTop,
    yBottom,
    measureStartX,
    playableStartX,
    playableEndX: xEnd,
  }

  if (finite(box.rawMeasureXStart)) {
    entry.rawMeasureXStart = cleanNormalized(box.rawMeasureXStart)
  }
  if (finite(box.rawMeasureXEnd)) {
    entry.rawMeasureXEnd = cleanNormalized(box.rawMeasureXEnd)
  }
  if (finite(box.firstNoteX)) {
    entry.firstNoteX = cleanNormalized(box.firstNoteX)
  }
  if (finite(box.lastNoteX)) {
    entry.lastNoteX = cleanNormalized(box.lastNoteX)
  }
  if (finite(box.visualMeasureStartX)) {
    entry.visualMeasureStartX = cleanNormalized(box.visualMeasureStartX)
  }
  if (finite(box.visualMeasureEndX)) {
    entry.visualMeasureEndX = cleanNormalized(box.visualMeasureEndX)
  }
  if (Array.isArray(box.noteXPositions)) {
    entry.noteXPositions = box.noteXPositions
      .map((value) => cleanNormalized(value))
      .filter((value) => finite(value))
  }

  if (finite(confidence)) {
    entry.confidence = Math.min(1, Math.max(0, Number(confidence)))
  }
  if (source) {
    entry.source = String(source)
  }

  return entry
}

function normalizeGridEntry(entry) {
  if (!entry || !finite(entry.page) || !finite(entry.measureNumber)) {
    return null
  }

  const measureStartX = cleanNormalized(
    finite(entry.measureStartX) ? entry.measureStartX : entry.xStart,
  )
  const rawMeasureXStart = finite(entry.rawMeasureXStart)
    ? cleanNormalized(entry.rawMeasureXStart)
    : measureStartX
  const rawMeasureXEnd = finite(entry.rawMeasureXEnd)
    ? cleanNormalized(entry.rawMeasureXEnd)
    : finite(entry.xEnd)
      ? cleanNormalized(entry.xEnd)
      : finite(entry.playableEndX)
        ? cleanNormalized(entry.playableEndX)
        : null
  const yTop = cleanNormalized(finite(entry.yTop) ? entry.yTop : entry.y0)
  const yBottom = cleanNormalized(finite(entry.yBottom) ? entry.yBottom : entry.y1)
  if (!finite(rawMeasureXEnd) || !(rawMeasureXEnd > rawMeasureXStart) || !(yBottom > yTop)) {
    return null
  }

  const playableRaw = finite(entry.playableStartX)
    ? entry.playableStartX
    : finite(entry.playableX0)
      ? entry.playableX0
      : rawMeasureXStart
  const legacyPlayableStartX = rounded(
    clampBetween(playableRaw, rawMeasureXStart, rawMeasureXEnd),
  )
  const visualMeasureStartX = finite(entry.visualMeasureStartX)
    ? cleanNormalized(entry.visualMeasureStartX)
    : legacyPlayableStartX
  const visualMeasureEndX = finite(entry.visualMeasureEndX)
    ? cleanNormalized(entry.visualMeasureEndX)
    : rawMeasureXEnd

  return {
    page: Number(entry.page),
    systemIndex: finite(entry.systemIndex) ? Number(entry.systemIndex) : 0,
    measureIndex: finite(entry.measureIndex) ? Number(entry.measureIndex) : null,
    measureNumber: Number(entry.measureNumber),
    xStart: rawMeasureXStart,
    xEnd: rawMeasureXEnd,
    yTop,
    yBottom,
    measureStartX: rawMeasureXStart,
    playableStartX: visualMeasureStartX,
    playableEndX: visualMeasureEndX,
    rawMeasureXStart,
    rawMeasureXEnd,
    visualMeasureStartX,
    visualMeasureEndX,
    ...(finite(entry.firstNoteX) ? { firstNoteX: cleanNormalized(entry.firstNoteX) } : {}),
    ...(finite(entry.lastNoteX) ? { lastNoteX: cleanNormalized(entry.lastNoteX) } : {}),
    ...(Array.isArray(entry.noteXPositions)
      ? {
          noteXPositions: entry.noteXPositions
            .map((value) => cleanNormalized(value))
            .filter((value) => finite(value)),
        }
      : {}),
    ...(finite(entry.confidence)
      ? { confidence: Math.min(1, Math.max(0, Number(entry.confidence))) }
      : {}),
    ...(entry.source ? { source: String(entry.source) } : {}),
  }
}

export function normalizeOmrMeasureGridMetadata(value) {
  const rawMeasures = Array.isArray(value) ? value : value?.measures
  if (!Array.isArray(rawMeasures)) {
    return null
  }

  const measures = rawMeasures
    .map(normalizeGridEntry)
    .filter(Boolean)
    .sort((left, right) => left.measureNumber - right.measureNumber)

  if (!measures.length) {
    return null
  }

  return {
    schemaVersion: OMR_MEASURE_GRID_SCHEMA_VERSION,
    source:
      typeof value?.source === 'string' && value.source.trim()
        ? value.source
        : measures.find((entry) => entry.source)?.source ?? 'omr',
    measureCount: measures.length,
    measures,
  }
}

export function buildOmrMeasureGridMetadata(measures, { source = 'omr' } = {}) {
  return normalizeOmrMeasureGridMetadata({
    schemaVersion: OMR_MEASURE_GRID_SCHEMA_VERSION,
    source,
    measures,
  })
}
