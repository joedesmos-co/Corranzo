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

function positiveFinite(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Whether react-pdf can render from width and/or height. */
export function isRenderablePageLayout(layout) {
  if (!layout) {
    return false
  }
  return Boolean(positiveFinite(layout.width) || positiveFinite(layout.height))
}

export function sanitizePageLayout(layout) {
  if (!layout) {
    return null
  }

  const width = positiveFinite(layout.width)
  const height = positiveFinite(layout.height)
  const displayWidth = positiveFinite(layout.displayWidth) ?? width
  const displayHeight = positiveFinite(layout.displayHeight) ?? height
  const scale = positiveFinite(layout.scale) ?? undefined

  if (!width && !height) {
    return null
  }

  return {
    ...layout,
    width: width ?? undefined,
    height: height ?? undefined,
    displayWidth: displayWidth ?? undefined,
    displayHeight: displayHeight ?? undefined,
    scale,
  }
}

function getBootstrapPageLayout(fitMode, containerSize, canvasPadding = DEFAULT_CANVAS_PADDING) {
  const { width: containerWidth, height: containerHeight } = containerSize
  if (!hasContainerSize(containerWidth, containerHeight)) {
    return null
  }

  const inner = innerSize(containerWidth, containerHeight, canvasPadding)
  if (fitMode === 'width') {
    return { width: inner.width, displayWidth: inner.width }
  }

  return { height: inner.height, displayHeight: inner.height }
}

function getLegacyPageLayout(fitMode, pageSize, containerSize, viewRotation, canvasPadding) {
  const effectivePageSize = getEffectivePageSize(pageSize, viewRotation) ?? pageSize
  const { width: containerWidth, height: containerHeight } = containerSize

  if (!effectivePageSize?.width || !effectivePageSize?.height) {
    return null
  }

  if (fitMode === 'width') {
    const width = getFitWidth(effectivePageSize.width, containerWidth, canvasPadding)
    if (!width) {
      return null
    }
    return {
      width: pageSize.width * (width / effectivePageSize.width),
      displayWidth: width,
      displayHeight: effectivePageSize.height * (width / effectivePageSize.width),
    }
  }

  const width = getFitPageWidth(
    effectivePageSize.width,
    effectivePageSize.height,
    containerWidth,
    containerHeight,
    canvasPadding,
  )
  if (!width) {
    return null
  }

  const scale = width / effectivePageSize.width
  return {
    width: pageSize.width * scale,
    displayWidth: effectivePageSize.width * scale,
    displayHeight: effectivePageSize.height * scale,
    scale,
  }
}

/**
 * Resolve layout for one PDF window slot, including bootstrap before source size is known.
 */
export function resolvePdfPageLayout({
  fitMode,
  pageNumber,
  slotPageNumber,
  pageSize = null,
  pageSizesByPage = {},
  containerSize,
  getPageViewRotation = () => 0,
  canvasPadding = DEFAULT_CANVAS_PADDING,
  referenceDisplaySize = null,
}) {
  const sourceSize =
    pageSizesByPage[slotPageNumber] ?? (slotPageNumber === pageNumber ? pageSize : null)
  const hasSourceSize = positiveFinite(sourceSize?.width) && positiveFinite(sourceSize?.height)
  const viewRotation = getPageViewRotation(slotPageNumber) ?? 0

  return getPageDimensions(
    fitMode,
    hasSourceSize ? sourceSize : null,
    containerSize,
    viewRotation,
    canvasPadding,
    hasSourceSize ? referenceDisplaySize : null,
  )
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

  if (!hasContainerSize(containerWidth, containerHeight)) {
    return {}
  }

  if (positiveFinite(pageSize?.width) && positiveFinite(pageSize?.height)) {
    const geometry = getCorrectedPageGeometry({
      sourceSize: pageSize,
      viewRotation,
      fitMode,
      containerSize,
      canvasPadding,
      referenceDisplaySize,
    })

    const layout = sanitizePageLayout({
      ...geometry.pageRenderProps,
      displayWidth: geometry.displayWidth,
      displayHeight: geometry.displayHeight,
      viewerRotation: geometry.viewerRotation,
      scale: geometry.scale,
    })
    if (layout) {
      return layout
    }

    const legacy = sanitizePageLayout(
      getLegacyPageLayout(fitMode, pageSize, containerSize, viewRotation, canvasPadding),
    )
    if (legacy) {
      return legacy
    }
  }

  return sanitizePageLayout(getBootstrapPageLayout(fitMode, containerSize, canvasPadding)) ?? {}
}
