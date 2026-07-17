/** Hierarchical confidence reasoning over the OMR V3 document IR. */

const EPSILON = 1e-6

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right)
  return finite.length ? finite[Math.floor(finite.length / 2)] : 0
}

function lowerQuantile(values, quantile = 0.2) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (!finite.length) return 0
  return finite[Math.floor((finite.length - 1) * clamp(quantile))]
}

function weightedGeometricMean(entries) {
  const usable = entries.filter(
    (entry) => Number.isFinite(entry?.value) && Number.isFinite(entry?.weight) && entry.weight > 0,
  )
  if (!usable.length) return 0
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0)
  const logTotal = usable.reduce(
    (sum, entry) => sum + Math.log(Math.max(0.02, clamp(entry.value))) * entry.weight,
    0,
  )
  return clamp(Math.exp(logTotal / totalWeight))
}

function systemSignature(system) {
  const groups = system?.staffGroups ?? []
  return groups
    .map((group) => `${group.type}:${group.staves?.length ?? 0}`)
    .join('|')
}

function systemContinuityScore(systems) {
  if (systems.length <= 1) return systems.length === 1 ? 0.8 : 0
  const comparisons = systems.slice(1).map(
    (system, index) => systemSignature(system) === systemSignature(systems[index]) ? 1 : 0.35,
  )
  return weightedGeometricMean(comparisons.map((value) => ({ value, weight: 1 })))
}

function pageStructureScore(page) {
  const systems = page?.systems ?? []
  if (!systems.length) return 0
  const groups = systems.flatMap((system) => system.staffGroups ?? [])
  const knownGroups = groups.filter((group) => group.type && group.type !== 'unknown').length
  const withMeasures = systems.filter((system) => (system.measureColumns?.length ?? 0) > 0).length
  const bounded = systems.filter((system) => {
    const box = system.boundingBox
    return (
      box &&
      box.width > 0 &&
      box.height > 0 &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 1 + EPSILON &&
      box.y + box.height <= 1 + EPSILON
    )
  }).length
  return weightedGeometricMean([
    { value: knownGroups / Math.max(1, groups.length), weight: 2 },
    { value: withMeasures / systems.length, weight: 2 },
    { value: bounded / systems.length, weight: 1 },
    { value: systemContinuityScore(systems), weight: 1 },
  ])
}

function boundaryScore(measure) {
  const evidence = measure?.barlineEvidence ?? []
  if (!evidence.length) return 0.35
  return weightedGeometricMean(
    evidence.map((entry) => {
      const kindFactor = entry.kind === 'inferred-missing-barline' ? 0.62 : 1
      const support = Number.isFinite(entry.supportRatio) ? entry.supportRatio : 0.7
      const confidence = Number.isFinite(entry.confidence) ? entry.confidence : 0.6
      return {
        value: clamp(kindFactor * Math.sqrt(Math.max(0.05, support * confidence))),
        weight: 1,
      }
    }),
  )
}

function staffParticipationScore(measure) {
  const expected = new Set(measure?.expectedStaffParticipation ?? [])
  if (!expected.size) return 0.5
  const participating = new Set(
    (measure?.voices ?? [])
      .filter((voice) => (voice.events?.length ?? 0) > 0)
      .map((voice) => voice.staffId)
      .filter(Boolean),
  )
  if (!participating.size) return 0.35
  const covered = [...expected].filter((staffId) => participating.has(staffId)).length
  const unexpected = [...participating].filter((staffId) => !expected.has(staffId)).length
  return clamp(covered / expected.size - unexpected / Math.max(2, expected.size * 2))
}

function voiceScore(measure) {
  const voices = measure?.voices ?? []
  if (!voices.length) return 0.35
  const scores = voices.map((voice) => {
    const constraints = voice.overlapConstraints ?? []
    const satisfied = constraints.length
      ? constraints.filter((constraint) => constraint.satisfied !== false).length / constraints.length
      : 0.75
    const events = [...(voice.events ?? [])].sort((left, right) => left.onset - right.onset)
    let nonOverlapping = 1
    let end = -Infinity
    for (const event of events) {
      if (!Number.isFinite(event.onset) || !Number.isFinite(event.duration?.divisions)) {
        nonOverlapping = Math.min(nonOverlapping, 0.3)
        continue
      }
      if (event.onset + EPSILON < end) nonOverlapping = 0
      end = Math.max(end, event.onset + event.duration.divisions)
    }
    return weightedGeometricMean([
      { value: satisfied, weight: 2 },
      { value: nonOverlapping, weight: 2 },
      { value: voice.ambiguous ? 0.55 : 0.9, weight: 1 },
      { value: voice.confidence?.overall ?? 0.5, weight: 1 },
    ])
  })
  return lowerQuantile(scores, 0.25)
}

function rhythmScore(measure) {
  const events = (measure?.voices ?? []).flatMap((voice) => voice.events ?? [])
  if (!events.length) return 0.4
  const valid = events.filter(
    (event) =>
      Number.isFinite(event.onset) &&
      event.onset >= 0 &&
      Number.isFinite(event.duration?.divisions) &&
      event.duration.divisions > 0,
  ).length
  const exact = events.filter((event) => event.duration?.exact !== false).length
  const orderedColumns = (measure.onsetColumns ?? []).every(
    (column, index, columns) => index === 0 || column.x + EPSILON >= columns[index - 1].x,
  )
  return weightedGeometricMean([
    { value: valid / events.length, weight: 2 },
    { value: exact / events.length, weight: 1 },
    { value: orderedColumns ? 1 : 0.25, weight: 1 },
  ])
}

function widthConsistencyScores(system) {
  const measures = system?.measureColumns ?? []
  const widths = measures
    .map((measure) => measure.xEnd - measure.xStart)
    .filter((width) => Number.isFinite(width) && width > 0)
  const reference = median(widths)
  return measures.map((measure) => {
    const width = measure.xEnd - measure.xStart
    if (!Number.isFinite(width) || width <= 0 || reference <= 0) return 0.2
    const relativeError = Math.abs(width - reference) / reference
    return clamp(Math.exp(-relativeError * 1.8), 0.2, 1)
  })
}

function measureScores(document) {
  const results = []
  for (const page of document?.pages ?? []) {
    for (const system of page.systems ?? []) {
      const widths = widthConsistencyScores(system)
      for (let index = 0; index < (system.measureColumns ?? []).length; index += 1) {
        const measure = system.measureColumns[index]
        const factors = {
          measureConsistency: weightedGeometricMean([
            { value: boundaryScore(measure), weight: 2 },
            { value: widths[index] ?? 0.2, weight: 1 },
          ]),
          staffContinuity: staffParticipationScore(measure),
          rhythmicConsistency: rhythmScore(measure),
          voiceContinuity: voiceScore(measure),
        }
        const score = weightedGeometricMean([
          { value: factors.measureConsistency, weight: 2 },
          { value: factors.staffContinuity, weight: 2 },
          { value: factors.rhythmicConsistency, weight: 2 },
          { value: factors.voiceContinuity, weight: 2 },
        ])
        results.push({
          pageIndex: page.pageIndex,
          systemId: system.systemId,
          measureId: measure.measureId,
          measureNumber: measure.measureNumber,
          score,
          factors,
        })
      }
    }
  }
  return results
}

/**
 * Calibrate detector confidence with structural bottlenecks instead of averaging
 * all measures. The bounded calibration keeps existing acceptance thresholds
 * meaningful while making local continuity failures visible.
 */
export function reasonAboutOmrV3Confidence(
  document,
  { legacyConfidence = 0, includeMeasureDetails = false } = {},
) {
  const pages = document?.pages ?? []
  const systems = pages.flatMap((page) => page.systems ?? [])
  const measures = measureScores(document)
  const pageScores = pages.map(pageStructureScore)
  const measureValues = measures.map((measure) => measure.score)
  const factors = {
    pageStructure: lowerQuantile(pageScores, 0.25),
    systemContinuity: systemContinuityScore(systems),
    measureConsistency: weightedGeometricMean(
      measures.map((measure) => ({ value: measure.factors.measureConsistency, weight: 1 })),
    ),
    staffContinuity: lowerQuantile(
      measures.map((measure) => measure.factors.staffContinuity),
      0.2,
    ),
    rhythmicConsistency: lowerQuantile(
      measures.map((measure) => measure.factors.rhythmicConsistency),
      0.2,
    ),
    voiceContinuity: lowerQuantile(
      measures.map((measure) => measure.factors.voiceContinuity),
      0.2,
    ),
    neighboringSystems: systemContinuityScore(systems),
  }
  const structuralConfidence = weightedGeometricMean([
    { value: factors.pageStructure, weight: 2 },
    { value: factors.systemContinuity, weight: 1 },
    { value: factors.measureConsistency, weight: 2 },
    { value: factors.staffContinuity, weight: 2 },
    { value: factors.rhythmicConsistency, weight: 2 },
    { value: factors.voiceContinuity, weight: 2 },
    { value: lowerQuantile(measureValues, 0.2), weight: 1 },
  ])
  const calibration = 0.9 + structuralConfidence * 0.2
  const overallConfidence = clamp(legacyConfidence * calibration)
  const lowMeasures = measures
    .filter((measure) => measure.score < 0.5)
    .sort((left, right) => left.score - right.score)
  return {
    method: 'omr-v3-hierarchical-bottleneck-v1',
    overallConfidence,
    legacyConfidence: clamp(legacyConfidence),
    structuralConfidence,
    calibration,
    factors,
    distribution: {
      measureCount: measures.length,
      minimum: measureValues.length ? Math.min(...measureValues) : 0,
      lowerQuantile: lowerQuantile(measureValues, 0.2),
      median: median(measureValues),
      lowMeasureCount: lowMeasures.length,
    },
    lowMeasures: lowMeasures.slice(0, 12).map((measure) => ({
      measureNumber: measure.measureNumber,
      pageIndex: measure.pageIndex,
      score: measure.score,
      factors: measure.factors,
    })),
    ...(includeMeasureDetails ? { measures } : {}),
  }
}

export const omrV3ConfidenceInternals = {
  weightedGeometricMean,
  lowerQuantile,
  measureScores,
}
