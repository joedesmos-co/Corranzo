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
 * Cache resolved library layouts per slot after source dimensions are known.
 */
export function getCachedLibraryPageLayout(cache, slotPageNumber, layout) {
  if (!cache || !layout) {
    return layout
  }

  const cached = cache.get(slotPageNumber)
  if (cached) {
    return cached
  }

  cache.set(slotPageNumber, layout)
  return layout
}
