import { describe, expect, it } from 'vitest'
import { filterPairedTabMirrorSystemEntries } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  GUITAR_SCORE_TARGET,
  detectGuitarScoreTargetAvailability,
  normalizeGuitarScoreTarget,
  scopeScoreFollowIdentityForGuitarTarget,
} from '../src/features/score-follow/guitarScoreTarget.js'

function systemWithLines(lineCount, center) {
  return {
    center,
    y0: center - 0.02,
    y1: center + 0.02,
    staves: [
      {
        lineYs: Array.from({ length: lineCount }, (_, index) => center + index * 0.01),
      },
    ],
  }
}

const pairedTimingMap = {
  notation: {
    hasStandardStaff: true,
    hasTabStaff: true,
  },
  notes: [{ id: 'n1' }, { id: 'tab-1', isTabMirror: true }],
}

describe('guitar score-follow display target preference', () => {
  it('detects notation + TAB as a selectable guitar target set', () => {
    const availability = detectGuitarScoreTargetAvailability(pairedTimingMap)

    expect(availability.mode).toBe('notation-tab')
    expect(availability.selectable).toBe(true)
    expect(availability.options.map((option) => option.target)).toEqual([
      GUITAR_SCORE_TARGET.NOTATION,
      GUITAR_SCORE_TARGET.TAB,
    ])
    expect(normalizeGuitarScoreTarget('missing', availability)).toBe(
      GUITAR_SCORE_TARGET.NOTATION,
    )
  })

  it('auto-selects the only available target for TAB-only and notation-only guitar scores', () => {
    const tabOnly = detectGuitarScoreTargetAvailability({
      notation: { hasStandardStaff: false, hasTabStaff: true },
    })
    expect(tabOnly.mode).toBe('tab-only')
    expect(tabOnly.selectable).toBe(false)
    expect(normalizeGuitarScoreTarget(GUITAR_SCORE_TARGET.NOTATION, tabOnly)).toBe(
      GUITAR_SCORE_TARGET.TAB,
    )

    const notationOnly = detectGuitarScoreTargetAvailability({
      notation: { hasStandardStaff: true, hasTabStaff: false },
    })
    expect(notationOnly.mode).toBe('notation-only')
    expect(notationOnly.selectable).toBe(false)
    expect(normalizeGuitarScoreTarget(GUITAR_SCORE_TARGET.TAB, notationOnly)).toBe(
      GUITAR_SCORE_TARGET.NOTATION,
    )
  })

  it('leaves piano score-follow identity unchanged', () => {
    const pianoAvailability = detectGuitarScoreTargetAvailability({
      notation: { hasStandardStaff: false, hasTabStaff: false },
    })

    expect(pianoAvailability.mode).toBe('none')
    expect(pianoAvailability.selectable).toBe(false)
    expect(scopeScoreFollowIdentityForGuitarTarget(
      'piano.pdf::123',
      pianoAvailability,
      GUITAR_SCORE_TARGET.TAB,
    )).toBe('piano.pdf::123')
  })

  it('keeps notation rows by default for paired notation + TAB systems', () => {
    const entries = [
      { page: 1, system: systemWithLines(5, 0.2), id: 'notation-1' },
      { page: 1, system: systemWithLines(6, 0.3), id: 'tab-1' },
      { page: 1, system: systemWithLines(5, 0.5), id: 'notation-2' },
      { page: 1, system: systemWithLines(6, 0.6), id: 'tab-2' },
    ]

    const result = filterPairedTabMirrorSystemEntries(entries, pairedTimingMap)

    expect(result.applied).toBe(true)
    expect(result.target).toBe(GUITAR_SCORE_TARGET.NOTATION)
    expect(result.entries.map((entry) => entry.id)).toEqual(['notation-1', 'notation-2'])
  })

  it('can keep TAB rows as the cursor target without duplicating systems', () => {
    const entries = [
      { page: 1, system: systemWithLines(5, 0.2), id: 'notation-1' },
      { page: 1, system: systemWithLines(6, 0.3), id: 'tab-1' },
      { page: 1, system: systemWithLines(5, 0.5), id: 'notation-2' },
      { page: 1, system: systemWithLines(6, 0.6), id: 'tab-2' },
    ]

    const result = filterPairedTabMirrorSystemEntries(entries, pairedTimingMap, {
      target: GUITAR_SCORE_TARGET.TAB,
    })

    expect(result.applied).toBe(true)
    expect(result.target).toBe(GUITAR_SCORE_TARGET.TAB)
    expect(result.entries.map((entry) => entry.id)).toEqual(['tab-1', 'tab-2'])
  })

  it('stores TAB target anchors separately while preserving notation as the default key', () => {
    const availability = detectGuitarScoreTargetAvailability(pairedTimingMap)

    expect(scopeScoreFollowIdentityForGuitarTarget(
      'guitar.pdf::123',
      availability,
      GUITAR_SCORE_TARGET.NOTATION,
    )).toBe('guitar.pdf::123')
    expect(scopeScoreFollowIdentityForGuitarTarget(
      'guitar.pdf::123',
      availability,
      GUITAR_SCORE_TARGET.TAB,
    )).toBe('guitar.pdf::123::guitar-score-target=tab')
  })
})
