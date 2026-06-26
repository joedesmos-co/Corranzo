import { isQuarterTurn } from './pdfPageViewRotation.js'

/**
 * Overlay layout in the rotator's local coordinate space (pre-CSS-transform).
 * Using getBoundingClientRect on a rotated page returns the axis-aligned box and
 * breaks overlay alignment and percentage-based cursor sizing.
 */
export function measurePdfOverlayLayout(pageElement) {
  if (!pageElement) {
    return null
  }

  const width = pageElement.offsetWidth
  const height = pageElement.offsetHeight
  if (!width || !height) {
    return null
  }

  return {
    left: pageElement.offsetLeft,
    top: pageElement.offsetTop,
    width,
    height,
  }
}

/**
 * Score-follow cursor spans the staff vertically on screen. In overlay-local
 * coordinates that is height for upright pages and width for quarter turns
 * (the rotator CSS transform maps local width → screen height).
 */
export function getScoreFollowCursorSpanAxis(viewRotation = 0) {
  return isQuarterTurn(viewRotation) ? 'width' : 'height'
}
