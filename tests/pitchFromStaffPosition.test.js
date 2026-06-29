import { describe, expect, it } from 'vitest'
import {
  clefForY,
  detectStaffClefsFromGlyphs,
  midiFromStaffPosition,
  resolvePitchFromGrandStaff,
  resolveStaffRoleForY,
} from '../src/features/omr/pitchFromStaffPosition.js'

const GRAND_STAFF = {
  treble: [0.1, 0.12, 0.14, 0.16, 0.18],
  bass: [0.3, 0.32, 0.34, 0.36, 0.38],
  splitY: 0.24,
}

const DUAL_TREBLE_CLEFS = { upper: 'treble', lower: 'treble' }

describe('resolveStaffRoleForY', () => {
  it('keeps treble and bass staff roles on their respective staves', () => {
    expect(clefForY(0.14, GRAND_STAFF)).toBe('treble')
    expect(clefForY(0.34, GRAND_STAFF)).toBe('bass')
  })

  it('prefers nearest staff lines when splitY bisects the upper staff', () => {
    const tightSplit = { ...GRAND_STAFF, splitY: 0.15 }
    expect(clefForY(0.17, tightSplit)).toBe('treble')
  })
})

const CRUEL_ANGEL_STAFF = {
  treble: [0.134, 0.14, 0.146, 0.152, 0.158],
  bass: [0.196, 0.202, 0.208, 0.214, 0.22],
  splitY: 0.177,
}

describe('resolvePitchFromGrandStaff', () => {
  it('uses treble clef sign on both staves when the score is dual-treble', () => {
    const mapping = resolvePitchFromGrandStaff(0.2148, CRUEL_ANGEL_STAFF, DUAL_TREBLE_CLEFS)
    expect(mapping.clef).toBe('bass')
    expect(mapping.clefSign).toBe('treble')
    expect(mapping.midi).toBe(midiFromStaffPosition(0.2148, CRUEL_ANGEL_STAFF.bass, 'treble'))
    expect(mapping.midi).toBe(67)
  })

  it('keeps standard grand-staff mapping when lower staff uses bass clef', () => {
    const mapping = resolvePitchFromGrandStaff(0.34, GRAND_STAFF)
    expect(mapping.clefSign).toBe('bass')
    expect(mapping.midi).toBe(midiFromStaffPosition(0.34, GRAND_STAFF.bass, 'bass'))
  })

  it('exposes alternate staff candidate diagnostics', () => {
    const mapping = resolvePitchFromGrandStaff(0.17, GRAND_STAFF, DUAL_TREBLE_CLEFS)
    expect(mapping.yNorm).toBe(0.17)
    expect(mapping.staffBounds?.treble?.lines).toHaveLength(5)
    expect(mapping.alternateClefSign).toMatch(/^(treble|bass)$/)
  })
})

describe('detectStaffClefsFromGlyphs', () => {
  it('reads G and F clef glyphs near each staff', () => {
    const imageData = { width: 1000, height: 1000 }
    const staffClefs = detectStaffClefsFromGlyphs(
      [
        { text: '\uE050', x: 80, y: 140 },
        { text: '\uE050', x: 85, y: 340 },
      ],
      imageData,
      GRAND_STAFF,
    )
    expect(staffClefs.upper).toBe('treble')
    expect(staffClefs.lower).toBe('treble')
    expect(staffClefs.source).toBe('vector-glyph')
    expect(staffClefs.detections).toHaveLength(2)
  })
})
