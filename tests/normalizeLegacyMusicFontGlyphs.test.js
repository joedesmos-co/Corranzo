import { describe, expect, it } from 'vitest'
import {
  LEGACY_MIN_NOTEHEADS,
  LEGACY_MSCORE_GLYPH_MAP,
  normalizeLegacyMusicFontGlyphs,
} from '../src/features/omr/normalizeLegacyMusicFontGlyphs.js'
import { hasVectorOmrNoteheads } from '../src/features/omr/processVectorOmrPage.js'

const LEGACY_BLACK = '\ue12d'
const LEGACY_HALF = '\ue12c'
const LEGACY_TREBLE_CLEF = '\ue19e'
const LEGACY_BASS_CLEF = '\ue19c'
const SMUFL_BLACK = '\ue0a4'
const SMUFL_HALF = '\ue0a3'
const SMUFL_TREBLE_CLEF = '\ue050'
const SMUFL_BASS_CLEF = '\ue062'

function item(text, fontName = 'music-font', overrides = {}) {
  return {
    text,
    x: 10,
    y: 10,
    width: 8,
    height: 8,
    fontName,
    pageWidth: 612,
    pageHeight: 792,
    ...overrides,
  }
}

function legacyGrandStaffPage() {
  // A simple grand-staff beat: one treble + one bass notehead at the same x,
  // plus enough surrounding noteheads to clear the vector quorum — the shape
  // of the musescore.com/TCPDF beginner PDFs that used to fall back to the
  // raster path and hallucinate extra notes.
  const items = [
    item(LEGACY_TREBLE_CLEF),
    item(LEGACY_BASS_CLEF),
    item('4'),
    item('4'),
    item(LEGACY_HALF),
  ]
  for (let index = 0; index < LEGACY_MIN_NOTEHEADS; index += 1) {
    items.push(item(LEGACY_BLACK, 'music-font', { x: 40 + index * 20 }))
  }
  items.push(item('Twinkle, Twinkle, Little Star', 'title-font'))
  items.push(item('3', 'fingering-font'))
  return items
}

describe('normalizeLegacyMusicFontGlyphs', () => {
  it('maps legacy MScore noteheads and clefs to SMuFL', () => {
    const { items, applied, diagnostics } = normalizeLegacyMusicFontGlyphs(
      legacyGrandStaffPage(),
    )
    expect(applied).toBe(true)
    expect(diagnostics.legacyNoteheadCount).toBeGreaterThanOrEqual(LEGACY_MIN_NOTEHEADS)
    const text = items.map((entry) => entry.text).join('')
    expect(text).toContain(SMUFL_BLACK)
    expect(text).toContain(SMUFL_HALF)
    expect(text).toContain(SMUFL_TREBLE_CLEF)
    expect(text).toContain(SMUFL_BASS_CLEF)
    expect(text).not.toContain(LEGACY_BLACK)
    expect(text).not.toContain(LEGACY_HALF)
  })

  it('routes legacy pages onto the vector path (2 same-beat notes stay 2 notes)', () => {
    const source = legacyGrandStaffPage()
    expect(hasVectorOmrNoteheads(source)).toBe(false)
    const { items } = normalizeLegacyMusicFontGlyphs(source)
    expect(hasVectorOmrNoteheads(items)).toBe(true)
    // Glyph count is preserved 1:1 — normalization cannot invent noteheads.
    const noteheads = items
      .map((entry) => entry.text)
      .join('')
      .split('')
      .filter((char) => char === SMUFL_BLACK || char === SMUFL_HALF)
    expect(noteheads).toHaveLength(LEGACY_MIN_NOTEHEADS + 1)
  })

  it('maps time-signature digits only inside the music font', () => {
    const { items } = normalizeLegacyMusicFontGlyphs(legacyGrandStaffPage())
    const musicDigits = items.filter(
      (entry) => entry.fontName === 'music-font' && entry.text === '\ue084',
    )
    expect(musicDigits).toHaveLength(2)
    // Fingering digit in a text font is untouched.
    expect(items.some((entry) => entry.fontName === 'fingering-font' && entry.text === '3')).toBe(
      true,
    )
    // Title text is untouched.
    expect(
      items.some((entry) => entry.text === 'Twinkle, Twinkle, Little Star'),
    ).toBe(true)
  })

  it('is the identity for SMuFL pages', () => {
    const page = [
      item(SMUFL_BLACK.repeat(LEGACY_MIN_NOTEHEADS)),
      item(SMUFL_TREBLE_CLEF),
      item('4'),
    ]
    const { items, applied } = normalizeLegacyMusicFontGlyphs(page)
    expect(applied).toBe(false)
    expect(items).toBe(page)
  })

  it('does not activate below the legacy notehead quorum', () => {
    const page = [item(LEGACY_BLACK), item(LEGACY_BLACK), item(LEGACY_TREBLE_CLEF)]
    const { items, applied } = normalizeLegacyMusicFontGlyphs(page)
    expect(applied).toBe(false)
    expect(items).toBe(page)
  })

  it('does not activate on mixed pages that already contain SMuFL noteheads', () => {
    const page = [
      item(SMUFL_BLACK),
      ...Array.from({ length: LEGACY_MIN_NOTEHEADS }, (_, index) =>
        item(LEGACY_BLACK, 'music-font', { x: index * 10 }),
      ),
    ]
    const { applied } = normalizeLegacyMusicFontGlyphs(page)
    expect(applied).toBe(false)
  })

  it('keeps every mapping inside the SMuFL ranges the pipeline consumes', () => {
    for (const [legacy, smufl] of LEGACY_MSCORE_GLYPH_MAP) {
      expect(legacy.codePointAt(0)).toBeGreaterThanOrEqual(0xe100)
      expect(legacy.codePointAt(0)).toBeLessThanOrEqual(0xe1ff)
      expect(smufl.codePointAt(0)).toBeGreaterThanOrEqual(0xe050)
      expect(smufl.codePointAt(0)).toBeLessThanOrEqual(0xe0ff)
    }
  })
})
