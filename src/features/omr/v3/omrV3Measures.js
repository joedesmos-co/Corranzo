/** Shared staff-group measure geometry for the OMR V3 shadow IR. */

import {
  createOmrDocumentIR,
  createOmrMeasureColumnIR,
  createOmrSystemIR,
  createOmrV3Diagnostic,
  createOmrV3Id,
  OMR_V3_DIAGNOSTIC_SEVERITY,
} from './omrV3Ir.js'

const DEFAULT_X_TOLERANCE = 0.008
const MAX_STEM_LIKELIHOOD = 0.55
const SINGLE_STAFF_MIN_CONFIDENCE = 0.58
const PARTIAL_MULTI_STAFF_MIN_CONFIDENCE = 0.82
const WIDE_SPAN_MIN_RATIO = 1.65
const WIDE_SPAN_MAX_PARTS = 3
const TRAILING_SHORT_RATIO = 0.58

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function average(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right)
  return finite.length ? finite[Math.floor(finite.length / 2)] : 0
}

function flattenStaves(system) {
  return (system?.staffGroups ?? []).flatMap((group) => group.staves ?? [])
}

function clusterBarlineEvidence(staves, tolerance) {
  const entries = staves
    .flatMap((staff) =>
      (staff.barlineEvidence ?? []).map((barline) => ({
        ...barline,
        staffId: staff.staffId,
      })),
    )
    .filter((entry) => Number.isFinite(entry.x))
    .sort((left, right) => left.x - right.x)
  const clusters = []
  for (const entry of entries) {
    const last = clusters[clusters.length - 1]
    if (last && Math.abs(entry.x - last.x) <= tolerance) {
      last.entries.push(entry)
      const weights = last.entries.map((candidate) => Math.max(0.05, candidate.confidence ?? 0.5))
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
      last.x =
        last.entries.reduce((sum, candidate, index) => sum + candidate.x * weights[index], 0) /
        totalWeight
    } else {
      clusters.push({ x: entry.x, entries: [entry] })
    }
  }
  return clusters
}

function clusterAssessment(cluster, staves) {
  const staffIds = [...new Set(cluster.entries.map((entry) => entry.staffId))]
  const supportRatio = staffIds.length / Math.max(1, staves.length)
  const confidence = average(cluster.entries.map((entry) => entry.confidence ?? 0.5))
  const stemLikelihood = Math.max(...cluster.entries.map((entry) => entry.stemLikelihood ?? 0), 0)
  const explicitlyStem = cluster.entries.some((entry) => entry.kind === 'stem')
  const strongBarlineEvidence = cluster.entries.some(
    (entry) =>
      entry.kind === 'barline' ||
      entry.vectorEvidence ||
      (entry.verticalSpanRatio ?? 0) >= 0.78,
  )

  let accepted = false
  let reason
  if (staves.length === 1) {
    accepted =
      !explicitlyStem &&
      stemLikelihood < MAX_STEM_LIKELIHOOD &&
      confidence >= SINGLE_STAFF_MIN_CONFIDENCE
    reason = accepted ? 'single-staff-barline' : explicitlyStem ? 'stem-candidate' : 'weak-single-staff-evidence'
  } else if (supportRatio >= 0.75) {
    accepted = !explicitlyStem || supportRatio === 1
    reason = accepted ? 'cross-staff-consensus' : 'stem-candidate'
  } else if (supportRatio >= 0.5) {
    accepted =
      !explicitlyStem &&
      stemLikelihood < MAX_STEM_LIKELIHOOD &&
      confidence >= PARTIAL_MULTI_STAFF_MIN_CONFIDENCE &&
      strongBarlineEvidence
    reason = accepted ? 'high-confidence-partial-consensus' : 'insufficient-cross-staff-support'
  } else {
    reason = 'insufficient-cross-staff-support'
  }

  return {
    x: cluster.x,
    accepted,
    reason,
    confidence: clamp(confidence * (0.65 + supportRatio * 0.35)),
    supportRatio,
    participatingStaffIds: staffIds,
    entries: cluster.entries,
  }
}

function systemEdges(system) {
  const xStart = system?.boundingBox?.x ?? 0
  const xEnd = xStart + (system?.boundingBox?.width ?? 1)
  return { xStart, xEnd }
}

function dedupeBoundaries(boundaries, tolerance) {
  const sorted = [...boundaries].sort((left, right) => left.x - right.x)
  const result = []
  for (const boundary of sorted) {
    const last = result[result.length - 1]
    if (last && Math.abs(boundary.x - last.x) <= tolerance) {
      if ((boundary.confidence ?? 0) > (last.confidence ?? 0)) {
        result[result.length - 1] = boundary
      }
    } else {
      result.push(boundary)
    }
  }
  return result
}

function observedMeasureWidths(boundaries) {
  return boundaries
    .slice(1)
    .map((boundary, index) => boundary.x - boundaries[index].x)
    .filter((width) => width > 0)
}

function resolveExpectedWidth(boundaries, neighboringMeasureWidths, expectedMeasureWidth) {
  if (Number.isFinite(expectedMeasureWidth) && expectedMeasureWidth > 0) {
    return expectedMeasureWidth
  }
  const neighboring = (neighboringMeasureWidths ?? []).filter(
    (width) => Number.isFinite(width) && width > 0,
  )
  const widths = observedMeasureWidths(boundaries)
  // Exclude the widest span while estimating; it may be the exact missing-
  // barline span we need to recover.
  if (widths.length >= 4) {
    const sorted = [...widths].sort((left, right) => left - right)
    widths.splice(0, widths.length, ...sorted.slice(0, -1))
  }
  return median([...neighboring, ...widths])
}

function recoverMissingBoundaries(
  boundaries,
  expectedWidth,
  evidenceCount,
  hasExternalWidthEvidence,
) {
  const enoughEvidence = evidenceCount >= 3 || (hasExternalWidthEvidence && evidenceCount >= 2)
  if (!Number.isFinite(expectedWidth) || expectedWidth <= 0 || !enoughEvidence) {
    return { boundaries, inferred: [] }
  }
  const inferred = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const left = boundaries[index]
    const right = boundaries[index + 1]
    const width = right.x - left.x
    const ratio = width / expectedWidth
    const parts = Math.round(ratio)
    if (
      ratio < WIDE_SPAN_MIN_RATIO ||
      parts < 2 ||
      parts > WIDE_SPAN_MAX_PARTS ||
      Math.abs(ratio - parts) > 0.28
    ) {
      continue
    }
    const partWidth = width / parts
    for (let part = 1; part < parts; part += 1) {
      inferred.push({
        x: left.x + part * partWidth,
        confidence: 0.48,
        kind: 'inferred-missing-barline',
        reason: 'neighbor-width-consistency',
        supportRatio: 0,
        participatingStaffIds: [],
        entries: [],
      })
    }
  }
  return {
    boundaries: dedupeBoundaries([...boundaries, ...inferred], DEFAULT_X_TOLERANCE / 2),
    inferred,
  }
}

function spansFromBoundaries(boundaries) {
  return boundaries.slice(1).map((right, index) => ({
    xStart: boundaries[index].x,
    xEnd: right.x,
    leftBoundary: boundaries[index],
    rightBoundary: right,
  }))
}

function trimInventedTrailingSpan(spans, symbolXs, expectedWidth) {
  if (spans.length < 2 || !(symbolXs?.length > 0)) {
    return { spans, trimmed: null }
  }
  const last = spans[spans.length - 1]
  const width = last.xEnd - last.xStart
  const hasSymbol = symbolXs.some((x) => Number.isFinite(x) && x >= last.xStart && x < last.xEnd)
  const lastObservedBoundary = last.leftBoundary.kind !== 'system-boundary'
  const syntheticRight = last.rightBoundary.kind === 'system-boundary'
  const shortAgainstExpected =
    Number.isFinite(expectedWidth) && expectedWidth > 0
      ? width < expectedWidth * TRAILING_SHORT_RATIO
      : width < median(spans.slice(0, -1).map((span) => span.xEnd - span.xStart)) * TRAILING_SHORT_RATIO
  const finiteSymbolXs = symbolXs.filter(Number.isFinite)
  if (finiteSymbolXs.length === 0) {
    return { spans, trimmed: null }
  }
  const contentEndsBeforeSpan = Math.max(...finiteSymbolXs) <= last.xStart

  if (!hasSymbol && lastObservedBoundary && syntheticRight && (shortAgainstExpected || contentEndsBeforeSpan)) {
    return { spans: spans.slice(0, -1), trimmed: last }
  }
  return { spans, trimmed: null }
}

function barlineEvidenceForSpan(span) {
  return [span.leftBoundary, span.rightBoundary].map((boundary, index) => ({
    side: index === 0 ? 'left' : 'right',
    x: boundary.x,
    kind: boundary.kind,
    confidence: boundary.confidence,
    supportRatio: boundary.supportRatio,
    participatingStaffIds: boundary.participatingStaffIds ?? [],
    evidenceIds: (boundary.entries ?? []).map((entry) => entry.evidenceId),
  }))
}

function withMeasureMembership(staffGroups, measureIds) {
  return (staffGroups ?? []).map((group) => ({
    ...group,
    staves: (group.staves ?? []).map((staff) => ({
      ...staff,
      measureMembership: [...measureIds],
    })),
  }))
}

/**
 * Reconcile per-staff evidence into one shared measure-column list. This is a
 * pure transformation and never emits notes or alters the production grid.
 */
export function buildOmrV3MeasureColumnsForSystem(
  system,
  {
    measureNumberStart = 1,
    xTolerance = DEFAULT_X_TOLERANCE,
    neighboringMeasureWidths = [],
    expectedMeasureWidth = null,
    symbolXs = [],
  } = {},
) {
  const staves = flattenStaves(system)
  const { xStart, xEnd } = systemEdges(system)
  const clusters = clusterBarlineEvidence(staves, xTolerance)
  const assessments = clusters.map((cluster) => clusterAssessment(cluster, staves))
  const accepted = assessments.filter(
    (assessment) =>
      assessment.accepted &&
      assessment.x > xStart + xTolerance &&
      assessment.x < xEnd - xTolerance,
  )
  const rejected = assessments.filter((assessment) => !assessment.accepted)
  let boundaries = dedupeBoundaries(
    [
      {
        x: xStart,
        kind: 'system-boundary',
        confidence: 0.75,
        supportRatio: 1,
        participatingStaffIds: staves.map((staff) => staff.staffId),
        entries: [],
      },
      ...accepted.map((assessment) => ({ ...assessment, kind: 'observed-barline' })),
      {
        x: xEnd,
        kind: 'system-boundary',
        confidence: 0.75,
        supportRatio: 1,
        participatingStaffIds: staves.map((staff) => staff.staffId),
        entries: [],
      },
    ],
    xTolerance,
  )
  const expectedWidth = resolveExpectedWidth(boundaries, neighboringMeasureWidths, expectedMeasureWidth)
  const hasExternalWidthEvidence =
    (Number.isFinite(expectedMeasureWidth) && expectedMeasureWidth > 0) ||
    neighboringMeasureWidths.some((width) => Number.isFinite(width) && width > 0)
  const recovered = recoverMissingBoundaries(
    boundaries,
    expectedWidth,
    accepted.length,
    hasExternalWidthEvidence,
  )
  boundaries = recovered.boundaries
  const trailing = trimInventedTrailingSpan(spansFromBoundaries(boundaries), symbolXs, expectedWidth)
  const spans = trailing.spans

  const measureColumns = spans.map((span, index) => {
    const measureNumber = measureNumberStart + index
    const measureId = createOmrV3Id('measure', system.systemId, measureNumber)
    const confidence = average([
      span.leftBoundary.confidence ?? 0.5,
      span.rightBoundary.confidence ?? 0.5,
    ])
    return createOmrMeasureColumnIR({
      measureId,
      systemId: system.systemId,
      measureNumber,
      xStart: span.xStart,
      xEnd: span.xEnd,
      boundingBox: {
        x: span.xStart,
        y: system.boundingBox.y,
        width: span.xEnd - span.xStart,
        height: system.boundingBox.height,
        space: 'normalized',
      },
      barlineEvidence: barlineEvidenceForSpan(span),
      expectedStaffParticipation: staves.map((staff) => staff.staffId),
      confidence: {
        overall: confidence,
        stages: { 'measure-column-reconciliation': confidence },
        evidence: [
          { kind: 'left-boundary', value: span.leftBoundary.kind },
          { kind: 'right-boundary', value: span.rightBoundary.kind },
        ],
      },
      diagnostics:
        span.leftBoundary.kind === 'inferred-missing-barline' ||
        span.rightBoundary.kind === 'inferred-missing-barline'
          ? [
              createOmrV3Diagnostic({
                code: 'measure-boundary-inferred',
                severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
                stage: 'measure-column-reconciliation',
                message: 'A missing/faint barline was inferred from neighboring measure widths.',
              }),
            ]
          : [],
    })
  })
  const measureIds = measureColumns.map((measure) => measure.measureId)
  const diagnostics = [
    ...rejected.map((assessment) =>
      createOmrV3Diagnostic({
        code: 'barline-candidate-rejected',
        stage: 'measure-column-reconciliation',
        message: `Rejected boundary at x=${assessment.x.toFixed(4)}: ${assessment.reason}.`,
        data: {
          x: assessment.x,
          reason: assessment.reason,
          supportRatio: assessment.supportRatio,
        },
      }),
    ),
    ...recovered.inferred.map((boundary) =>
      createOmrV3Diagnostic({
        code: 'missing-barline-inferred',
        severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
        stage: 'measure-column-reconciliation',
        message: `Inferred shared boundary at x=${boundary.x.toFixed(4)}.`,
        data: { x: boundary.x, expectedWidth },
      }),
    ),
    ...(trailing.trimmed
      ? [
          createOmrV3Diagnostic({
            code: 'invented-trailing-measure-rejected',
            stage: 'measure-column-reconciliation',
            message: 'Dropped an empty synthetic trailing span after the final observed barline.',
            data: {
              xStart: trailing.trimmed.xStart,
              xEnd: trailing.trimmed.xEnd,
            },
          }),
        ]
      : []),
  ]

  const nextSystem = createOmrSystemIR({
    ...system,
    staffGroups: withMeasureMembership(system.staffGroups, measureIds),
    measureColumns,
    systemBarlines: boundaries.map((boundary) => ({
      x: boundary.x,
      kind: boundary.kind,
      confidence: boundary.confidence,
      supportRatio: boundary.supportRatio,
      participatingStaffIds: boundary.participatingStaffIds ?? [],
    })),
    diagnostics: [...(system.diagnostics ?? []), ...diagnostics],
    confidence: {
      overall: measureColumns.length
        ? average(measureColumns.map((measure) => measure.confidence.overall))
        : 0,
      stages: {
        ...(system.confidence?.stages ?? {}),
        'measure-column-reconciliation': measureColumns.length
          ? average(measureColumns.map((measure) => measure.confidence.overall))
          : 0,
      },
      evidence: system.confidence?.evidence ?? [],
    },
  })

  return {
    system: nextSystem,
    measureColumns,
    nextMeasureNumber: measureNumberStart + measureColumns.length,
    diagnostics: {
      rawCandidateCount: clusters.length,
      acceptedBoundaryCount: accepted.length,
      rejectedBoundaryCount: rejected.length,
      inferredBoundaryCount: recovered.inferred.length,
      trailingSpanRejected: Boolean(trailing.trimmed),
      expectedMeasureWidth: expectedWidth || null,
      measureCount: measureColumns.length,
      perSystemAlignment: staves.length
        ? average(
            measureColumns.flatMap((measure) =>
              measure.barlineEvidence.map((evidence) => evidence.supportRatio ?? 0),
            ),
          )
        : 0,
    },
  }
}

function recentWidths(systems, limit = 12) {
  return systems
    .flatMap((system) =>
      (system.measureColumns ?? []).map((measure) => measure.xEnd - measure.xStart),
    )
    .filter((width) => Number.isFinite(width) && width > 0)
    .slice(-limit)
}

/** Number all shared measure columns in document reading order. */
export function buildOmrV3DocumentMeasureColumns(
  document,
  { symbolXsBySystem = new Map() } = {},
) {
  let measureNumber = 1
  const priorSystems = []
  const pageResults = []
  const pages = (document?.pages ?? []).map((page) => {
    const systems = (page.systems ?? []).map((system) => {
      const result = buildOmrV3MeasureColumnsForSystem(system, {
        measureNumberStart: measureNumber,
        neighboringMeasureWidths: recentWidths(priorSystems),
        symbolXs: symbolXsBySystem.get(system.systemId) ?? [],
      })
      measureNumber = result.nextMeasureNumber
      priorSystems.push(result.system)
      pageResults.push({ systemId: system.systemId, ...result.diagnostics })
      return result.system
    })
    return { ...page, systems }
  })
  return {
    document: createOmrDocumentIR({ ...document, pages }),
    systems: pageResults,
    totalMeasures: measureNumber - 1,
  }
}

export function summarizeOmrV3MeasureGeometry(document) {
  const systems = (document?.pages ?? []).flatMap((page) => page.systems ?? [])
  const measures = systems.flatMap((system) => system.measureColumns ?? [])
  const staffParticipation = measures.flatMap((measure) => measure.expectedStaffParticipation ?? [])
  const inferredBoundaryCount = systems.reduce(
    (sum, system) =>
      sum +
      (system.systemBarlines ?? []).filter((barline) => barline.kind === 'inferred-missing-barline')
        .length,
    0,
  )
  return {
    systemCount: systems.length,
    measureCount: measures.length,
    inferredBoundaryCount,
    meanMeasuresPerSystem: systems.length ? measures.length / systems.length : 0,
    expectedStaffParticipations: staffParticipation.length,
    systemsWithoutMeasures: systems.filter((system) => !(system.measureColumns?.length > 0)).length,
  }
}
