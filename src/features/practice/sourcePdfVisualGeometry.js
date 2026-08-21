import { normalizeOmrMeasureGridMetadata } from '../omr/omrMeasureGridMeta.js'
import {
  resolveSourceVisualAnchorGeometry,
  SOURCE_VISUAL_REPRESENTATION,
} from '../omr/omrSourceVisualMap.js'
import { normalizeViewRotation } from '../../utils/pdfPageViewRotation.js'

const MIN_SYSTEM_HEIGHT = 0.08
const DEFAULT_SYSTEM_PADDING_Y = 0.025
const DEFAULT_SYSTEM_PADDING_X = 0.02

function finite(value) {
  return Number.isFinite(Number(value))
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value)))
}

function normalizeRect(rect) {
  if (!rect) return null
  const x0 = Number(rect.x0)
  const y0 = Number(rect.y0)
  const x1 = Number(rect.x1)
  const y1 = Number(rect.y1)
  if (![x0, y0, x1, y1].every(Number.isFinite) || !(x1 > x0) || !(y1 > y0)) {
    return null
  }
  return {
    x0: clamp01(x0),
    y0: clamp01(y0),
    x1: clamp01(x1),
    y1: clamp01(y1),
  }
}

function expandRect(rect, paddingX, paddingY) {
  return normalizeRect({
    x0: rect.x0 - paddingX,
    y0: rect.y0 - paddingY,
    x1: rect.x1 + paddingX,
    y1: rect.y1 + paddingY,
  })
}

function unionRects(rects) {
  const valid = rects.map(normalizeRect).filter(Boolean)
  if (!valid.length) return null
  return {
    x0: Math.min(...valid.map((rect) => rect.x0)),
    y0: Math.min(...valid.map((rect) => rect.y0)),
    x1: Math.max(...valid.map((rect) => rect.x1)),
    y1: Math.max(...valid.map((rect) => rect.y1)),
  }
}

function nearestByMeasure(entries, measureNumber) {
  if (!entries.length) return null
  if (!finite(measureNumber)) return entries[0]
  return entries.reduce((best, entry) =>
    Math.abs(Number(entry.measureNumber) - Number(measureNumber)) <
    Math.abs(Number(best.measureNumber) - Number(measureNumber))
      ? entry
      : best,
  )
}

function preferredAnchorGeometry(anchor, preferredRepresentation) {
  const geometry = resolveSourceVisualAnchorGeometry(anchor, preferredRepresentation)
  if (
    preferredRepresentation &&
    geometry?.representation !== preferredRepresentation
  ) {
    return null
  }
  return geometry
}

function systemAnchorRects(sourceVisualMap, page, systemIndex, preferredRepresentation) {
  if (!sourceVisualMap?.anchors?.length || !finite(page)) return []
  return sourceVisualMap.anchors
    .filter(
      (anchor) =>
        Number(anchor.page) === Number(page) &&
        (systemIndex == null || Number(anchor.systemIndex) === Number(systemIndex)),
    )
    .map((anchor) => preferredAnchorGeometry(anchor, preferredRepresentation))
    .filter(Boolean)
    .map((anchor) => anchor.sourceBBox)
    .filter(Boolean)
}

function targetFromExactOwnership(noteTarget) {
  const first = noteTarget?.sourceAnchors?.find(
    (anchor) => finite(anchor?.page) && finite(anchor?.systemIndex),
  )
  return first
    ? {
        page: Number(first.page),
        systemIndex: Number(first.systemIndex),
        measureNumber: noteTarget.measureNumber ?? null,
        source: 'source-ownership',
      }
    : null
}

function targetFromMeasureGrid(measureGrid, measureNumber) {
  if (!measureGrid?.measures?.length) return null
  const exact = measureGrid.measures.find(
    (entry) => Number(entry.measureNumber) === Number(measureNumber),
  )
  const entry = exact ?? nearestByMeasure(measureGrid.measures, measureNumber)
  return entry
    ? {
        page: Number(entry.page),
        systemIndex: Number(entry.systemIndex ?? 0),
        measureNumber: entry.measureNumber,
        source: exact ? 'measure-grid' : 'nearest-measure-grid',
      }
    : null
}

function targetFromSourceMap(sourceVisualMap, measureNumber) {
  const anchors = sourceVisualMap?.anchors ?? []
  const entry =
    anchors.find((anchor) => Number(anchor.measureNumber) === Number(measureNumber)) ??
    nearestByMeasure(anchors, measureNumber)
  return entry
    ? {
        page: Number(entry.page),
        systemIndex: finite(entry.systemIndex) ? Number(entry.systemIndex) : null,
        measureNumber: entry.measureNumber,
        source:
          Number(entry.measureNumber) === Number(measureNumber)
            ? 'source-map-measure'
            : 'nearest-source-map-measure',
      }
    : null
}

function targetFromScoreAnchors(scoreAnchors, measureNumber) {
  const anchors = scoreAnchors ?? []
  const entry =
    anchors.find((anchor) => Number(anchor.measureNumber) === Number(measureNumber)) ??
    nearestByMeasure(anchors, measureNumber)
  return entry
    ? {
        page: Number(entry.page),
        systemIndex: finite(entry.meta?.systemIndex) ? Number(entry.meta.systemIndex) : null,
        measureNumber: entry.measureNumber,
        source:
          Number(entry.measureNumber) === Number(measureNumber)
            ? 'score-anchor-measure'
            : 'nearest-score-anchor-measure',
      }
    : null
}

/**
 * Chooses a source-backed page/system without requiring exact ownership for
 * the current semantic event. The source map and measure grid improve the
 * crop, but the PDF remains the visual fallback whenever they are incomplete.
 */
export function resolveSourceVisualSystem({
  noteTarget = null,
  activeMeasureNumber = null,
  visiblePageNumber = 1,
  sourceVisualMap = null,
  omrMeasureGrid = null,
  scoreAnchors = [],
} = {}) {
  const measureGrid = normalizeOmrMeasureGridMetadata(omrMeasureGrid)
  const measureNumber = noteTarget?.measureNumber ?? activeMeasureNumber
  return (
    targetFromExactOwnership(noteTarget) ??
    targetFromMeasureGrid(measureGrid, measureNumber) ??
    targetFromSourceMap(sourceVisualMap, measureNumber) ??
    targetFromScoreAnchors(scoreAnchors, measureNumber) ??
    {
      page: finite(noteTarget?.page)
        ? Number(noteTarget.page)
        : Math.max(1, Number(visiblePageNumber) || 1),
      systemIndex: null,
      measureNumber: finite(measureNumber) ? Number(measureNumber) : null,
      source: 'source-page-fallback',
    }
  )
}

function cropFromMeasureGrid(measureGrid, targetSystem) {
  const measures = measureGrid?.measures?.filter(
    (entry) =>
      Number(entry.page) === Number(targetSystem.page) &&
      Number(entry.systemIndex ?? 0) === Number(targetSystem.systemIndex ?? 0),
  ) ?? []
  if (!measures.length) return null
  return unionRects(
    measures.map((entry) => ({
      x0: entry.rawMeasureXStart ?? entry.xStart,
      x1: entry.rawMeasureXEnd ?? entry.xEnd,
      y0: entry.yTop,
      y1: entry.yBottom,
    })),
  )
}

function cropFromScoreAnchors(scoreAnchors, targetSystem) {
  const samePage = (scoreAnchors ?? []).filter(
    (anchor) => Number(anchor.page) === Number(targetSystem.page),
  )
  const sameSystem = targetSystem.systemIndex == null
    ? []
    : samePage.filter(
        (anchor) => Number(anchor.meta?.systemIndex) === Number(targetSystem.systemIndex),
      )
  const candidates = sameSystem.length
    ? sameSystem
    : samePage.filter(
        (anchor) => Number(anchor.measureNumber) === Number(targetSystem.measureNumber),
      )
  if (!candidates.length) return null

  const yMin = Math.min(...candidates.map((anchor) => Number(anchor.y)))
  const yMax = Math.max(...candidates.map((anchor) => Number(anchor.y)))
  const xMin = Math.min(...candidates.map((anchor) => Number(anchor.x)))
  const xMax = Math.max(...candidates.map((anchor) => Number(anchor.x)))
  return normalizeRect({
    x0: Math.min(xMin, 0.06),
    x1: Math.max(xMax, 0.94),
    y0: yMin - MIN_SYSTEM_HEIGHT / 2,
    y1: yMax + MIN_SYSTEM_HEIGHT / 2,
  })
}

export function resolveSourceSystemCrop({
  targetSystem,
  omrMeasureGrid = null,
  sourceVisualMap = null,
  scoreAnchors = [],
  preferredRepresentation = null,
} = {}) {
  if (!targetSystem || !finite(targetSystem.page)) return null
  const measureGrid = normalizeOmrMeasureGridMetadata(omrMeasureGrid)
  const gridCrop = cropFromMeasureGrid(measureGrid, targetSystem)
  const sourceInkBounds = unionRects(
    systemAnchorRects(
      sourceVisualMap,
      targetSystem.page,
      targetSystem.systemIndex,
      preferredRepresentation,
    ),
  )
  const scoreAnchorCrop = cropFromScoreAnchors(scoreAnchors, targetSystem)
  const systemBounds = unionRects([gridCrop, sourceInkBounds, scoreAnchorCrop])
  const base = systemBounds ?? { x0: 0, y0: 0, x1: 1, y1: 1 }
  const verticalSpan = base.y1 - base.y0
  const paddingY = Math.max(DEFAULT_SYSTEM_PADDING_Y, verticalSpan * 0.12)
  const expanded = expandRect(base, DEFAULT_SYSTEM_PADDING_X, paddingY) ?? base

  return {
    ...expanded,
    page: Number(targetSystem.page),
    systemIndex: targetSystem.systemIndex,
    measureNumber: targetSystem.measureNumber,
    key: `${targetSystem.page}:${targetSystem.systemIndex ?? 'page'}`,
    source: gridCrop
      ? 'measure-grid'
      : sourceInkBounds
        ? 'source-anchor-system'
        : scoreAnchorCrop
          ? 'score-anchor-system'
          : 'full-source-page',
    approximate: !gridCrop && !sourceInkBounds,
  }
}

export function rotateSourcePoint(point, rotation = 0) {
  const normalizedRotation = normalizeViewRotation(rotation)
  const x = Number(point.x)
  const y = Number(point.y)
  if (normalizedRotation === 90) return { x: 1 - y, y: x }
  if (normalizedRotation === 180) return { x: 1 - x, y: 1 - y }
  if (normalizedRotation === 270) return { x: y, y: 1 - x }
  return { x, y }
}

export function rotateSourceRect(rect, rotation = 0) {
  const normalized = normalizeRect(rect)
  if (!normalized) return null
  const corners = [
    rotateSourcePoint({ x: normalized.x0, y: normalized.y0 }, rotation),
    rotateSourcePoint({ x: normalized.x1, y: normalized.y0 }, rotation),
    rotateSourcePoint({ x: normalized.x0, y: normalized.y1 }, rotation),
    rotateSourcePoint({ x: normalized.x1, y: normalized.y1 }, rotation),
  ]
  return {
    x0: Math.min(...corners.map((point) => point.x)),
    y0: Math.min(...corners.map((point) => point.y)),
    x1: Math.max(...corners.map((point) => point.x)),
    y1: Math.max(...corners.map((point) => point.y)),
  }
}

export function resolveSourceCropTransform({
  crop,
  pageSize,
  containerSize,
  rotation = 0,
} = {}) {
  const normalizedCrop = normalizeRect(crop)
  const pageWidth = Number(pageSize?.width)
  const pageHeight = Number(pageSize?.height)
  const containerWidth = Number(containerSize?.width)
  const containerHeight = Number(containerSize?.height)
  if (
    !normalizedCrop ||
    ![pageWidth, pageHeight, containerWidth, containerHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return null
  }

  const normalizedRotation = normalizeViewRotation(rotation)
  const rotatedCrop = rotateSourceRect(normalizedCrop, normalizedRotation)
  const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270
  const rotatedPageWidth = quarterTurn ? pageHeight : pageWidth
  const rotatedPageHeight = quarterTurn ? pageWidth : pageHeight
  const cropWidth = (rotatedCrop.x1 - rotatedCrop.x0) * rotatedPageWidth
  const cropHeight = (rotatedCrop.y1 - rotatedCrop.y0) * rotatedPageHeight
  const scale = Math.min(containerWidth / cropWidth, containerHeight / cropHeight)
  if (!(scale > 0)) return null

  const renderedPageWidth = rotatedPageWidth * scale
  const renderedPageHeight = rotatedPageHeight * scale
  const renderedCropWidth = cropWidth * scale
  const renderedCropHeight = cropHeight * scale
  const offsetX = (containerWidth - renderedCropWidth) / 2
  const offsetY = (containerHeight - renderedCropHeight) / 2

  return {
    rotation: normalizedRotation,
    crop: normalizedCrop,
    rotatedCrop,
    scale,
    renderedPageWidth,
    renderedPageHeight,
    renderedCropWidth,
    renderedCropHeight,
    pageLeft: offsetX - rotatedCrop.x0 * renderedPageWidth,
    pageTop: offsetY - rotatedCrop.y0 * renderedPageHeight,
    offsetX,
    offsetY,
  }
}

export function mapSourceRectIntoCrop(rect, transform) {
  if (!transform) return null
  const rotated = rotateSourceRect(rect, transform.rotation)
  if (!rotated) return null
  return {
    x0: transform.pageLeft + rotated.x0 * transform.renderedPageWidth,
    y0: transform.pageTop + rotated.y0 * transform.renderedPageHeight,
    x1: transform.pageLeft + rotated.x1 * transform.renderedPageWidth,
    y1: transform.pageTop + rotated.y1 * transform.renderedPageHeight,
  }
}

export function normalizePreferredSourceRepresentation(value) {
  if (value === SOURCE_VISUAL_REPRESENTATION.TAB) return value
  if (value === SOURCE_VISUAL_REPRESENTATION.NOTATION) return value
  return null
}
