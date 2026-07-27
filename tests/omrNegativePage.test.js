import { describe, expect, it } from 'vitest'
import {
  classifyOmrNegativePage,
  isMusicalOmrStaffSystem,
  OMR_NEGATIVE_PAGE_KIND,
} from '../src/features/omr/classifyOmrNegativePage.js'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  decorativeCoverPage,
  renderPagesFromArray,
  rhythmicPianoPage,
} from './helpers/syntheticScore.js'

describe('OMR negative-page / decorative cover isolation', () => {
  it('rejects hatching and hairline systems as non-musical', () => {
    expect(
      isMusicalOmrStaffSystem({
        y0: 0,
        y1: 0.04,
        lineCount: 50,
        lineYs: [0.01, 0.012, 0.014, 0.016, 0.018],
        staveCount: 1,
        barlineConfident: false,
      }),
    ).toBe(false)
    expect(
      isMusicalOmrStaffSystem({
        y0: 0.2,
        y1: 0.201,
        lineCount: 4,
        lineYs: [],
        staveCount: 1,
        barlineConfident: false,
      }),
    ).toBe(false)
  })

  it('keeps confident and grand-staff systems as musical', () => {
    expect(
      isMusicalOmrStaffSystem({
        y0: 0.18,
        y1: 0.26,
        lineCount: 10,
        lineYs: [0.18, 0.19, 0.2, 0.21, 0.22],
        staveCount: 1,
        barlineConfident: true,
      }),
    ).toBe(true)
    expect(
      isMusicalOmrStaffSystem({
        y0: 0.19,
        y1: 0.33,
        lineCount: 0,
        lineYs: [],
        staveCount: 2,
        barlineConfident: true,
      }),
    ).toBe(true)
    expect(
      isMusicalOmrStaffSystem({
        y0: 0.2,
        y1: 0.254,
        lineCount: 32,
        lineYs: [0.2, 0.21, 0.22, 0.23, 0.24],
        staveCount: 1,
        barlineConfident: true,
      }),
    ).toBe(true)
  })

  it('classifies a page as no-music only when every system fails', () => {
    const none = classifyOmrNegativePage({
      systems: [
        { y0: 0, y1: 0.04, lineCount: 40, lineYs: [0.01, 0.012, 0.014, 0.016, 0.018], staveCount: 1 },
        { y0: 0.5, y1: 0.51, lineCount: 8, lineYs: [], staveCount: 1, barlineConfident: false },
      ],
    })
    expect(none.status).toBe(OMR_NEGATIVE_PAGE_KIND.NO_MUSIC)
    expect(none.kind).toBe('non-musical-page')

    const mixed = classifyOmrNegativePage({
      systems: [
        { y0: 0, y1: 0.04, lineCount: 40, lineYs: [0.01, 0.012, 0.014, 0.016, 0.018], staveCount: 1 },
        {
          y0: 0.2,
          y1: 0.28,
          lineCount: 10,
          lineYs: [0.2, 0.21, 0.22, 0.23, 0.24],
          staveCount: 1,
          barlineConfident: true,
        },
      ],
    })
    expect(mixed.status).toBe(OMR_NEGATIVE_PAGE_KIND.MUSIC)
    expect(mixed.musicalSystemCount).toBe(1)
  })

  it('isolates a decorative cover so it cannot emit playable events', async () => {
    let rejection
    try {
      await runPdfOmrPipeline('synthetic', {
        numPages: 1,
        preprocessPages: false,
        renderPage: renderPagesFromArray([decorativeCoverPage()]),
        title: 'decorative-cover',
      })
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBeInstanceOf(Error)
    expect(rejection.code === 'no-notes' || rejection.code === 'no-systems' || rejection.difficulty?.tooDifficult).toBe(
      true,
    )
    expect(rejection.noteCount ?? 0).toBe(0)
  })

  it('does not damage a healthy music page', async () => {
    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 1,
      preprocessPages: false,
      renderPage: renderPagesFromArray([rhythmicPianoPage({ measuresPerSystem: 2 })]),
      title: 'healthy-music-negative-page-guard',
    })
    expect(result.noteCount).toBeGreaterThan(0)
    expect(result.diagnostics?.partialRecovery?.isolatedRegions ?? []).toEqual([])
  })

  it('isolates a decorative cover beside a healthy music page without wiping music', async () => {
    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 2,
      preprocessPages: false,
      renderPage: renderPagesFromArray([
        decorativeCoverPage(),
        rhythmicPianoPage({ measuresPerSystem: 2 }),
      ]),
      title: 'cover-then-music',
      allowPartialRecovery: true,
    })
    expect(result.noteCount).toBeGreaterThan(0)
    const isolated = result.diagnostics?.partialRecovery?.isolatedRegions ?? []
    expect(isolated.some((entry) => entry.page === 1)).toBe(true)
    expect(isolated.some((entry) => entry.kind === 'non-musical-page' || entry.kind === 'no-staff-systems')).toBe(
      true,
    )
  })
})
