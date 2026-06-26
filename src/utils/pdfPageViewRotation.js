/** Normalize degrees to 0, 90, 180, or 270. */
export function normalizeViewRotation(degrees) {
  const deg = ((Math.round((degrees ?? 0) / 90) * 90) % 360 + 360) % 360
  return deg
}

export function cycleViewRotation(degrees) {
  return normalizeViewRotation((degrees ?? 0) + 90)
}

export function isQuarterTurn(degrees) {
  const deg = normalizeViewRotation(degrees)
  return deg === 90 || deg === 270
}

/** Swap width/height for fit calculations when the page is shown at 90°/270°. */
export function getEffectivePageSize(pageSize, viewRotation = 0) {
  if (!pageSize?.width || !pageSize?.height) {
    return pageSize
  }
  if (!isQuarterTurn(viewRotation)) {
    return pageSize
  }
  return {
    width: pageSize.height,
    height: pageSize.width,
  }
}

/** Build a page→rotation map from setup orientation diagnostics. */
export function pageViewRotationsFromOrientation(orientation) {
  const map = {}
  for (const page of orientation?.pages ?? []) {
    const rotation = normalizeViewRotation(page.rotation)
    if (rotation !== 0) {
      map[page.page] = rotation
    }
  }
  return map
}

export function getPageViewRotation(pageViewRotations, pageNumber) {
  return normalizeViewRotation(pageViewRotations?.[pageNumber] ?? 0)
}

/**
 * Authoritative per-page viewer rotations.
 *
 * The auto layer comes from the reconciled analysis orientation (recomputed
 * fresh, never persisted); the manual layer is the user's explicit "Rotate page"
 * overrides and always wins. This single resolver is what makes a stale turn
 * unable to override a fresh auto-setup, and keeps every page consistent.
 */
export function resolveEffectivePageRotations(orientation, manualRotations = {}) {
  const merged = { ...pageViewRotationsFromOrientation(orientation) }
  for (const [page, rotation] of Object.entries(manualRotations ?? {})) {
    merged[page] = normalizeViewRotation(rotation)
  }
  return merged
}

/** Whether viewer rotations match detected correction for every rotated page. */
export function isViewerRotationCorrected(orientation, pageViewRotations = {}) {
  if (!orientation?.anyRotated) {
    return true
  }
  for (const page of orientation.pages ?? []) {
    const detected = normalizeViewRotation(page.rotation)
    if (detected === 0) {
      continue
    }
    if (pageViewRotations[page.page] == null) {
      return false
    }
    const viewer = getPageViewRotation(pageViewRotations, page.page)
    if (viewer !== detected) {
      return false
    }
  }
  return true
}
