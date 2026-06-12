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
export function getPageDimensions(fitMode, pageSize, containerSize) {
  const { width: containerWidth, height: containerHeight } = containerSize

  if (!hasContainerSize(containerWidth, containerHeight)) {
    return {}
  }

  const inner = innerSize(containerWidth, containerHeight)

  if (pageSize) {
    const { width: pageWidth, height: pageHeight } = pageSize

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
    return width ? { width } : {}
  }

  // Bootstrap render before onLoadSuccess provides page aspect ratio
  if (fitMode === 'width') {
    return { width: inner.width }
  }

  return { height: inner.height }
}
