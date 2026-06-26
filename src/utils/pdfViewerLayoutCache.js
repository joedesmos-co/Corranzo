import { arePdfPageSizesEqual, PDF_PAGE_SIZE_TOLERANCE } from './pdfPageSizeCache.js'

export function arePdfDisplayLayoutsEqual(
  a,
  b,
  tolerance = PDF_PAGE_SIZE_TOLERANCE,
) {
  if (!a || !b) {
    return false
  }
  return (
    arePdfPageSizesEqual(
      { width: a.displayWidth, height: a.displayHeight },
      { width: b.displayWidth, height: b.displayHeight },
      tolerance,
    ) &&
    (a.viewerRotation ?? 0) === (b.viewerRotation ?? 0)
  )
}

/**
 * Stable cache key: shared document reference + container + per-page rotation.
 * Same key → same scale; reference change → new key (no stale per-page drift).
 */
export function buildLibraryLayoutCacheKey({
  fitMode,
  containerSize,
  referenceDisplaySize,
  viewerRotationKey,
  slotPageNumber,
  viewRotation = 0,
}) {
  const containerWidth = Math.round(containerSize?.width ?? 0)
  const containerHeight = Math.round(containerSize?.height ?? 0)
  const referenceWidth = Math.round(referenceDisplaySize?.correctedWidth ?? 0)
  const referenceHeight = Math.round(referenceDisplaySize?.correctedHeight ?? 0)
  return [
    fitMode,
    `${containerWidth}x${containerHeight}`,
    `${referenceWidth}x${referenceHeight}`,
    viewerRotationKey,
    slotPageNumber,
    viewRotation,
  ].join('|')
}

/**
 * Cache resolved library layouts to absorb container jitter without freezing
 * per-page scale before the document reference is known.
 */
export function getCachedLibraryPageLayout(cache, cacheKey, layout) {
  if (!cache || !layout || !cacheKey) {
    return layout
  }

  const cached = cache.get(cacheKey)
  if (cached) {
    return cached
  }

  cache.set(cacheKey, layout)
  return layout
}
