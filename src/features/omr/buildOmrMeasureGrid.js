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
}) {
  const x0Content = contentBounds.x0 ?? contentBounds.left / imageData.width
  const x1Content = contentBounds.x1 ?? contentBounds.right / imageData.width
  const contentWidth = Math.max(1e-6, x1Content - x0Content)

  const { positions: rawBarlines, diagnostics: barlineDiagnostics } =
    detectSystemBarlinesWithDiagnostics(imageData, contentBounds, system, {
      darkThreshold,
    })
  const barlines = rawBarlines.filter(
    (x) => x > x0Content + 0.02 && x < x1Content - 0.02,
  )
  const reliability = assessBarlineReliability(barlines, contentBounds, barlineDiagnostics)

  const boundaries = [x0Content, ...barlines.sort((left, right) => left - right), x1Content]
  let spans = boundariesToSpans(boundaries, contentWidth)
  const initialMeasureCount = spans.length

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
    barlineDensityAmbiguous: barlineDiagnostics?.densityAmbiguous === true,
    reliabilityReason: reliability.reason,
    reliabilityConfident: reliability.confident,
    measureWidthFrac: reliability.measureWidthFrac,
    initialMeasureCount,
    finalMeasureCount: measureBoxes.length,
    mergedNarrowSpans: narrowMerge.mergedCount + narrowAfter.mergedCount,
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
