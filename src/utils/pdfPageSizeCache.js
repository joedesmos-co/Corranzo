/** Ignore sub-pixel drift when comparing PDF source page dimensions. */
export const PDF_PAGE_SIZE_TOLERANCE = 1

export function arePdfPageSizesEqual(
  a,
  b,
  tolerance = PDF_PAGE_SIZE_TOLERANCE,
) {
  if (!a && !b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  if (!Number.isFinite(a.width) || !Number.isFinite(a.height)) {
    return false
  }
  if (!Number.isFinite(b.width) || !Number.isFinite(b.height)) {
    return false
  }
  return (
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  )
}

/**
 * Store a page's source dimensions when they materially change.
 * @returns {boolean} true when the cache was updated
 */
export function upsertPdfPageSize(
  cache,
  pageNumber,
  size,
  tolerance = PDF_PAGE_SIZE_TOLERANCE,
) {
  if (!cache || !pageNumber || !size?.width || !size?.height) {
    return false
  }

  const previous = cache[pageNumber]
  if (arePdfPageSizesEqual(previous, size, tolerance)) {
    return false
  }

  cache[pageNumber] = {
    width: size.width,
    height: size.height,
  }
  return true
}
