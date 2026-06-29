import { normalizeOmrMeasureGridMetadata } from '../omr/omrMeasureGridMeta.js'
import {
  ANCHOR_SOURCE,
  AUTO_MEASURE_ANCHOR_SCHEMA_VERSION,
} from './anchorUtils.js'

export const OMR_ANCHOR_SCHEMA_VERSION = 1

function finite(value) {
  return Number.isFinite(Number(value))
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000
}

function timingByMeasureNumber(timingMap) {
  const byMeasure = new Map()
  for (const measure of timingMap?.measures ?? []) {
    if (finite(measure.number)) {
      byMeasure.set(Number(measure.number), measure)
    }
  }
  return byMeasure
}

function systemEndByGridKey(measures) {
  const bySystem = new Map()
  for (const measure of measures) {
    const key = `${measure.page}:${measure.systemIndex}`
    const endX = measure.visualMeasureEndX ?? measure.playableEndX
    const current = bySystem.get(key)
    if (!finite(current) || endX > current) {
      bySystem.set(key, endX)
    }
  }
  return bySystem
}

function validMeasureWindow(measure) {
  const start = Number(measure?.startTimeSeconds)
  const end = Number(measure?.endTimeSeconds)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null
  }
  return {
    startTimeSeconds: start,
    durationSeconds: Math.max(0, end - start),
  }
}

/**
 * Build per-measure score-follow anchors directly from OMR's PDF measure grid.
 * The generated MusicXML remains the timing source; this grid supplies the
 * printed page/system/measure boxes so OMR playback does not run generic PDF
 * calibration or start at the left margin.
 */
export function buildOmrMeasureGridAnchors({ measureGrid, timingMap } = {}) {
  const normalized = normalizeOmrMeasureGridMetadata(measureGrid)
  const measures = normalized?.measures ?? []
  if (!measures.length || !timingMap?.measures?.length) {
    return []
  }

  const timing = timingByMeasureNumber(timingMap)
  const systemEnds = systemEndByGridKey(measures)
  const anchors = []

  for (const gridMeasure of measures) {
    const measureNumber = Number(gridMeasure.measureNumber)
    const timingMeasure = timing.get(measureNumber)
    if (!timingMeasure) {
      continue
    }
    const window = validMeasureWindow(timingMeasure)
    if (!window) {
      continue
    }

    const systemKey = `${gridMeasure.page}:${gridMeasure.systemIndex}`
    const rawMeasureXStart = gridMeasure.rawMeasureXStart ?? gridMeasure.measureStartX
    const rawMeasureXEnd = gridMeasure.rawMeasureXEnd ?? gridMeasure.playableEndX
    const visualMeasureStartX =
      gridMeasure.visualMeasureStartX ?? gridMeasure.playableStartX ?? rawMeasureXStart
    const visualMeasureEndX =
      gridMeasure.visualMeasureEndX ?? gridMeasure.playableEndX ?? rawMeasureXEnd
    const systemEndX = systemEnds.get(systemKey) ?? visualMeasureEndX
    const y = round4((gridMeasure.yTop + gridMeasure.yBottom) / 2)

    anchors.push({
      id: `omr-measure-${gridMeasure.page}-${gridMeasure.systemIndex}-${measureNumber}`,
      page: gridMeasure.page,
      x: visualMeasureStartX,
      y,
      measureNumber,
      source: ANCHOR_SOURCE.OMR,
      meta: {
        role: 'measure',
        autoMeasureSchemaVersion: AUTO_MEASURE_ANCHOR_SCHEMA_VERSION,
        omrAnchorSchemaVersion: OMR_ANCHOR_SCHEMA_VERSION,
        omrMeasureGridSchemaVersion: normalized.schemaVersion,
        systemIndex: gridMeasure.systemIndex,
        measuresInSpan: measures.filter(
          (entry) =>
            entry.page === gridMeasure.page && entry.systemIndex === gridMeasure.systemIndex,
        ).length,
        indexInSystem: gridMeasure.measureIndex,
        confidence: gridMeasure.confidence ?? null,
        measureStartTimeSeconds: window.startTimeSeconds,
        measureDurationSeconds: window.durationSeconds,
        measureStartX: rawMeasureXStart,
        rawMeasureXStart,
        rawMeasureXEnd,
        visualMeasureStartX,
        visualMeasureEndX,
        firstNoteX: gridMeasure.firstNoteX ?? null,
        lastNoteX: gridMeasure.lastNoteX ?? null,
        noteXPositions: gridMeasure.noteXPositions ?? [],
        playableStartX: visualMeasureStartX,
        playableEndX: visualMeasureEndX,
        systemEndX,
        xSource: 'omr-measure-grid',
        measureBox: {
          x0: rawMeasureXStart,
          y0: gridMeasure.yTop,
          x1: rawMeasureXEnd,
          y1: gridMeasure.yBottom,
        },
      },
    })
  }

  return anchors.sort((left, right) => left.measureNumber - right.measureNumber)
}
