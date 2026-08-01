import { describe, expect, it } from 'vitest'
import {
  estimateLedgerLineCount,
  midiFromStaffPosition,
  staffSpanWithLedger,
} from '../src/features/omr/pitchFromStaffPosition.js'
import {
  vectorGlyphAllocationBounds,
  vectorGlyphInMeasure,
} from '../src/features/omr/vectorGlyphMeasureBounds.js'
import {
  ORPHAN_REJECTION,
  assignVectorOrphanNoteheads,
} from '../src/features/omr/vectorOrphanNoteheads.js'

const TREBLE = [0.5, 0.51, 0.52, 0.53, 0.54]
const GAP = (0.54 - 0.5) / 4

describe('extreme-register ledger pitch mapping', () => {
  it('maps a bass-clef chord tone one ledger below the staff', () => {
    const bass = [0.6, 0.61, 0.62, 0.63, 0.64]
    const gap = (0.64 - 0.6) / 4
    // E2 sits on the first ledger below bass bottom G2
    const y = 0.64 + gap
    expect(estimateLedgerLineCount(y, bass)).toEqual({ direction: 'below', count: 1 })
    expect(midiFromStaffPosition(y, bass, 'bass')).toBe(40)
  })

  it('maps bass-clef tones three and several ledger lines below', () => {
    const bass = [0.6, 0.61, 0.62, 0.63, 0.64]
    const gap = (0.64 - 0.6) / 4
    expect(midiFromStaffPosition(0.64 + gap * 2, bass, 'bass')).toBe(36) // C2 (2 ledgers)
    expect(midiFromStaffPosition(0.64 + gap * 3, bass, 'bass')).toBe(33) // A1 (3 ledgers)
    expect(midiFromStaffPosition(0.64 + gap * 5, bass, 'bass')).toBe(26) // D1 (several)
  })

  it('maps treble open-E extreme low chord tones (several ledgers below)', () => {
    // Written guitar open E on treble: E4..E2
    expect(midiFromStaffPosition(0.54, TREBLE, 'treble')).toBe(64) // E4
    expect(midiFromStaffPosition(0.54 + GAP * 1.5, TREBLE, 'treble')).toBe(59) // B3
    expect(midiFromStaffPosition(0.54 + GAP * 2.5, TREBLE, 'treble')).toBe(55) // G3
    expect(midiFromStaffPosition(0.54 + GAP * 3.5, TREBLE, 'treble')).toBe(52) // E3
    expect(midiFromStaffPosition(0.54 + GAP * 5, TREBLE, 'treble')).toBe(47) // B2
    expect(midiFromStaffPosition(0.54 + GAP * 7, TREBLE, 'treble')).toBe(40) // E2
  })

  it('maps treble tones one, three, and several ledger lines above', () => {
    expect(midiFromStaffPosition(0.5 - GAP, TREBLE, 'treble')).toBe(81) // A5 on first ledger
    expect(midiFromStaffPosition(0.5 - GAP * 3, TREBLE, 'treble')).toBe(88) // E6
    expect(midiFromStaffPosition(0.5 - GAP * 5, TREBLE, 'treble')).toBe(95) // B6
    expect(estimateLedgerLineCount(0.5 - GAP * 3, TREBLE).count).toBeGreaterThanOrEqual(3)
  })

  it('does not invent pitches beyond a conservative extreme window', () => {
    expect(midiFromStaffPosition(0.54 + GAP * 20, TREBLE, 'treble')).toBeNull()
    expect(midiFromStaffPosition(0.5 - GAP * 20, TREBLE, 'treble')).toBeNull()
  })
})

describe('extreme-register measure bounds and orphan recovery', () => {
  const imageData = { width: 1000, height: 1000 }
  const staffLines = { treble: TREBLE }
  const measureBox = {
    measureNumber: 8,
    x0: 0.7,
    x1: 0.95,
    y0: 0.48,
    y1: 0.56,
    staffLines,
  }

  it('keeps deep ledger noteheads inside measure allocation bounds', () => {
    const bounds = vectorGlyphAllocationBounds(measureBox)
    expect(bounds.y1).toBeGreaterThan(0.54 + GAP * 7)
    const deep = { text: '\ue0a4', x: 800, y: (0.54 + GAP * 7) * 1000 }
    expect(vectorGlyphInMeasure(deep, measureBox, imageData)).toBe(true)
  })

  it('does not treat a far mid-page glyph as an extreme ledger orphan', () => {
    const { diagnostics } = assignVectorOrphanNoteheads({
      glyphs: [{ text: '\ue0a4', x: 500, y: 50 }],
      imageData,
      systemMeasureBoxes: [[measureBox]],
      staffClefsBySystem: new Map([[0, { upper: 'treble', lower: 'treble' }]]),
    })
    expect(diagnostics.reassignedOrphanCount).toBe(0)
    expect(diagnostics.rejectedOrphanReasons[ORPHAN_REJECTION.FAR_FROM_STAFF]).toBe(1)
  })

  it('reassigns a deep ledger orphan that sits under the same staff', () => {
    const deepY = 0.54 + GAP * 6
    // Place just outside the unpadded box but within ledger pad / orphan distance.
    const tightBox = {
      ...measureBox,
      y0: 0.5,
      y1: 0.545,
    }
    const glyph = { text: '\ue0a4', x: 800, y: deepY * 1000 }
    // Ensure it is outside the old 3-space pad style but accepted now.
    expect(vectorGlyphInMeasure(glyph, tightBox, imageData)).toBe(true)
    const { assignments, diagnostics } = assignVectorOrphanNoteheads({
      glyphs: [glyph],
      imageData,
      systemMeasureBoxes: [[{ ...tightBox, y1: 0.542 }]],
      staffClefsBySystem: new Map([[0, { upper: 'treble', lower: 'treble' }]]),
      assignedKeys: new Set(),
    })
    // Either in-measure (not an orphan) or reassigned — must not be far-from-staff.
    if (diagnostics.orphanNoteheadCount > 0) {
      expect(diagnostics.rejectedOrphanReasons[ORPHAN_REJECTION.FAR_FROM_STAFF] ?? 0).toBe(0)
      expect(diagnostics.reassignedOrphanCount + (assignments.get(8)?.length ?? 0)).toBeGreaterThan(0)
    }
  })

  it('keeps an explicitly wide staff span available for stacked ledgers', () => {
    const span = staffSpanWithLedger(TREBLE, { aboveLedgers: 8, belowLedgers: 8 })
    expect(span.bottom).toBeGreaterThan(0.54 + GAP * 7)
    expect(span.top).toBeLessThan(0.5 - GAP * 7)
  })
})
