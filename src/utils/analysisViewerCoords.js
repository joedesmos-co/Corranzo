import { normalizeViewRotation } from './pdfPageViewRotation.js'

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

/**
 * Staff detection + calibration use normalized coords on the upright analysis
 * bitmap. The PDF viewer paints the raw page inside a CSS rotator; map analysis
 * points into the pre-transform overlay percentage space.
 */
export function mapAnalysisPointToViewerOverlay(x, y, viewerRotation = 0) {
  const ux = clamp01(x)
  const uy = clamp01(y)
  const rotation = normalizeViewRotation(viewerRotation)

  switch (rotation) {
    case 90:
      return { x: uy, y: 1 - ux }
    case 180:
      return { x: 1 - ux, y: 1 - uy }
    case 270:
      return { x: 1 - uy, y: ux }
    default:
      return { x: ux, y: uy }
  }
}

/** Inverse of mapAnalysisPointToViewerOverlay for pointer placement. */
export function mapViewerOverlayToAnalysisPoint(x, y, viewerRotation = 0) {
  const ox = clamp01(x)
  const oy = clamp01(y)
  const rotation = normalizeViewRotation(viewerRotation)

  switch (rotation) {
    case 90:
      return { x: 1 - oy, y: ox }
    case 180:
      return { x: 1 - ox, y: 1 - oy }
    case 270:
      return { x: oy, y: 1 - ox }
    default:
      return { x: ox, y: oy }
  }
}

export function mapAnalysisAxisRectToViewerOverlay(rect, viewerRotation = 0) {
  if (!rect) {
    return rect
  }

  const corners = [
    mapAnalysisPointToViewerOverlay(rect.x0 ?? rect.left, rect.y0 ?? rect.top, viewerRotation),
    mapAnalysisPointToViewerOverlay(rect.x1 ?? rect.right, rect.y0 ?? rect.top, viewerRotation),
    mapAnalysisPointToViewerOverlay(rect.x0 ?? rect.left, rect.y1 ?? rect.bottom, viewerRotation),
    mapAnalysisPointToViewerOverlay(rect.x1 ?? rect.right, rect.y1 ?? rect.bottom, viewerRotation),
  ]

  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  }
}

export function mapAnchorForViewerOverlay(anchor, viewerRotation = 0) {
  if (!anchor) {
    return anchor
  }
  const mapped = mapAnalysisPointToViewerOverlay(anchor.x, anchor.y, viewerRotation)
  return { ...anchor, x: mapped.x, y: mapped.y }
}

export function mapSystemBandForViewerOverlay(system, viewerRotation = 0) {
  if (!system) {
    return system
  }
  const mapped = mapAnalysisAxisRectToViewerOverlay(
    {
      x0: system.x0,
      y0: system.y0,
      x1: system.x1,
      y1: system.y1,
    },
    viewerRotation,
  )
  return {
    ...system,
    x0: mapped.x0,
    y0: mapped.y0,
    x1: mapped.x1,
    y1: mapped.y1,
  }
}

export function mapCalibrationOverlayPageForViewer(pageLayout, viewerRotation = 0) {
  if (!pageLayout) {
    return pageLayout
  }

  return {
    ...pageLayout,
    systems: (pageLayout.systems ?? []).map((system) => {
      const bounds = system.bounds
        ? mapAnalysisAxisRectToViewerOverlay(
            {
              left: system.bounds.left,
              top: system.bounds.top,
              right: system.bounds.right,
              bottom: system.bounds.bottom,
            },
            viewerRotation,
          )
        : null
      const inkBounds = system.inkBounds
        ? mapAnalysisAxisRectToViewerOverlay(
            {
              left: system.inkBounds.left,
              top: system.inkBounds.top,
              right: system.inkBounds.right,
              bottom: system.inkBounds.bottom,
            },
            viewerRotation,
          )
        : null
      const center = Number.isFinite(system.centerY)
        ? mapAnalysisPointToViewerOverlay(0.5, system.centerY, viewerRotation).y
        : system.centerY

      return {
        ...system,
        bounds: bounds
          ? {
              left: bounds.left,
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
            }
          : null,
        inkBounds: inkBounds
          ? {
              left: inkBounds.left,
              top: inkBounds.top,
              right: inkBounds.right,
              bottom: inkBounds.bottom,
            }
          : null,
        centerY: center,
      }
    }),
    anchors: (pageLayout.anchors ?? []).map((anchor) =>
      mapAnchorForViewerOverlay(anchor, viewerRotation),
    ),
  }
}
