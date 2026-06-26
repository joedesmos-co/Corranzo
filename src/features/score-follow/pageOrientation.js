/**
 * Page orientation detection + correction for score analysis.
 *
 * Sheet music is dominated by long HORIZONTAL staff lines that span most of a
 * system's width. A page scanned or exported sideways (90°/270°) has those lines
 * running VERTICALLY, which defeats the row-density staff detector and produces a
 * spray of tiny false "systems". Page rotation must therefore be detected and
 * corrected BEFORE staff detection.
 *
 * Detection is pure pixel math (no PDF, no canvas): we measure how much "long
 * line" energy runs horizontally vs vertically. Only a line covering ≥50% of the
 * perpendicular axis counts, so ordinary barlines (which span a single ~8%-tall
 * system) never register as vertical lines — an upright page is never mistaken
 * for a sideways one, which keeps clean scores byte-identical.
 */

function pixelLuminance(data, index) {
  const alpha = data[index + 3] / 255
  const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  return lum * alpha + 255 * (1 - alpha)
}

function isDark(data, index, threshold = 190) {
  return pixelLuminance(data, index) < threshold
}

/** A bin (row/column) counts as a "line" when it is dark across ≥ this fraction. */
const LINE_COVERAGE = 0.5

export const PAGE_ROTATION = { NONE: 0, CW90: 90, HALF: 180, CW270: 270 }

/** Energy of long horizontal dark lines (staff lines on an upright page). */
export function horizontalLineScore(imageData, { coverage = LINE_COVERAGE, darkThreshold = 190 } = {}) {
  const { width, height, data } = imageData
  if (!width || !height) return 0
  let score = 0
  for (let y = 0; y < height; y += 1) {
    let dark = 0
    const rowBase = y * width
    for (let x = 0; x < width; x += 1) {
      if (isDark(data, (rowBase + x) * 4, darkThreshold)) dark += 1
    }
    const frac = dark / width
    if (frac >= coverage) score += frac - coverage
  }
  return score / height
}

/** Energy of long vertical dark lines (staff lines on a sideways page). */
export function verticalLineScore(imageData, { coverage = LINE_COVERAGE, darkThreshold = 190 } = {}) {
  const { width, height, data } = imageData
  if (!width || !height) return 0
  let score = 0
  for (let x = 0; x < width; x += 1) {
    let dark = 0
    for (let y = 0; y < height; y += 1) {
      if (isDark(data, (y * width + x) * 4, darkThreshold)) dark += 1
    }
    const frac = dark / height
    if (frac >= coverage) score += frac - coverage
  }
  return score / width
}

/**
 * Rotate ImageData clockwise by 0/90/180/270°. Returns a new `{width,height,data}`
 * (data is a Uint8ClampedArray) that every detector consumes directly.
 */
export function rotateImageData(imageData, degrees) {
  const deg = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360
  const { width: w, height: h, data } = imageData
  if (deg === 0) {
    return { width: w, height: h, data }
  }
  const quarter = deg === 90 || deg === 270
  const nw = quarter ? h : w
  const nh = quarter ? w : h
  const out = new Uint8ClampedArray(nw * nh * 4)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const si = (y * w + x) * 4
      let nx
      let ny
      if (deg === 90) {
        nx = h - 1 - y
        ny = x
      } else if (deg === 180) {
        nx = w - 1 - x
        ny = h - 1 - y
      } else {
        nx = y
        ny = w - 1 - x
      }
      const di = (ny * nw + nx) * 4
      out[di] = data[si]
      out[di + 1] = data[si + 1]
      out[di + 2] = data[si + 2]
      out[di + 3] = data[si + 3]
    }
  }
  return { width: nw, height: nh, data: out }
}

/**
 * Decide whether a page is upright or sideways from its line energy.
 * Conservative: only flags sideways when vertical line energy clearly dominates,
 * so upright music (where this returns NONE, not uncertain) is never penalized.
 */
export function detectPageOrientation(imageData, { ratio = 1.6, minScore = 0.0008 } = {}) {
  const horizontalScore = horizontalLineScore(imageData)
  const verticalScore = verticalLineScore(imageData)
  const sideways = verticalScore > minScore && verticalScore > horizontalScore * ratio

  if (sideways) {
    const dominance = verticalScore / (verticalScore + horizontalScore || 1)
    return {
      rotation: PAGE_ROTATION.CW90,
      sideways: true,
      // Borderline sideways (only just clears the ratio) → flag as uncertain so
      // the pipeline can lower its confidence rather than trust a risky rotation.
      uncertain: verticalScore < horizontalScore * ratio * 1.4,
      confidence: Math.max(0, Math.min(1, dominance)),
      horizontalScore,
      verticalScore,
    }
  }
  return {
    rotation: PAGE_ROTATION.NONE,
    sideways: false,
    uncertain: false,
    confidence: horizontalScore > 0 ? Math.max(0, Math.min(1, horizontalScore / (horizontalScore + verticalScore || 1))) : 1,
    horizontalScore,
    verticalScore,
  }
}

/**
 * Detect orientation and, if sideways, return an upright copy of the bitmap.
 * For a sideways page we rotate both 90° and 270° and keep whichever restores the
 * most horizontal staff-line energy (and mark it uncertain when the two are too
 * close to tell upright from upside-down). Upright pages return the SAME imageData
 * reference, so normal scores are unchanged.
 */
export function normalizeImageDataOrientation(imageData, options = {}) {
  const detection = detectPageOrientation(imageData, options)
  if (!detection.sideways) {
    return {
      imageData,
      rotation: PAGE_ROTATION.NONE,
      sideways: false,
      uncertain: false,
      confidence: detection.confidence,
      detection,
    }
  }

  const cw = rotateImageData(imageData, 90)
  const ccw = rotateImageData(imageData, 270)
  const cwScore = horizontalLineScore(cw)
  const ccwScore = horizontalLineScore(ccw)
  const useCw = cwScore >= ccwScore
  const best = useCw ? cw : ccw
  const margin = Math.abs(cwScore - ccwScore)
  const tieUncertain = margin < 0.1 * Math.max(cwScore, ccwScore, 1e-9)

  return {
    imageData: best,
    rotation: useCw ? PAGE_ROTATION.CW90 : PAGE_ROTATION.CW270,
    sideways: true,
    uncertain: detection.uncertain || tieUncertain,
    confidence: detection.confidence,
    detection,
  }
}

/** Minimum normalized band height; anything thinner is an impossible "system". */
export const MIN_SYSTEM_HEIGHT_NORM = 0.02

/**
 * Drop impossibly thin system bands (e.g. row-noise slivers a sideways page
 * leaves behind). Entries with unknown geometry are kept — this only removes the
 * clearly-degenerate ones.
 */
export function rejectTinySystems(entries, { minHeightNorm = MIN_SYSTEM_HEIGHT_NORM } = {}) {
  return entries.filter((entry) => {
    const y0 = entry?.system?.y0
    const y1 = entry?.system?.y1
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
      return true
    }
    return y1 - y0 >= minHeightNorm
  })
}

/** Collapse per-page orientation results into a setup-level summary. */
export function summarizePageOrientations(pages) {
  const list = pages ?? []
  const rotated = list.filter((p) => p.rotation && p.rotation !== PAGE_ROTATION.NONE)
  const uncertain = list.filter((p) => p.uncertain)
  return {
    anyRotated: rotated.length > 0,
    anyUncertain: uncertain.length > 0,
    rotatedPageCount: rotated.length,
    maxRotation: list.reduce((max, p) => Math.max(max, p.rotation ?? 0), 0),
    pages: list.map((p) => ({
      page: p.page,
      rotation: p.rotation ?? 0,
      uncertain: Boolean(p.uncertain),
      confidence: p.confidence,
    })),
  }
}

/**
 * Lower setup confidence when the page had to be rotated (some risk remains) or
 * the orientation was uncertain. No-op for upright pages, so clean scores keep
 * their confidence exactly.
 */
export function applyOrientationConfidencePenalty(confidence, summary) {
  let next = confidence
  if (summary?.anyRotated) {
    next *= 0.85
  }
  if (summary?.anyUncertain) {
    next *= 0.9
  }
  return next
}
