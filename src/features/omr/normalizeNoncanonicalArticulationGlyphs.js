/**
 * Normalize a narrowly identifiable pre-standard articulation cmap.
 *
 * A few vector-score generators embedded a small custom music font where the
 * visible staccato and accent outlines were assigned to U+E4A0 and U+E4A3
 * respectively. Those assignments predate/conflict with SMuFL, where U+E4A0
 * is accent-above and U+E4A3 is staccato-below.
 *
 * This compatibility path is deliberately page/font scoped and conservative:
 * both legacy codepoints must occur repeatedly in the same font, share
 * effectively identical text metrics, have a broad E4A3 advance that is
 * incompatible with a staccato dot, and be drawn substantially smaller than a
 * quorum of noteheads from that font. Clean SMuFL fonts such as Bravura do not
 * match that fingerprint.
 */

const LEGACY_STACCATO = '\ue4a0'
const LEGACY_ACCENT = '\ue4a3'
const SMUFL_STACCATO_ABOVE = '\ue4a2'
const SMUFL_ACCENT_ABOVE = '\ue4a0'
const NOTEHEAD_GLYPHS = new Set(['\ue0a2', '\ue0a3', '\ue0a4'])
const MIN_EACH_ARTICULATION = 2
const MIN_NOTEHEADS = 12

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (!finite.length) return null
  const middle = Math.floor(finite.length / 2)
  return finite.length % 2
    ? finite[middle]
    : (finite[middle - 1] + finite[middle]) / 2
}

function relativeDifference(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity
  return Math.abs(left - right) / Math.max(1e-6, Math.abs(left), Math.abs(right))
}

function metricRowsForItem(item) {
  const text = item.text ?? ''
  const charWidth = Number(item.width ?? 0) / Math.max(1, text.length)
  return [...text].map((char) => ({
    char,
    width: charWidth,
    height: Number(item.height ?? 0),
  }))
}

function fontProfiles(pageText) {
  const profiles = new Map()
  for (const item of pageText ?? []) {
    const fontName = item.fontName ?? ''
    const profile = profiles.get(fontName) ?? {
      noteheads: [],
      legacyStaccato: [],
      legacyAccent: [],
    }
    for (const row of metricRowsForItem(item)) {
      if (NOTEHEAD_GLYPHS.has(row.char)) {
        profile.noteheads.push(row)
      } else if (row.char === LEGACY_STACCATO) {
        profile.legacyStaccato.push(row)
      } else if (row.char === LEGACY_ACCENT) {
        profile.legacyAccent.push(row)
      }
    }
    profiles.set(fontName, profile)
  }
  return profiles
}

function mappingForProfile(profile) {
  if (
    profile.noteheads.length < MIN_NOTEHEADS ||
    profile.legacyAccent.length < MIN_EACH_ARTICULATION
  ) {
    return null
  }
  const staccatoWidth = median(profile.legacyStaccato.map((row) => row.width))
  const staccatoHeight = median(profile.legacyStaccato.map((row) => row.height))
  const accentWidth = median(profile.legacyAccent.map((row) => row.width))
  const accentHeight = median(profile.legacyAccent.map((row) => row.height))
  const noteheadHeight = median(profile.noteheads.map((row) => row.height))

  const legacyAccent =
    accentWidth / Math.max(1e-6, accentHeight) >= 0.4 &&
    accentHeight / Math.max(1e-6, noteheadHeight) <= 0.75
  const pairedMetrics =
    profile.legacyStaccato.length >= MIN_EACH_ARTICULATION &&
    relativeDifference(staccatoWidth, accentWidth) <= 0.05 &&
    relativeDifference(staccatoHeight, accentHeight) <= 0.05
  const repeatedAccentOnly =
    profile.legacyAccent.length >= MIN_EACH_ARTICULATION * 2
  if (!legacyAccent || (!pairedMetrics && !repeatedAccentOnly)) {
    return null
  }
  return {
    legacyAccent,
    legacyStaccato: pairedMetrics,
  }
}

function mapForFont(pageText) {
  return new Map(
    [...fontProfiles(pageText).entries()]
      .map(([fontName, profile]) => [fontName, mappingForProfile(profile)])
      .filter(([, mapping]) => mapping != null),
  )
}

export function normalizeNoncanonicalArticulationGlyphs(pageText = []) {
  const mappingsByFont = mapForFont(pageText)
  const diagnostics = {
    matchingFonts: [...mappingsByFont.keys()],
    mappedGlyphCount: 0,
    mapping: {
      'U+E4A0': 'U+E4A2',
      'U+E4A3': 'U+E4A0',
    },
  }
  if (!mappingsByFont.size) {
    return { items: pageText, applied: false, diagnostics }
  }

  const items = pageText.map((item) => {
    const mapping = mappingsByFont.get(item.fontName ?? '')
    if (!mapping) return item
    let changed = false
    const text = [...(item.text ?? '')]
      .map((char) => {
        if (char === LEGACY_STACCATO && mapping.legacyStaccato) {
          changed = true
          diagnostics.mappedGlyphCount += 1
          return SMUFL_STACCATO_ABOVE
        }
        if (char === LEGACY_ACCENT && mapping.legacyAccent) {
          changed = true
          diagnostics.mappedGlyphCount += 1
          return SMUFL_ACCENT_ABOVE
        }
        return char
      })
      .join('')
    return changed
      ? {
          ...item,
          text,
          originalArticulationText: item.text,
        }
      : item
  })
  return { items, applied: true, diagnostics }
}
