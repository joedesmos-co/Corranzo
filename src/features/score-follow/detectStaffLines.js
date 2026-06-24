import {
  detectBarlineCandidates,
  BARLINE_REJECT_REASON,
} from './detectBarlinesInSystem.js'

/**
 * Staff-line-based staff-system detection — the primary, dense-music-robust
 * detector for auto score-follow.
 *
 * Row-density band detection fails on dense piano/anime/game arrangements:
 * note ink fills every row, so systems blur together with no clean valleys.
 * Staff LINES, however, are an invariant feature of any engraved score — long,
 * thin, near-full-width horizontal runs of ink. Detecting those runs and
 * grouping them into systems (using the MusicXML staves-per-system count) is
 * far more reliable. Barlines are then long vertical runs spanning the full
 * grand-staff height, which give measures-per-system.
 *
 * Validated on a real dense 4-page arrangement (exact systems + measure counts
 * per page) and on the public-domain demo.
 */

/** Luminance composited over white so transparent PDF backgrounds aren't ink. */
function compositeLuminance(data, index) {
  const alpha = data[index + 3] / 255
  const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  return lum * alpha + 255 * (1 - alpha)
}

function contentColumns(imageData, contentBounds) {
  const { width } = imageData
  const left = Math.max(0, Math.floor((contentBounds.left ?? contentBounds.x0 * width)))
  const right = Math.min(width - 1, Math.ceil((contentBounds.right ?? contentBounds.x1 * width)))
  return { left, right, span: Math.max(1, right - left + 1) }
}

/**
 * Adaptive ink threshold: the midpoint between the paper background and the ink
 * level. Dark engravings get a low threshold (precise, no over-detection);
 * light/thin engravings (Satie-style classical) get a high threshold so their
 * faint staff lines still register. Avoids the fixed-170 cutoff that dropped
 * light scores to coarse fallbacks or "no systems".
 */
export function estimateInkThreshold(imageData, contentBounds) {
  const { width, height, data } = imageData
  const { left, right } = contentColumns(imageData, contentBounds)
  const lums = []
  const stepY = Math.max(1, Math.floor(height / 320))
  const stepX = Math.max(1, Math.floor((right - left + 1) / 320))
  for (let y = 0; y < height; y += stepY) {
    const rowOffset = y * width
    for (let x = left; x <= right; x += stepX) {
      lums.push(compositeLuminance(data, (rowOffset + x) * 4))
    }
  }
  if (lums.length === 0) {
    return 170
  }
  lums.sort((a, b) => a - b)
  const background = lums[Math.floor(lums.length * 0.9)] // paper (high percentile)
  const inkPixels = lums.filter((l) => l < background - 15)
  if (inkPixels.length < lums.length * 0.002) {
    return 170 // near-blank region — keep the conservative default
  }
  const inkLevel = inkPixels[Math.floor(inkPixels.length * 0.5)] // median ink
  return Math.min(235, Math.max(150, (background + inkLevel) / 2))
}

/**
 * Per-row staff-line scores over the content width:
 *   - run:  longest contiguous dark run / content width (solid staff lines)
 *   - dark: total dark fraction / content width (handles BROKEN lines where
 *           noteheads/stems interrupt the staff line)
 */
export function computeRowStaffScores(imageData, contentBounds, darkThreshold = 170) {
  const { width, height, data } = imageData
  const { left, right, span } = contentColumns(imageData, contentBounds)
  const run = new Float32Array(height)
  const dark = new Float32Array(height)
  for (let y = 0; y < height; y += 1) {
    let current = 0
    let best = 0
    let total = 0
    const rowOffset = y * width
    for (let x = left; x <= right; x += 1) {
      if (compositeLuminance(data, (rowOffset + x) * 4) < darkThreshold) {
        current += 1
        total += 1
        if (current > best) best = current
      } else {
        current = 0
      }
    }
    run[y] = best / span
    dark[y] = total / span
  }
  return { run, dark }
}

/** Backwards-compatible: longest-run coverage per row. */
export function computeHorizontalRunCoverage(imageData, contentBounds, darkThreshold = 170) {
  return computeRowStaffScores(imageData, contentBounds, darkThreshold).run
}

function clusterStaffLineRows(lineRows, height, minGapNorm) {
  if (lineRows.length === 0) {
    return []
  }
  const gapPx = Math.max(3, Math.floor(height * minGapNorm))
  const clusters = []
  let current = [lineRows[0]]
  for (let i = 1; i < lineRows.length; i += 1) {
    if (lineRows[i] - lineRows[i - 1] > gapPx) {
      clusters.push(current)
      current = []
    }
    current.push(lineRows[i])
  }
  clusters.push(current)
  return clusters
    .map((rows) => {
      const y0 = rows[0] / height
      const y1 = rows[rows.length - 1] / height
      return { y0, y1, center: (y0 + y1) / 2, lineCount: rows.length }
    })
    .filter((stave) => stave.lineCount >= 2)
}

/**
 * Detect individual staves from staff-line rows, using an adaptive ink
 * threshold and multiple passes (strict → looser) so the detector handles:
 * dense dark arrangements, thin/light classical engraving, shorter systems
 * that don't span the page, and broken staff lines crossed by noteheads/slurs.
 *
 * Returns the detected staves; attaches `lastTrace` to the function for the
 * dev debug report when nothing is found.
 */
export function detectStaffLineStaves(imageData, contentBounds, options = {}) {
  const { minGapNorm = 0.018 } = options
  const { height } = imageData
  const adaptive = options.darkThreshold ?? estimateInkThreshold(imageData, contentBounds)

  // Passes from precise to permissive. Each accepts a row as a staff line when
  // its longest run OR (for broken lines) its total dark fraction is high.
  const passes = [
    { dark: adaptive, runCov: 0.5, darkCov: 0.85 },
    { dark: adaptive, runCov: 0.35, darkCov: 0.6 },
    { dark: Math.min(235, adaptive + 25), runCov: 0.3, darkCov: 0.55 },
  ]

  let trace = null
  for (const pass of passes) {
    const { run, dark } = computeRowStaffScores(imageData, contentBounds, pass.dark)
    const lineRows = []
    let maxRun = 0
    for (let y = 0; y < height; y += 1) {
      if (run[y] > maxRun) maxRun = run[y]
      if (run[y] > pass.runCov || dark[y] > pass.darkCov) {
        lineRows.push(y)
      }
    }
    const staves = clusterStaffLineRows(lineRows, height, minGapNorm)
    trace = {
      adaptiveThreshold: Math.round(adaptive),
      passDarkThreshold: Math.round(pass.dark),
      runCoverage: pass.runCov,
      darkCoverage: pass.darkCov,
      candidateRows: lineRows.length,
      maxRunCoverage: Number(maxRun.toFixed(3)),
      staves: staves.length,
    }
    if (staves.length >= 1) {
      detectStaffLineStaves.lastTrace = { ...trace, accepted: true }
      return staves
    }
  }

  detectStaffLineStaves.lastTrace = { ...trace, accepted: false, reason: 'no staff-line rows passed any threshold' }
  return []
}

/**
 * Group detected staves into systems.
 *
 * The reliable discriminator is the GAP STRUCTURE, not a fixed chunk size,
 * because a grand staff's treble + bass may be detected as two separate staves
 * (high-resolution renders) or merged into one (low-resolution / tight
 * spacing):
 *   - Bimodal gaps (clear small intra-system vs large inter-system) → split at
 *     the large gaps. This pairs treble+bass into one system.
 *   - Uniform gaps → each detected stave is already its own system (merged
 *     grand staff, or genuinely single-staff systems).
 *
 * `stavesPerSystem` (from MusicXML) is used as a cross-check / cap, not as the
 * sole grouping rule.
 */
export function groupStavesIntoSystems(staves, stavesPerSystem = 1) {
  if (staves.length <= 1) {
    return staves.map((stave) => ({ ...stave, staveCount: 1 }))
  }
  const perSystem = Math.max(1, Math.round(stavesPerSystem))

  // Hypothesis test for chunking by `stavesPerSystem` (e.g. pair treble+bass):
  // correct only when the gaps WITHIN a chunk are consistently smaller than the
  // gaps BETWEEN chunks. Works whether treble/bass are detected as two staves
  // (chunk them) or merged into one (don't). Uses a CONSISTENT-SEPARATION test
  // rather than a fixed ratio, because airy classical engraving (Satie) has a
  // within-pair gap only slightly smaller than the between-system gap — but the
  // separation is still clean (every inter-gap exceeds every intra-gap).
  if (perSystem >= 2 && staves.length > perSystem && staves.length % perSystem === 0) {
    const intra = []
    const inter = []
    for (let i = 1; i < staves.length; i += 1) {
      const gap = staves[i].center - staves[i - 1].center
      if (i % perSystem === 0) {
        inter.push(gap) // gap at a chunk boundary
      } else {
        intra.push(gap) // gap inside a chunk
      }
    }
    if (chunkingIsConsistent(inter, intra)) {
      const systems = []
      for (let i = 0; i < staves.length; i += perSystem) {
        systems.push(mergeStaveGroup(staves.slice(i, i + perSystem)))
      }
      return systems
    }
  }

  // Otherwise each detected cluster is already a whole system (a merged grand
  // staff, or genuinely single-staff systems).
  return staves.map((stave) => ({ ...stave, staveCount: 1 }))
}

/**
 * True when chunk-boundary gaps consistently exceed within-chunk gaps — i.e.
 * the staves really do pair up. Median must be a touch larger AND most boundary
 * gaps must clear the largest within-chunk gap, so uniform spacing (a merged
 * grand staff or evenly-spaced single staves) is NOT falsely chunked.
 */
function chunkingIsConsistent(inter, intra) {
  if (inter.length === 0 || intra.length === 0) {
    return false
  }
  const medInter = median(inter)
  const medIntra = median(intra)
  if (medInter <= medIntra * 1.04) {
    return false // gaps are essentially uniform → not paired
  }
  const maxIntra = Math.max(...intra)
  const interClearingIntra = inter.filter((g) => g > maxIntra * 0.9).length / inter.length
  return interClearingIntra >= 0.7
}

function median(values) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function mergeStaveGroup(group) {
  const y0 = group[0].y0
  const y1 = group[group.length - 1].y1
  return { y0, y1, center: (y0 + y1) / 2, staveCount: group.length }
}

/**
 * Count barlines in a system band: vertical dark runs spanning most of the
 * system height. Stems are short (one staff), barlines span the full grand
 * staff, so the height fraction separates them. Adjacent columns are merged so
 * a thick barline counts once.
 */
export function countSystemBarlines(imageData, contentBounds, system, options = {}) {
  return detectSystemBarlinePositions(imageData, contentBounds, system, options).length
}

/** A real measure is at least this fraction of the system's content width. */
const MIN_MEASURE_WIDTH_FRAC = 0.045
/** Borderline measure width — keep barlines but downgrade confidence. */
const LOW_CONFIDENCE_MEASURE_WIDTH_FRAC = 0.055
/** More detected "measures" than this in one system means the count is unreliable. */
const MAX_MEASURES_PER_SYSTEM = 16

/**
 * Decide whether a detected barline set is a TRUSTWORTHY measure-count signal.
 *
 * Dense piano/anime notation stacks noteheads + stems into full-grand-staff
 * vertical runs that are pixel-identical to barlines, producing a tight, regular
 * grid of false positives (e.g. 28 "measures" where there are 6). Such a grid is
 * unreliable: its implied measure width is far too small to be a real measure,
 * or the count is implausibly high. In those cases we must NOT emit a confident
 * measure count (better to fall back to MusicXML breaks than to map measures to
 * the wrong systems with false confidence).
 *
 * When spacing is ambiguous but barlines are retained, returns confident:false
 * with confidenceLevel 'low' rather than deleting borderline candidates.
 */
export function assessBarlineReliability(positions, contentBounds, diagnostics = null) {
  const x0 = contentBounds?.x0 ?? 0
  const x1 = contentBounds?.x1 ?? 1
  const contentWidth = Math.max(1e-6, x1 - x0)
  const retainedLowConfidence = diagnostics?.retainedLowConfidence ?? 0
  const densityAmbiguous = diagnostics?.densityAmbiguous === true

  if (!positions || positions.length < 2) {
    const rejectedDense =
      (diagnostics?.rejected?.[BARLINE_REJECT_REASON.TOO_DENSE] ?? 0) > 0 ||
      (diagnostics?.rejected?.[BARLINE_REJECT_REASON.INCONSISTENT] ?? 0) > 0
    return {
      confident: false,
      confidenceLevel: 'none',
      reason: rejectedDense ? 'barline-grid-too-dense' : 'too-few-barlines',
      measureWidthFrac: null,
      retainedLowConfidence,
      densityAmbiguous,
    }
  }
  const measures = positions.length - 1
  const gaps = []
  for (let i = 1; i < positions.length; i += 1) {
    gaps.push(positions[i] - positions[i - 1])
  }
  const measureWidthFrac = median(gaps) / contentWidth

  if (measures > MAX_MEASURES_PER_SYSTEM) {
    return {
      confident: false,
      confidenceLevel: 'none',
      reason: 'too-many-barlines',
      measureWidthFrac,
      retainedLowConfidence,
      densityAmbiguous: true,
    }
  }
  if (measureWidthFrac < MIN_MEASURE_WIDTH_FRAC) {
    return {
      confident: false,
      confidenceLevel: densityAmbiguous || retainedLowConfidence > 0 ? 'low' : 'none',
      reason: 'barline-grid-too-dense',
      measureWidthFrac,
      retainedLowConfidence,
      densityAmbiguous: true,
    }
  }
  if (densityAmbiguous) {
    return {
      confident: false,
      confidenceLevel: 'low',
      reason: 'ambiguous-density',
      measureWidthFrac,
      retainedLowConfidence,
      densityAmbiguous: true,
    }
  }
  if (
    retainedLowConfidence > 0 &&
    measureWidthFrac < LOW_CONFIDENCE_MEASURE_WIDTH_FRAC
  ) {
    return {
      confident: false,
      confidenceLevel: 'low',
      reason: 'low-confidence-candidates',
      measureWidthFrac,
      retainedLowConfidence,
      densityAmbiguous: false,
    }
  }
  return {
    confident: true,
    confidenceLevel: retainedLowConfidence > 0 ? 'medium' : 'high',
    reason: retainedLowConfidence > 0 ? 'ok-with-borderline-candidates' : 'ok',
    measureWidthFrac,
    retainedLowConfidence,
    densityAmbiguous: false,
  }
}

/** Normalized x positions of detected barlines within a system band. */
export function detectSystemBarlinePositions(imageData, contentBounds, system, options = {}) {
  const { darkThreshold = 150 } = options
  return detectBarlineCandidates(imageData, contentBounds, system, { darkThreshold }).positions
}

/**
 * Barline detection with per-system rejection diagnostics (for debug reports).
 */
export function detectSystemBarlinesWithDiagnostics(
  imageData,
  contentBounds,
  system,
  options = {},
) {
  const { darkThreshold = 150 } = options
  return detectBarlineCandidates(imageData, contentBounds, system, { darkThreshold })
}

/**
 * Full staff-line system detection for one page: detect staves, group into
 * systems using staves-per-system, and (optionally) attach a barline-based
 * measure-count estimate per system.
 *
 * Returns { systems: [{ y0, y1, center, staveCount, barlineCount, measureEstimate }] }.
 */
export function detectStaffLineSystems(imageData, contentBounds, options = {}) {
  const { stavesPerSystem = 1, countBarlines = true } = options
  // Adaptive ink threshold drives BOTH staff-line and barline detection so light
  // engravings register consistently.
  const inkThreshold = options.darkThreshold ?? estimateInkThreshold(imageData, contentBounds)
  const staves = detectStaffLineStaves(imageData, contentBounds, {
    ...options,
    darkThreshold: inkThreshold,
  })
  const trace = detectStaffLineStaves.lastTrace ?? null
  const grouped = groupStavesIntoSystems(staves, stavesPerSystem)

  // Barlines are darker than staff lines, so bias the threshold toward ink but
  // never below the staff-line threshold.
  const barlineThreshold = Math.min(inkThreshold, Math.max(150, inkThreshold - 20))
  const systems = grouped.map((system) => {
    const detection = countBarlines
      ? detectSystemBarlinesWithDiagnostics(imageData, contentBounds, system, {
          darkThreshold: barlineThreshold,
        })
      : { positions: [], diagnostics: null }
    const positions = detection.positions
    const barlineCount = positions.length
    const reliability = assessBarlineReliability(positions, contentBounds, detection.diagnostics)
    // N barlines (start + internal + end) bound N-1 measures — but only emit a
    // count when the barlines are a trustworthy measure signal. A confident-but-
    // wrong count would map measures to the wrong systems, so an unreliable
    // (e.g. dense-notation) result yields null and falls back to MusicXML breaks.
    const measureEstimate =
      barlineCount >= 2 && reliability.confident ? barlineCount - 1 : null
    return {
      ...system,
      barlineCount,
      barlineCandidatesRaw: detection.diagnostics?.candidatesRaw ?? null,
      barlineRejected: detection.diagnostics?.rejected ?? null,
      barlineAccepted: detection.diagnostics?.accepted ?? barlineCount,
      barlineRetainedLowConfidence: detection.diagnostics?.retainedLowConfidence ?? 0,
      barlineDensityAmbiguous: detection.diagnostics?.densityAmbiguous ?? false,
      measureEstimate,
      barlineConfident: reliability.confident,
      barlineConfidenceLevel: reliability.confidenceLevel,
      barlineReliabilityReason: reliability.reason,
      contentBounds,
    }
  })

  return { staves, systems, inkThreshold: Math.round(inkThreshold), trace }
}
