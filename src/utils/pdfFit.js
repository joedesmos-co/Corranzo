import { getEffectivePageSize } from './pdfPageViewRotation.js'
import { getCorrectedPageGeometry } from './pdfPageGeometry.js'

export const DEFAULT_CANVAS_PADDING = 32
export const PRACTICE_CANVAS_PADDING = 18

export {
  computeDocumentDisplayReference,
  computeFitScale,
  getCorrectedPageGeometry,
  getCorrectedPageSize,
  viewerRotationFromAnalysisRotation,
} from './pdfPageGeometry.js'

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
 * Returns react-pdf Page props plus display box dimensions for the page frame.
 */
export function getPageDimensions(
  fitMode,
  pageSize,
  containerSize,
  viewRotation = 0,
  canvasPadding = DEFAULT_CANVAS_PADDING,
  referenceDisplaySize = null,
) {
  const { width: containerWidth, height: containerHeight } = containerSize
  const geometry = getCorrectedPageGeometry({
    sourceSize: pageSize,
    viewRotation,
    fitMode,
    containerSize,
    canvasPadding,
    referenceDisplaySize,
  })

  if (!hasContainerSize(containerWidth, containerHeight)) {
    return {}
  }

  if (pageSize?.width && pageSize?.height) {
    return {
      ...geometry.pageRenderProps,
      displayWidth: geometry.displayWidth,
      displayHeight: geometry.displayHeight,
      viewerRotation: geometry.viewerRotation,
      scale: geometry.scale,
    }
  }

  const inner = innerSize(containerWidth, containerHeight, canvasPadding)
  const effectivePageSize = getEffectivePageSize(pageSize, viewRotation) ?? pageSize

  if (effectivePageSize && fitMode === 'width') {
    return { width: inner.width }
  }

  return { height: inner.height }
}
