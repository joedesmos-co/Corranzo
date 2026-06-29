import { getMeasureAtTime } from '../musicxml/timingQuery.js'
import { ANCHOR_SOURCE } from './anchorUtils.js'
import { resolveTrustedAnchorForMeasure } from './trustedAnchors.js'

function finite(value) {
  return Number.isFinite(value)
}

function round4(value) {
  return finite(value) ? Math.round(value * 10000) / 10000 : null
}

export function deriveAnchorMeasureBox(anchor) {
  if (!anchor) {
    return null
  }

  const meta = anchor.meta ?? {}
  const box = meta.measureBox
  if (
    finite(box?.x0) &&
    finite(box?.x1) &&
    finite(box?.y0) &&
    finite(box?.y1)
  ) {
    return {
      x0: round4(box.x0),
      y0: round4(box.y0),
      x1: round4(box.x1),
      y1: round4(box.y1),
      source: 'measureBox',
    }
  }

  if (finite(meta.measureStartX) && finite(meta.playableEndX)) {
    const halfHeight = 0.035
    const y0 = finite(meta.systemY0) ? meta.systemY0 : (anchor.y ?? 0) - halfHeight
    const y1 = finite(meta.systemY1) ? meta.systemY1 : (anchor.y ?? 0) + halfHeight
    return {
      x0: round4(meta.measureStartX),
      y0: round4(y0),
      x1: round4(meta.playableEndX),
      y1: round4(y1),
      source: 'measure-span',
    }
  }

  if (finite(anchor.x) && finite(anchor.y)) {
    return {
      x0: round4(anchor.x),
      y0: round4(anchor.y),
      x1: round4(anchor.x),
      y1: round4(anchor.y),
      source: 'anchor-point',
    }
  }

  return null
}

function fallbackTierFor(anchor, cursor, autoSetupReport) {
  if (cursor?.fallbackTier) {
    return cursor.fallbackTier
  }
  if (!anchor) {
    return 'no-measure-anchor'
  }
  if (anchor.source === ANCHOR_SOURCE.MANUAL) {
    return 'manual-anchor'
  }
  if (anchor.source === ANCHOR_SOURCE.DEMO) {
    return 'bundled-calibrated-anchor'
  }
  if (anchor.source === ANCHOR_SOURCE.MUSICXML_LAYOUT) {
    return 'musicxml-layout-anchor'
  }
  if (anchor.source === ANCHOR_SOURCE.OMR) {
    return 'omr-measure-grid'
  }
  if (anchor.source === ANCHOR_SOURCE.AUTO_SYSTEM || anchor.source === ANCHOR_SOURCE.AUTO) {
    return 'auto-system-anchor'
  }
  if (anchor.source === ANCHOR_SOURCE.AUTO_MEASURE) {
    const xSource = anchor.meta?.xSource ?? ''
    if (xSource.includes('barline') || anchor.meta?.measureBox) {
      return 'detected-measure-box'
    }
    if (xSource.includes('estimated')) {
      return 'estimated-measure-box'
    }
    return autoSetupReport?.allocationMode === 'partial-barline-counts'
      ? 'partial-detected-measure-box'
      : 'auto-measure-box'
  }
  return 'unknown-anchor'
}

export function buildCursorMappingDebug({
  timingMap,
  practiceTime,
  trustedAnchors,
  cursor,
  autoSetupReport = null,
} = {}) {
  const measure = timingMap ? getMeasureAtTime(timingMap, practiceTime) : null
  const measureIndex = measure
    ? (timingMap?.measures ?? []).findIndex((entry) => entry.number === measure.number)
    : -1
  const anchor =
    measure?.number != null
      ? resolveTrustedAnchorForMeasure(trustedAnchors ?? [], measure.number)
      : null
  const box = deriveAnchorMeasureBox(anchor)
  const cursorXWithinBox =
    box && finite(cursor?.x) && finite(box.x0) && finite(box.x1) && box.x1 > box.x0
      ? round4((cursor.x - box.x0) / (box.x1 - box.x0))
      : null
  const matchedOmrMeasureBox =
    anchor?.source === ANCHOR_SOURCE.OMR && box
      ? {
          measureNumber: anchor.measureNumber ?? measure?.number ?? null,
          pageNumber: anchor.page ?? cursor?.page ?? null,
          systemIndex: anchor.meta?.systemIndex ?? cursor?.systemIndex ?? null,
          xStart: box.x0,
          xEnd: box.x1,
          yTop: box.y0,
          yBottom: box.y1,
          rawMeasureXStart: round4(anchor.meta?.rawMeasureXStart ?? anchor.meta?.measureStartX),
          visualMeasureXStart: round4(
            anchor.meta?.visualMeasureStartX ?? anchor.meta?.playableStartX ?? anchor.x,
          ),
          firstNoteX: round4(anchor.meta?.firstNoteX),
          lastNoteX: round4(anchor.meta?.lastNoteX),
          cursorX: round4(cursor?.x),
          cursorXWithinBox,
          measureStartTimeSeconds: round4(anchor.meta?.measureStartTimeSeconds),
          measureDurationSeconds: round4(anchor.meta?.measureDurationSeconds),
          confidence: round4(anchor.meta?.confidence),
        }
      : null

  return {
    playbackTime: round4(practiceTime ?? null),
    currentPlaybackMeasure: measure?.number ?? null,
    measureIndex: measureIndex >= 0 ? measureIndex : null,
    measureNumber: measure?.number ?? cursor?.measureNumber ?? null,
    pageNumber: anchor?.page ?? cursor?.page ?? null,
    systemIndex: anchor?.meta?.systemIndex ?? cursor?.systemIndex ?? null,
    measureBoundingBox: box,
    matchedOmrMeasureBox,
    cursorXWithinMeasureBox: cursorXWithinBox,
    interpolationSource:
      cursor?.interpolationSource ??
      (cursor?.progressMode ? `motion-timeline:${cursor.progressMode}` : null) ??
      (cursor?.interpolated ? 'legacy-anchor-gap' : anchor ? 'measure-anchor' : 'none'),
    fallbackTier: fallbackTierFor(anchor, cursor, autoSetupReport),
    anchorSource: anchor?.source ?? null,
    anchorSchemaVersion: anchor?.meta?.autoMeasureSchemaVersion ?? null,
    allocationMode: autoSetupReport?.allocationMode ?? null,
  }
}
