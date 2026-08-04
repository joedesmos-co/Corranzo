import {
  assessBarlineReliability,
  detectSystemBarlinesWithDiagnostics,
} from '../score-follow/detectStaffLines.js'
import { summarizeBarlineRejections } from '../score-follow/pdfPageAnalysis.js'
import { estimateGrandStaffLines } from './pitchFromStaffPosition.js'

const MIN_MEASURES_IF_NO_BARLINES = 4
/** Match assessBarlineReliability — spans narrower than this are likely false barlines. */
export const MIN_MEASURE_SPAN_FRAC = 0.045
/** Uniform grids above this count with small equal widths are often 2× oversampled. */
const OVERSAMPLE_COLLAPSE_MIN_SPANS = 5
const OVERSAMPLE_MAX_MEAN_WIDTH_FRAC = 0.17
const OVERSAMPLE_MAX_WIDTH_CV = 0.22
const TRAILING_SHORT_SPAN_RATIO = 0.62
const TRAILING_PAIR_MIN_COMBINED_RATIO = 0.75
const TRAILING_PAIR_MAX_COMBINED_RATIO = 1.35
const TRAILING_SINGLE_MIN_COMBINED_RATIO = 1.1
const TRAILING_SINGLE_MAX_COMBINED_RATIO = 1.65
const VECTOR_NOTE_COLUMN_PRECISE_DISTANCE = 0.0035
const VECTOR_STEM_MIN_NOTEHEAD_WIDTH_PX = 14
const VECTOR_STEM_OFFSET_RATIO_MIN = 0.3
const VECTOR_STEM_OFFSET_RATIO_MAX = 0.5
const WIDE_SPAN_SPLIT_MIN_RATIO = 1.68
const WIDE_SPAN_SPLIT_MAX_PARTS = 3
const VECTOR_SINGLETON_COLUMN_CLUSTER_DISTANCE = 0.006
/** Cluster chordally stacked heads into one column for gap-aware barline snaps. */
export const VECTOR_NOTE_COLUMN_CLUSTER_DISTANCE = 0.01
/** Trailing chord columns stolen across a late barline leave a gap ≥ this × median. */
const NOTE_COLUMN_GAP_SNAP_MIN_RATIO = 2
/** Barlines closer than this to an in-pack column centroid are likely stems. */
const IN_PACK_BARLINE_MAX_DISTANCE = 0.008
/** Column gap ≥ median × this marks a measure pack boundary. */
const PACK_BOUNDARY_GAP_RATIO = 2
/** Search the rightmost fraction of the left span for a stolen opening column. */
const NOTE_COLUMN_GAP_SNAP_SEARCH_LEFT_FRAC = 0.45
const NOTE_COLUMN_GAP_SNAP_MIN_COLUMNS = 4
/** Rebuild entire unreliable grids when large column gaps imply a cleaner measure count. */
const NOTE_COLUMN_GAP_REBUILD_MIN_RATIO = 2
const NOTE_COLUMN_GAP_REBUILD_MIN_COLUMNS = 8
const NOTE_COLUMN_GAP_REBUILD_MIN_MEASURES = 2
const NOTE_COLUMN_GAP_REBUILD_MAX_MEASURES = 8

function average(values) {
  if (!values.length) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function coefficientOfVariation(values) {
  if (!values.length) {
    return Infinity
  }
  const mean = average(values)
  if (mean <= 0) {
    return Infinity
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

function median(values) {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function boundariesToSpans(boundaries, contentWidth) {
  const unique = []
  for (const x of boundaries) {
    if (!unique.length || x - unique[unique.length - 1] > 0.015) {
      unique.push(x)
    }
  }

  const spans = []
  for (let index = 0; index < unique.length - 1; index += 1) {
    const x0 = unique[index]
    const x1 = unique[index + 1]
    if (x1 - x0 < 0.03) {
      continue
    }
    spans.push({ x0, x1 })
  }

  if (spans.length >= 2) {
    const firstWidth = spans[0].x1 - spans[0].x0
    const secondWidth = spans[1].x1 - spans[1].x0
    const looksLikePreSystemLabel =
      firstWidth < contentWidth * 0.11 && secondWidth > firstWidth * 1.8
    if (looksLikePreSystemLabel) {
      return spans.slice(1)
    }
  }

  return spans
}

/** Recover a missed barline when one span is an integer multiple of its peers. */
export function splitWideMeasureSpans(
  spans,
  { minRatio = WIDE_SPAN_SPLIT_MIN_RATIO, maxParts = WIDE_SPAN_SPLIT_MAX_PARTS } = {},
) {
  if (spans.length < 3) {
    return { spans, splitCount: 0 }
  }
  const widths = spans.map((span) => span.x1 - span.x0)
  const referenceWidth = median(widths)
  if (referenceWidth <= 0) {
    return { spans, splitCount: 0 }
  }
  const result = []
  let splitCount = 0
  for (const span of spans) {
    const ratio = (span.x1 - span.x0) / referenceWidth
    const parts = Math.round(ratio)
    if (ratio >= minRatio && parts >= 2 && parts <= maxParts) {
      const partWidth = (span.x1 - span.x0) / parts
      const partRatio = partWidth / referenceWidth
      if (partRatio >= 0.72 && partRatio <= 1.35) {
        for (let part = 0; part < parts; part += 1) {
          result.push({
            x0: span.x0 + part * partWidth,
            x1: span.x0 + (part + 1) * partWidth,
          })
        }
        splitCount += parts - 1
        continue
      }
    }
    result.push({ ...span })
  }
  return { spans: result, splitCount }
}

export function rejectVectorNoteColumns(barlines, noteheadXNorms = [], imageWidth = 1000) {
  if (noteheadXNorms.length < 3) {
    return { barlines, rejectedCount: 0, candidateOffsets: [] }
  }
  const columns = noteheadXNorms.map((entry) =>
    Number.isFinite(entry)
      ? { x: entry, width: null }
      : { x: entry.x, width: entry.width ?? null },
  )
  const candidates = barlines.map((barlineX) => {
    const closest = columns.reduce(
      (best, noteheadX) =>
        Math.abs(barlineX - noteheadX.x) < Math.abs(best.offset)
          ? {
              offset: barlineX - noteheadX.x,
              width: noteheadX.width,
              widthRatio: noteheadX.width
                ? (barlineX - noteheadX.x) / noteheadX.width
                : null,
            }
          : best,
      { offset: Infinity, width: null, widthRatio: null },
    )
    return closest
  })
  const candidateOffsets = candidates.filter((candidate) => Math.abs(candidate.offset) <= 0.012)
  const filtered = barlines.filter((_, index) => {
    const candidate = candidates[index]
    const preciseMatch = Math.abs(candidate.offset) <= VECTOR_NOTE_COLUMN_PRECISE_DISTANCE
    const resolvedStemMatch =
      (candidate.width ?? 0) * imageWidth >= VECTOR_STEM_MIN_NOTEHEAD_WIDTH_PX &&
      candidate.widthRatio >= VECTOR_STEM_OFFSET_RATIO_MIN &&
      candidate.widthRatio <= VECTOR_STEM_OFFSET_RATIO_MAX
    return !preciseMatch && !resolvedStemMatch
  })
  return {
    barlines: filtered,
    rejectedCount: barlines.length - filtered.length,
    candidateOffsets,
  }
}

/**
 * Dense chordal systems can mis-detect a note stem as a barline mid-pack.
 * Reject barlines that sit on a column centroid when neighboring columns
 * are tightly spaced (not at a large inter-measure gap).
 */
export function rejectBarlinesInsideNoteColumnPacks(barlines, noteColumnXNorms = []) {
  const columns = clusterVectorNoteheadColumns(noteColumnXNorms).map((column) => column.x)
  if (columns.length < 4 || barlines.length === 0) {
    return { barlines, rejectedCount: 0 }
  }
  const gaps = []
  for (let index = 1; index < columns.length; index += 1) {
    gaps.push(columns[index] - columns[index - 1])
  }
  const medianGap = median(gaps)
  if (!(medianGap > 0)) {
    return { barlines, rejectedCount: 0 }
  }
  const maxDistance = Math.min(IN_PACK_BARLINE_MAX_DISTANCE, medianGap * 0.55)
  const boundaryThreshold = medianGap * PACK_BOUNDARY_GAP_RATIO
  const isPackBoundary = (columnIndex) => {
    const gapBefore =
      columnIndex > 0 ? columns[columnIndex] - columns[columnIndex - 1] : Infinity
    const gapAfter =
      columnIndex < columns.length - 1
        ? columns[columnIndex + 1] - columns[columnIndex]
        : Infinity
    return gapBefore >= boundaryThreshold || gapAfter >= boundaryThreshold
  }
  const filtered = barlines.filter((barlineX) => {
    let nearestIndex = 0
    let nearestDistance = Infinity
    for (let index = 0; index < columns.length; index += 1) {
      const distance = Math.abs(barlineX - columns[index])
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    }
    if (nearestDistance > maxDistance) {
      return true
    }
    return isPackBoundary(nearestIndex)
  })
  return {
    barlines: filtered,
    rejectedCount: barlines.length - filtered.length,
  }
}

/**
 * Vector note-column rejection is reliable for monophonic/singleton attacks:
 * each vertical beside a head is a stem, not a barline. In chordal textures,
 * staggered heads and accidentals make the same proximity evidence ambiguous,
 * so retain the pixel barline path.
 */
export function shouldUseVectorNoteColumnHints(noteheadXNorms = []) {
  if (noteheadXNorms.length < 3) {
    return false
  }
  const positions = noteheadXNorms
    .map((entry) => (Number.isFinite(entry) ? entry : entry?.x))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (positions.length < 3) {
    return false
  }
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] - positions[index - 1] <= VECTOR_SINGLETON_COLUMN_CLUSTER_DISTANCE) {
      return false
    }
  }
  return true
}

/**
 * Collapse vertically stacked chord heads into column centroids.
 * Safe for chordal textures where per-head stem rejection is ambiguous.
 */
export function clusterVectorNoteheadColumns(
  noteheadXNorms = [],
  clusterDistance = VECTOR_NOTE_COLUMN_CLUSTER_DISTANCE,
) {
  const positions = noteheadXNorms
    .map((entry) => {
      if (Number.isFinite(entry)) {
        return { x: entry, width: null, count: 1 }
      }
      if (!Number.isFinite(entry?.x)) {
        return null
      }
      return {
        x: entry.x,
        width: Number.isFinite(entry.width) ? entry.width : null,
        count: 1,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.x - right.x)
  if (!positions.length) {
    return []
  }
  const columns = [{ ...positions[0] }]
  for (let index = 1; index < positions.length; index += 1) {
    const note = positions[index]
    const current = columns[columns.length - 1]
    if (note.x - current.x <= clusterDistance) {
      const nextCount = current.count + note.count
      current.x = (current.x * current.count + note.x * note.count) / nextCount
      current.count = nextCount
      if (Number.isFinite(note.width)) {
        current.width = Number.isFinite(current.width)
          ? Math.max(current.width, note.width)
          : note.width
      }
      continue
    }
    columns.push({ ...note })
  }
  return columns.map(({ x, width, count }) => ({ x, width, count }))
}

/**
 * Late barlines often sit just after the next measure's opening chord column.
 * When note columns show a gap much larger than the local median immediately
 * left of a boundary, snap that boundary into the gap midpoint so the stolen
 * opening column rejoins the following measure.
 */
export function snapMeasureSpansToNoteColumnGaps(
  spans,
  noteColumnXNorms = [],
  {
    minGapRatio = NOTE_COLUMN_GAP_SNAP_MIN_RATIO,
    searchLeftFrac = NOTE_COLUMN_GAP_SNAP_SEARCH_LEFT_FRAC,
    minColumns = NOTE_COLUMN_GAP_SNAP_MIN_COLUMNS,
    minSpanFrac = MIN_MEASURE_SPAN_FRAC,
  } = {},
) {
  if (spans.length < 2 || noteColumnXNorms.length < minColumns) {
    return { spans, snappedCount: 0 }
  }
  const columns = clusterVectorNoteheadColumns(noteColumnXNorms).map((column) => column.x)
  if (columns.length < minColumns) {
    return { spans, snappedCount: 0 }
  }
  const gaps = []
  for (let index = 1; index < columns.length; index += 1) {
    gaps.push(columns[index] - columns[index - 1])
  }
  const medianGap = median(gaps)
  if (!(medianGap > 0)) {
    return { spans, snappedCount: 0 }
  }
  const minGap = medianGap * minGapRatio
  const result = spans.map((span) => ({ ...span }))
  let snappedCount = 0
  for (let index = 0; index < result.length - 1; index += 1) {
    const left = result[index]
    const right = result[index + 1]
    const boundary = left.x1
    const spanWidth = left.x1 - left.x0
    if (!(spanWidth > 0)) {
      continue
    }
    const searchLeft = left.x0 + spanWidth * (1 - searchLeftFrac)
    let bestGap = null
    for (let columnIndex = 1; columnIndex < columns.length; columnIndex += 1) {
      const leftX = columns[columnIndex - 1]
      const rightX = columns[columnIndex]
      if (leftX < searchLeft || rightX > boundary + medianGap * 0.35) {
        continue
      }
      const gap = rightX - leftX
      if (gap < minGap) {
        continue
      }
      if (!bestGap || gap > bestGap.gap) {
        bestGap = { gap, mid: (leftX + rightX) / 2 }
      }
    }
    if (!bestGap) {
      continue
    }
    const nextLeftWidth = bestGap.mid - left.x0
    const nextRightWidth = right.x1 - bestGap.mid
    if (nextLeftWidth < minSpanFrac || nextRightWidth < minSpanFrac) {
      continue
    }
    if (Math.abs(bestGap.mid - boundary) < medianGap * 0.15) {
      continue
    }
    left.x1 = bestGap.mid
    right.x0 = bestGap.mid
    snappedCount += 1
  }
  return { spans: result, snappedCount }
}

/**
 * When barline detection is unreliable and note columns form clear packs separated
 * by large gaps, rebuild measure spans from those gaps instead of trusting a
 * density-thinned false grid (common on lower paired-guitar systems).
 */
export function rebuildSpansFromNoteColumnGaps(
  spans,
  noteColumnXNorms = [],
  contentBounds,
  {
    minGapRatio = NOTE_COLUMN_GAP_REBUILD_MIN_RATIO,
    minColumns = NOTE_COLUMN_GAP_REBUILD_MIN_COLUMNS,
    minMeasures = NOTE_COLUMN_GAP_REBUILD_MIN_MEASURES,
    maxMeasures = NOTE_COLUMN_GAP_REBUILD_MAX_MEASURES,
    minSpanFrac = MIN_MEASURE_SPAN_FRAC,
  } = {},
) {
  const x0Content = contentBounds?.x0 ?? spans[0]?.x0
  const x1Content = contentBounds?.x1 ?? spans[spans.length - 1]?.x1
  const contentWidth = Math.max(1e-6, (x1Content ?? 1) - (x0Content ?? 0))
  if (
    !Number.isFinite(x0Content) ||
    !Number.isFinite(x1Content) ||
    noteColumnXNorms.length < minColumns
  ) {
    return { spans, rebuilt: false, measureCount: spans.length }
  }
  const columns = clusterVectorNoteheadColumns(noteColumnXNorms).map((column) => column.x)
  if (columns.length < minColumns) {
    return { spans, rebuilt: false, measureCount: spans.length }
  }
  const gaps = []
  for (let index = 1; index < columns.length; index += 1) {
    gaps.push({
      index,
      gap: columns[index] - columns[index - 1],
      mid: (columns[index] + columns[index - 1]) / 2,
    })
  }
  const medianGap = median(gaps.map((entry) => entry.gap))
  if (!(medianGap > 0)) {
    return { spans, rebuilt: false, measureCount: spans.length }
  }
  const boundaryGaps = gaps
    .filter((entry) => entry.gap >= medianGap * minGapRatio)
    .sort((left, right) => left.mid - right.mid)
  const proposedCount = boundaryGaps.length + 1
  if (
    proposedCount < minMeasures ||
    proposedCount > maxMeasures ||
    proposedCount >= spans.length ||
    proposedCount < 2
  ) {
    return { spans, rebuilt: false, measureCount: spans.length }
  }
  // Prefer rebuilds that actually reduce false fragmentation.
  if (proposedCount > spans.length - 1) {
    return { spans, rebuilt: false, measureCount: spans.length }
  }
  const boundaries = [x0Content, ...boundaryGaps.map((entry) => entry.mid), x1Content]
  const rebuilt = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const x0 = boundaries[index]
    const x1 = boundaries[index + 1]
    if (x1 - x0 < minSpanFrac * contentWidth * 0.85) {
      return { spans, rebuilt: false, measureCount: spans.length }
    }
    rebuilt.push({ x0, x1 })
  }
  if (rebuilt.length !== proposedCount) {
    return { spans, rebuilt: false, measureCount: spans.length }
  }
  const widths = rebuilt.map((span) => (span.x1 - span.x0) / contentWidth)
  if (coefficientOfVariation(widths) > 0.55) {
    return { spans, rebuilt: false, measureCount: spans.length }
  }
  return { spans: rebuilt, rebuilt: true, measureCount: rebuilt.length }
}

/**
 * Merge measure slivers produced by stem columns mistaken for barlines.
 */
export function mergeNarrowMeasureSpans(spans, contentWidth, minFrac = MIN_MEASURE_SPAN_FRAC) {
  if (!spans.length) {
    return { spans: [], mergedCount: 0 }
  }
  const minWidth = contentWidth * minFrac
  const result = spans.map((span) => ({ ...span }))
  let mergedCount = 0
  let index = 0
  while (index < result.length) {
    const width = result[index].x1 - result[index].x0
    if (width >= minWidth || result.length === 1) {
      index += 1
      continue
    }
    mergedCount += 1
    if (index === 0) {
      result[1] = { x0: result[0].x0, x1: result[1].x1 }
      result.splice(0, 1)
    } else {
      result[index - 1] = { x0: result[index - 1].x0, x1: result[index].x1 }
      result.splice(index, 1)
      index -= 1
    }
  }
  return { spans: result, mergedCount }
}

/**
 * Dense systems can leave one false barline near the right edge after normal
 * density thinning. Merge only narrow trailing spans with local width evidence:
 * two short tail spans must combine to a normal measure, while a single short
 * tail requires an already-unreliable dense/thinned barline grid.
 */
export function mergeTrailingNarrowMeasureSpans(
  spans,
  contentWidth,
  {
    shortRatio = TRAILING_SHORT_SPAN_RATIO,
    pairMinCombinedRatio = TRAILING_PAIR_MIN_COMBINED_RATIO,
    pairMaxCombinedRatio = TRAILING_PAIR_MAX_COMBINED_RATIO,
    singleMinCombinedRatio = TRAILING_SINGLE_MIN_COMBINED_RATIO,
    singleMaxCombinedRatio = TRAILING_SINGLE_MAX_COMBINED_RATIO,
    allowSingleTrailingMerge = false,
  } = {},
) {
  if (spans.length < 3) {
    return { spans, mergedCount: 0 }
  }
  const result = spans.map((span) => ({ ...span }))
  const widthFracs = result.map((span) => (span.x1 - span.x0) / contentWidth)
  const medianWidth = median(widthFracs)
  if (medianWidth <= 0) {
    return { spans: result, mergedCount: 0 }
  }

  const lastIndex = result.length - 1
  const lastWidth = widthFracs[lastIndex]
  const previousWidth = widthFracs[lastIndex - 1]
  const lastIsShort = lastWidth < medianWidth * shortRatio
  const previousIsShort = previousWidth < medianWidth * shortRatio
  const combinedRatio = (previousWidth + lastWidth) / medianWidth

  if (
    previousIsShort &&
    lastIsShort &&
    combinedRatio >= pairMinCombinedRatio &&
    combinedRatio <= pairMaxCombinedRatio
  ) {
    result[lastIndex - 1] = {
      x0: result[lastIndex - 1].x0,
      x1: result[lastIndex].x1,
    }
    result.splice(lastIndex, 1)
    return { spans: result, mergedCount: 1 }
  }

  if (
    allowSingleTrailingMerge &&
    lastIsShort &&
    !previousIsShort &&
    combinedRatio >= singleMinCombinedRatio &&
    combinedRatio <= singleMaxCombinedRatio
  ) {
    result[lastIndex - 1] = {
      x0: result[lastIndex - 1].x0,
      x1: result[lastIndex].x1,
    }
    result.splice(lastIndex, 1)
    return { spans: result, mergedCount: 1 }
  }

  return { spans: result, mergedCount: 0 }
}

/**
 * When barline thinning leaves a regular grid of similarly narrow measures,
 * pair-adjacent spans to recover whole-bar widths (common in dense piano PDFs).
 */
export function collapseUniformOversampledSpans(
  spans,
  contentWidth,
  {
    minCount = OVERSAMPLE_COLLAPSE_MIN_SPANS,
    maxMeanWidthFrac = OVERSAMPLE_MAX_MEAN_WIDTH_FRAC,
    maxWidthCv = OVERSAMPLE_MAX_WIDTH_CV,
  } = {},
) {
  if (spans.length < minCount) {
    return { spans, collapsedPairs: 0 }
  }
  const widthFracs = spans.map((span) => (span.x1 - span.x0) / contentWidth)
  const meanWidth = average(widthFracs)
  const widthCv = coefficientOfVariation(widthFracs)
  if (meanWidth >= maxMeanWidthFrac || widthCv > maxWidthCv) {
    return { spans, collapsedPairs: 0 }
  }

  const collapsed = []
  let collapsedPairs = 0
  for (let index = 0; index < spans.length; index += 2) {
    if (index + 1 < spans.length) {
      collapsed.push({ x0: spans[index].x0, x1: spans[index + 1].x1 })
      collapsedPairs += 1
    } else {
      collapsed.push({ ...spans[index] })
    }
  }
  return { spans: collapsed, collapsedPairs }
}

const UNRELIABLE_BARLINE_REASONS = new Set([
  'density-thinned',
  'ambiguous-density',
  'barline-grid-too-dense',
  'too-many-barlines',
  'low-confidence-candidates',
])

function shouldCollapseOversampledGrid(reliability, spans) {
  if (!spans.length || reliability?.confident !== false) {
    return false
  }
  if (!UNRELIABLE_BARLINE_REASONS.has(reliability.reason)) {
    return false
  }
  return spans.length >= OVERSAMPLE_COLLAPSE_MIN_SPANS
}

function fallbackSpans(contentBounds, measureCount = MIN_MEASURES_IF_NO_BARLINES) {
  const x0Content = contentBounds.x0 ?? 0
  const x1Content = contentBounds.x1 ?? 1
  const step = (x1Content - x0Content) / measureCount
  const spans = []
  for (let index = 0; index < measureCount; index += 1) {
    spans.push({
      x0: x0Content + index * step,
      x1: x0Content + (index + 1) * step,
    })
  }
  return spans
}

function spansToMeasureBoxes(spans, {
  page,
  systemIndex,
  system,
  measureNumberStart,
}) {
  const staffLines = estimateGrandStaffLines(system)
  return spans.map((span, index) => ({
    page,
    systemIndex,
    measureIndex: index,
    measureNumber: measureNumberStart + index,
    x0: span.x0,
    x1: span.x1,
    playableX0:
      index === 0
        ? span.x0 + Math.min((span.x1 - span.x0) * 0.34, 0.085)
        : span.x0,
    y0: system.y0,
    y1: system.y1,
    staffLines,
  }))
}

function summarizeSpanWidths(spans, contentWidth) {
  return spans.map((span) =>
    Number((((span.x1 - span.x0) / contentWidth) * 100).toFixed(1)),
  )
}

function countSuspiciousSpans(spans, contentWidth, minFrac = MIN_MEASURE_SPAN_FRAC) {
  const minWidth = contentWidth * minFrac
  return spans.filter((span) => span.x1 - span.x0 < minWidth).length
}

/**
 * Build normalized measure rectangles from a detected grand-staff system.
 */
export function buildMeasureBoxesForSystemWithDiagnostics({
  page,
  systemIndex,
  system,
  contentBounds,
  imageData,
  measureNumberStart = 1,
  darkThreshold = 150,
  vectorNoteheadXNorms = [],
  noteColumnXNorms = null,
}) {
  const x0Content = contentBounds.x0 ?? contentBounds.left / imageData.width
  const x1Content = contentBounds.x1 ?? contentBounds.right / imageData.width
  const contentWidth = Math.max(1e-6, x1Content - x0Content)

  const { positions: rawBarlines, diagnostics: barlineDiagnostics } =
    detectSystemBarlinesWithDiagnostics(imageData, contentBounds, system, {
      darkThreshold,
    })
  const vectorFiltered = rejectVectorNoteColumns(
    rawBarlines,
    vectorNoteheadXNorms,
    imageData.width,
  )
  const columnHints = Array.isArray(noteColumnXNorms) && noteColumnXNorms.length
    ? noteColumnXNorms
    : vectorNoteheadXNorms
  const inPackFiltered = rejectBarlinesInsideNoteColumnPacks(
    vectorFiltered.barlines,
    columnHints,
  )
  const barlines = inPackFiltered.barlines.filter(
    (x) => x > x0Content + 0.02 && x < x1Content - 0.02,
  )
  const reliability = assessBarlineReliability(barlines, contentBounds, barlineDiagnostics)

  const boundaries = [x0Content, ...barlines.sort((left, right) => left - right), x1Content]
  let spans = boundariesToSpans(boundaries, contentWidth)
  const initialMeasureCount = spans.length

  const wideSpanRecovery = vectorFiltered.rejectedCount > 0
    ? splitWideMeasureSpans(spans)
    : { spans, splitCount: 0 }
  spans = wideSpanRecovery.spans

  const narrowMerge = mergeNarrowMeasureSpans(spans, contentWidth)
  spans = narrowMerge.spans

  let collapsedPairs = 0
  if (shouldCollapseOversampledGrid(reliability, spans)) {
    const collapsed = collapseUniformOversampledSpans(spans, contentWidth)
    spans = collapsed.spans
    collapsedPairs = collapsed.collapsedPairs
  }

  const narrowAfter = mergeNarrowMeasureSpans(spans, contentWidth)
  spans = narrowAfter.spans
  const trailingNarrow = mergeTrailingNarrowMeasureSpans(spans, contentWidth, {
    allowSingleTrailingMerge:
      reliability?.confident === false &&
      UNRELIABLE_BARLINE_REASONS.has(reliability.reason),
  })
  spans = trailingNarrow.spans

  let rebuiltFromNoteColumnGaps = 0
  if (
    reliability?.confident === false &&
    UNRELIABLE_BARLINE_REASONS.has(reliability.reason)
  ) {
    const rebuilt = rebuildSpansFromNoteColumnGaps(spans, columnHints, {
      x0: x0Content,
      x1: x1Content,
    })
    if (rebuilt.rebuilt) {
      spans = rebuilt.spans
      rebuiltFromNoteColumnGaps = rebuilt.measureCount
    }
  }
  const gapSnap = snapMeasureSpansToNoteColumnGaps(spans, columnHints)
  spans = gapSnap.spans

  if (spans.length === 0) {
    spans = fallbackSpans({ x0: x0Content, x1: x1Content })
  }

  const measureBoxes = spansToMeasureBoxes(spans, {
    page,
    systemIndex,
    system,
    measureNumberStart,
  })

  const spanWidthPercents = summarizeSpanWidths(spans, contentWidth)
  const suspiciousShortMeasures = countSuspiciousSpans(spans, contentWidth)

  const diagnostics = {
    page,
    systemIndex,
    barlineCount: barlines.length,
    barlineRejectedSummary: summarizeBarlineRejections(barlineDiagnostics?.rejected),
    barlineThinningRemoved: barlineDiagnostics?.thinningRemoved ?? 0,
    vectorNoteColumnRejected: vectorFiltered.rejectedCount,
    inPackBarlinesRejected: inPackFiltered.rejectedCount,
    vectorNoteColumnCandidates: vectorFiltered.candidateOffsets,
    barlineDensityAmbiguous: barlineDiagnostics?.densityAmbiguous === true,
    reliabilityReason: reliability.reason,
    reliabilityConfident: reliability.confident,
    measureWidthFrac: reliability.measureWidthFrac,
    initialMeasureCount,
    finalMeasureCount: measureBoxes.length,
    mergedNarrowSpans: narrowMerge.mergedCount + narrowAfter.mergedCount,
    recoveredMissingBarlines: wideSpanRecovery.splitCount,
    mergedTrailingSpans: trailingNarrow.mergedCount,
    snappedNoteColumnGaps: gapSnap.snappedCount,
    rebuiltFromNoteColumnGaps,
    collapsedPairs,
    suspiciousShortMeasures,
    spanWidthPercents,
  }

  return { measureBoxes, diagnostics }
}

/**
 * Build normalized measure rectangles from a detected grand-staff system.
 */
export function buildMeasureBoxesForSystem(options) {
  return buildMeasureBoxesForSystemWithDiagnostics(options).measureBoxes
}
