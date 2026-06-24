import { describe, expect, it } from 'vitest'
import {
  BARLINE_REJECT_REASON,
  detectBarlineCandidates,
  splitGrandStaffVerticalBands,
} from '../src/features/score-follow/detectBarlinesInSystem.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'
import { summarizeBarlineRejections } from '../src/features/score-follow/pdfPageAnalysis.js'
import {
  cleanPianoPage,
  densePianoPage,
  lightClassicalPage,
  multiPageScore,
} from './helpers/syntheticScore.js'

describe('detectBarlineCandidates — grand-staff barline vs stem classification', () => {
  it('splits a grand staff into treble, gap, and bass bands', () => {
    const page = cleanPianoPage({ systems: 2, measuresPerSystem: 4 })
    const bounds = detectContentBounds(page)
    const system = { y0: page.systemBands[0].top / page.height, y1: page.systemBands[0].bottom / page.height }
    const bands = splitGrandStaffVerticalBands(page, bounds, system)
    expect(bands.treble.y1).toBeLessThan(bands.bass.y0)
    expect(bands.gap.y1 - bands.gap.y0).toBeGreaterThan(0)
  })

  it('finds all barlines on a clean engraved system', () => {
    const page = cleanPianoPage({ systems: 1, measuresPerSystem: 4 })
    const bounds = detectContentBounds(page)
    const system = { y0: page.systemBands[0].top / page.height, y1: page.systemBands[0].bottom / page.height }
    const { positions } = detectBarlineCandidates(page, bounds, system)
    expect(positions.length).toBe(5)
  })

  it('thins dense stem grids to a plausible barline count with rejection diagnostics', () => {
    const page = densePianoPage({ systems: 1, measuresPerSystem: 6 })
    const bounds = detectContentBounds(page)
    const system = { y0: page.systemBands[0].top / page.height, y1: page.systemBands[0].bottom / page.height }
    const { positions, diagnostics } = detectBarlineCandidates(page, bounds, system)
    expect(positions.length).toBeGreaterThanOrEqual(5)
    expect(positions.length).toBeLessThanOrEqual(10)
    expect(diagnostics.candidatesRaw).toBeGreaterThan(positions.length)
    expect(diagnostics.rejected[BARLINE_REJECT_REASON.STEM_LIKE]).toBeGreaterThan(0)
    expect(summarizeBarlineRejections(diagnostics.rejected)).toMatch(/stem-like=/)
  })

  it('keeps light classical barlines unchanged', () => {
    const page = lightClassicalPage({ systems: 2, measuresPerSystem: 4 })
    const bounds = detectContentBounds(page)
    const { systems } = detectStaffLineSystems(page, bounds, { stavesPerSystem: 2 })
    for (const system of systems) {
      expect(system.barlineConfident).toBe(true)
      expect(system.measureEstimate).toBe(4)
    }
  })

  it('keeps multi-page barline counts per system', () => {
    const pages = multiPageScore({ pages: 2, systemsPerPage: 3, measuresPerSystem: 4 })
    for (const page of pages) {
      const bounds = detectContentBounds(page)
      const { systems } = detectStaffLineSystems(page, bounds, { stavesPerSystem: 2 })
      expect(systems.every((s) => s.barlineConfident && s.measureEstimate === 4)).toBe(true)
    }
  })
})
