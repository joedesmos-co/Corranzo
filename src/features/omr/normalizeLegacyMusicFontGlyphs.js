/**
 * Legacy music-font glyph normalization for vector OMR.
 *
 * Some vector PDFs embed non-SMuFL music fonts whose noteheads/clefs live at
 * idiosyncratic codepoints. Two families are handled:
 *
 * 1. Legacy MScore (musescore.com / TCPDF exports) — known static codepoint
 *    mapping via LEGACY_MSCORE_GLYPH_MAP.
 * 2. LilyPond Feta and other dynamically-encoded fonts — the black-notehead
 *    codepoint is discovered by ink-based heuristic: the most frequent
 *    compact glyph in the music font that has a dark (filled) center when
 *    probed against the rendered image. Open (half/whole) noteheads are
 *    detected as ring-shaped (dark border, bright center).
 *
 * The module is deliberately conservative:
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
  // Accidentals (MScore legacy font → SMuFL)
  ['\ue1a0', '\ue262'], // sharp
  ['\ue1a1', '\ue260'], // flat
  ['\ue1a2', '\ue261'], // natural
  ['\ue1a3', '\ue263'], // double sharp
  ['\ue1a4', '\ue264'], // double flat
  // Alternate embedded MScore subset used by MuseScore web exports. These
  // codepoints were identified from repeated system-margin geometry: U+E10E
  // occurs in paired sharp-order columns and U+E114 in paired flat-order
  // columns, while the same font's noteheads/clefs use the mappings above.
  ['\ue10e', '\ue262'], // sharp (alternate MScore subset)
  ['\ue114', '\ue260'], // flat (alternate MScore subset)
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
    return {
      ...item,
      text: mappedText,
      originalLegacyText: text,
      legacyMusicFontNormalized: true,
    }
  })

  diagnostics.mappedGlyphCount = mappedGlyphCount
  return { items, applied: true, diagnostics }
}

// ---------------------------------------------------------------------------
// Dynamic non-SMuFL music-font detection (LilyPond Feta, etc.)
//
// LilyPond embeds its Feta music font with per-document glyph ID assignments
// that vary by font subset. Black noteheads can be at U+AC, ASCII 'Z', or
// any other codepoint. There is no static codepoint map — we must detect
// noteheads dynamically by analyzing frequency + ink profile.
// ---------------------------------------------------------------------------

const DYNAMIC_MIN_NOTEHEADS = 12
const DYNAMIC_MIN_INK_SAMPLES = 6

function isInk(pixel, index) {
  return (
    pixel[index] < 128 || pixel[index + 1] < 128 || pixel[index + 2] < 128
  )
}

/**
 * Probe the rendered image at a glyph position to determine if the glyph is
 * a filled (black) notehead, an open (half/whole) notehead, or neither.
 * glyphY is in image pixel coordinates (top-down).
 *
 * The probe is sized from glyphW (the character width), not from the font
 * height — pdf.js reports the full em-height for embedded fonts, which can
 * be 3-4x the actual ink extent, inflating the probe to include staff lines
 * and stems. Notehead ink is roughly square in real pixels.
 */
function probeGlyphInk(imageData, glyphX, glyphY, glyphW, _glyphH) {
  void _glyphH
  if (!imageData?.data || !imageData.width || !imageData.height) {
    return null
  }
  const cx = Math.round(glyphX)
  const cy = Math.round(glyphY)
  // The probe radius is the glyph width × 0.6 — just larger than the notehead
  // ink, so the center measurement is the notehead body and the border ring
  // reaches just past the outer edge.
  const probeRadius = Math.max(3, Math.round(glyphW * 0.6))
  const ringOuter = Math.round(glyphW * 1.1)
  const { data, width: imgW, height: imgH } = imageData
  if (cx < 0 || cy < 0 || cx >= imgW || cy >= imgH) {
    return null
  }
  if (cx - ringOuter < 0 || cy - ringOuter < 0 || cx + ringOuter >= imgW || cy + ringOuter >= imgH) {
    // Near page edge — skip; we need clean surrounding pixels
    return null
  }

  let centerDark = 0
  let centerTotal = 0
  let borderDark = 0
  let borderTotal = 0

  for (let dy = -ringOuter; dy <= ringOuter; dy += 1) {
    for (let dx = -ringOuter; dx <= ringOuter; dx += 1) {
      const px = cx + dx
      const py = cy + dy
      if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue
      const idx = (py * imgW + px) * 4
      const dist = Math.hypot(dx, dy)
      const isCenter = dist <= probeRadius * 0.5
      const isBorder = dist > probeRadius * 0.5 && dist <= ringOuter
      if (isCenter) {
        centerTotal += 1
        if (isInk(data, idx)) centerDark += 1
      } else if (isBorder) {
        borderTotal += 1
        if (isInk(data, idx)) borderDark += 1
      }
    }
  }

  const centerRatio = centerTotal ? centerDark / centerTotal : 0
  const borderRatio = borderTotal ? borderDark / borderTotal : 0

  if (centerRatio >= 0.5) {
    return 'filled'
  }
  if (centerRatio <= 0.3 && borderRatio >= 0.2) {
    return 'open'
  }
  return null
}

/**
 * Collect per-font character statistics from page text items.
 * Returns a Map: fontName → { total, chars: Map(char → { count, positions, width, height }) }
 */
function collectFontCharStats(pageText, imageData) {
  const result = new Map()
  for (const item of pageText ?? []) {
    const font = item.fontName ?? ''
    const text = item.text ?? ''
    if (!text.length || !Number.isFinite(item.pageWidth) || !Number.isFinite(item.pageHeight)) {
      continue
    }
    const scaleX = imageData.width / item.pageWidth
    const scaleY = imageData.height / item.pageHeight
    const charWidth = (item.width ?? 0) / Math.max(1, text.length)
    const fontEntry = result.get(font) ?? { total: 0, chars: new Map() }

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]
      const textX = item.x + charWidth * (i + 0.5)
      const imgX = textX * scaleX
      const imgY = imageData.height - item.y * scaleY
      const charEntry = fontEntry.chars.get(ch) ?? {
        count: 0,
        width: charWidth * scaleX,
        height: (item.height ?? 0) * scaleY,
        positions: [],
      }
      charEntry.count += 1
      charEntry.positions.push([imgX, imgY])
      fontEntry.chars.set(ch, charEntry)
      fontEntry.total += 1
    }
    result.set(font, fontEntry)
  }
  return result
}

/**
 * Determine the staff gap estimate from image width.
 * Mirrors staffGapGuess in detectVectorRepeatBarlines.js (~1.4% of width).
 */
function estimateStaffGap(imageData) {
  if (!imageData?.width) return 12
  return Math.max(8, imageData.width * 0.014)
}

/**
 * Identify the black-notehead character in a non-SMuFL music font using
 * frequency + ink analysis. Returns the character code and/or open-notehead
 * candidates.
 */
function detectDynamicNoteheadGlyphs(fontStats, imageData) {
  if (!fontStats || imageData?.data == null) {
    return null
  }
  const staffGap = estimateStaffGap(imageData)
  const chars = [...fontStats.chars.entries()]
  // Filter out whitespace and very low-frequency chars
  const candidates = chars.filter(
    ([ch, stats]) =>
      ch.trim().length > 0 &&
      stats.count >= DYNAMIC_MIN_NOTEHEADS &&
      stats.width > 0 &&
      stats.height > 0,
  )
  if (candidates.length === 0) {
    return null
  }

  // Sort by frequency descending — the black notehead is overwhelmingly the
  // most frequent music glyph on any score page.
  candidates.sort((a, b) => b[1].count - a[1].count)

  const result = { blackNotehead: null, openNoteheads: [] }

  for (const [ch, stats] of candidates) {
    // Width filters the music-font glyphs: noteheads are ~0.7-1.2x staff gap
    // wide, while stems/ledger lines/barlines are very narrow (0.2-0.3x) and
    // beams/slurs are very wide (>2x). Font "height" reports the em box, not
    // the ink height, so we don't use it for filtering — the ink probe is the
    // authoritative shape discriminator.
    const wOk = stats.width >= staffGap * 0.35 && stats.width <= staffGap * 2.2
    if (!wOk) continue

    // Ink probe — sample up to 20 positions
    const samplePositions = stats.positions.slice(0, 20)
    let filledCount = 0
    let openCount = 0
    let probed = 0
    for (const [x, y] of samplePositions) {
      const ink = probeGlyphInk(imageData, x, y, stats.width, stats.height)
      if (ink) {
        probed += 1
        if (ink === 'filled') filledCount += 1
        else if (ink === 'open') openCount += 1
      }
    }
    if (probed < DYNAMIC_MIN_INK_SAMPLES) continue

    const filledRatio = filledCount / probed
    const openRatio = openCount / probed

    if (filledRatio >= 0.45 && !result.blackNotehead) {
      // Reject ASCII digits (0-9) as "noteheads" — they are TAB fret digits
      // in tablature fonts, not music notation noteheads. Notation fonts
      // (Feta, Bravura, MScore) map noteheads to PUA/legacy PUA codepoints,
      // never to ASCII digits which are reserved for time signatures,
      // measure numbers, etc.
      const code = ch.codePointAt(0)
      if (code >= 0x30 && code <= 0x39) {
        // This font uses ASCII digits as the most frequent "filled" glyph
        // — it's a TAB font, not a notation font. Skip it.
        continue
      }
      result.blackNotehead = ch
    } else if (openRatio >= 0.4 && result.openNoteheads.length < 2) {
      const code = ch.codePointAt(0)
      if (code >= 0x30 && code <= 0x39) {
        continue
      }
      result.openNoteheads.push(ch)
    }
  }

  return result
}

/**
 * Identify accidental glyphs (sharp, flat, natural) in a non-SMuFL music font.
 *
 * After noteheads are detected, accidentals are structural glyphs that appear
 * once per system at the key-signature position. Heuristics:
 * - Low total frequency (once per system, < 20 total) — distinguishes from
 *   noteheads (dozens to hundreds) and from rests (variable frequency)
 * - Width within 60% of the black notehead width — distinguishes from clefs
 *   (much wider, spanning the full staff)
 * - Not already mapped as a notehead
 *
 * The sharp is the most frequent accidental candidate, since sharp keys
 * (G, D, A, E, B, F#) place one sharp at each system start. Flats and
 * naturals appear less frequently (only in keys with 3+ flats, or as
 * courtesy accidentals).
 *
 * This is a conservative detector: it only fires when there IS a strong
 * accidental candidate. C-major pages return null (no false positives).
 */
function detectDynamicAccidentalGlyphs(fontStats, noteheadWidth, alreadyMapped) {
  if (!fontStats || !noteheadWidth) return null

  const chars = [...fontStats.chars.entries()]
  // Filter for accidental candidates:
  // - Not already mapped (notehead or open notehead)
  // - Low frequency (structural glyph, appears once per system)
  // - Width within 60% of notehead width (accidentals are notehead-sized)
  const candidates = chars.filter(([ch, stats]) => {
    if (alreadyMapped.has(ch)) return false
    if (stats.count < 1 || stats.count > 20) return false
    const widthRatio = stats.width / noteheadWidth
    return widthRatio >= 0.4 && widthRatio <= 1.6
  })

  if (candidates.length === 0) return null

  // The sharp is the most frequent accidental candidate
  candidates.sort((a, b) => b[1].count - a[1].count)
  const sharp = candidates[0]
  if (!sharp) return null

  return { sharp: sharp[0] }
}

/**
 * Normalize non-SMuFL music-font glyphs (LilyPond Feta, etc.) by detecting
 * notehead codepoints dynamically via ink analysis. Requires imageData for
 * pixel probing. Returns identity when no dynamic noteheads are found.
 */
export function normalizeNonSmuflMusicFontGlyphs(pageText = [], imageData = null) {
  const diagnostics = {
    smuflNoteheadCount: 0,
    dynamicNoteheadCount: 0,
    mappedGlyphCount: 0,
    dynamicFontNames: [],
    detectedBlackNotehead: null,
    detectedOpenNoteheads: [],
    detectionMethod: 'none',
  }

  if (!imageData?.data || !imageData.width || !imageData.height) {
    return { items: pageText, applied: false, diagnostics }
  }

  // Only apply when there are no SMuFL noteheads
  const smuflNoteheads = countGlyphs(pageText, SMUFL_NOTEHEAD_GLYPHS)
  diagnostics.smuflNoteheadCount = smuflNoteheads
  if (smuflNoteheads > 0) {
    return { items: pageText, applied: false, diagnostics }
  }

  // Also skip if MScore legacy noteheads were already handled
  const legacyNoteheads = countGlyphs(pageText, LEGACY_NOTEHEAD_GLYPHS)
  if (legacyNoteheads >= LEGACY_MIN_NOTEHEADS) {
    return { items: pageText, applied: false, diagnostics }
  }

  // Find music font with dynamic notehead glyphs
  const fontStats = collectFontCharStats(pageText, imageData)
  let detectedFont = null
  let detectedGlyphs = null

  // Check fonts sorted by total character count (music fonts dominate)
  const sortedFonts = [...fontStats.entries()].sort(
    (a, b) => b[1].total - a[1].total
  )

  for (const [fontName, stats] of sortedFonts) {
    if (stats.total < DYNAMIC_MIN_NOTEHEADS * 2) continue
    const glyphs = detectDynamicNoteheadGlyphs(stats, imageData)
    if (glyphs?.blackNotehead) {
      detectedFont = fontName
      detectedGlyphs = glyphs
      break
    }
  }

  if (!detectedFont || !detectedGlyphs?.blackNotehead) {
    return { items: pageText, applied: false, diagnostics }
  }

  // Build the dynamic glyph map
  const dynamicMap = new Map()
  dynamicMap.set(detectedGlyphs.blackNotehead, '\ue0a4') // black notehead
  for (const openChar of detectedGlyphs.openNoteheads) {
    // First open notehead → half (\ue0a3); second → whole (\ue0a2)
    const smufl = dynamicMap.size === 1 ? '\ue0a2' : '\ue0a3'
    dynamicMap.set(openChar, smufl)
  }

  // Detect accidentals (sharps, flats, naturals) — structural glyphs that
  // appear once per system at the key-signature position. After noteheads
  // are identified, accidentals are the remaining glyphs with low frequency
  // and width similar to the notehead. The sharp is the most frequent
  // accidental candidate (appears once per system for sharp keys).
  const noteheadWidth = fontStats.get(detectedFont)?.chars.get(detectedGlyphs.blackNotehead)?.width ?? null
  const accidentalGlyphs = detectDynamicAccidentalGlyphs(
    fontStats.get(detectedFont),
    noteheadWidth,
    dynamicMap
  )
  if (accidentalGlyphs?.sharp) {
    dynamicMap.set(accidentalGlyphs.sharp, '\ue262') // sharp
  }

  diagnostics.dynamicFontNames = [detectedFont]
  diagnostics.detectedBlackNotehead = detectedGlyphs.blackNotehead
  diagnostics.detectedOpenNoteheads = detectedGlyphs.openNoteheads
  diagnostics.detectionMethod = 'dynamic-ink-probe'

  let mappedGlyphCount = 0
  const items = pageText.map((item) => {
    if ((item.fontName ?? '') !== detectedFont) return item
    const text = item.text ?? ''
    let changed = false
    let mappedText = ''
    for (const char of text) {
      const mapped = dynamicMap.get(char)
      if (mapped) {
        changed = true
        mappedGlyphCount += 1
        mappedText += mapped
      } else {
        mappedText += char
      }
    }
    if (!changed) return item
    return {
      ...item,
      text: mappedText,
      originalLegacyText: text,
      legacyMusicFontNormalized: true,
    }
  })

  diagnostics.mappedGlyphCount = mappedGlyphCount
  diagnostics.dynamicNoteheadCount = dynamicMap.size
  return { items, applied: true, diagnostics }
}
