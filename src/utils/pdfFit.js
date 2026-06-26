import { getEffectivePageSize } from './pdfPageViewRotation.js'

const CANVAS_PADDING = 32

function innerSize(containerWidth, containerHeight) {
  return {
    width: Math.max(0, containerWidth - CANVAS_PADDING),
    height: Math.max(0, containerHeight - CANVAS_PADDING),
  }
}

function hasContainerSize(containerWidth, containerHeight) {
  return containerWidth > 0 && containerHeight > 0
}

export function getFitPageWidth(pageWidth, pageHeight, containerWidth, containerHeight) {
  if (!pageWidth || !pageHeight || !hasContainerSize(containerWidth, containerHeight)) {
    return null
  }

  const inner = innerSize(containerWidth, containerHeight)
  const scale = Math.min(inner.width / pageWidth, inner.height / pageHeight)

  return pageWidth * scale
}

export function getFitWidth(pageWidth, containerWidth) {
  if (!pageWidth || containerWidth <= 0) {
    return null
  }

  return containerWidth - CANVAS_PADDING
}

/**
 * Returns width and/or height props for react-pdf Page.
 * Uses container-only fallbacks until page dimensions are known.
 */
export function getPageDimensions(fitMode, pageSize, containerSize, viewRotation = 0) {
  const { width: containerWidth, height: containerHeight } = containerSize
  const effectivePageSize = getEffectivePageSize(pageSize, viewRotation) ?? pageSize

  if (!hasContainerSize(containerWidth, containerHeight)) {
    return {}
  }

  const inner = innerSize(containerWidth, containerHeight)

  if (effectivePageSize) {
    const { width: pageWidth, height: pageHeight } = effectivePageSize

    if (fitMode === 'width') {
      const width = getFitWidth(pageWidth, containerWidth)
      return width ? { width } : {}
    }

    const width = getFitPageWidth(
      pageWidth,
      pageHeight,
      containerWidth,
      containerHeight,
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
