/**
 * Guitar Vision — string-conditioned region sampling.
 *
 * ## Why the piano sampler is not enough
 *
 * `RegionSampler` samples a grid over each object's bounding box, which is
 * correct when an object's identity is carried by its extent. A TAB fret digit
 * is not like that: its identity is carried by *which of six lines it sits on*,
 * and the digit's bounding box is nearly identical whether it is on the top string
 * or the bottom one. Two digits at the same x, same width, same height, one line
 * apart, are different notes two strings apart — and a box-sampled feature
 * cannot tell them apart.
 *
 * So TAB objects are sampled in **line-relative coordinates**: the sampler is
 * given the string's y position and the staff gap, and returns a grid in units of
 * staff space relative to that line. The same box on a different string therefore
 * produces a genuinely different feature, and the model can learn "this is a 3
 * on string 5" rather than having to infer the string from vertical position in
 * a way that is destroyed by the crop.
 *
 * This is the single most important geometric difference between guitar
 * recognition and piano recognition, and it is why a shared box feature
 * silently caps TAB accuracy.
 */

/** Staff space, in the units the caller supplies. Kept explicit for testability. */
const DEFAULT_GRID = 3

/**
 * Normalised, line-relative sampling positions.
 *
 * Offsets are in multiples of half a staff space: a fret digit's body sits on
 * the string line, and multi-digit frets extend rightward, so the horizontal
 * samples are asymmetric.
 *
 * @returns {Float32Array} `[dx0, dy0, dx1, dy1, ...]` in staff-space units.
 */
export function lineRelativeGrid({ grid = DEFAULT_GRID, staffGap = 1 } = {}) {
  const offsets = []
  for (let row = 0; row < grid; row += 1) {
    for (let column = 0; column < grid; column += 1) {
      const u = (column + 0.5) / grid
      const v = (row + 0.5) / grid
      // Horizontal samples stay inside the digit; vertical samples straddle the
      // string line so the line itself is represented in the feature.
      offsets.push((u - 0.5) * 1.6, (v - 0.5) * 2.0 * staffGap)
    }
  }
  return Float32Array.from(offsets)
}

/**
 * Build the absolute sample positions for a TAB digit.
 *
 * @param {object} input
 * @param {number} input.centerX     digit centre, normalised page x
 * @param {number} input.stringLineY  y of the string line this digit sits on
 * @param {number} input.staffGap     distance between adjacent string lines
 * @param {number} input.digitWidth   width of the glyph, normalised
 * @param {number} [input.digitHeight]
 * @param {number} [input.grid]
 * @returns {{positions: Float32Array, count: number, anchorY: number}}
 */
export function tabDigitSamplePositions({
  centerX,
  stringLineY,
  staffGap,
  digitWidth,
  digitHeight = staffGap,
  grid = DEFAULT_GRID,
}) {
  const offsets = lineRelativeGrid({ grid, staffGap: digitHeight })
  const count = grid * grid
  const positions = new Float32Array(count * 2)

  for (let index = 0; index < count; index += 1) {
    // x is anchored on the digit's own width; y is anchored on the string line.
    positions[index * 2] = centerX + offsets[index * 2] * digitWidth
    positions[index * 2 + 1] = stringLineY + offsets[index * 2 + 1]
  }

  return { positions, count, anchorY: stringLineY }
}

/**
 * Which string line a y position belongs to.
 *
 * Returns 1-based string number with string 1 the highest, matching MusicXML and
 * `STANDARD_GUITAR_TUNING`. Returns null when the position is too far from any
 * line to be a fret digit, because a fret digit is printed *on* a line and a
 * confident wrong string is worse than an abstention.
 */
export function stringForY(yNorm, lineYs, { maxGapFactor = 0.45 } = {}) {
  if (!lineYs?.length) return null
  const sorted = [...lineYs].filter(Number.isFinite).sort((left, right) => left - right)
  if (!sorted.length) return null

  // pageY increases downward, so string 1 (the highest-pitched, visually
  // topmost line) is the smallest y.
  const gap =
    sorted.length > 1 ? (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1) : 0.01
  let best = null
  let bestDistance = Infinity
  sorted.forEach((lineY, index) => {
    const distance = Math.abs(yNorm - lineY)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index + 1
    }
  })
  if (gap > 0 && bestDistance > gap * maxGapFactor) return null
  return best
}

/**
 * Multi-digit fret geometry.
 *
 * A fret of 10-24 is two glyphs that must be read as one number. Treating them
 * as two single digits is how `12` becomes `1` and `2` on two strings — the exact
 * failure the legacy engine's clustering heuristics were written to patch.
 */
export function clusterFretDigits(digits, { staffGap = 1 } = {}) {
  const byString = new Map()
  for (const digit of digits) {
    if (digit.string == null) continue
    if (!byString.has(digit.string)) byString.set(digit.string, [])
    byString.get(digit.string).push(digit)
  }

  const clusters = []
  for (const [string, list] of byString) {
    list.sort((left, right) => left.x - right.x)
    let current = null
    for (const digit of list) {
      const width = Math.max(digit.width ?? staffGap * 0.6, 1e-6)
      // Two glyphs of one fret are typeset tight; distinct notes are separated by
      // at least a notehead. The threshold is expressed in digit widths so it
      // survives resolution changes.
      const joinsCurrent =
        current != null && digit.x - current.right <= width * (current.digits.length + 0.5)
      if (joinsCurrent) {
        current.digits.push(digit)
        current.right = Math.max(current.right, digit.x + width / 2)
        current.left = Math.min(current.left, digit.x - width / 2)
      } else {
        current = {
          string,
          digits: [digit],
          left: digit.x - width / 2,
          right: digit.x + width / 2,
        }
        clusters.push(current)
      }
    }
  }

  return clusters.map((cluster) => {
    const text = cluster.digits.map((digit) => digit.text).join('')
    const fret = Number.parseInt(text, 10)
    return {
      string: cluster.string,
      fret: Number.isFinite(fret) ? fret : null,
      digitCount: cluster.digits.length,
      centerX: cluster.digits.reduce((sum, digit) => sum + digit.x, 0) / cluster.digits.length,
      left: cluster.left,
      right: cluster.right,
      valid: Number.isFinite(fret) && fret >= 0 && fret <= 24,
    }
  })
}
