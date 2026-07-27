/**
 * Conservative non-musical / decorative-page classification for OMR.
 *
 * Goal: isolate title covers and ornamental borders that invent false staves,
 * without stripping systems from healthy music pages. A page is treated as
 * non-musical only when zero systems pass the musical-staff heuristic.
 */

export const OMR_NEGATIVE_PAGE_KIND = Object.freeze({
  MUSIC: 'music',
  NO_MUSIC: 'no-music',
})

function systemSpan(system) {
  const y0 = Number(system?.y0)
  const y1 = Number(system?.y1)
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return 0
  return Math.max(0, y1 - y0)
}

/**
 * @param {object} system
 * @returns {boolean}
 */
export function isMusicalOmrStaffSystem(system) {
  if (!system || typeof system !== 'object') return false
  const span = systemSpan(system)
  const lineCount = Number.isFinite(system.lineCount) ? system.lineCount : 0
  const staffLines = Array.isArray(system.lineYs) ? system.lineYs.length : 0
  const staveCount = Number.isFinite(system.staveCount) ? system.staveCount : 1

  // Hairline false systems from ornaments / rule borders.
  if (span < 0.018) return false

  // Confident measure structure is strong music evidence, including noisy scans
  // whose detected-line counts are inflated by hatching or bleed.
  if (system.barlineConfident) return true

  // Decorative hatching / border bands without trustworthy barlines.
  if (lineCount >= 18) return false

  // Grand-staff bands often omit per-staff lineYs but keep a large span.
  if (staveCount >= 2 && span >= 0.08) return true

  // Typical single-staff band with a sane height and non-hatching line count.
  if (span >= 0.035 && lineCount <= 14 && staffLines <= 12) return true

  // Mid-height band with a selected 5-line staff.
  if (span >= 0.025 && staffLines >= 4 && staffLines <= 6 && lineCount <= 14) {
    return true
  }

  // Noisy scan staff: selected 5-line geometry with moderate height, even when
  // raw detected-line count is elevated (but not cover-border extreme).
  if (staffLines >= 4 && staffLines <= 6 && span >= 0.03 && lineCount < 40) {
    return true
  }

  return false
}

/**
 * Classify a page after staff detection and before note recognition.
 *
 * @param {{ systems?: object[], stavesPerSystem?: number }} input
 */
export function classifyOmrNegativePage({ systems = [], stavesPerSystem = 1 } = {}) {
  const list = Array.isArray(systems) ? systems : []
  if (list.length === 0) {
    return {
      status: OMR_NEGATIVE_PAGE_KIND.NO_MUSIC,
      reason: 'no-systems',
      kind: 'no-staff-systems',
      musicalSystemCount: 0,
      systemCount: 0,
      musicalRate: 0,
      stavesPerSystem,
    }
  }

  const musicalSystems = list.filter((system) => isMusicalOmrStaffSystem(system))
  const musicalRate = musicalSystems.length / list.length
  if (musicalSystems.length === 0) {
    return {
      status: OMR_NEGATIVE_PAGE_KIND.NO_MUSIC,
      reason: 'decorative-or-non-musical-systems',
      kind: 'non-musical-page',
      musicalSystemCount: 0,
      systemCount: list.length,
      musicalRate: 0,
      stavesPerSystem,
    }
  }

  return {
    status: OMR_NEGATIVE_PAGE_KIND.MUSIC,
    reason: 'musical-systems-present',
    kind: null,
    musicalSystemCount: musicalSystems.length,
    systemCount: list.length,
    musicalRate,
    stavesPerSystem,
  }
}
