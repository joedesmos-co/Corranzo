/**
 * Guitar-relevant free-text mining for MusicXML `<words>` directions.
 *
 * MusicXML has no capo element and no structured barre/position encoding, so
 * these arrive as staff text in every exporter (MuseScore included). Mining
 * them is interpretation of text, not of structure — so every result retains
 * the source text and a text-mined confidence, and the raw-text audit only
 * quarantines words that match NO known pattern.
 *
 * Single source of truth: the symbolic parser and the canonical gap audit
 * both import this module, so a pattern cannot be "handled" in one place and
 * "unknown" in the other.
 */

const ROMAN = '(XII|XI|X|IX|VIII|VII|VI|IV|V|III|II|I)'

const PATTERNS = [
  { kind: 'capo', test: /\bcapo(?:dastro)?\s*(\d+)/i, params: (m, text) => ({ fret: Number(m[1]), partial: /partial|cut|esus/i.test(text) }) },
  { kind: 'barre', test: new RegExp(`^\\s*(1/2\\s*)?[BC]\\s?${ROMAN}\\.?\\s*$`, 'i'), params: (m) => ({ half: /^1\/2/i.test(m[0]), position: m[2] }) },
  { kind: 'position', test: new RegExp(`^\\s*${ROMAN}\\.?\\s*$`, 'i'), params: (m) => ({ position: m[1] }) },
  { kind: 'da-capo-al-fine', test: /D\.?\s*C\.?\s+al\s+Fine/i, params: () => ({}) },
  { kind: 'da-capo-al-coda', test: /D\.?\s*C\.?\s+al\s+Coda/i, params: () => ({}) },
  { kind: 'dal-segno-al-fine', test: /D\.?\s*S\.?\s+al\s+Fine/i, params: () => ({}) },
  { kind: 'dal-segno-al-coda', test: /D\.?\s*S\.?\s+al\s+Coda/i, params: () => ({}) },
  { kind: 'da-capo', test: /D\.?\s*C\.?/i, params: () => ({}) },
  { kind: 'dal-segno', test: /D\.?\s*S\.?/i, params: () => ({}) },
  { kind: 'to-coda', test: /To\s+Coda/i, params: () => ({}) },
  { kind: 'fine', test: /^\s*Fine\s*$/i, params: () => ({}) },
]

/** Navigation kinds (subset of PATTERNS) for score-level jump semantics. */
export const NAVIGATION_KINDS = Object.freeze([
  'da-capo', 'da-capo-al-fine', 'da-capo-al-coda',
  'dal-segno', 'dal-segno-al-fine', 'dal-segno-al-coda',
  'to-coda', 'fine',
])

/**
 * Mine one free-text direction. Returns null when no pattern matches —
 * the caller must treat that as uninterpretable text, not as "no direction".
 */
export function mineTextDirection(text) {
  const source = String(text ?? '').trim()
  if (!source) return null
  for (const pattern of PATTERNS) {
    const match = source.match(pattern.test)
    if (match) {
      return { kind: pattern.kind, sourceText: source, confidence: 'text-mined', ...pattern.params(match, source) }
    }
  }
  return null
}

/** True when free text carries a meaning the truth layer resolves. */
export function isMinedText(text) {
  return mineTextDirection(text) != null
}
