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
  const barlines = vectorFiltered.barlines.filter(
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
