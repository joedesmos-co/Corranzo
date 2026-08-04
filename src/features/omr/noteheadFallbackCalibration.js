import { staffLineGap } from './pitchFromStaffPosition.js'

const TRUSTED_ANCHOR_SOURCES = new Set([
  'ink-notehead-geometry',
  'ledger-masked-ink-notehead-geometry',
])
const CALIBRATABLE_REJECTION_REASONS = new Set([
  'no-head-sized-component',
  'component-outside-font-origin-range',
  'ambiguous-components',
])

const MIN_SAMPLES = 6
const MIN_INLIER_FRACTION = 0.8
const MIN_ORIGIN_OFFSET_SPACES = 0.35
const MAX_ORIGIN_OFFSET_SPACES = 0.7
const MAX_INLIER_MAD_SPACES = 0.03
const MAX_INLIER_SPAN_SPACES = 0.12

function median(values) {
  if (!values.length) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function medianAbsoluteDeviation(values, center = median(values)) {
  if (!values.length || !Number.isFinite(center)) {
    return null
  }
  return median(values.map((value) => Math.abs(value - center)))
}

function rounded(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return null
  }
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

export function noteheadFallbackCalibrationKey(glyph) {
  if (
    !glyph ||
    glyph.legacyMusicFontNormalized ||
    typeof glyph.fontName !== 'string' ||
    !glyph.fontName.trim() ||
    typeof glyph.text !== 'string' ||
    !glyph.text
  ) {
    return null
  }
  return `${glyph.fontName.trim()}\u001f${glyph.text}`
}

export function createNoteheadFallbackCalibrationSample({
  glyph,
  anchor,
  imageData,
}) {
  const key = noteheadFallbackCalibrationKey(glyph)
  const gapNorm = Number(anchor?.localStaffGapNorm)
  const rawYNorm = Number(anchor?.rawYNorm)
  const yNorm = Number(anchor?.yNorm)
  const heightNorm = imageData?.height
    ? Number(glyph?.height) / imageData.height
    : null
  if (
    !key ||
    !TRUSTED_ANCHOR_SOURCES.has(anchor?.source) ||
    Number(anchor?.confidence) < 0.9 ||
    !(gapNorm > 0) ||
    !Number.isFinite(rawYNorm) ||
    !Number.isFinite(yNorm) ||
    !(heightNorm > 0)
  ) {
    return null
  }
  return {
    key,
    glyph,
    source: anchor.source,
    confidence: anchor.confidence,
    originToCenterSpaces: (rawYNorm - yNorm) / gapNorm,
    glyphHeightSpaces: heightNorm / gapNorm,
  }
}

function eligibleSample(sample) {
  const key = sample?.key ?? noteheadFallbackCalibrationKey(sample?.glyph)
  return Boolean(
    key &&
      TRUSTED_ANCHOR_SOURCES.has(sample?.source) &&
      Number(sample?.confidence) >= 0.9 &&
      Number.isFinite(sample?.originToCenterSpaces) &&
      Number.isFinite(sample?.glyphHeightSpaces) &&
      sample.glyphHeightSpaces > 0,
  )
}

function rejectModel(rejected, key, samples, reason, extra = {}) {
  rejected.push({
    key,
    sampleCount: samples.length,
    reason,
    ...extra,
  })
}

/**
 * Build page-local font/glyph fallback models from trusted ink only. The
 * estimator is deliberately robust: isolated wrong-body anchors are trimmed,
 * while sparse or internally inconsistent groups remain uncalibrated.
 */
export function buildNoteheadFallbackCalibrations(samples = []) {
  const groups = new Map()
  let eligibleSampleCount = 0
  for (const sample of samples) {
    if (!eligibleSample(sample)) {
      continue
    }
    eligibleSampleCount += 1
    const key = sample.key ?? noteheadFallbackCalibrationKey(sample.glyph)
    const group = groups.get(key) ?? []
    group.push(sample)
    groups.set(key, group)
  }

  const models = new Map()
  const accepted = []
  const rejected = []

  for (const [key, group] of groups) {
    if (group.length < MIN_SAMPLES) {
      rejectModel(rejected, key, group, 'insufficient-samples')
      continue
    }

    const offsets = group.map((sample) => sample.originToCenterSpaces)
    const initialMedian = median(offsets)
    const initialMad = medianAbsoluteDeviation(offsets, initialMedian)
    const inlierTolerance = Math.min(
      0.08,
      Math.max(0.035, Number(initialMad) * 4),
    )
    const inliers = group.filter(
      (sample) =>
        Math.abs(sample.originToCenterSpaces - initialMedian) <= inlierTolerance,
    )
    const inlierFraction = inliers.length / group.length
    if (
      inliers.length < MIN_SAMPLES ||
      inlierFraction < MIN_INLIER_FRACTION
    ) {
      rejectModel(rejected, key, group, 'insufficient-consistent-inliers', {
        inlierCount: inliers.length,
        inlierFraction: rounded(inlierFraction),
      })
      continue
    }

    const inlierOffsets = inliers.map(
      (sample) => sample.originToCenterSpaces,
    )
    const originToCenterSpaces = median(inlierOffsets)
    const madSpaces = medianAbsoluteDeviation(
      inlierOffsets,
      originToCenterSpaces,
    )
    const minOffset = Math.min(...inlierOffsets)
    const maxOffset = Math.max(...inlierOffsets)
    const spanSpaces = maxOffset - minOffset
    if (
      originToCenterSpaces < MIN_ORIGIN_OFFSET_SPACES ||
      originToCenterSpaces > MAX_ORIGIN_OFFSET_SPACES
    ) {
      rejectModel(rejected, key, group, 'implausible-optical-offset', {
        originToCenterSpaces: rounded(originToCenterSpaces),
      })
      continue
    }
    if (
      madSpaces > MAX_INLIER_MAD_SPACES ||
      spanSpaces > MAX_INLIER_SPAN_SPACES
    ) {
      rejectModel(rejected, key, group, 'excessive-dispersion', {
        madSpaces: rounded(madSpaces),
        spanSpaces: rounded(spanSpaces),
      })
      continue
    }

    const leaveOneOutResiduals = inliers.map((sample, index) => {
      const heldOutMedian = median(
        inlierOffsets.filter((_, candidateIndex) => candidateIndex !== index),
      )
      return Math.abs(sample.originToCenterSpaces - heldOutMedian)
    })
    const maxLeaveOneOutResidual = Math.max(...leaveOneOutResiduals)
    if (maxLeaveOneOutResidual > 0.08) {
      rejectModel(rejected, key, group, 'held-out-instability', {
        maxLeaveOneOutResidual: rounded(maxLeaveOneOutResidual),
      })
      continue
    }

    const heightRatios = inliers.map((sample) => sample.glyphHeightSpaces)
    const glyphHeightSpaces = median(heightRatios)
    const glyphHeightMad = medianAbsoluteDeviation(
      heightRatios,
      glyphHeightSpaces,
    )
    const sampleStrength = Math.min(0.08, (inliers.length - MIN_SAMPLES) * 0.01)
    const consistencyStrength = Math.max(
      0,
      0.08 * (1 - madSpaces / MAX_INLIER_MAD_SPACES),
    )
    const confidence = Math.min(
      0.92,
      0.72 + sampleStrength + consistencyStrength,
    )
    const model = {
      key,
      fontName: inliers[0].glyph.fontName,
      glyph: inliers[0].glyph.text,
      originToCenterSpaces,
      sampleCount: group.length,
      inlierCount: inliers.length,
      inlierFraction,
      madSpaces,
      spanSpaces,
      maxLeaveOneOutResidual,
      glyphHeightSpaces,
      glyphHeightMad,
      minGlyphHeightSpaces: Math.min(...heightRatios),
      maxGlyphHeightSpaces: Math.max(...heightRatios),
      confidence,
      sources: [...new Set(inliers.map((sample) => sample.source))].sort(),
    }
    models.set(key, model)
    accepted.push({
      ...model,
      originToCenterSpaces: rounded(model.originToCenterSpaces),
      inlierFraction: rounded(model.inlierFraction),
      madSpaces: rounded(model.madSpaces),
      spanSpaces: rounded(model.spanSpaces),
      maxLeaveOneOutResidual: rounded(model.maxLeaveOneOutResidual),
      glyphHeightSpaces: rounded(model.glyphHeightSpaces),
      glyphHeightMad: rounded(model.glyphHeightMad),
      confidence: rounded(model.confidence),
    })
  }

  return {
    models,
    eligibleSampleCount,
    accepted,
    rejected,
  }
}

/**
 * Replace only the two well-understood rejected ink fallbacks. Unknown fonts,
 * ambiguous components, legacy normalization, unstable sizes, and negligible
 * corrections keep the established metric anchor.
 */
export function applyNoteheadFallbackCalibration({
  anchor,
  glyph,
  imageData,
  lineYs,
  calibration,
}) {
  if (
    !anchor ||
    anchor.source !== 'glyph-metrics-fallback' ||
    !CALIBRATABLE_REJECTION_REASONS.has(anchor.rejectedReason)
  ) {
    return anchor
  }
  const key = noteheadFallbackCalibrationKey(glyph)
  const model = key ? calibration?.models?.get(key) : null
  if (!model || !imageData?.height) {
    return anchor
  }
  const gapNorm =
    Number(anchor.localStaffGapNorm) || staffLineGap(lineYs ?? [])
  const rawYNorm = Number(anchor.rawYNorm)
  const glyphHeightNorm = Number(glyph?.height) / imageData.height
  if (!(gapNorm > 0) || !Number.isFinite(rawYNorm) || !(glyphHeightNorm > 0)) {
    return anchor
  }

  const glyphHeightSpaces = glyphHeightNorm / gapNorm
  const heightTolerance = Math.max(0.18, Number(model.glyphHeightMad) * 4)
  if (
    glyphHeightSpaces < model.minGlyphHeightSpaces - heightTolerance ||
    glyphHeightSpaces > model.maxGlyphHeightSpaces + heightTolerance
  ) {
    return anchor
  }

  const yNorm = rawYNorm - model.originToCenterSpaces * gapNorm
  const correctionSpaces =
    Math.abs(Number(anchor.fallbackYNorm) - yNorm) / gapNorm
  const minCorrectionSpaces =
    anchor.rejectedReason === 'ambiguous-components' ? 0 : 0.06
  if (
    !Number.isFinite(yNorm) ||
    yNorm < 0 ||
    yNorm > 1 ||
    correctionSpaces < minCorrectionSpaces ||
    correctionSpaces > 0.45
  ) {
    return anchor
  }

  return {
    ...anchor,
    yNorm,
    source: 'self-calibrated-glyph-fallback',
    confidence: model.confidence,
    inkRejectedReason: anchor.rejectedReason,
    rejectedReason: null,
    calibration: {
      scope: 'page-font-glyph',
      fontName: model.fontName,
      glyph: model.glyph,
      originToCenterSpaces: rounded(model.originToCenterSpaces),
      sampleCount: model.sampleCount,
      inlierCount: model.inlierCount,
      inlierFraction: rounded(model.inlierFraction),
      madSpaces: rounded(model.madSpaces),
      maxLeaveOneOutResidual: rounded(model.maxLeaveOneOutResidual),
      glyphHeightSpaces: rounded(glyphHeightSpaces),
      correctionSpaces: rounded(correctionSpaces),
      confidence: rounded(model.confidence),
      sources: model.sources,
    },
  }
}
