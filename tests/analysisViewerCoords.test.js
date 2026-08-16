import { describe, expect, it } from 'vitest'
import {
  mapAnalysisAxisRectToViewerOverlay,
  mapAnalysisPointToViewerOverlay,
  mapViewerOverlayToAnalysisPoint,
  normalizeViewerDisplayPoint,
} from '../src/utils/analysisViewerCoords.js'

function cssRotateOverlayPoint(point, sourceSize, rotation) {
  const localX = point.x * sourceSize.width
  const localY = point.y * sourceSize.height

  switch (rotation) {
    case 90:
      return {
        x: sourceSize.height - localY,
        y: localX,
        displayWidth: sourceSize.height,
        displayHeight: sourceSize.width,
      }
    case 180:
      return {
        x: sourceSize.width - localX,
        y: sourceSize.height - localY,
        displayWidth: sourceSize.width,
        displayHeight: sourceSize.height,
      }
    case 270:
      return {
        x: localY,
        y: sourceSize.width - localX,
        displayWidth: sourceSize.height,
        displayHeight: sourceSize.width,
      }
    default:
      return {
        x: localX,
        y: localY,
        displayWidth: sourceSize.width,
        displayHeight: sourceSize.height,
      }
  }
}

describe('analysisViewerCoords', () => {
  it('leaves upright analysis points unchanged at 0°', () => {
    expect(mapAnalysisPointToViewerOverlay(0.2, 0.4, 0)).toEqual({ x: 0.2, y: 0.4 })
  })

  it('round-trips analysis and viewer overlay points for quarter turns', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const analysis = { x: 0.15, y: 0.62 }
      const overlay = mapAnalysisPointToViewerOverlay(analysis.x, analysis.y, rotation)
      const back = mapViewerOverlayToAnalysisPoint(overlay.x, overlay.y, rotation)
      expect(back.x).toBeCloseTo(analysis.x, 6)
      expect(back.y).toBeCloseTo(analysis.y, 6)
    }
  })

  it('maps a portrait analysis point onto landscape overlay space at 90°', () => {
    expect(mapAnalysisPointToViewerOverlay(0.5, 0.4, 90)).toEqual({ x: 0.4, y: 0.5 })
  })

  it('maps points and axis-aligned rectangles exactly at every right-angle rotation', () => {
    const point = { x: 0.2, y: 0.4 }
    const expectedPoints = {
      0: { x: 0.2, y: 0.4 },
      90: { x: 0.4, y: 0.8 },
      180: { x: 0.8, y: 0.6 },
      270: { x: 0.6, y: 0.2 },
    }
    for (const rotation of [0, 90, 180, 270]) {
      expect(mapAnalysisPointToViewerOverlay(point.x, point.y, rotation)).toEqual(
        expectedPoints[rotation],
      )
    }

    const rect = { x0: 0.1, y0: 0.2, x1: 0.35, y1: 0.6 }
    expect(mapAnalysisAxisRectToViewerOverlay(rect, 0)).toMatchObject(rect)
    expect(mapAnalysisAxisRectToViewerOverlay(rect, 90)).toMatchObject({
      x0: 0.2,
      y0: 0.65,
      x1: 0.6,
      y1: 0.9,
    })
    expect(mapAnalysisAxisRectToViewerOverlay(rect, 180)).toMatchObject({
      x0: 0.65,
      y0: 0.4,
      x1: 0.9,
      y1: 0.8,
    })
    expect(mapAnalysisAxisRectToViewerOverlay(rect, 270)).toMatchObject({
      x0: 0.4,
      y0: 0.1,
      x1: 0.8,
      y1: 0.35,
    })
  })

  it('lands an analysis point at the same display percentage on a non-square page', () => {
    const sourceSize = { width: 612, height: 792 }
    const analysis = { x: 0.17, y: 0.63 }

    for (const rotation of [0, 90, 180, 270]) {
      const overlay = mapAnalysisPointToViewerOverlay(
        analysis.x,
        analysis.y,
        rotation,
      )
      const displayed = cssRotateOverlayPoint(overlay, sourceSize, rotation)
      expect(displayed.x).toBeCloseTo(analysis.x * displayed.displayWidth, 8)
      expect(displayed.y).toBeCloseTo(analysis.y * displayed.displayHeight, 8)

      // Pointer coordinates normalized against getBoundingClientRect() are
      // already display/analysis coordinates; no inverse rotation belongs here.
      const pointer = normalizeViewerDisplayPoint(
        displayed.x / displayed.displayWidth,
        displayed.y / displayed.displayHeight,
      )
      expect(pointer.x).toBeCloseTo(analysis.x, 8)
      expect(pointer.y).toBeCloseTo(analysis.y, 8)
    }
  })

  it('clamps transformed-display pointer coordinates without rotating them', () => {
    expect(normalizeViewerDisplayPoint(-0.2, 1.4)).toEqual({ x: 0, y: 1 })
    expect(normalizeViewerDisplayPoint(0.3, 0.7)).toEqual({ x: 0.3, y: 0.7 })
  })
})
