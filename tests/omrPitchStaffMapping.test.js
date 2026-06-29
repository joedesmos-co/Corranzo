import { describe, expect, it } from 'vitest'
import {
  categorizePitchDeltaSemitones,
  PITCH_ERROR_CATEGORY,
  summarizePitchErrors,
} from '../src/features/omr/omrPitchErrorAnalysis.js'
import { normalizedStaffLineYs } from '../src/features/score-follow/detectStaffLines.js'
import {
  midiFromStaffPosition,
  resolveNoteheadYNorm,
  resolvePitchFromGrandStaff,
  staffSpanWithLedger,
} from '../src/features/omr/pitchFromStaffPosition.js'

const GRAND_STAFF = {
  treble: [0.134, 0.14, 0.146, 0.152, 0.158],
  bass: [0.196, 0.202, 0.208, 0.214, 0.22],
  splitY: 0.177,
}

describe('normalizedStaffLineYs', () => {
  it('picks five uniformly spaced rows from oversampled clusters', () => {
    const height = 1000
    const rows = [134, 140, 146, 152, 158, 159]
    const lineYs = normalizedStaffLineYs(rows, height)
    expect(lineYs).toHaveLength(5)
    const gaps = lineYs.slice(1).map((y, index) => y - lineYs[index])
    expect(Math.min(...gaps) / Math.max(...gaps)).toBeGreaterThan(0.75)
  })

  it('returns null when fewer than five rows are available', () => {
    expect(normalizedStaffLineYs([134, 140, 146, 152], 1000)).toBeNull()
  })
})

describe('resolveNoteheadYNorm', () => {
  it('applies a bounded center correction for notehead-sized glyphs', () => {
    const imageData = { height: 1000 }
    const lineYs = GRAND_STAFF.treble
    const glyph = { y: 146, height: 14 }
    const yNorm = resolveNoteheadYNorm(glyph, imageData, lineYs)
    expect(yNorm).toBeLessThan(glyph.y / imageData.height)
    expect(yNorm).toBeGreaterThan((glyph.y - glyph.height) / imageData.height)
  })
})

describe('resolveStaffRoleForY dense grand staff', () => {
  it('clips overlapping ledger spans at the split', () => {
    const trebleSpan = staffSpanWithLedger(GRAND_STAFF.treble, {
      clipBottom: GRAND_STAFF.splitY - 0.002,
    })
    const bassSpan = staffSpanWithLedger(GRAND_STAFF.bass, {
      clipTop: GRAND_STAFF.splitY + 0.002,
    })
    expect(trebleSpan.bottom).toBeLessThan(GRAND_STAFF.splitY)
    expect(bassSpan.top).toBeGreaterThan(GRAND_STAFF.splitY)
  })

  it('maps a dense lower-staff treble-clef note', () => {
    const mapping = resolvePitchFromGrandStaff(0.2148, GRAND_STAFF, {
      upper: 'treble',
      lower: 'treble',
    })
    expect(mapping.clef).toBe('bass')
    expect(mapping.clefSign).toBe('treble')
    expect(mapping.midi).toBe(midiFromStaffPosition(0.2148, GRAND_STAFF.bass, 'treble'))
  })

  it('uses bass clef for noteheads below the lower staff bottom line', () => {
    const mapping = resolvePitchFromGrandStaff(0.233, GRAND_STAFF, {
      upper: 'treble',
      lower: 'treble',
    })
    expect(mapping.clefSign).toBe('bass')
    expect(mapping.midi).toBe(midiFromStaffPosition(0.233, GRAND_STAFF.bass, 'bass'))
  })
})

describe('omrPitchErrorAnalysis', () => {
  it('categorizes interval buckets used in dense benchmarks', () => {
    expect(categorizePitchDeltaSemitones(1)).toBe(PITCH_ERROR_CATEGORY.ACCIDENTAL)
    expect(categorizePitchDeltaSemitones(-2)).toBe(PITCH_ERROR_CATEGORY.DIATONIC_STEP)
    expect(categorizePitchDeltaSemitones(24)).toBe(PITCH_ERROR_CATEGORY.OCTAVE)
    expect(categorizePitchDeltaSemitones(7)).toBe(PITCH_ERROR_CATEGORY.OTHER)
  })

  it('summarizes wrong-pitch histograms', () => {
    const summary = summarizePitchErrors([
      { measureNumber: 1, pitchDeltaSemitones: 2, truth: { label: 'C4' }, generated: { label: 'D4' } },
      { measureNumber: 1, pitchDeltaSemitones: -12, truth: { label: 'C5' }, generated: { label: 'C4' } },
    ])
    expect(summary.total).toBe(2)
    expect(summary.histogram[PITCH_ERROR_CATEGORY.DIATONIC_STEP]).toBe(1)
    expect(summary.histogram[PITCH_ERROR_CATEGORY.OCTAVE]).toBe(1)
  })
})
