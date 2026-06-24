import { describe, expect, it } from 'vitest'
import {
  BARLINE_REJECT_REASON,
  detectBarlineCandidates,
  splitGrandStaffVerticalBands,
} from '../src/features/score-follow/detectBarlinesInSystem.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import {
  assessBarlineReliability,
  detectStaffLineSystems,
} from '../src/features/score-follow/detectStaffLines.js'
import {
  summarizeBarlineDiagnostics,
  summarizeBarlineRejections,
} from '../src/features/score-follow/pdfPageAnalysis.js'
import {
  cleanPianoPage,
  densePianoPage,
  lightClassicalPage,
  multiPageScore,
  unevenMeasurePage,
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
    const { positions, diagnostics } = detectBarlineCandidates(page, bounds, system)
    expect(positions.length).toBe(5)
    expect(diagnostics.retainedLowConfidence).toBe(0)
    expect(diagnostics.densityAmbiguous).toBe(false)
  })

  it('thins dense stem grids conservatively with ambiguity diagnostics', () => {
    const page = densePianoPage({ systems: 1, measuresPerSystem: 6 })
    const bounds = detectContentBounds(page)
    const system = { y0: page.systemBands[0].top / page.height, y1: page.systemBands[0].bottom / page.height }
    const { positions, diagnostics } = detectBarlineCandidates(page, bounds, system)
    expect(positions.length).toBeGreaterThanOrEqual(5)
    expect(positions.length).toBeLessThanOrEqual(12)
    expect(diagnostics.candidatesRaw).toBeGreaterThan(positions.length)
    const totalRejected = Object.values(diagnostics.rejected).reduce((a, b) => a + b, 0)
    expect(totalRejected).toBeGreaterThan(0)
    expect(diagnostics.thinningRemoved).toBeGreaterThan(0)
    expect(diagnostics.densityAmbiguous).toBe(false)
    expect(summarizeBarlineDiagnostics(diagnostics)).toMatch(/too-dense=|thinning-removed=/)
  })

  it('clears density ambiguity after thinning when final spacing is healthy', () => {
    const page = densePianoPage({ systems: 1, measuresPerSystem: 6 })
    const bounds = detectContentBounds(page)
    const system = { y0: page.systemBands[0].top / page.height, y1: page.systemBands[0].bottom / page.height }
    const { positions, diagnostics } = detectBarlineCandidates(page, bounds, system)
    expect(diagnostics.thinningRemoved).toBeGreaterThan(0)
    expect(diagnostics.densityAmbiguous).toBe(false)
    const reliability = assessBarlineReliability(positions, bounds, diagnostics)
    expect(reliability.measureWidthFrac).toBeGreaterThanOrEqual(0.055)
    expect(reliability.confident).toBe(false)
    expect(reliability.reason).toBe('density-thinned')
  })

  it('discounts stem signals when inter-staff gap continuity is strong', () => {
    const page = densePianoPage({ systems: 1, measuresPerSystem: 6 })
    const bounds = detectContentBounds(page)
    const system = { y0: page.systemBands[0].top / page.height, y1: page.systemBands[0].bottom / page.height }
    const { diagnostics } = detectBarlineCandidates(page, bounds, system)
    // Multi-signal path routes most stem grid pixels to weak-run, not a single stem-like bucket.
    expect(
      (diagnostics.rejected[BARLINE_REJECT_REASON.WEAK_RUN] ?? 0) +
        (diagnostics.rejected[BARLINE_REJECT_REASON.STEM_LIKE] ?? 0) +
        (diagnostics.rejected[BARLINE_REJECT_REASON.TOO_DENSE] ?? 0),
    ).toBeGreaterThan(0)
    expect(summarizeBarlineRejections(diagnostics.rejected)).toBeTruthy()
  })

  it('keeps light classical barlines unchanged', () => {
    const page = lightClassicalPage({ systems: 2, measuresPerSystem: 4 })
    const bounds = detectContentBounds(page)
    const { systems } = detectStaffLineSystems(page, bounds, { stavesPerSystem: 2 })
    for (const system of systems) {
      expect(system.barlineConfident).toBe(true)
      expect(system.measureEstimate).toBe(4)
      expect(system.barlineRetainedLowConfidence).toBe(0)
      expect(system.barlineDensityAmbiguous).toBe(false)
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

  it('keeps uneven-measure sparse systems confident', () => {
    const page = unevenMeasurePage()
    const bounds = detectContentBounds(page)
    const { systems } = detectStaffLineSystems(page, bounds, { stavesPerSystem: 2 })
    for (const system of systems) {
      expect(system.barlineConfident).toBe(true)
      expect(system.barlineDensityAmbiguous).toBe(false)
    }
  })

  it('downgrades dense ambiguous grids without forcing a measure count', () => {
    const page = densePianoPage({ systems: 1, measuresPerSystem: 6 })
    const bounds = detectContentBounds(page)
    const { systems } = detectStaffLineSystems(page, bounds, { stavesPerSystem: 2 })
    const system = systems[0]
    expect(system.barlineThinningRemoved).toBeGreaterThan(0)
    expect(system.barlineConfident).toBe(false)
    expect(system.measureEstimate).toBeNull()
    expect(['density-thinned', 'ambiguous-density', 'barline-grid-too-dense']).toContain(
      system.barlineReliabilityReason,
    )
    const reliability = assessBarlineReliability(
      Array.from({ length: 12 }, (_, i) => 0.08 + i * 0.03),
      bounds,
      {
        densityAmbiguous: true,
        retainedLowConfidence: 0,
        rejected: { [BARLINE_REJECT_REASON.TOO_DENSE]: 8 },
        thinningRemoved: 8,
      },
    )
    expect(reliability.confident).toBe(false)
    expect(reliability.confidenceLevel).not.toBe('high')
    expect(['ambiguous-density', 'barline-grid-too-dense']).toContain(reliability.reason)
  })

  it('keeps confident measure counts when spacing is healthy despite borderline candidates', () => {
    const bounds = { x0: 0.08, x1: 0.92 }
    const positions = [0.08, 0.23, 0.38, 0.53, 0.68, 0.83, 0.92]
    const reliability = assessBarlineReliability(positions, bounds, {
      retainedLowConfidence: 2,
      densityAmbiguous: false,
      rejected: {},
    })
    expect(reliability.confident).toBe(true)
    expect(reliability.confidenceLevel).toBe('medium')
  })
})
