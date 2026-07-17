/** Cross-fixture shadow metrics and conservative promotion gates for OMR V3. */

import { evaluateOmrAccuracy } from '../omrAccuracyEvaluator.js'
import { serializeOmrV3MusicXml } from './omrV3MusicXml.js'
import { OMR_V3_RELATIONSHIP_TYPE } from './omrV3Ir.js'
import { countOmrV3VoiceOverlapViolations } from './omrV3Voices.js'

const ACCURACY_METRICS = [
  'pitchAccuracy',
  'durationAccuracy',
  'onsetAccuracy',
  'chordGroupingAccuracy',
  'noteDetectionF1',
]

function structures(document) {
  const systems = (document.pages ?? []).flatMap((page) => page.systems ?? [])
  const groups = systems.flatMap((system) => system.staffGroups ?? [])
  const measures = systems.flatMap((system) => system.measureColumns ?? [])
  return { systems, groups, measures }
}

function ratio(numerator, denominator, fallback = null) {
  return denominator > 0 ? numerator / denominator : fallback
}

function exactListAccuracy(actual, expected) {
  if (!Array.isArray(expected)) return null
  const length = Math.max(actual.length, expected.length)
  if (length === 0) return 1
  let matches = 0
  for (let index = 0; index < length; index += 1) {
    if (actual[index] === expected[index]) matches += 1
  }
  return matches / length
}

function accuracyMetrics(musicXml, truthMusicXml) {
  if (!musicXml || !truthMusicXml) return null
  return evaluateOmrAccuracy({
    generatedMusicXml: musicXml,
    groundTruthMusicXml: truthMusicXml,
  }).metrics
}

export function evaluateOmrV3Shadow({
  document,
  runtimeMusicXml = null,
  truthMusicXml = null,
  expectedStructure = {},
  serializerResult = null,
} = {}) {
  const serialized = serializerResult ?? serializeOmrV3MusicXml(document)
  const { systems, groups, measures } = structures(document)
  const mirrors = (document.relationships ?? []).filter(
    (relationship) => relationship.type === OMR_V3_RELATIONSHIP_TYPE.NOTATION_TAB_MIRROR,
  ).length
  const tabEligibleEvents = measures
    .flatMap((measure) => measure.voices ?? [])
    .filter((voice) => voice.candidateRank === 0)
    .flatMap((voice) => voice.events ?? [])
    .filter((event) => event.technical?.notationSymbolId).length
  const expectedMeasureCount = expectedStructure.measureCount
  const expectedSystemCount = expectedStructure.systemCount
  const currentAccuracy = accuracyMetrics(runtimeMusicXml, truthMusicXml)
  const v3Accuracy = accuracyMetrics(serialized.musicXml, truthMusicXml)
  return {
    serializer: serialized.summary,
    structure: {
      systemCount: systems.length,
      staffGroupCount: groups.length,
      measureCount: measures.length,
      systemCountAccuracy: Number.isInteger(expectedSystemCount)
        ? systems.length === expectedSystemCount
          ? 1
          : 0
        : null,
      staffGroupAccuracy: exactListAccuracy(
        groups.map((group) => group.type),
        expectedStructure.staffGroupTypes,
      ),
      absoluteMeasureCountError: Number.isInteger(expectedMeasureCount)
        ? Math.abs(measures.length - expectedMeasureCount)
        : null,
    },
    fusion: {
      notationTabPairingRecall: ratio(mirrors, tabEligibleEvents, tabEligibleEvents ? 0 : null),
      mirrorRelationshipCount: mirrors,
      duplicateEventRate: serialized.summary.duplicateEventRate,
    },
    validity: {
      invalidEventRate: serialized.summary.invalidEventRate,
      invalidEventCount: serialized.summary.invalidEventCount,
      voiceOverlapViolations: countOmrV3VoiceOverlapViolations(document),
    },
    accuracy: { current: currentAccuracy, v3: v3Accuracy },
    musicXml: serialized.musicXml,
  }
}

function flattenedMetrics(report) {
  const accuracy = report?.accuracy?.v3 ?? report?.metrics ?? report ?? {}
  return {
    ...Object.fromEntries(ACCURACY_METRICS.map((key) => [key, accuracy?.[key] ?? null])),
    absoluteMeasureCountError: report?.structure?.absoluteMeasureCountError ?? null,
    systemCountAccuracy: report?.structure?.systemCountAccuracy ?? null,
    staffGroupAccuracy: report?.structure?.staffGroupAccuracy ?? null,
    notationTabPairingRecall: report?.fusion?.notationTabPairingRecall ?? null,
    duplicateEventRate: report?.fusion?.duplicateEventRate ?? report?.duplicateEventRate ?? 0,
    invalidEventRate: report?.validity?.invalidEventRate ?? report?.invalidEventRate ?? 0,
    voiceOverlapViolations:
      report?.validity?.voiceOverlapViolations ?? report?.voiceOverlapViolations ?? 0,
  }
}

const HIGHER_IS_BETTER = [
  ...ACCURACY_METRICS,
  'systemCountAccuracy',
  'staffGroupAccuracy',
  'notationTabPairingRecall',
]
const LOWER_IS_BETTER = [
  'absoluteMeasureCountError',
  'duplicateEventRate',
  'invalidEventRate',
  'voiceOverlapViolations',
]

function compareFixture(fixture) {
  const current = flattenedMetrics(fixture.current)
  const v3 = flattenedMetrics(fixture.v3)
  const improvements = []
  const regressions = []
  for (const key of HIGHER_IS_BETTER) {
    if (!Number.isFinite(current[key]) || !Number.isFinite(v3[key])) continue
    if (v3[key] > current[key]) improvements.push(key)
    if (v3[key] < current[key]) regressions.push(key)
  }
  for (const key of LOWER_IS_BETTER) {
    if (!Number.isFinite(current[key]) || !Number.isFinite(v3[key])) continue
    if (v3[key] < current[key]) improvements.push(key)
    if (v3[key] > current[key]) regressions.push(key)
  }
  return { id: fixture.id, enforced: fixture.enforced !== false, current, v3, improvements, regressions }
}

/** Promotion requires two improved fixtures and zero enforced regressions. */
export function assessOmrV3PromotionGate(
  fixtures = [],
  {
    thresholdLowered = false,
    fixtureHardcodingDetected = false,
    confidenceInflationDetected = false,
  } = {},
) {
  const comparisons = fixtures.map(compareFixture)
  const enforced = comparisons.filter((comparison) => comparison.enforced)
  const improvedFixtureCount = enforced.filter((comparison) => comparison.improvements.length > 0).length
  const regressions = enforced.filter((comparison) => comparison.regressions.length > 0)
  const policyViolations = [
    ...(thresholdLowered ? ['threshold-lowered'] : []),
    ...(fixtureHardcodingDetected ? ['fixture-hardcoding'] : []),
    ...(confidenceInflationDetected ? ['confidence-inflation'] : []),
  ]
  const pass = improvedFixtureCount >= 2 && regressions.length === 0 && policyViolations.length === 0
  return {
    pass,
    status: pass ? 'eligible-for-partial-promotion-review' : 'shadow-only',
    improvedFixtureCount,
    requiredImprovedFixtureCount: 2,
    regressionCount: regressions.length,
    policyViolations,
    comparisons,
    promotedToRuntime: false,
    candidates: {
      structure: pass ? 'eligible-for-review' : 'not-promoted',
      measureGeometry: pass ? 'eligible-for-review' : 'not-promoted',
      pianoGrouping: pass ? 'eligible-for-review' : 'not-promoted',
      guitarFusion: pass ? 'eligible-for-review' : 'not-promoted',
      fullV3: 'not-promoted',
    },
  }
}

function productionFixtureStatus(fixture) {
  return fixture?.shadow?.status ?? fixture?.status ?? 'unavailable'
}

function productionFixtureEvidence(fixture) {
  return fixture?.shadow?.evidence ?? fixture?.evidence ?? {}
}

function productionFixtureDecision(fixture) {
  return fixture?.shadow?.decision ?? fixture?.decision ?? null
}

/**
 * Full-runtime qualification is intentionally stricter than the historical
 * partial-promotion review gate above. A V3 replacement must be evaluated on
 * every enforced fixture, must own its musical symbols instead of replaying
 * legacy events, and must own honest rejection decisions. Runtime and rollback
 * readiness are explicit evidence inputs rather than inferred from metrics.
 */
export function assessOmrV3ProductionGate(
  fixtures = [],
  {
    runtimeCandidateImplemented = false,
    rollbackVerified = false,
    thresholdLowered = false,
    fixtureHardcodingDetected = false,
    confidenceInflationDetected = false,
  } = {},
) {
  const enforced = fixtures.filter((fixture) => fixture.enforced !== false)
  const recognitionFixtures = enforced.filter(
    (fixture) => fixture.expectedOutcome !== 'reject-honestly',
  )
  const rejectionFixtures = enforced.filter(
    (fixture) => fixture.expectedOutcome === 'reject-honestly',
  )
  const evaluatedRecognitionFixtures = recognitionFixtures.filter(
    (fixture) => productionFixtureStatus(fixture) === 'ready',
  )
  const independentRecognitionFixtures = evaluatedRecognitionFixtures.filter(
    (fixture) => productionFixtureEvidence(fixture).independentPrimaryEventRate === 1,
  )
  const independentlyRejectedFixtures = rejectionFixtures.filter((fixture) => {
    const decision = productionFixtureDecision(fixture)
    return (
      decision?.status === 'reject' &&
      decision?.ownedBy === 'omr-v3' &&
      decision?.independent === true
    )
  })
  const comparableFixtures = evaluatedRecognitionFixtures.map((fixture) => ({
    id: fixture.id ?? fixture.fixtureId,
    enforced: true,
    current: fixture.current ?? fixture.shadow?.current,
    v3: fixture.v3 ?? fixture.shadow?.v3,
  }))
  const regressionGate = assessOmrV3PromotionGate(comparableFixtures, {
    thresholdLowered,
    fixtureHardcodingDetected,
    confidenceInflationDetected,
  })
  const blockers = []

  if (evaluatedRecognitionFixtures.length !== recognitionFixtures.length) {
    blockers.push({
      code: 'incomplete-enforced-recognition-coverage',
      expected: recognitionFixtures.length,
      actual: evaluatedRecognitionFixtures.length,
      fixtures: recognitionFixtures
        .filter((fixture) => productionFixtureStatus(fixture) !== 'ready')
        .map((fixture) => fixture.id ?? fixture.fixtureId),
    })
  }
  if (independentRecognitionFixtures.length !== recognitionFixtures.length) {
    blockers.push({
      code: 'legacy-derived-symbol-evidence',
      expected: recognitionFixtures.length,
      actual: independentRecognitionFixtures.length,
      fixtures: recognitionFixtures
        .filter(
          (fixture) => productionFixtureEvidence(fixture).independentPrimaryEventRate !== 1,
        )
        .map((fixture) => fixture.id ?? fixture.fixtureId),
    })
  }
  if (independentlyRejectedFixtures.length !== rejectionFixtures.length) {
    blockers.push({
      code: 'v3-rejection-ownership-incomplete',
      expected: rejectionFixtures.length,
      actual: independentlyRejectedFixtures.length,
      fixtures: rejectionFixtures
        .filter((fixture) => !independentlyRejectedFixtures.includes(fixture))
        .map((fixture) => fixture.id ?? fixture.fixtureId),
    })
  }
  if (regressionGate.regressionCount > 0) {
    blockers.push({
      code: 'enforced-regressions',
      count: regressionGate.regressionCount,
      fixtures: regressionGate.comparisons
        .filter((comparison) => comparison.regressions.length > 0)
        .map((comparison) => comparison.id),
    })
  }
  if (regressionGate.policyViolations.length > 0) {
    blockers.push({
      code: 'policy-violations',
      violations: regressionGate.policyViolations,
    })
  }
  if (!runtimeCandidateImplemented) {
    blockers.push({ code: 'runtime-candidate-not-implemented' })
  }
  if (!rollbackVerified) {
    blockers.push({ code: 'rollback-not-verified' })
  }

  const pass = blockers.length === 0
  return {
    pass,
    status: pass ? 'eligible-for-production-rollout' : 'blocked',
    promotedToRuntime: false,
    enforcedFixtureCount: enforced.length,
    recognitionFixtureCount: recognitionFixtures.length,
    rejectionFixtureCount: rejectionFixtures.length,
    evaluatedRecognitionFixtureCount: evaluatedRecognitionFixtures.length,
    independentRecognitionFixtureCount: independentRecognitionFixtures.length,
    independentlyRejectedFixtureCount: independentlyRejectedFixtures.length,
    regressionCount: regressionGate.regressionCount,
    policyViolations: regressionGate.policyViolations,
    runtimeCandidateImplemented: Boolean(runtimeCandidateImplemented),
    rollbackVerified: Boolean(rollbackVerified),
    blockers,
  }
}
