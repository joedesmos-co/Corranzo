/**
 * Legacy music-font glyph normalization for vector OMR.
 *
 * Some vector PDFs (notably musescore.com / TCPDF exports of beginner
 * arrangements) embed the legacy pre-SMuFL "MScore" music font instead of a
 * SMuFL font like Bravura. Their noteheads/clefs live at legacy private-use
 * codepoints, so the SMuFL-based vector OMR sees zero noteheads and silently
 * falls back to the much weaker raster path.
 *
 * This module maps legacy music-font codepoints to their SMuFL equivalents so
 * the vector pipeline can consume such pages unchanged. It is deliberately
 * conservative:
 *
 * - It only activates when a page has NO SMuFL noteheads and a clear quorum of
 *   legacy noteheads (mirrors the vector path's own notehead quorum).
 * - It only rewrites glyphs drawn in the music font(s) — the fonts that
 *   contain the legacy noteheads. Lyrics, fingering digits, and title text in
 *   other fonts are never touched.
 * - Codepoints without a proven mapping are left as-is (they are not SMuFL
 *   codepoints, so downstream consumers ignore them).
 *
 * Mapping provenance: derived from the embedded MScore font of a real TCPDF
 * export (glyph outline geometry + on-page position), not from guesswork:
 * black/half notehead counts matched ground truth exactly, and the G/F clef
 * assignment was verified against upper/lower staff positions and glyph
 * bounding boxes (G clef ~1.8em tall, F clef hangs below the baseline).
 */

// Legacy MScore codepoint → SMuFL codepoint.
export const LEGACY_MSCORE_GLYPH_MAP = new Map([
  ['\ue12b', '\ue0a2'], // whole notehead (adjacent to half/black in legacy font)
  ['\ue12c', '\ue0a3'], // half notehead
  ['\ue12d', '\ue0a4'], // black notehead
  ['\ue19e', '\ue050'], // G (treble) clef
  ['\ue19c', '\ue062'], // F (bass) clef
])

const LEGACY_NOTEHEAD_GLYPHS = new Set(['\ue12b', '\ue12c', '\ue12d'])
const SMUFL_NOTEHEAD_GLYPHS = new Set(['\ue0a2', '\ue0a3', '\ue0a4'])

// SMuFL time-signature digits start at U+E080 (timeSig0..timeSig9). Legacy
// music fonts draw time-signature digits as ASCII digits in the music font.
const SMUFL_TIME_SIG_DIGIT_BASE = 0xe080
const ASCII_ZERO = 0x30
const ASCII_NINE = 0x39

// Mirrors VECTOR_MIN_NOTEHEADS in processVectorOmrPage.js: the vector path
// only engages with a quorum of noteheads, so normalizing below that quorum
// could never flip a page to the vector path anyway.
export const LEGACY_MIN_NOTEHEADS = 12

function countGlyphs(pageText, glyphSet) {
  let count = 0
  for (const item of pageText) {
    for (const char of item.text ?? '') {
      if (glyphSet.has(char)) {
        count += 1
      }
    }
  }
  return count
}

function collectMusicFontNames(pageText) {
  const fontNames = new Set()
  for (const item of pageText) {
    const text = item.text ?? ''
    for (const char of text) {
      if (LEGACY_NOTEHEAD_GLYPHS.has(char)) {
        fontNames.add(item.fontName ?? '')
        break
      }
    }
  }
  return fontNames
}

function mapMusicFontChar(char) {
  const mapped = LEGACY_MSCORE_GLYPH_MAP.get(char)
  if (mapped) {
    return mapped
  }
  const code = char.codePointAt(0)
  if (code >= ASCII_ZERO && code <= ASCII_NINE) {
    // Time-signature digits drawn in the music font itself.
    return String.fromCodePoint(SMUFL_TIME_SIG_DIGIT_BASE + (code - ASCII_ZERO))
  }
  return char
}

/**
 * Normalize a page's text items so legacy music-font glyphs read as SMuFL.
 * Returns `{ items, applied, diagnostics }`. When not applied, `items` is the
 * original array (identity — zero risk for SMuFL pages).
 */
export function normalizeLegacyMusicFontGlyphs(pageText = []) {
  const smuflNoteheads = countGlyphs(pageText, SMUFL_NOTEHEAD_GLYPHS)
  const legacyNoteheads = countGlyphs(pageText, LEGACY_NOTEHEAD_GLYPHS)
  const diagnostics = {
    smuflNoteheadCount: smuflNoteheads,
    legacyNoteheadCount: legacyNoteheads,
    mappedGlyphCount: 0,
    musicFontNames: [],
  }

  if (smuflNoteheads > 0 || legacyNoteheads < LEGACY_MIN_NOTEHEADS) {
    return { items: pageText, applied: false, diagnostics }
  }

  const musicFontNames = collectMusicFontNames(pageText)
  diagnostics.musicFontNames = [...musicFontNames]

  let mappedGlyphCount = 0
  const items = pageText.map((item) => {
    if (!musicFontNames.has(item.fontName ?? '')) {
      return item
    }
    const text = item.text ?? ''
    let changed = false
    let mappedText = ''
    for (const char of text) {
      const mapped = mapMusicFontChar(char)
      if (mapped !== char) {
        changed = true
        mappedGlyphCount += 1
      }
      mappedText += mapped
    }
    if (!changed) {
      return item
    }
    return { ...item, text: mappedText }
  })

  diagnostics.mappedGlyphCount = mappedGlyphCount
  return { items, applied: true, diagnostics }
}
