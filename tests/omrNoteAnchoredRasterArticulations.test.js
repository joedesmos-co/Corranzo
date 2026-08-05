import { describe, expect, it } from 'vitest'
import { assignNoteAnchoredRasterArticulations } from '../src/features/omr/detectNoteAnchoredRasterArticulations.js'
import { detectStaccatoOnNote } from '../src/features/omr/detectOmrExpression.js'

function blankImage(width = 180, height = 220) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(255),
  }
}

function fillRect(imageData, x0, y0, w, h, value = 0) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) continue
      const i = (y * imageData.width + x) * 4
      imageData.data[i] = value
      imageData.data[i + 1] = value
      imageData.data[i + 2] = value
      imageData.data[i + 3] = 255
    }
  }
}

const measureBox = {
  staffLines: {
    treble: [0.45, 0.5, 0.55, 0.6, 0.65],
  },
}

function paintAccentWedge(imageData, cx, topY) {
  // Compact left-heavy hollow chevron that stays inside the note-local crop.
  fillRect(imageData, cx - 5, topY, 10, 2)
  fillRect(imageData, cx - 5, topY + 2, 4, 6)
  fillRect(imageData, cx + 2, topY + 2, 2, 6)
  fillRect(imageData, cx - 3, topY + 7, 6, 2)
}

describe('assignNoteAnchoredRasterArticulations', () => {
  it('detects staccato above an up-stem-like chord column', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 80, 132, 8, 8)
    fillRect(imageData, 20, 99, 140, 1)
    fillRect(imageData, 82, 92, 3, 3)
    const noteheads = [
      { cx: 84, cy: 122, clef: 'treble' },
      { cx: 84, cy: 136, clef: 'treble' },
    ]
    const result = assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(result.staccatoColumns).toBe(1)
    expect(noteheads.every((note) => note.articulation?.type === 'staccato')).toBe(true)
  })

  it('detects staccato below a down-stem-like column', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 108, 8, 8)
    fillRect(imageData, 82, 138, 3, 3)
    const noteheads = [{ cx: 84, cy: 112, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation?.type).toBe('staccato')
    expect(noteheads[0].articulation?.placement).toBe('below')
  })

  it('broadcasts a chord staccato to mates', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 108, 8, 8)
    fillRect(imageData, 80, 120, 8, 8)
    fillRect(imageData, 80, 132, 8, 8)
    // Far enough above the top chord tone (topCy=112) for the staccato gap rule.
    fillRect(imageData, 82, 82, 3, 3)
    const noteheads = [
      { cx: 84, cy: 112, clef: 'treble' },
      { cx: 84, cy: 124, clef: 'treble' },
      { cx: 84, cy: 136, clef: 'treble' },
    ]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads.every((note) => note.articulation?.type === 'staccato')).toBe(true)
  })

  it('detects an accent wedge above a note', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    paintAccentWedge(imageData, 84, 88)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    const result = assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(result.accentColumns).toBe(1)
    expect(noteheads[0].accentArticulation?.type).toBe('accent')
  })

  it('detects an accent below a note', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 108, 8, 8)
    paintAccentWedge(imageData, 84, 132)
    const noteheads = [{ cx: 84, cy: 112, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].accentArticulation?.type).toBe('accent')
    expect(noteheads[0].accentArticulation?.placement).toBe('below')
  })

  it('broadcasts a chord accent', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 80, 130, 8, 8)
    paintAccentWedge(imageData, 84, 88)
    const noteheads = [
      { cx: 84, cy: 122, clef: 'treble' },
      { cx: 84, cy: 134, clef: 'treble' },
    ]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads.every((note) => note.accentArticulation?.type === 'accent')).toBe(true)
  })

  it('does not emit tenuto from a short horizontal stroke in this pass', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 76, 88, 14, 2)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation?.type === 'tenuto').toBe(false)
  })

  it('does not treat an augmentation-dot-like mark beside the head as staccato', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 92, 120, 3, 3)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation).toBeUndefined()
  })

  it('rejects a full staff line as tenuto', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 20, 99, 140, 1)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation).toBeUndefined()
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('rejects a ledger-like short dense row spanning the crop as tenuto', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 60, 90, 50, 1)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation?.type === 'tenuto').toBe(false)
  })

  it('rejects a stem hairline', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 90, 80, 1, 40)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation).toBeUndefined()
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('rejects a beam-like thick horizontal band as accent when it spans the patch', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 50, 85, 70, 3)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('rejects a slur-like long thin arc fragment as accent', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    // sparse arc crumbs spanning wide
    for (let x = 40; x < 130; x += 3) {
      fillRect(imageData, x, 70 + Math.floor((x - 40) / 20), 2, 1)
    }
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('rejects a crop-edge-touching arc band as accent (clipped slur)', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    // Continuous arc through the above-patch that hits both crop sides.
    for (let x = 60; x <= 110; x += 1) {
      const y = 90 + Math.round(((x - 84) * (x - 84)) / 220)
      fillRect(imageData, x, y, 2, 2)
    }
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('rejects a single diagonal stroke as accent', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    for (let i = 0; i < 14; i += 1) {
      fillRect(imageData, 76 + i, 90 + Math.floor(i * 0.35), 2, 1)
    }
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('rejects a flat near-head ink crumb as accent', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    // 7×3 band just above the head — slur/stem junction crumb
    fillRect(imageData, 80, 108, 7, 3)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('accepts a compact two-stroke wedge that stays inside the crop', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    // Near-square hollow chevron with left/right imbalance
    fillRect(imageData, 79, 90, 9, 2)
    fillRect(imageData, 79, 92, 3, 6)
    fillRect(imageData, 85, 92, 2, 6)
    fillRect(imageData, 81, 97, 5, 2)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].accentArticulation?.type).toBe('accent')
  })

  it('rejects accidental-like ink left of the head', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    fillRect(imageData, 60, 112, 4, 14)
    fillRect(imageData, 58, 116, 8, 2)
    fillRect(imageData, 58, 122, 8, 2)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation).toBeUndefined()
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('rejects a text-like digit blob above the staff as articulation', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    // tall narrow glyph unlike staccato/accent/tenuto
    fillRect(imageData, 78, 70, 5, 14)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation).toBeUndefined()
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('keeps separate ownership for two nearby voice columns', () => {
    const imageData = blankImage(260, 220)
    fillRect(imageData, 70, 118, 8, 8)
    fillRect(imageData, 72, 92, 3, 3)
    fillRect(imageData, 150, 118, 8, 8)
    paintAccentWedge(imageData, 154, 88)
    const noteheads = [
      { cx: 74, cy: 122, clef: 'treble' },
      { cx: 154, cy: 122, clef: 'treble' },
    ]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation?.type).toBe('staccato')
    expect(noteheads[1].accentArticulation?.type).toBe('accent')
  })

  it('rejects ambiguous multi-crumb staccato patches', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    // Two dense dots in the valid staccato band — slur fragmentation, not one mark.
    fillRect(imageData, 78, 88, 3, 3)
    fillRect(imageData, 88, 92, 3, 3)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation).toBeUndefined()
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('rejects a near-head staccato-sized slur crumb', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    // Dense crumb hugging the head (dy < ~2 staff spaces)
    fillRect(imageData, 82, 108, 3, 3)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation).toBeUndefined()
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('does not invent articulations from an empty ambiguous patch', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 118, 8, 8)
    const noteheads = [{ cx: 84, cy: 122, clef: 'treble' }]
    assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, 170)
    expect(noteheads[0].articulation).toBeUndefined()
    expect(noteheads[0].accentArticulation).toBeUndefined()
  })

  it('leaves the legacy vector-oriented detectStaccatoOnNote helper intact', () => {
    const imageData = blankImage()
    fillRect(imageData, 80, 114, 8, 8)
    fillRect(imageData, 82, 106, 3, 3)
    const hit = detectStaccatoOnNote(imageData, { cx: 84, cy: 118 }, 170)
    expect(hit?.type).toBe('staccato')
  })
})
