import { getEffectivePageSize } from './pdfPageViewRotation.js'

export const DEFAULT_CANVAS_PADDING = 32
export const PRACTICE_CANVAS_PADDING = 18

function innerSize(containerWidth, containerHeight, canvasPadding) {
  return {
    width: Math.max(0, containerWidth - canvasPadding),
    height: Math.max(0, containerHeight - canvasPadding),
  }
}

function hasContainerSize(containerWidth, containerHeight) {
  return containerWidth > 0 && containerHeight > 0
}

export function getFitPageWidth(pageWidth, pageHeight, containerWidth, containerHeight, canvasPadding = DEFAULT_CANVAS_PADDING) {
  if (!pageWidth || !pageHeight || !hasContainerSize(containerWidth, containerHeight)) {
    return null
  }

  const inner = innerSize(containerWidth, containerHeight, canvasPadding)
  const scale = Math.min(inner.width / pageWidth, inner.height / pageHeight)

  return pageWidth * scale
}

export function getFitWidth(pageWidth, containerWidth, canvasPadding = DEFAULT_CANVAS_PADDING) {
  if (!pageWidth || containerWidth <= 0) {
    return null
  }

  return containerWidth - canvasPadding
}

/**
 * Returns width and/or height props for react-pdf Page.
 * Uses container-only fallbacks until page dimensions are known.
 */
export function getPageDimensions(fitMode, pageSize, containerSize, viewRotation = 0, canvasPadding = DEFAULT_CANVAS_PADDING) {
  const { width: containerWidth, height: containerHeight } = containerSize
  const effectivePageSize = getEffectivePageSize(pageSize, viewRotation) ?? pageSize

  if (!hasContainerSize(containerWidth, containerHeight)) {
    return {}
  }

  const inner = innerSize(containerWidth, containerHeight, canvasPadding)

  if (effectivePageSize) {
    const { width: pageWidth, height: pageHeight } = effectivePageSize

    if (fitMode === 'width') {
      const width = getFitWidth(pageWidth, containerWidth, canvasPadding)
      return width ? { width } : {}
    }

    const width = getFitPageWidth(
      pageWidth,
      pageHeight,
      containerWidth,
      containerHeight,
      canvasPadding,
    )
    if (!width) {
      return {}
    }
    const scale = width / pageWidth
    return { width, height: pageHeight * scale }
  }

  // Bootstrap render before onLoadSuccess provides page aspect ratio
  if (fitMode === 'width') {
    return { width: inner.width }
  }

  return { height: inner.height }
}
