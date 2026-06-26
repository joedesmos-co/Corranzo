import { describe, expect, it } from 'vitest'
import {
  mapAnalysisPointToViewerOverlay,
  mapViewerOverlayToAnalysisPoint,
} from '../src/utils/analysisViewerCoords.js'

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
})
