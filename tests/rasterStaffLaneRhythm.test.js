import { describe, expect, it } from 'vitest'
import {
  filterRecoveredStemFragments,
  packRasterStaffLanes,
} from '../src/features/omr/assembleOmrMeasureRhythm.js'

function chord(clef, cx, durationDivisions, durationType) {
  return {
    type: 'note',
    clef,
    cx,
    positionInMeasure: cx / 100,
    durationDivisions,
    durationType,
    confidence: 0.9,
    notes: [{ midi: clef === 'bass' ? 48 : 72, clef }],
  }
}

describe('raster grand-staff rhythm packing', () => {
  it('preserves simultaneous treble quarters and bass halves in independent lanes', () => {
    const packed = packRasterStaffLanes(
      [
        chord('treble', 10, 4, 'quarter'),
        chord('treble', 30, 4, 'quarter'),
        chord('treble', 50, 4, 'quarter'),
        chord('treble', 70, 4, 'quarter'),
        chord('bass', 10, 8, 'half'),
        chord('bass', 50, 8, 'half'),
      ],
      { measureNumber: 1, page: 1 },
    )

    const treble = packed.events.filter((event) => event.clef === 'treble')
    const bass = packed.events.filter((event) => event.clef === 'bass')
    expect(treble.map((event) => event.startDivision)).toEqual([0, 4, 8, 12])
    expect(treble.map((event) => event.durationDivisions)).toEqual([4, 4, 4, 4])
    expect(bass.map((event) => event.startDivision)).toEqual([0, 8])
    expect(bass.map((event) => event.durationDivisions)).toEqual([8, 8])
    expect(packed.validation.packing).toBe('independent-staff-lanes')
    expect(packed.validation.valid).toBe(true)
  })

  it('aligns an incomplete lower lane to source-supported upper-staff columns', () => {
    const packed = packRasterStaffLanes(
      [
        chord('treble', 10, 4, 'quarter'),
        chord('treble', 30, 4, 'quarter'),
        chord('treble', 50, 4, 'quarter'),
        chord('treble', 70, 4, 'quarter'),
        chord('bass', 11, 4, 'quarter'),
        chord('bass', 49, 4, 'quarter'),
      ],
      { measureNumber: 1, page: 1 },
    )

    const bass = packed.events.filter((event) => event.clef === 'bass')
    expect(bass.map((event) => event.startDivision)).toEqual([0, 8])
    expect(bass.map((event) => event.durationDivisions)).toEqual([4, 4])
    expect(bass.map((event) => event.rhythmPacking)).toEqual([
      'cross-staff-column-aligned',
      'cross-staff-column-aligned',
    ])
  })

  it('never drops visible columns when geometric starts overlap', () => {
    const packed = packRasterStaffLanes(
      [
        chord('treble', 10, 4, 'quarter'),
        chord('treble', 12, 4, 'quarter'),
        chord('treble', 30, 4, 'quarter'),
        chord('treble', 50, 4, 'quarter'),
        chord('treble', 70, 4, 'quarter'),
        chord('bass', 10, 4, 'quarter'),
        chord('bass', 50, 4, 'quarter'),
      ],
      { measureNumber: 1, page: 1 },
    )

    expect(packed.events.filter((event) => event.clef === 'treble')).toHaveLength(5)
    expect(packed.validation.lanes.treble.fallback).toBe('preserving-even-lane')
  })
})

describe('recovered raster stem ownership', () => {
  it('removes an opposite-direction fragment pointing to an owned stem', () => {
    const lineYs = [0.2, 0.3, 0.4, 0.5, 0.6]
    const owner = {
      cx: 40,
      cy: 60,
      clef: 'treble',
      stem: { x: 46, tipY: 30, direction: 'up' },
      pitchMapping: { lineYs },
      detectionEvidence: { source: 'raster-morphology-core' },
    }
    const fragment = {
      cx: 50,
      cy: 42,
      clef: 'treble',
      stem: { x: 46, tipY: 60, direction: 'down' },
      pitchMapping: { lineYs },
      detectionEvidence: { recoveredBy: 'morphology-gap-strong-raster-shape' },
    }
    expect(filterRecoveredStemFragments([owner, fragment], 80)).toEqual([owner])
  })
})
