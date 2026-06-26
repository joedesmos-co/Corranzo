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
 * Document-wide corrected reference box so every page shares ONE visual scale.
 *
 * Uses the max corrected width AND max corrected height across the document (a
 * bounding box), not a single largest-area page: the resulting fit scale is the
 * one at which every page — portrait or landscape, rotated or not — fits the
 * container, so pages never jump scale as you navigate or as rotation arrives.
 * For a uniform document the box equals the page size, so normal PDFs render
 * exactly as before.
 */
export function computeDocumentDisplayReference(
  pageSizesByPage = {},
  pageViewRotations = {},
  orientation = null,
) {
  const pageNumbers = new Set([
    ...Object.keys(pageSizesByPage).map(Number),
    ...(orientation?.pages ?? []).map((entry) => entry.page),
  ])

  const correctedBoxes = []
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
    correctedBoxes.push(corrected)
  }

  if (correctedBoxes.length === 0) {
    return null
  }

  // Size the reference from the DOMINANT corrected orientation only. After
  // rotation, score pages share one upright paper shape; a stray page in the
  // other orientation (a mis-detected or genuinely different page) must not
  // inflate the reference and shrink everything else. Within the dominant pool
  // the reference is the bounding box, so every page in it fits at one scale.
  const portrait = correctedBoxes.filter((box) => box.height >= box.width)
  const landscape = correctedBoxes.filter((box) => box.height < box.width)
  const pool = portrait.length >= landscape.length ? portrait : landscape

  const correctedWidth = Math.max(...pool.map((box) => box.width))
  const correctedHeight = Math.max(...pool.map((box) => box.height))

  if (!correctedWidth || !correctedHeight) {
    return null
  }

  return { correctedWidth, correctedHeight }
}

/**
 * Per-page geometry report for manual verification (dev/debug table + export).
 * Returns, for every page, the exact values that drive rendering so a human can
 * confirm rotation and shared scale are correct: source box, auto/manual/effective
 * rotation, corrected upright box, react-pdf render size, and the display box.
 */
export function buildPageGeometryReport({
  numPages = 0,
  pageSizesByPage = {},
  orientation = null,
  pageViewRotations = {},
  nativeRotationsByPage = {},
  originalSizesByPage = {},
  containerSize = { width: 0, height: 0 },
  fitMode = 'page',
  canvasPadding = 0,
  referenceDisplaySize = null,
  variant = 'unknown',
} = {}) {
  const rows = []
  for (let page = 1; page <= numPages; page += 1) {
    const source = pageSizesByPage[page] ?? null
    const original = originalSizesByPage[page] ?? null
    const autoRotation = normalizeViewRotation(
      orientation?.pages?.find((entry) => entry.page === page)?.rotation ?? 0,
    )
    const hasManual = pageViewRotations[page] != null
    const effective = normalizeViewRotation(hasManual ? pageViewRotations[page] : autoRotation)
    const manualRotation = hasManual && effective !== autoRotation ? effective : null

    let corrected = null
    let geometry = null
    if (source?.width > 0 && source?.height > 0) {
      corrected = getCorrectedPageSize(source, effective)
      geometry = getCorrectedPageGeometry({
        sourceSize: source,
        viewRotation: effective,
        fitMode,
        containerSize,
        canvasPadding,
        referenceDisplaySize,
      })
    }

    rows.push({
      page,
      nativeRotation: normalizeViewRotation(nativeRotationsByPage[page] ?? 0),
      originalWidth: original?.width ?? null,
      originalHeight: original?.height ?? null,
      sourceWidth: source?.width ?? null,
      sourceHeight: source?.height ?? null,
      autoRotation,
      manualRotation,
      viewerRotation: effective,
      correctedWidth: corrected?.width ?? null,
      correctedHeight: corrected?.height ?? null,
      renderWidth: geometry?.renderWidth ?? null,
      renderHeight: geometry?.renderHeight ?? null,
      displayWidth: geometry?.displayWidth ?? null,
      displayHeight: geometry?.displayHeight ?? null,
      scale: geometry?.scale ?? null,
      // 'resolved' once react-pdf has reported the page's real size; otherwise the
      // frame is still using a container-fit bootstrap layout.
      layoutSource: source?.width > 0 && source?.height > 0 ? 'resolved' : 'bootstrap',
      variant,
    })
  }
  return {
    rows,
    referenceDisplaySize: referenceDisplaySize ?? null,
    documentReferenceWidth: referenceDisplaySize?.correctedWidth ?? null,
    documentReferenceHeight: referenceDisplaySize?.correctedHeight ?? null,
    fitMode,
    containerSize,
    variant,
  }
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
    }) ?? null

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

  if (!Number.isFinite(scale) || scale <= 0) {
    scale = null
  }

  const renderWidth =
    sourceWidth && scale != null ? sourceWidth * scale : 0
  const renderHeight =
    sourceHeight && scale != null ? sourceHeight * scale : 0
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
