import { describe, expect, it } from 'vitest'
import {
  LEGACY_MIN_NOTEHEADS,
  LEGACY_MSCORE_GLYPH_MAP,
  normalizeLegacyMusicFontGlyphs,
} from '../src/features/omr/normalizeLegacyMusicFontGlyphs.js'
import {
  hasVectorOmrNoteheads,
  textGlyphsToImage,
} from '../src/features/omr/processVectorOmrPage.js'
import { restsForMeasure } from '../src/features/omr/detectVectorRests.js'

const LEGACY_BLACK = '\ue12d'
const LEGACY_HALF = '\ue12c'
const LEGACY_TREBLE_CLEF = '\ue19e'
const LEGACY_BASS_CLEF = '\ue19c'
const LEGACY_BASS_CLEF_8VB = '\ue1db'
const LEGACY_QUARTER_REST = '\ue107'
const LEGACY_EIGHTH_REST = '\ue109'
const LEGACY_SIXTEENTH_REST = '\ue10a'
const SMUFL_BLACK = '\ue0a4'
const SMUFL_HALF = '\ue0a3'
const SMUFL_TREBLE_CLEF = '\ue050'
const SMUFL_BASS_CLEF = '\ue062'
const ALTERNATE_MSCORE_SHARP = '\ue10e'
const ALTERNATE_MSCORE_NATURAL = '\ue113'
const ALTERNATE_MSCORE_FLAT = '\ue114'

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

  it('normalizes the legacy composite bass-clef-8vb glyph with provenance', () => {
    const page = legacyGrandStaffPage()
    page.push(item(LEGACY_BASS_CLEF_8VB))

    const { items } = normalizeLegacyMusicFontGlyphs(page)
    const normalized = items.find(
      (entry) => entry.originalLegacyText === LEGACY_BASS_CLEF_8VB,
    )

    expect(normalized?.text).toBe(SMUFL_BASS_CLEF)
    expect(normalized?.legacyMusicFontNormalized).toBe(true)
  })

  it('normalizes source-proven MScore rests for the vector rest detector', () => {
    const page = legacyGrandStaffPage()
    page.push(
      item(LEGACY_QUARTER_REST, 'music-font', { x: 180, y: 650 }),
      item(LEGACY_EIGHTH_REST, 'music-font', { x: 300, y: 650 }),
      item(LEGACY_SIXTEENTH_REST, 'music-font', { x: 420, y: 650 }),
    )

    const { items } = normalizeLegacyMusicFontGlyphs(page)
    const imageData = { width: 612, height: 792 }
    const rests = restsForMeasure(
      textGlyphsToImage(items, imageData),
      imageData,
      {
        x0: 0.1,
        x1: 0.8,
        y0: 0.1,
        y1: 0.3,
        staffLines: {
          treble: [0.14, 0.16, 0.18, 0.2, 0.22],
          bass: [0.3, 0.32, 0.34, 0.36, 0.38],
          splitY: 0.26,
        },
      },
      [],
    )

    expect(rests.map((rest) => rest.durationType)).toEqual([
      'quarter',
      'eighth',
      'sixteenth',
    ])
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

  it('maps alternate MScore subset accidentals only on a proven legacy music font', () => {
    const page = legacyGrandStaffPage()
    page.push(item(ALTERNATE_MSCORE_SHARP.repeat(6), 'music-font'))
    page.push(item(ALTERNATE_MSCORE_NATURAL.repeat(3), 'music-font'))
    page.push(item(ALTERNATE_MSCORE_FLAT.repeat(4), 'music-font'))
    page.push(item(
      `${ALTERNATE_MSCORE_SHARP}${ALTERNATE_MSCORE_NATURAL}${ALTERNATE_MSCORE_FLAT}`,
      'title-font',
    ))

    const { items, applied } = normalizeLegacyMusicFontGlyphs(page)
    expect(applied).toBe(true)
    expect(items.some((entry) => entry.fontName === 'music-font' && entry.text === '\ue262'.repeat(6))).toBe(true)
    expect(items.some((entry) => entry.fontName === 'music-font' && entry.text === '\ue261'.repeat(3))).toBe(true)
    expect(items.some((entry) => entry.fontName === 'music-font' && entry.text === '\ue260'.repeat(4))).toBe(true)
    expect(
      items.some(
        (entry) =>
          entry.fontName === 'title-font' &&
          entry.text ===
            `${ALTERNATE_MSCORE_SHARP}${ALTERNATE_MSCORE_NATURAL}${ALTERNATE_MSCORE_FLAT}`,
      ),
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
      const smuflCode = smufl.codePointAt(0)
      // SMuFL noteheads/clefs are in 0xE050-0xE0FF; accidentals are in
      // 0xE260-0xE264; rests are in 0xE4E3-0xE4E7.
      const isNoteheadOrClef = smuflCode >= 0xe050 && smuflCode <= 0xe0ff
      const isAccidental = smuflCode >= 0xe260 && smuflCode <= 0xe264
      const isRest = smuflCode >= 0xe4e3 && smuflCode <= 0xe4e7
      expect(isNoteheadOrClef || isAccidental || isRest).toBe(true)
    }
  })

  it('static normalization does not fire on dynamic-font pages (demo-minuet safety)', () => {
    // Simulate demo-minuet-in-g's g_d0_f3 font: low-PUA codepoints (U+0001, U+0004, etc.)
    // The static MScore path must skip these — they are handled by the dynamic path.
    const SHARP = '\u0004'
    const TREBLE = '\u0005'
    const NOTEHEAD = '\u0001'
    const page = [
      item(NOTEHEAD.repeat(100), 'g_d0_f3', { width: 7 }),
      item(SHARP.repeat(6), 'g_d0_f3', { width: 6 }),
      item(TREBLE.repeat(6), 'g_d0_f3', { width: 14 }),
    ]
    const { applied } = normalizeLegacyMusicFontGlyphs(page)
    expect(applied).toBe(false) // static path skips — dynamic path handles this
  })

  it('static normalization does not fabricate sharps on C-major pages', () => {
    // C-major fixture: noteheads + clefs, no accidentals.
    // The static path must not create false key signatures.
    const CLEF = '\u0005'
    const NOTEHEAD = '\u0001'
    const page = [
      item(NOTEHEAD.repeat(100), 'music-font', { width: 7 }),
      item(CLEF.repeat(6), 'music-font', { width: 14 }),
    ]
    const { applied } = normalizeLegacyMusicFontGlyphs(page)
    expect(applied).toBe(false) // no MScore legacy noteheads → static skips
})

  it('regression: demo-minuet U+0007 half-notehead detection must not overfire', () => {
    // The dynamic font path for demo-minuet-in-g's g_d0_f3 font uses low-PUA codepoints.
    // U+0007 appears 5 times in the font but 0 times in measure 1 bass staff (where
    // ground-truth expects G3/B3/D4 half-noteheads). A classifier that maps U+0007
    // to half-notehead in this font creates +17 extra notes and +8 missing notes
    // across the Tier A corpus (see da0732c revert).
    const SHARP = '\u0004'
    const TREBLE = '\u0005'
    const NOTEHEAD_BLACK = '\u0001'
    const NOTEHEAD_HALF_U0007 = '\u0007'
    const page = [
      item(NOTEHEAD_BLACK.repeat(100), 'g_d0_f3', { width: 7 }),
      item(NOTEHEAD_HALF_U0007.repeat(5), 'g_d0_f3', { width: 7 }),
      item(SHARP.repeat(6), 'g_d0_f3', { width: 6 }),
      item(TREBLE.repeat(6), 'g_d0_f3', { width: 14 }),
    ]
    const { applied } = normalizeLegacyMusicFontGlyphs(page)
    expect(applied).toBe(false) // dynamic font pages skip static path
  })

})
