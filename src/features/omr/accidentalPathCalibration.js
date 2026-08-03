const ACCIDENTAL_TYPES = new Set(['sharp', 'flat', 'natural'])

const MIN_CONFIDENCE = 0.85
const MIN_NOTE_ANCHOR_CONFIDENCE = 0.8
const MIN_DISTINCT_PATHS = 8
const MIN_DISTINCT_NOTE_COLUMNS = 8
const MIN_MEASURES = 2
const MIN_DX_SPACES = 0.5
const MAX_DX_SPACES = 3.2
const MAX_VERTICAL_RESIDUAL_SPACES = 0.2
const MODE_RADIUS_SPACES = 0.18
const MIN_INLIER_FRACTION = 0.75
const MAX_RUNNER_UP_RATIO = 0.45
const MAX_INLIER_MAD_SPACES = 0.075
const MAX_INLIER_SPAN_SPACES = 0.22
const MAX_LEAVE_ONE_MEASURE_OUT_RESIDUAL_SPACES = 0.12
const TRUSTED_NOTE_ANCHOR_SOURCES = new Set([
  'ink-notehead-geometry',
  'ledger-masked-ink-notehead-geometry',
  'self-calibrated-glyph-fallback',
])

export const ACCIDENTAL_PATH_CALIBRATION_LIMITS = Object.freeze({
  minConfidence: MIN_CONFIDENCE,
  minNoteAnchorConfidence: MIN_NOTE_ANCHOR_CONFIDENCE,
  minDistinctPaths: MIN_DISTINCT_PATHS,
  minDistinctNoteColumns: MIN_DISTINCT_NOTE_COLUMNS,
  minMeasures: MIN_MEASURES,
  minDxSpaces: MIN_DX_SPACES,
  maxDxSpaces: MAX_DX_SPACES,
  maxVerticalResidualSpaces: MAX_VERTICAL_RESIDUAL_SPACES,
  modeRadiusSpaces: MODE_RADIUS_SPACES,
  minInlierFraction: MIN_INLIER_FRACTION,
  maxRunnerUpRatio: MAX_RUNNER_UP_RATIO,
  maxInlierMadSpaces: MAX_INLIER_MAD_SPACES,
  maxInlierSpanSpaces: MAX_INLIER_SPAN_SPACES,
  maxLeaveOneMeasureOutResidualSpaces:
    MAX_LEAVE_ONE_MEASURE_OUT_RESIDUAL_SPACES,
})

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

function accidentalType(value) {
  const candidate = typeof value === 'string'
    ? value
    : value?.type ?? value?.accidentalType
  return ACCIDENTAL_TYPES.has(candidate) ? candidate : null
}

/**
 * Models are page-local, but isolated by accidental type. The source prefix
 * prevents a future glyph/ink model from being mistaken for direct-path data.
 */
export function accidentalPathCalibrationKey(value) {
  const type = accidentalType(value)
  return type ? `vector-path\u001f${type}` : null
}

function directPathId(glyph) {
  if (glyph?.source !== 'vector-path') {
    return null
  }
  const pathId = glyph.pathCandidateId ?? glyph.candidateId
  if (
    typeof pathId !== 'string' ||
    !pathId ||
    /cluster/i.test(pathId) ||
    /cluster/i.test(glyph.reason ?? '')
  ) {
    return null
  }
  if (!/(?:^|-)op\d+$/i.test(pathId) && !Number.isInteger(glyph.operatorIndex)) {
    return null
  }
  return pathId
}

function trustedNoteAnchor(note, imageData, explicitAnchorY, explicitTrusted) {
  if (Number.isFinite(explicitAnchorY) && explicitTrusted === true) {
    return {
      y: Number(explicitAnchorY),
      source: 'explicit-trusted-anchor',
      confidence: 1,
    }
  }
  const anchor = note?.noteheadAnchor
  if (
    !TRUSTED_NOTE_ANCHOR_SOURCES.has(anchor?.source) ||
    Number(anchor?.confidence) < MIN_NOTE_ANCHOR_CONFIDENCE ||
    !Number.isFinite(note?.yNorm) ||
    !(imageData?.height > 0)
  ) {
    return null
  }
  return {
    y: note.yNorm * imageData.height,
    source: anchor.source,
    confidence: Number(anchor.confidence),
  }
}

function normalizedColumnId(noteX, staffGap, measureId, explicitColumnId) {
  if (explicitColumnId != null && `${explicitColumnId}`.length) {
    return `${explicitColumnId}`
  }
  // A twentieth of a staff space keeps separately engraved columns distinct
  // while remaining stable under uniform PDF/raster scaling.
  const quantizedColumn = Math.round((noteX / staffGap) * 20)
  return `${measureId}\u001f${quantizedColumn}`
}

/**
 * Create one truth-free calibration observation from an independently detected
 * direct PDF path and a vertically aligned notehead. Bbox separation and a
 * tight optical-Y residual make the pair safe enough to teach horizontal
 * ownership; ambiguous pairing should be omitted by the caller.
 */
export function createAccidentalPathCalibrationSample({
  glyph,
  note,
  type,
  staffGap,
  imageData = null,
  measureId = null,
  noteColumnId = null,
  noteAnchorY: explicitAnchorY = null,
  noteAnchorTrusted = false,
} = {}) {
  const resolvedType = accidentalType(type ?? glyph)
  const key = accidentalPathCalibrationKey(resolvedType)
  const pathId = directPathId(glyph)
  const gap = Number(staffGap)
  const noteX = Number(note?.cx)
  const glyphX = Number(glyph?.x)
  const glyphY = Number(glyph?.y)
  const anchor = trustedNoteAnchor(
    note,
    imageData,
    explicitAnchorY,
    noteAnchorTrusted,
  )
  const anchorY = anchor?.y
  const resolvedMeasureId = measureId ?? note?.measureNumber
  const boundsX1 = Number(glyph?.bounds?.x1)

  if (
    !key ||
    !pathId ||
    Number(glyph?.confidence) < MIN_CONFIDENCE ||
    !(gap > 0) ||
    !Number.isFinite(noteX) ||
    !Number.isFinite(glyphX) ||
    !Number.isFinite(glyphY) ||
    !Number.isFinite(anchorY) ||
    !Number.isFinite(boundsX1) ||
    !(boundsX1 < noteX) ||
    resolvedMeasureId == null
  ) {
    return null
  }

  const dxSpaces = (noteX - glyphX) / gap
  const verticalResidualSpaces = Math.abs(anchorY - glyphY) / gap
  if (
    dxSpaces < MIN_DX_SPACES ||
    dxSpaces > MAX_DX_SPACES ||
    verticalResidualSpaces > MAX_VERTICAL_RESIDUAL_SPACES
  ) {
    return null
  }

  return {
    key,
    type: resolvedType,
    source: 'vector-path',
    confidence: Number(glyph.confidence),
    noteAnchorSource: anchor.source,
    noteAnchorConfidence: anchor.confidence,
    pathId,
    noteColumnId: normalizedColumnId(
      noteX,
      gap,
      resolvedMeasureId,
      noteColumnId,
    ),
    measureId: `${resolvedMeasureId}`,
    dxSpaces,
    verticalResidualSpaces,
  }
}

function eligibleSample(sample) {
  return Boolean(
    sample?.key === accidentalPathCalibrationKey(sample?.type) &&
      sample?.source === 'vector-path' &&
      Number(sample?.confidence) >= MIN_CONFIDENCE &&
      typeof sample?.noteAnchorSource === 'string' &&
      sample.noteAnchorSource &&
      Number(sample?.noteAnchorConfidence) >= MIN_NOTE_ANCHOR_CONFIDENCE &&
      typeof sample?.pathId === 'string' &&
      sample.pathId &&
      !/cluster/i.test(sample.pathId) &&
      sample?.noteColumnId != null &&
      sample?.measureId != null &&
      Number.isFinite(sample?.dxSpaces) &&
      sample.dxSpaces >= MIN_DX_SPACES &&
      sample.dxSpaces <= MAX_DX_SPACES &&
      Number.isFinite(sample?.verticalResidualSpaces) &&
      sample.verticalResidualSpaces >= 0 &&
      sample.verticalResidualSpaces <= MAX_VERTICAL_RESIDUAL_SPACES,
  )
}

function closestSamplePerPath(samples, center, radius = MODE_RADIUS_SPACES) {
  const byPath = new Map()
  for (const sample of samples) {
    const distance = Math.abs(sample.dxSpaces - center)
    if (distance > radius) {
      continue
    }
    const existing = byPath.get(sample.pathId)
    if (
      !existing ||
      distance < existing.distance ||
      (distance === existing.distance &&
        sample.verticalResidualSpaces < existing.sample.verticalResidualSpaces)
    ) {
      byPath.set(sample.pathId, { sample, distance })
    }
  }
  return [...byPath.values()].map((entry) => entry.sample)
}

function modeWindow(samples) {
  let winner = null
  for (const candidate of samples) {
    let inliers = closestSamplePerPath(samples, candidate.dxSpaces)
    let center = median(inliers.map((sample) => sample.dxSpaces))
    inliers = closestSamplePerPath(samples, center)
    center = median(inliers.map((sample) => sample.dxSpaces))
    const mad = medianAbsoluteDeviation(
      inliers.map((sample) => sample.dxSpaces),
      center,
    )
    const verticalResidual = inliers.reduce(
      (sum, sample) => sum + sample.verticalResidualSpaces,
      0,
    )
    if (
      !winner ||
      inliers.length > winner.inliers.length ||
      (inliers.length === winner.inliers.length && mad < winner.mad) ||
      (inliers.length === winner.inliers.length &&
        mad === winner.mad &&
        verticalResidual < winner.verticalResidual)
    ) {
      winner = { center, mad, inliers, verticalResidual }
    }
  }
  if (!winner) {
    return null
  }

  // Recenter once so the result does not depend on which observation seeded
  // the winning window.
  const inliers = closestSamplePerPath(samples, winner.center)
  const center = median(inliers.map((sample) => sample.dxSpaces))
  const finalInliers = closestSamplePerPath(samples, center)
  const selectedSamples = new Set(finalInliers)
  const excluded = samples.filter((sample) => !selectedSamples.has(sample))
  let runnerUpCount = 0
  for (const candidate of excluded) {
    const count = closestSamplePerPath(excluded, candidate.dxSpaces).length
    runnerUpCount = Math.max(runnerUpCount, count)
  }

  return {
    center: median(finalInliers.map((sample) => sample.dxSpaces)),
    inliers: finalInliers,
    runnerUpCount,
  }
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
 * Build conservative page-local models. The estimator needs repeated evidence
 * across both note columns and measures, rejects a competing second mode, then
 * validates that no single measure materially determines the result.
 */
export function buildAccidentalPathCalibrations(samples = []) {
  const groups = new Map()
  let eligibleSampleCount = 0
  for (const sample of samples) {
    if (!eligibleSample(sample)) {
      continue
    }
    eligibleSampleCount += 1
    const group = groups.get(sample.key) ?? []
    group.push(sample)
    groups.set(sample.key, group)
  }

  const models = new Map()
  const accepted = []
  const rejected = []

  for (const [key, rawGroup] of groups) {
    const group = rawGroup
    const distinctPathCount = new Set(group.map((sample) => sample.pathId)).size
    const distinctNoteColumnCount = new Set(
      group.map((sample) => sample.noteColumnId),
    ).size
    if (
      distinctPathCount < MIN_DISTINCT_PATHS ||
      distinctNoteColumnCount < MIN_DISTINCT_NOTE_COLUMNS
    ) {
      rejectModel(rejected, key, group, 'insufficient-distinct-evidence', {
        rawSampleCount: rawGroup.length,
        distinctPathCount,
        distinctNoteColumnCount,
      })
      continue
    }

    const measureCount = new Set(group.map((sample) => sample.measureId)).size
    if (measureCount < MIN_MEASURES) {
      rejectModel(rejected, key, group, 'insufficient-measure-support', {
        distinctPathCount,
        distinctNoteColumnCount,
        measureCount,
      })
      continue
    }

    const mode = modeWindow(group)
    const inlierFraction = mode.inliers.length / distinctPathCount
    const runnerUpRatio = mode.runnerUpCount / mode.inliers.length
    if (runnerUpRatio > MAX_RUNNER_UP_RATIO) {
      rejectModel(rejected, key, group, 'competing-horizontal-modes', {
        inlierCount: mode.inliers.length,
        inlierFraction: rounded(inlierFraction),
        runnerUpCount: mode.runnerUpCount,
        runnerUpRatio: rounded(runnerUpRatio),
      })
      continue
    }
    if (inlierFraction < MIN_INLIER_FRACTION) {
      rejectModel(rejected, key, group, 'insufficient-dominant-mode', {
        inlierCount: mode.inliers.length,
        inlierFraction: rounded(inlierFraction),
        runnerUpCount: mode.runnerUpCount,
      })
      continue
    }

    const inliers = mode.inliers
    const distinctInlierPathCount = new Set(
      inliers.map((sample) => sample.pathId),
    ).size
    const distinctInlierColumnCount = new Set(
      inliers.map((sample) => sample.noteColumnId),
    ).size
    const inlierMeasures = [...new Set(
      inliers.map((sample) => sample.measureId),
    )]
    if (
      distinctInlierPathCount < MIN_DISTINCT_PATHS ||
      distinctInlierColumnCount < MIN_DISTINCT_NOTE_COLUMNS
    ) {
      rejectModel(rejected, key, group, 'insufficient-distinct-inliers', {
        inlierCount: inliers.length,
        distinctInlierPathCount,
        distinctInlierColumnCount,
      })
      continue
    }
    if (inlierMeasures.length < MIN_MEASURES) {
      rejectModel(rejected, key, group, 'insufficient-inlier-measure-support', {
        inlierCount: inliers.length,
        measureCount: inlierMeasures.length,
      })
      continue
    }

    const inlierValues = inliers.map((sample) => sample.dxSpaces)
    const preferredDxSpaces = median(inlierValues)
    const madSpaces = medianAbsoluteDeviation(inlierValues, preferredDxSpaces)
    const spanSpaces = Math.max(...inlierValues) - Math.min(...inlierValues)
    if (
      madSpaces > MAX_INLIER_MAD_SPACES ||
      spanSpaces > MAX_INLIER_SPAN_SPACES
    ) {
      rejectModel(rejected, key, group, 'excessive-inlier-dispersion', {
        preferredDxSpaces: rounded(preferredDxSpaces),
        madSpaces: rounded(madSpaces),
        spanSpaces: rounded(spanSpaces),
      })
      continue
    }

    const leaveOneMeasureOut = inlierMeasures.map((heldOutMeasure) => {
      const heldOutValues = inliers
        .filter((sample) => sample.measureId === heldOutMeasure)
        .map((sample) => sample.dxSpaces)
      const trainingValues = inliers
        .filter((sample) => sample.measureId !== heldOutMeasure)
        .map((sample) => sample.dxSpaces)
      const heldOutCenter = median(heldOutValues)
      const trainingCenter = median(trainingValues)
      return {
        measureId: heldOutMeasure,
        heldOutCount: heldOutValues.length,
        trainingCount: trainingValues.length,
        heldOutCenter,
        trainingCenter,
        residualSpaces: Math.abs(heldOutCenter - trainingCenter),
      }
    })
    const maxLeaveOneMeasureOutResidual = Math.max(
      ...leaveOneMeasureOut.map((entry) => entry.residualSpaces),
    )
    if (
      maxLeaveOneMeasureOutResidual >
      MAX_LEAVE_ONE_MEASURE_OUT_RESIDUAL_SPACES
    ) {
      rejectModel(
        rejected,
        key,
        group,
        'leave-one-measure-out-instability',
        {
          maxLeaveOneMeasureOutResidual: rounded(
            maxLeaveOneMeasureOutResidual,
          ),
          leaveOneMeasureOut: leaveOneMeasureOut.map((entry) => ({
            ...entry,
            heldOutCenter: rounded(entry.heldOutCenter),
            trainingCenter: rounded(entry.trainingCenter),
            residualSpaces: rounded(entry.residualSpaces),
          })),
        },
      )
      continue
    }

    const sampleStrength = Math.min(0.08, (inliers.length - 8) * 0.008)
    const consistencyStrength = Math.max(
      0,
      0.08 * (1 - madSpaces / MAX_INLIER_MAD_SPACES),
    )
    const confidence = Math.min(0.94, 0.78 + sampleStrength + consistencyStrength)
    const type = inliers[0].type
    const model = {
      key,
      source: 'vector-path',
      type,
      preferredDxSpaces,
      sampleCount: distinctPathCount,
      rawSampleCount: rawGroup.length,
      inlierCount: inliers.length,
      inlierFraction,
      distinctPathCount,
      distinctNoteColumnCount,
      distinctInlierPathCount,
      distinctInlierColumnCount,
      measureCount: inlierMeasures.length,
      madSpaces,
      spanSpaces,
      runnerUpCount: mode.runnerUpCount,
      runnerUpRatio,
      maxLeaveOneMeasureOutResidual,
      leaveOneMeasureOut,
      confidence,
    }
    models.set(key, model)
    accepted.push({
      ...model,
      preferredDxSpaces: rounded(preferredDxSpaces),
      inlierFraction: rounded(inlierFraction),
      madSpaces: rounded(madSpaces),
      spanSpaces: rounded(spanSpaces),
      runnerUpRatio: rounded(runnerUpRatio),
      maxLeaveOneMeasureOutResidual: rounded(
        maxLeaveOneMeasureOutResidual,
      ),
      confidence: rounded(confidence),
      leaveOneMeasureOut: leaveOneMeasureOut.map((entry) => ({
        ...entry,
        heldOutCenter: rounded(entry.heldOutCenter),
        trainingCenter: rounded(entry.trainingCenter),
        residualSpaces: rounded(entry.residualSpaces),
      })),
    })
  }

  return {
    models,
    eligibleSampleCount,
    accepted,
    rejected,
  }
}

export function lookupAccidentalPathCalibration(calibration, value) {
  const key = accidentalPathCalibrationKey(value)
  if (!key || !calibration?.models?.get) {
    return null
  }
  return calibration.models.get(key) ?? null
}

/**
 * Return the calibrated horizontal residual without altering legacy scoring.
 * A caller can use residualPixels in place of raw dx only when this returns a
 * model; unknown types/pages therefore retain their previous behavior.
 */
export function accidentalPathHorizontalResidual({
  noteX,
  glyphX,
  staffGap,
  type,
  calibration,
} = {}) {
  const model = lookupAccidentalPathCalibration(calibration, type)
  const gap = Number(staffGap)
  const dx = Number(noteX) - Number(glyphX)
  if (!model || !(gap > 0) || !Number.isFinite(dx) || dx <= 0) {
    return null
  }
  const dxSpaces = dx / gap
  const residualSpaces = Math.abs(dxSpaces - model.preferredDxSpaces)
  return {
    model,
    dxSpaces,
    preferredDxSpaces: model.preferredDxSpaces,
    residualSpaces,
    residualPixels: residualSpaces * gap,
  }
}
