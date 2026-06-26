import { normalizeViewRotation, isQuarterTurn } from './pdfPageViewRotation.js'

export { getEffectivePageSize } from './pdfPageViewRotation.js'

/**
 * Upright display box after applying viewer rotation to the source PDF page.
 * Analysis anchors and overlays use this coordinate space.
 */
export function getCorrectedPageSize(sourceSize, viewRotation = 0) {
  if (!sourceSize?.width || !sourceSize?.height) {
    return sourceSize ?? null
  }
  const rotation = normalizeViewRotation(viewRotation)
  if (isQuarterTurn(rotation)) {
    return { width: sourceSize.height, height: sourceSize.width }
  }
  return { width: sourceSize.width, height: sourceSize.height }
}

function innerSize(containerWidth, containerHeight, canvasPadding) {
  return {
    width: Math.max(0, containerWidth - canvasPadding),
    height: Math.max(0, containerHeight - canvasPadding),
  }
}

function hasContainerSize(containerWidth, containerHeight) {
  return containerWidth > 0 && containerHeight > 0
}

/**
 * Analysis rotation = degrees applied to the source bitmap to reach upright
 * analysis space. The viewer applies the same rotation to the raw PDF page.
 */
export function viewerRotationFromAnalysisRotation(analysisRotation) {
  return normalizeViewRotation(analysisRotation)
}

export function computeFitScale({
  correctedWidth,
  correctedHeight,
  containerWidth,
  containerHeight,
  fitMode = 'page',
  canvasPadding = 0,
}) {
  if (!correctedWidth || !correctedHeight || !hasContainerSize(containerWidth, containerHeight)) {
    return null
  }

  const inner = innerSize(containerWidth, containerHeight, canvasPadding)

  if (fitMode === 'width') {
    return inner.width / correctedWidth
  }

  return Math.min(inner.width / correctedWidth, inner.height / correctedHeight)
}

/**
 * Pick a document-wide corrected size so every page shares the same visual scale.
 */
export function computeDocumentDisplayReference(
  pageSizesByPage = {},
  pageViewRotations = {},
  orientation = null,
) {
  let correctedWidth = 0
  let correctedHeight = 0
  const pageNumbers = new Set([
    ...Object.keys(pageSizesByPage).map(Number),
    ...(orientation?.pages ?? []).map((entry) => entry.page),
  ])

  for (const pageNumber of pageNumbers) {
    const sourceSize = pageSizesByPage[pageNumber]
    if (!sourceSize?.width || !sourceSize?.height) {
      continue
    }

    const orientationEntry = orientation?.pages?.find((entry) => entry.page === pageNumber)
    const rotation = viewerRotationFromAnalysisRotation(
      pageViewRotations[pageNumber] ?? orientationEntry?.rotation ?? 0,
    )
    const corrected = getCorrectedPageSize(sourceSize, rotation)
    if (!corrected?.width || !corrected?.height) {
      continue
    }

    const area = corrected.width * corrected.height
    const refArea = correctedWidth * correctedHeight
    if (area > refArea) {
      correctedWidth = corrected.width
      correctedHeight = corrected.height
    }
  }

  if (!correctedWidth || !correctedHeight) {
    return null
  }

  return { correctedWidth, correctedHeight }
}

/**
 * Single source of truth for PDF render size, display box, and overlay space.
 */
export function getCorrectedPageGeometry({
  sourceSize,
  viewRotation = 0,
  fitMode = 'page',
  containerSize = { width: 0, height: 0 },
  canvasPadding = 0,
  referenceDisplaySize = null,
}) {
  const sourceWidth = sourceSize?.width ?? 0
  const sourceHeight = sourceSize?.height ?? 0
  const viewerRotation = viewerRotationFromAnalysisRotation(viewRotation)
  const corrected = getCorrectedPageSize(
    sourceWidth && sourceHeight ? { width: sourceWidth, height: sourceHeight } : null,
    viewerRotation,
  )
  const correctedWidth = corrected?.width ?? 0
  const correctedHeight = corrected?.height ?? 0
  const { width: containerWidth, height: containerHeight } = containerSize

  let scale =
    computeFitScale({
      correctedWidth,
      correctedHeight,
      containerWidth,
      containerHeight,
      fitMode,
      canvasPadding,
    }) ?? 1

  if (referenceDisplaySize?.correctedWidth && referenceDisplaySize?.correctedHeight) {
    const referenceScale = computeFitScale({
      correctedWidth: referenceDisplaySize.correctedWidth,
      correctedHeight: referenceDisplaySize.correctedHeight,
      containerWidth,
      containerHeight,
      fitMode,
      canvasPadding,
    })
    if (referenceScale != null) {
      scale = referenceScale
    }
  }

  const renderWidth = sourceWidth ? sourceWidth * scale : 0
  const renderHeight = sourceHeight ? sourceHeight * scale : 0
  const quarterTurn = isQuarterTurn(viewerRotation)
  const displayWidth = quarterTurn ? renderHeight : renderWidth
  const displayHeight = quarterTurn ? renderWidth : renderHeight

  return {
    sourceWidth,
    sourceHeight,
    correctedWidth,
    correctedHeight,
    viewerRotation,
    layoutRotation: viewerRotation,
    scale,
    renderWidth,
    renderHeight,
    displayWidth,
    displayHeight,
    pageRenderProps:
      renderWidth > 0
        ? { width: renderWidth }
        : renderHeight > 0
          ? { height: renderHeight }
          : {},
  }
}
