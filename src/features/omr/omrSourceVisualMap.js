/**
 * Source-PDF visual provenance for playable OMR notes.
 *
 * All persisted geometry in this module is expressed in raw source-PDF page
 * space, normalized to the individual page (0..1, top-left origin). The PDF
 * overlay paints this geometry in its pre-transform page box; the existing CSS
 * page rotation then carries the highlight with the printed ink.
 */

export const OMR_SOURCE_VISUAL_MAP_SCHEMA_VERSION = 1
export const OMR_SOURCE_VISUAL_MAP_MAX_ANCHORS = 12_000
export const SOURCE_VISUAL_COORDINATE_SPACE = 'pdf-source-normalized'
export const SOURCE_VISUAL_REPRESENTATION = Object.freeze({
  NOTATION: 'notation',
  TAB: 'tab',
})

const anchorIndexCache = new WeakMap()

function finite(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value))
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value)))
}

function rounded(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000
}

function normalized(value) {
  return rounded(clamp01(value))
}

function median(values) {
  const sorted = values.filter(finite).map(Number).sort((left, right) => left - right)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function normalizedStaffGap(note) {
  if (finite(note?.noteheadAnchor?.localStaffGapNorm)) {
    return Number(note.noteheadAnchor.localStaffGapNorm)
  }
  const lineYs = note?.pitchMapping?.lineYs
  if (!Array.isArray(lineYs) || lineYs.length < 2) {
    return null
  }
  const sorted = [...lineYs].filter(finite).map(Number).sort((a, b) => a - b)
  return median(sorted.slice(1).map((value, index) => value - sorted[index]))
}

function pageDimensions(note) {
  let width = finite(note?.sourcePageWidth) ? Number(note.sourcePageWidth) : null
  let height = finite(note?.sourcePageHeight) ? Number(note.sourcePageHeight) : null

  if (!(width > 0) && finite(note?.cx) && finite(note?.xNorm) && Number(note.xNorm) !== 0) {
    width = Number(note.cx) / Number(note.xNorm)
  }
  const rawYNorm = note?.noteheadAnchor?.rawYNorm
  if (!(height > 0) && finite(note?.cy) && finite(rawYNorm) && Number(rawYNorm) !== 0) {
    height = Number(note.cy) / Number(rawYNorm)
  }
  return {
    width: width > 0 ? width : null,
    height: height > 0 ? height : null,
  }
}

function normalizeRect(rect) {
  if (!rect) return null
  const x0 = finite(rect.x0) ? Number(rect.x0) : finite(rect.left) ? Number(rect.left) : null
  const y0 = finite(rect.y0) ? Number(rect.y0) : finite(rect.top) ? Number(rect.top) : null
  const x1 = finite(rect.x1) ? Number(rect.x1) : finite(rect.right) ? Number(rect.right) : null
  const y1 = finite(rect.y1) ? Number(rect.y1) : finite(rect.bottom) ? Number(rect.bottom) : null
  if (![x0, y0, x1, y1].every(finite) || !(x1 > x0) || !(y1 > y0)) {
    return null
  }
  const normalizedX0 = normalized(x0)
  const normalizedY0 = normalized(y0)
  const normalizedX1 = normalized(x1)
  const normalizedY1 = normalized(y1)
  if (!(normalizedX1 > normalizedX0) || !(normalizedY1 > normalizedY0)) {
    return null
  }
  return {
    x0: normalizedX0,
    y0: normalizedY0,
    x1: normalizedX1,
    y1: normalizedY1,
    coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
  }
}

function rectFromPixelBounds(bounds, dimensions) {
  if (!bounds || !(dimensions?.width > 0) || !(dimensions?.height > 0)) {
    return null
  }
  const x = Number(bounds.x)
  const y = Number(bounds.y)
  const width = Number(bounds.width)
  const height = Number(bounds.height)
  if (![x, y, width, height].every(Number.isFinite) || !(width > 0) || !(height > 0)) {
    return null
  }
  return normalizeRect({
    x0: x / dimensions.width,
    y0: y / dimensions.height,
    x1: (x + width) / dimensions.width,
    y1: (y + height) / dimensions.height,
  })
}

function estimatedNoteheadRect(center, note, dimensions) {
  if (!center) return null
  const gapY = normalizedStaffGap(note) ?? 0.009
  const pageAspect =
    dimensions?.width > 0 && dimensions?.height > 0
      ? dimensions.height / dimensions.width
      : 1.35
  const halfHeight = Math.min(0.012, Math.max(0.0025, gapY * 0.34))
  const halfWidth = Math.min(0.016, Math.max(0.003, gapY * pageAspect * 0.48))
  return normalizeRect({
    x0: center.x - halfWidth,
    y0: center.y - halfHeight,
    x1: center.x + halfWidth,
    y1: center.y + halfHeight,
  })
}

function sourceCenterAndBox(note, representation = SOURCE_VISUAL_REPRESENTATION.NOTATION) {
  const dimensions = pageDimensions(note)
  const explicit = normalizeRect(note?.sourcePdfBBox ?? note?.sourceBBox)
  const inkBounds = rectFromPixelBounds(note?.noteheadAnchor?.visualBounds, dimensions)
  const sourceX = finite(note?.sourcePdfCenter?.x)
    ? Number(note.sourcePdfCenter.x)
    : finite(note?.xNorm)
    ? Number(note.xNorm)
    : finite(note?.cx) && dimensions.width
      ? Number(note.cx) / dimensions.width
      : null
  const rawVisualY =
    finite(note?.sourcePdfCenter?.y)
      ? Number(note.sourcePdfCenter.y)
      : representation === SOURCE_VISUAL_REPRESENTATION.TAB && finite(note?.yNorm)
      ? Number(note.yNorm)
      : finite(note?.noteheadAnchor?.yNorm)
        ? Number(note.noteheadAnchor.yNorm)
        : finite(note?.cy) && dimensions.height
          ? Number(note.cy) / dimensions.height
          : finite(note?.yNorm)
            ? Number(note.yNorm)
            : null

  const bestBox = explicit ?? inkBounds
  const center = bestBox
    ? {
        x: rounded((bestBox.x0 + bestBox.x1) / 2),
        y: rounded((bestBox.y0 + bestBox.y1) / 2),
        coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
      }
    : finite(sourceX) && finite(rawVisualY)
      ? {
          x: normalized(sourceX),
          y: normalized(rawVisualY),
          coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
        }
      : null
  if (!center) return null

  return {
    sourceCenter: center,
    sourceBBox: bestBox ?? estimatedNoteheadRect(center, note, dimensions),
    staffGap: finite(normalizedStaffGap(note)) ? rounded(normalizedStaffGap(note)) : null,
    geometrySource: explicit
      ? note?.sourcePdfBBox
        ? 'source-pdf-bbox'
        : 'source-bbox'
      : inkBounds
        ? 'ink-notehead-bbox'
        : representation === SOURCE_VISUAL_REPRESENTATION.TAB
          ? 'tab-token-center'
          : 'source-notehead-center',
  }
}

function geometryConfidence(note, geometry, representation) {
  const exactVectorGlyphOwnership =
    representation === SOURCE_VISUAL_REPRESENTATION.NOTATION &&
    (note?.source === 'vector-glyph' || note?.source === 'vector-glyph-orphan')

  if (exactVectorGlyphOwnership) {
    // The semantic note was created from this exact PDF glyph, so pitch and
    // rhythm confidence cannot make its visual ownership ambiguous. Preserve
    // the optical detector's confidence when it supplied ink/bounds. When only
    // the glyph-center fallback is available, retain the existing conservative
    // center-only ceiling rather than demoting exact ownership with semantic
    // confidence from an unrelated subsystem.
    const visualConfidence =
      geometry?.geometrySource === 'source-notehead-center'
        ? 0.78
        : finite(note?.noteheadAnchor?.confidence)
          ? Number(note.noteheadAnchor.confidence)
          : 0.78
    return rounded(Math.min(1, Math.max(0, visualConfidence)))
  }

  const candidates = [
    note?.confidence,
    note?.pitchConfidence,
    note?.noteheadAnchor?.confidence,
    representation === SOURCE_VISUAL_REPRESENTATION.TAB
      ? note?.notationTabPairConfidence
      : null,
  ].filter(finite).map(Number)
  let confidence = candidates.length ? Math.min(...candidates) : 0.72
  if (geometry?.geometrySource === 'source-notehead-center') confidence = Math.min(confidence, 0.78)
  if (geometry?.geometrySource === 'tab-token-center') confidence = Math.min(confidence, 0.82)
  return rounded(Math.min(1, Math.max(0, confidence)))
}

function normalizeRepresentation(value) {
  return value === SOURCE_VISUAL_REPRESENTATION.TAB
    ? SOURCE_VISUAL_REPRESENTATION.TAB
    : SOURCE_VISUAL_REPRESENTATION.NOTATION
}

function normalizeGeometryEntry(entry, fallbackRepresentation = null) {
  if (!entry) return null
  const sourceCenter = entry.sourceCenter
  if (!finite(sourceCenter?.x) || !finite(sourceCenter?.y)) return null
  const sourceBBox = normalizeRect(entry.sourceBBox)
  if (!sourceBBox) return null
  return {
    representation: normalizeRepresentation(entry.representation ?? fallbackRepresentation),
    sourceCenter: {
      x: normalized(sourceCenter.x),
      y: normalized(sourceCenter.y),
      coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
    },
    sourceBBox,
    confidence: finite(entry.confidence)
      ? rounded(Math.min(1, Math.max(0, Number(entry.confidence))))
      : 0.7,
    geometrySource: String(entry.geometrySource ?? 'source-notehead-center').slice(0, 80),
    staffGap: finite(entry.staffGap) ? rounded(entry.staffGap) : null,
  }
}

function normalizeAnchor(anchor) {
  if (!anchor?.sourceNoteheadId || !finite(anchor.page) || !finite(anchor.measureNumber)) {
    return null
  }
  const sourceNoteheadId = String(anchor.sourceNoteheadId)
  if (!sourceNoteheadId.startsWith('sfnh-') || sourceNoteheadId.length > 128) {
    return null
  }
  const geometry = normalizeGeometryEntry(anchor, anchor.representation)
  if (!geometry) return null
  const alternates = (Array.isArray(anchor.alternates) ? anchor.alternates.slice(0, 2) : [])
    .map((entry) => normalizeGeometryEntry(entry))
    .filter(Boolean)
    .filter((entry) => entry.representation !== geometry.representation)

  const sourceEventIds = [
    anchor.sourceEventId,
    ...(Array.isArray(anchor.sourceEventIds) ? anchor.sourceEventIds.slice(0, 16) : []),
  ]
    .filter(Boolean)
    .map(String)
    .filter((value) => value.length <= 160)

  return {
    sourceNoteheadId,
    sourceEventId: sourceEventIds[0] ?? null,
    sourceEventIds: [...new Set(sourceEventIds)],
    page: Math.max(1, Math.round(Number(anchor.page))),
    systemIndex: finite(anchor.systemIndex) ? Math.max(0, Math.round(Number(anchor.systemIndex))) : null,
    staffIndex: finite(anchor.staffIndex) ? Math.max(0, Math.round(Number(anchor.staffIndex))) : null,
    measureIndex: finite(anchor.measureIndex) ? Math.max(0, Math.round(Number(anchor.measureIndex))) : null,
    measureNumber: Math.round(Number(anchor.measureNumber)),
    midi: finite(anchor.midi) ? Math.round(Number(anchor.midi)) : null,
    voice: finite(anchor.voice) ? Math.max(1, Math.round(Number(anchor.voice))) : null,
    kind: anchor.kind === 'tab-fret' ? 'tab-fret' : 'notehead',
    representation: geometry.representation,
    sourceCenter: geometry.sourceCenter,
    sourceBBox: geometry.sourceBBox,
    confidence: geometry.confidence,
    geometrySource: geometry.geometrySource,
    staffGap: geometry.staffGap,
    alternates,
  }
}

export function normalizeOmrSourceVisualMap(value) {
  const rawAnchors = Array.isArray(value) ? value : value?.anchors
  if (
    !Array.isArray(rawAnchors) ||
    rawAnchors.length === 0 ||
    rawAnchors.length > OMR_SOURCE_VISUAL_MAP_MAX_ANCHORS
  ) {
    return null
  }
  const byId = new Map()
  const anchors = []
  for (const candidate of rawAnchors) {
    const anchor = normalizeAnchor(candidate)
    if (!anchor) continue
    const existing = byId.get(anchor.sourceNoteheadId)
    if (existing) {
      existing.sourceEventIds = [
        ...new Set([...existing.sourceEventIds, ...anchor.sourceEventIds]),
      ]
      continue
    }
    byId.set(anchor.sourceNoteheadId, anchor)
    anchors.push(anchor)
  }
  if (!anchors.length) return null
  return {
    schemaVersion: OMR_SOURCE_VISUAL_MAP_SCHEMA_VERSION,
    coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
    source: 'omr-source-ownership',
    anchorCount: anchors.length,
    anchors,
  }
}

function mapDeskewedPointToSource(point, { width, height, deskewAngle = 0 } = {}) {
  if (!finite(point?.x) || !finite(point?.y)) return null
  if (!(width > 0) || !(height > 0) || !finite(deskewAngle) || Number(deskewAngle) === 0) {
    return { x: normalized(point.x), y: normalized(point.y) }
  }
  const centerX = (width - 1) / 2
  const xPx = Number(point.x) * width
  const yPx = Number(point.y) * height
  const slope = Math.tan((Number(deskewAngle) * Math.PI) / 180)
  return {
    x: normalized(point.x),
    y: normalized((yPx + (xPx - centerX) * slope) / height),
  }
}

function mapDeskewedRectToSource(rect, transform) {
  const normalizedRect = normalizeRect(rect)
  if (!normalizedRect) return null
  const corners = [
    mapDeskewedPointToSource({ x: normalizedRect.x0, y: normalizedRect.y0 }, transform),
    mapDeskewedPointToSource({ x: normalizedRect.x1, y: normalizedRect.y0 }, transform),
    mapDeskewedPointToSource({ x: normalizedRect.x0, y: normalizedRect.y1 }, transform),
    mapDeskewedPointToSource({ x: normalizedRect.x1, y: normalizedRect.y1 }, transform),
  ].filter(Boolean)
  if (corners.length !== 4) return null
  return normalizeRect({
    x0: Math.min(...corners.map((point) => point.x)),
    y0: Math.min(...corners.map((point) => point.y)),
    x1: Math.max(...corners.map((point) => point.x)),
    y1: Math.max(...corners.map((point) => point.y)),
  })
}

function processedNoteCenter(note, representation = SOURCE_VISUAL_REPRESENTATION.NOTATION) {
  const dimensions = pageDimensions(note)
  const bounds = normalizeRect(note?.sourceBBox) ??
    rectFromPixelBounds(note?.noteheadAnchor?.visualBounds, dimensions)
  if (bounds) {
    return {
      x: (bounds.x0 + bounds.x1) / 2,
      y: (bounds.y0 + bounds.y1) / 2,
    }
  }
  const x = finite(note?.xNorm)
    ? Number(note.xNorm)
    : finite(note?.cx) && dimensions.width
      ? Number(note.cx) / dimensions.width
      : null
  const y =
    representation === SOURCE_VISUAL_REPRESENTATION.TAB && finite(note?.yNorm)
      ? Number(note.yNorm)
      : finite(note?.noteheadAnchor?.yNorm)
        ? Number(note.noteheadAnchor.yNorm)
        : finite(note?.cy) && dimensions.height
          ? Number(note.cy) / dimensions.height
          : finite(note?.yNorm)
            ? Number(note.yNorm)
            : null
  return finite(x) && finite(y) ? { x, y } : null
}

function restoreNoteGeometry(note, transform, representation) {
  if (!note) return
  const dimensions = pageDimensions(note)
  const processedBBox = normalizeRect(note.sourceBBox) ??
    rectFromPixelBounds(note?.noteheadAnchor?.visualBounds, dimensions)
  const center = processedNoteCenter(note, representation)
  const sourceCenter = mapDeskewedPointToSource(center, transform)
  if (sourceCenter) {
    note.sourcePdfCenter = sourceCenter
  }
  const sourceBBox = mapDeskewedRectToSource(processedBBox, transform)
  if (sourceBBox) {
    note.sourcePdfBBox = sourceBBox
  }
}

/**
 * Invert preprocessing deskew before source geometry leaves the page pipeline.
 * Contrast/denoise/staff recovery do not move coordinates; deskew is the only
 * geometric preprocessing operation and preserves page dimensions.
 */
export function restoreOmrSourcePdfGeometry(
  { measureRhythms = [], measureGrid = [] } = {},
  { width, height, deskewAngle = 0 } = {},
) {
  const transform = { width, height, deskewAngle }
  for (const measure of measureRhythms ?? []) {
    for (const event of measure.events ?? []) {
      for (const note of event.notes ?? []) {
        const representation = note?.sourceVisualKind === 'tab-fret'
          ? SOURCE_VISUAL_REPRESENTATION.TAB
          : SOURCE_VISUAL_REPRESENTATION.NOTATION
        restoreNoteGeometry(note, transform, representation)
        if (note.tabSourceVisual) {
          const tab = {
            ...note.tabSourceVisual,
            sourcePageWidth: note.sourcePageWidth ?? note.tabSourceVisual.sourcePageWidth,
            sourcePageHeight: note.sourcePageHeight ?? note.tabSourceVisual.sourcePageHeight,
          }
          restoreNoteGeometry(tab, transform, SOURCE_VISUAL_REPRESENTATION.TAB)
          note.tabSourceVisual = tab
        }
      }
    }
  }

  for (const entry of measureGrid ?? []) {
    const rect = mapDeskewedRectToSource(
      {
        x0: entry.rawMeasureXStart ?? entry.xStart,
        y0: entry.yTop,
        x1: entry.rawMeasureXEnd ?? entry.xEnd,
        y1: entry.yBottom,
      },
      transform,
    )
    if (!rect) continue
    entry.yTop = rect.y0
    entry.yBottom = rect.y1
  }

  return { measureRhythms, measureGrid }
}

function measureGridIndex(measureGrid) {
  const entries = Array.isArray(measureGrid) ? measureGrid : measureGrid?.measures ?? []
  return new Map(
    entries
      .filter((entry) => finite(entry?.measureNumber))
      .map((entry) => [Number(entry.measureNumber), entry]),
  )
}

function staffIndexForNote(note) {
  if (finite(note?.staff)) return Math.max(0, Number(note.staff) - 1)
  if (note?.sourceVisualKind === 'tab-fret') return finite(note.string) ? Number(note.string) - 1 : 0
  if (note?.clef === 'bass') return 1
  if (note?.clef === 'treble') return 0
  return null
}

function tabAlternate(note) {
  const tab = note?.tabSourceVisual
  if (!tab) return null
  const geometry = sourceCenterAndBox(
    {
      ...tab,
      sourcePageWidth: note.sourcePageWidth ?? tab.sourcePageWidth,
      sourcePageHeight: note.sourcePageHeight ?? tab.sourcePageHeight,
    },
    SOURCE_VISUAL_REPRESENTATION.TAB,
  )
  if (!geometry) return null
  return {
    representation: SOURCE_VISUAL_REPRESENTATION.TAB,
    ...geometry,
    confidence: geometryConfidence(note, geometry, SOURCE_VISUAL_REPRESENTATION.TAB),
  }
}

function sourceNoteheadIdForGeometry(page, representation, geometry) {
  const rep = representation === SOURCE_VISUAL_REPRESENTATION.TAB ? 't' : 'n'
  const x = Math.round(geometry.sourceCenter.x * 1_000_000)
  const y = Math.round(geometry.sourceCenter.y * 1_000_000)
  return `sfnh-p${page}-${rep}-x${x}-y${y}`
}

/**
 * Assign stable MusicXML note IDs and build the matching canonical source map.
 * This intentionally runs after all OMR ownership/rhythm corrections, so the
 * IDs describe exactly the final playable event-note objects.
 */
export function buildOmrSourceVisualMap(measures = [], measureGrid = null) {
  const gridByMeasure = measureGridIndex(measureGrid)
  const anchors = []

  for (const measure of measures ?? []) {
    const measureNumber = Number(measure?.measureNumber)
    const page = Number(measure?.page ?? gridByMeasure.get(measureNumber)?.page)
    if (!finite(measureNumber) || !finite(page)) continue
    const systemIndex = finite(measure?.systemIndex)
      ? Number(measure.systemIndex)
      : gridByMeasure.get(measureNumber)?.systemIndex ?? null
    const measureIndex = gridByMeasure.get(measureNumber)?.measureIndex ?? null

    for (let eventIndex = 0; eventIndex < (measure.events ?? []).length; eventIndex += 1) {
      const event = measure.events[eventIndex]
      if (event?.type !== 'note') continue
      const sourceEventId = `sfve-p${page}-m${measureNumber}-e${eventIndex}`
      for (let noteIndex = 0; noteIndex < (event.notes ?? []).length; noteIndex += 1) {
        const note = event.notes[noteIndex]
        const representation =
          note?.sourceVisualKind === 'tab-fret'
            ? SOURCE_VISUAL_REPRESENTATION.TAB
            : SOURCE_VISUAL_REPRESENTATION.NOTATION
        const geometry = sourceCenterAndBox(note, representation)
        if (!geometry) continue

        // Source identity is derived from printed ink, not semantic array order.
        // A shared/unison notehead can legitimately belong to more than one
        // voice event; those notes must join to the same visual anchor.
        const sourceNoteheadId = sourceNoteheadIdForGeometry(
          page,
          representation,
          geometry,
        )
        note.sourceNoteheadId = sourceNoteheadId
        const alternate = representation === SOURCE_VISUAL_REPRESENTATION.NOTATION
          ? tabAlternate(note)
          : null
        anchors.push({
          sourceNoteheadId,
          sourceEventId,
          page,
          systemIndex,
          staffIndex: staffIndexForNote(note),
          measureIndex,
          measureNumber,
          midi: note.midi,
          voice: event.voice ?? note.voice ?? null,
          kind: representation === SOURCE_VISUAL_REPRESENTATION.TAB ? 'tab-fret' : 'notehead',
          representation,
          ...geometry,
          confidence: geometryConfidence(note, geometry, representation),
          alternates: alternate ? [alternate] : [],
        })
      }
    }
  }

  return normalizeOmrSourceVisualMap({ anchors })
}

export function getSourceVisualAnchorIndex(sourceVisualMap) {
  if (!sourceVisualMap || typeof sourceVisualMap !== 'object') return new Map()
  const cached = anchorIndexCache.get(sourceVisualMap)
  if (cached) return cached
  const index = new Map(
    (sourceVisualMap.anchors ?? []).map((anchor) => [anchor.sourceNoteheadId, anchor]),
  )
  anchorIndexCache.set(sourceVisualMap, index)
  return index
}

/** Select notation/TAB geometry without duplicating semantic note ownership. */
export function resolveSourceVisualAnchorGeometry(anchor, preferredRepresentation = null) {
  if (!anchor) return null
  const preferred = normalizeRepresentation(preferredRepresentation ?? anchor.representation)
  if (anchor.representation === preferred) return anchor
  const alternate = anchor.alternates?.find((entry) => entry.representation === preferred)
  return alternate
    ? {
        ...anchor,
        ...alternate,
        representation: alternate.representation,
      }
    : anchor
}
