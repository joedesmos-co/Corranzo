import { describe, expect, it } from 'vitest'
import { buildPracticeGuidance } from '../src/features/import/practiceGuidance.js'
import { buildOmrGeneratedWarnings } from '../src/features/import/useImportReadiness.js'
import { OMR_DISCLAIMER } from '../src/features/omr/omrMusicalConstants.js'

describe('practice UX polish — no happy-path onboarding copy', () => {
  it('returns no instructional steps when PDF and timing are ready', () => {
    expect(
      buildPracticeGuidance({
        hasPdf: true,
        hasMidi: false,
        hasMusicXml: true,
        timingReady: true,
        timingError: null,
        midiError: null,
        isDemoPiece: false,
      }),
    ).toEqual([])

    expect(
      buildPracticeGuidance({
        hasPdf: true,
        hasMidi: true,
        hasMusicXml: true,
        timingReady: true,
        timingError: null,
        midiError: null,
        midiPlayable: true,
        isDemoPiece: true,
      }),
    ).toEqual([])
  })

  it('does not coach Press Play or cursor setup on the happy path', () => {
    const steps = buildPracticeGuidance({
      hasPdf: true,
      hasMusicXml: true,
      hasMidi: false,
      timingReady: true,
    }).join(' ')
    expect(steps).not.toMatch(/Press Play/)
    expect(steps).not.toMatch(/Score cursor may need/)
    expect(steps).not.toMatch(/Generated from PDF/)
  })

  it('keeps blocker guidance when timing is missing', () => {
    const steps = buildPracticeGuidance({
      hasPdf: true,
      hasMusicXml: false,
      hasMidi: false,
    })
    expect(steps.some((step) => /timing file/i.test(step))).toBe(true)
  })

  it('filters the OMR disclaimer out of Practice-visible OMR warnings', () => {
    const warnings = buildOmrGeneratedWarnings({
      source: 'omr',
      omrMeta: {
        warnings: [OMR_DISCLAIMER, 'Dense TAB notes detected on this page.'],
      },
    })
    expect(warnings.map((entry) => entry.message)).not.toContain(OMR_DISCLAIMER)
    expect(warnings.some((entry) => entry.message.includes('Dense TAB'))).toBe(true)
  })
})
