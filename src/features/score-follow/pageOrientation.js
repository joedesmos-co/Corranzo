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

const DEFAULT_TOP_MARGIN_FRAC = 0.14
const DEFAULT_BOTTOM_MARGIN_FRAC = 0.12
const DEFAULT_SIDE_MARGIN_FRAC = 0.06

function marginBounds(
  imageData,
  {
    topFrac = DEFAULT_TOP_MARGIN_FRAC,
    bottomFrac = DEFAULT_BOTTOM_MARGIN_FRAC,
    leftFrac = DEFAULT_SIDE_MARGIN_FRAC,
    rightFrac = DEFAULT_SIDE_MARGIN_FRAC,
  } = {},
) {
  const { width = 0, height = 0 } = imageData ?? {}
  const y0 = Math.floor(height * topFrac)
  const y1 = Math.max(y0 + 1, Math.floor(height * (1 - bottomFrac)))
  const x0 = Math.floor(width * leftFrac)
  const x1 = Math.max(x0 + 1, Math.floor(width * (1 - rightFrac)))
  return { width, height, x0, x1, y0, y1 }
}

/** Staff-line energy in the central band, ignoring title/footer margins. */
export function horizontalLineScoreInBand(imageData, options = {}) {
  const { width, height, x0, x1, y0, y1 } = marginBounds(imageData, options)
  const { coverage = LINE_COVERAGE, darkThreshold = 190 } = options
  if (!width || !height || y1 <= y0) {
    return horizontalLineScore(imageData, options)
  }

  const { data } = imageData
  let score = 0
  for (let y = y0; y < y1; y += 1) {
    let dark = 0
    const span = x1 - x0
    const rowBase = y * width
    for (let x = x0; x < x1; x += 1) {
      if (isDark(data, (rowBase + x) * 4, darkThreshold)) {
        dark += 1
      }
    }
    const frac = dark / span
    if (frac >= coverage) {
      score += frac - coverage
    }
  }
  return score / (y1 - y0)
}

/** Vertical line energy in the central band (sideways pages). */
export function verticalLineScoreInBand(imageData, options = {}) {
  const { width, height, x0, x1, y0, y1 } = marginBounds(imageData, options)
  const { coverage = LINE_COVERAGE, darkThreshold = 190 } = options
  if (!width || !height || x1 <= x0) {
    return verticalLineScore(imageData, options)
  }

  const { data } = imageData
  let score = 0
  const span = y1 - y0
  for (let x = x0; x < x1; x += 1) {
    let dark = 0
    for (let y = y0; y < y1; y += 1) {
      if (isDark(data, (y * width + x) * 4, darkThreshold)) {
        dark += 1
      }
    }
    const frac = dark / span
    if (frac >= coverage) {
      score += frac - coverage
    }
  }
  return score / (x1 - x0)
}

function lineScores(imageData, options = {}) {
  const useBand = options.useMarginMask !== false
  if (useBand) {
    return {
      horizontalScore: horizontalLineScoreInBand(imageData, options),
      verticalScore: verticalLineScoreInBand(imageData, options),
    }
  }
  return {
    horizontalScore: horizontalLineScore(imageData, options),
    verticalScore: verticalLineScore(imageData, options),
  }
}

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
export function detectPageOrientation(
  imageData,
  { ratio = 1.45, minScore = 0.0005, landscapeRatio = 1.12, useMarginMask = true, ...rest } = {},
) {
  const scoreOptions = { useMarginMask, ...rest }
  const { horizontalScore, verticalScore } = lineScores(imageData, scoreOptions)
  const { width = 0, height = 0 } = imageData ?? {}
  const landscape = width > height * landscapeRatio
  const sidewaysByLines =
    verticalScore > minScore && verticalScore > horizontalScore * ratio
  const sidewaysByLandscape =
    landscape &&
    verticalScore > minScore &&
    verticalScore >= horizontalScore * (ratio * 0.72)
  const sideways = sidewaysByLines || sidewaysByLandscape

  if (sideways) {
    const dominance = verticalScore / (verticalScore + horizontalScore || 1)
    return {
      rotation: PAGE_ROTATION.CW90,
      sideways: true,
      sidewaysByLines,
      sidewaysByLandscape,
      // Borderline sideways (only just clears the ratio) → flag as uncertain so
      // the pipeline can lower its confidence rather than trust a risky rotation.
      uncertain: verticalScore < horizontalScore * ratio * 1.4,
      confidence: Math.max(0, Math.min(1, dominance)),
      horizontalScore,
      verticalScore,
      landscape,
    }
  }
  return {
    rotation: PAGE_ROTATION.NONE,
    sideways: false,
    sidewaysByLines: false,
    sidewaysByLandscape: false,
    uncertain: false,
    confidence: horizontalScore > 0 ? Math.max(0, Math.min(1, horizontalScore / (horizontalScore + verticalScore || 1))) : 1,
    horizontalScore,
    verticalScore,
    landscape,
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
    const bandOpts = { useMarginMask: options.useMarginMask !== false, ...options }
    const uprightScore = horizontalLineScoreInBand(imageData, bandOpts)
    const flippedScore = horizontalLineScoreInBand(rotateImageData(imageData, 180), bandOpts)
    const flipMargin = Math.abs(flippedScore - uprightScore)
    const flipUncertain = flipMargin < 0.1 * Math.max(uprightScore, flippedScore, 1e-9)
    const needsFlip = !flipUncertain && flippedScore > uprightScore * 1.06

    if (needsFlip) {
      return {
        imageData: rotateImageData(imageData, 180),
        rotation: PAGE_ROTATION.HALF,
        sideways: false,
        uncertain: flipUncertain,
        confidence: detection.confidence,
        correctionPath: flipUncertain ? 'auto-detect-upright-uncertain' : 'auto-detect-upright-flip',
        detection,
        quarterTurnScores: null,
      }
    }

    return {
      imageData,
      rotation: PAGE_ROTATION.NONE,
      sideways: false,
      uncertain: false,
      confidence: detection.confidence,
      correctionPath: 'none',
      detection,
      quarterTurnScores: null,
    }
  }

  const bandOpts = { useMarginMask: options.useMarginMask !== false, ...options }
  const cw = rotateImageData(imageData, 90)
  const ccw = rotateImageData(imageData, 270)
  const cwScore = horizontalLineScoreInBand(cw, bandOpts)
  const ccwScore = horizontalLineScoreInBand(ccw, bandOpts)
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
    correctionPath: detection.uncertain || tieUncertain ? 'auto-detect-uncertain' : 'auto-detect',
    detection,
    quarterTurnScores: { cw: cwScore, ccw: ccwScore },
  }
}

/**
 * Apply a viewer-selected rotation (0/90/180/270) to analysis bitmap.
 * Used when the user clicks Rotate page or when restoring saved view rotations.
 */
export function applyPageViewRotation(imageData, degrees) {
  const rotation = normalizeViewRotationDegrees(degrees)
  if (rotation === PAGE_ROTATION.NONE) {
    return normalizeImageDataOrientation(imageData)
  }
  const rotated = rotateImageData(imageData, rotation)
  const upright = normalizeImageDataOrientation(rotated)
  return {
    imageData: upright.imageData,
    rotation,
    sideways: rotation !== PAGE_ROTATION.NONE,
    uncertain: upright.uncertain,
    confidence: upright.confidence,
    correctionPath: 'forced-viewer',
    detection: upright.detection,
    forced: true,
  }
}

function normalizeViewRotationDegrees(degrees) {
  const deg = ((Math.round((degrees ?? 0) / 90) * 90) % 360 + 360) % 360
  if (deg === 90) {
    return PAGE_ROTATION.CW90
  }
  if (deg === 180) {
    return PAGE_ROTATION.HALF
  }
  if (deg === 270) {
    return PAGE_ROTATION.CW270
  }
  return PAGE_ROTATION.NONE
}

/**
 * Resolve analysis orientation for one page: forced viewer rotation wins over auto-detect.
 */
export function resolvePageOrientation(imageData, { forcedRotation = null, options = {} } = {}) {
  const forced = normalizeViewRotationDegrees(forcedRotation)
  if (forced !== PAGE_ROTATION.NONE) {
    return applyPageViewRotation(imageData, forced)
  }
  return normalizeImageDataOrientation(imageData, options)
}

/** Apply a reconciled viewer rotation from the original source bitmap. */
export function applyDocumentPageRotation(imageData, rotation) {
  const normalized = normalizeViewRotationDegrees(rotation)
  if (normalized === PAGE_ROTATION.NONE) {
    return normalizeImageDataOrientation(imageData)
  }
  return applyPageViewRotation(imageData, normalized)
}

const DOCUMENT_HIGH_CONFIDENCE = 0.55
const DOCUMENT_ASPECT_TOLERANCE = 0.03

function aspectRatio(width, height) {
  if (!width || !height) {
    return null
  }
  return width / height
}

function sameSourceAspect(pageA, pageB) {
  const ratioA = aspectRatio(pageA.sourceWidth, pageA.sourceHeight)
  const ratioB = aspectRatio(pageB.sourceWidth, pageB.sourceHeight)
  if (ratioA == null || ratioB == null) {
    return false
  }
  return Math.abs(ratioA - ratioB) <= DOCUMENT_ASPECT_TOLERANCE * Math.max(ratioA, ratioB)
}

function isQuarterTurnRotation(rotation) {
  const deg = normalizeViewRotationDegrees(rotation)
  return deg === PAGE_ROTATION.CW90 || deg === PAGE_ROTATION.CW270
}

function isConfidentUpright(page) {
  return (
    normalizeViewRotationDegrees(page.rotation ?? 0) === PAGE_ROTATION.NONE &&
    !page.uncertain &&
    !page.detectedSideways &&
    (page.confidence ?? 1) >= DOCUMENT_HIGH_CONFIDENCE
  )
}

function dominantQuarterTurnRotation(pages) {
  const votes = pages.filter((page) => isQuarterTurnRotation(page.rotation))
  if (votes.length === 0) {
    return null
  }

  const count90 = votes.filter((page) => normalizeViewRotationDegrees(page.rotation) === PAGE_ROTATION.CW90).length
  const count270 = votes.filter((page) => normalizeViewRotationDegrees(page.rotation) === PAGE_ROTATION.CW270).length
  if (count90 === count270) {
    return null
  }
  if (count90 + count270 < 2) {
    return null
  }

  return count90 > count270 ? PAGE_ROTATION.CW90 : PAGE_ROTATION.CW270
}

function reconcileAspectGroup(group) {
  const sorted = [...group].sort((a, b) => a.page - b.page)
  const dominantQuarter = dominantQuarterTurnRotation(
    sorted.filter((page) => !page.uncertain && isQuarterTurnRotation(page.rotation)),
  ) ?? dominantQuarterTurnRotation(sorted.filter((page) => isQuarterTurnRotation(page.rotation)))

  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index]
    if (isConfidentUpright(page)) {
      continue
    }

    const isFirst = index === 0
    const isLast = index === sorted.length - 1
    const neighbor = isFirst ? sorted[1] : isLast ? sorted[sorted.length - 2] : null
    const neighborQuarter =
      neighbor && isQuarterTurnRotation(neighbor.rotation) ? normalizeViewRotationDegrees(neighbor.rotation) : null

    const pageQuarter = normalizeViewRotationDegrees(page.rotation ?? 0)
    const lowConfidence = page.uncertain || (page.confidence ?? 0) < DOCUMENT_HIGH_CONFIDENCE

    if (isLast && neighbor && sameSourceAspect(page, neighbor)) {
      const neighborRotation = normalizeViewRotationDegrees(neighbor.rotation ?? 0)
      if (neighborRotation !== PAGE_ROTATION.NONE && pageQuarter !== neighborRotation) {
        page.rotation = neighborRotation
        page.uncertain = false
        page.correctionPath = 'document-last-page-neighbor'
        continue
      }
    }

    if (neighborQuarter != null && sameSourceAspect(page, neighbor) && (isFirst || isLast) && lowConfidence) {
      if (pageQuarter !== neighborQuarter) {
        page.rotation = neighborQuarter
        page.uncertain = false
        page.correctionPath = 'document-edge-neighbor'
      }
      continue
    }

    if (
      dominantQuarter != null &&
      isQuarterTurnRotation(page.rotation) &&
      pageQuarter !== dominantQuarter &&
      lowConfidence
    ) {
      page.rotation = dominantQuarter
      page.uncertain = false
      page.correctionPath = 'document-dominant'
      continue
    }

    if (
      dominantQuarter != null &&
      neighborQuarter === dominantQuarter &&
      sameSourceAspect(page, neighbor) &&
      page.rotation === PAGE_ROTATION.NONE &&
      (page.uncertain || page.detectedSideways || page.landscape) &&
      (isFirst || isLast)
    ) {
      page.rotation = dominantQuarter
      page.uncertain = false
      page.correctionPath = 'document-edge-neighbor'
    }
  }
}

/**
 * Align per-page auto-detected rotations within a scanned document.
 * Prefers the dominant quarter-turn among confident pages and uses neighbors
 * as tie-breakers for uncertain first/last pages with matching source aspect.
 */
export function reconcileDocumentPageOrientations(pageRecords = []) {
  const pages = pageRecords.map((page) => ({ ...page }))
  if (pages.length < 2) {
    return pages
  }

  const groups = new Map()
  for (const page of pages) {
    const key = `${page.sourceWidth ?? 0}x${page.sourceHeight ?? 0}`
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(page)
  }

  for (const group of groups.values()) {
    if (group.length >= 2) {
      reconcileAspectGroup(group)
    }
  }

  return pages
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

/** Per-page orientation diagnostics for setup reports and calibration debug. */
export function buildPageOrientationRecord(page, sourceImageData, oriented, { forcedRotation = null } = {}) {
  const forced = normalizeViewRotationDegrees(forcedRotation)
  let correctionPath = oriented.correctionPath ?? 'none'
  if (forced !== PAGE_ROTATION.NONE) {
    correctionPath = 'forced-viewer'
  }
  return {
    page,
    rotation: oriented.rotation ?? PAGE_ROTATION.NONE,
    uncertain: Boolean(oriented.uncertain),
    confidence: oriented.confidence ?? null,
    correctionPath,
    detectedSideways: oriented.detection?.sideways ?? false,
    sidewaysByLines: oriented.detection?.sidewaysByLines ?? false,
    sidewaysByLandscape: oriented.detection?.sidewaysByLandscape ?? false,
    landscape: oriented.detection?.landscape ?? false,
    horizontalLineScore: oriented.detection?.horizontalScore ?? null,
    verticalLineScore: oriented.detection?.verticalScore ?? null,
    sourceWidth: sourceImageData?.width ?? null,
    sourceHeight: sourceImageData?.height ?? null,
    analysisWidth: oriented.imageData?.width ?? sourceImageData?.width ?? null,
    analysisHeight: oriented.imageData?.height ?? sourceImageData?.height ?? null,
  }
}

/** Collapse per-page orientation results into a setup-level summary. */
export function summarizePageOrientations(pages) {
  const list = pages ?? []
  const rotated = list.filter((p) => p.rotation && p.rotation !== PAGE_ROTATION.NONE)
  const uncertain = list.filter((p) => p.uncertain)
  const autoCorrected = list.filter((p) =>
    String(p.correctionPath ?? '').startsWith('auto-detect'),
  )
  return {
    anyRotated: rotated.length > 0,
    anyUncertain: uncertain.length > 0,
    anyAutoCorrected: autoCorrected.length > 0,
    rotatedPageCount: rotated.length,
    maxRotation: list.reduce((max, p) => Math.max(max, p.rotation ?? 0), 0),
    correctionPaths: [...new Set(list.map((p) => p.correctionPath).filter(Boolean))],
    pages: list.map((p) => ({
      page: p.page,
      rotation: p.rotation ?? 0,
      uncertain: Boolean(p.uncertain),
      confidence: p.confidence,
      correctionPath: p.correctionPath ?? 'none',
      detectedSideways: p.detectedSideways ?? false,
      horizontalLineScore: p.horizontalLineScore ?? null,
      verticalLineScore: p.verticalLineScore ?? null,
      sourceWidth: p.sourceWidth ?? null,
      sourceHeight: p.sourceHeight ?? null,
      analysisWidth: p.analysisWidth ?? null,
      analysisHeight: p.analysisHeight ?? null,
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
