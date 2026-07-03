/**
 * OMR Engine V2 Phase 6B — live voice-serialization candidate qualification.
 * Diagnostic only; analyzes Phase 6 shadow output with truth MXL when available.
 */

import { hotspotMeasuresForFixture } from './omrHotspotDiagnostics.js'
import { FROZEN_BASELINE } from './omrRolloutGate.js'

export const ENFORCED_LIVE_FIXTURES = ['clean', 'dense', 'simple']

export const QUALIFICATION_BLOCKER = {
  NO_SCOREGRAPH: 'no-scoregraph-full',
  NO_TRUTH: 'no-truth-mxl',
  NOT_IN_FAMILY: 'not-in-family',
  NO_IMPROVEMENT: 'no-improvement',
  HARD_CONSTRAINTS: 'hard-constraints',
  STRUCTURAL_PRESERVATION: 'structural-preservation',
  TRUTH_GATE: 'truth-gate',
  CHORD_REGRESSION: 'chord-regression',
  DURATION_REGRESSION: 'duration-regression',
  PITCH_REGRESSION: 'pitch-regression',
  NOTE_COUNT_CHANGED: 'note-count-changed',
  NO_ONSET_DURATION_GAIN: 'no-onset-or-duration-gain',
  IDENTITY: 'identity-no-change',
}

const PRESERVATION_VIOLATION_BLOCKER = {
  'note-count-changed': QUALIFICATION_BLOCKER.NOTE_COUNT_CHANGED,
  'duration-changed': QUALIFICATION_BLOCKER.DURATION_REGRESSION,
  'chord-split': QUALIFICATION_BLOCKER.CHORD_REGRESSION,
  'same-start-collision': QUALIFICATION_BLOCKER.STRUCTURAL_PRESERVATION,
  'onset-group-regression': QUALIFICATION_BLOCKER.STRUCTURAL_PRESERVATION,
}

export function classifyQualificationBlocker(entry = {}) {
  const reason = String(entry.rejectReason ?? entry.rejections?.[0] ?? '')
  if (reason === 'constraints-failed') {
    return QUALIFICATION_BLOCKER.HARD_CONSTRAINTS
  }
  if (reason === 'preservation-failed') {
    const violation = entry.rejectedVariants?.[0]?.violations?.[0]
    return PRESERVATION_VIOLATION_BLOCKER[violation] ?? QUALIFICATION_BLOCKER.STRUCTURAL_PRESERVATION
  }
  if (reason === 'not-in-family') {
    return QUALIFICATION_BLOCKER.NOT_IN_FAMILY
  }
  if (reason === 'no-improvement') {
    return QUALIFICATION_BLOCKER.NO_IMPROVEMENT
  }
  if (reason === 'chord-regression') {
    return QUALIFICATION_BLOCKER.CHORD_REGRESSION
  }
  if (reason === 'duration-regression') {
    return QUALIFICATION_BLOCKER.DURATION_REGRESSION
  }
  if (reason === 'pitch-regression') {
    return QUALIFICATION_BLOCKER.PITCH_REGRESSION
  }
  if (reason === 'note-count-changed') {
    return QUALIFICATION_BLOCKER.NOTE_COUNT_CHANGED
  }
  if (reason === 'no-onset-or-duration-gain') {
    return QUALIFICATION_BLOCKER.NO_ONSET_DURATION_GAIN
  }
  if (reason.includes('truth-gate')) {
    return QUALIFICATION_BLOCKER.TRUTH_GATE
  }
  return QUALIFICATION_BLOCKER.TRUTH_GATE
}

function measureMapByNumber(entries = []) {
  return new Map(entries.map((entry) => [entry.measureNumber, entry]))
}

function buildMeasureQualification({
  measureNumber,
  structuralEntry = null,
  truthEntry = null,
  structuralReject = null,
  truthReject = null,
  perMeasureDelta = null,
}) {
  let status = 'unchanged'
  let blocker = QUALIFICATION_BLOCKER.IDENTITY

  if (truthEntry) {
    status = 'truth-approved'
    blocker = null
  } else if (structuralEntry && truthReject) {
    status = 'structural-only-rejected-by-truth'
    blocker = classifyQualificationBlocker(truthReject)
  } else if (structuralReject) {
    status = 'structurally-rejected'
    blocker = classifyQualificationBlocker(structuralReject)
  } else if (!structuralEntry && !structuralReject) {
    status = 'not-candidate'
    blocker = QUALIFICATION_BLOCKER.NOT_IN_FAMILY
  }

  return {
    measureNumber,
    status,
    blocker,
    variantId: truthEntry?.variantId ?? structuralEntry?.variantId ?? structuralReject?.bestVariantId ?? null,
    structuralVariantId: structuralEntry?.variantId ?? null,
    truthGateDelta: truthEntry?.truthGateDelta ?? truthReject?.truthGateDelta ?? null,
    perMeasureDelta: perMeasureDelta ?? null,
    familyReasons:
      truthEntry?.familyReasons ??
      structuralEntry?.familyReasons ??
      structuralReject?.familyReasons ??
      [],
    rejectedVariants: structuralReject?.rejectedVariants ?? truthReject?.rejectedVariants ?? [],
  }
}

/**
 * Build per-fixture qualification from a Phase 6 voiceSerializationShadow record.
 */
export function buildVoiceSerializationQualification(
  voiceShadow = {},
  { fixtureId = null, fixtureMetrics = null } = {},
) {
  const phase =
    voiceShadow?.constraintVersion?.includes('phase-7') ||
    voiceShadow?.solverDiagnostics?.constraintVersion?.includes('phase-7')
      ? '7'
      : '6b'

  if (!voiceShadow || voiceShadow.status === 'unavailable') {
    return {
      fixtureId,
      phase,
      liveEligible: ENFORCED_LIVE_FIXTURES.includes(fixtureId),
      scoreGraphAvailable: false,
      truthAvailable: false,
      anyTruthApproved: false,
      truthApprovedCount: 0,
      structuralAppliedCount: 0,
      blocker: QUALIFICATION_BLOCKER.NO_SCOREGRAPH,
      hotspotMeasures: hotspotMeasuresForFixture(fixtureId),
      hotspotQualification: [],
      measures: [],
      globalDelta: null,
      runtimeMetrics: fixtureMetrics,
      recommendation: 'Re-run live dashboard with includeScoreGraph and truth MXL.',
    }
  }

  const scoreGraphAvailable = voiceShadow.status !== 'shadow-only-no-scoregraph'
  const truthAvailable = Boolean(voiceShadow.runtime && voiceShadow.shadow)

  if (!scoreGraphAvailable) {
    return {
      fixtureId,
      phase,
      liveEligible: ENFORCED_LIVE_FIXTURES.includes(fixtureId),
      scoreGraphAvailable: false,
      truthAvailable,
      anyTruthApproved: false,
      truthApprovedCount: 0,
      structuralAppliedCount: voiceShadow.structurallyAppliedCount ?? 0,
      blocker: QUALIFICATION_BLOCKER.NO_SCOREGRAPH,
      hotspotMeasures: voiceShadow.hotspotMeasures ?? hotspotMeasuresForFixture(fixtureId),
      hotspotQualification: (voiceShadow.hotspotMeasures ?? hotspotMeasuresForFixture(fixtureId)).map(
        (measureNumber) => ({
          measureNumber,
          status: 'unavailable',
          blocker: QUALIFICATION_BLOCKER.NO_SCOREGRAPH,
        }),
      ),
      measures: [],
      globalDelta: voiceShadow.delta ?? null,
      runtimeMetrics: voiceShadow.runtime ?? fixtureMetrics ?? null,
      recommendation:
        'Run live OMR dashboard (not --from-reports) so scoreGraphFull is populated for shadow solver.',
    }
  }

  const structuralApplied = voiceShadow.structuralAppliedMeasures ?? []
  const truthApproved = voiceShadow.changedMeasures ?? voiceShadow.acceptedCandidateMeasures ?? []
  const structuralByMeasure = measureMapByNumber(structuralApplied)
  const truthByMeasure = measureMapByNumber(truthApproved)
  const structuralRejectByMeasure = measureMapByNumber(
    voiceShadow.rejectedMeasures ?? voiceShadow.solverDiagnostics?.rejectedCandidateMeasures ?? [],
  )
  const truthRejectByMeasure = measureMapByNumber(voiceShadow.rejectedByTruth ?? [])
  const deltaByMeasure = measureMapByNumber(voiceShadow.perMeasureDelta ?? [])

  const measureNumbers = new Set([
    ...structuralByMeasure.keys(),
    ...truthByMeasure.keys(),
    ...structuralRejectByMeasure.keys(),
    ...truthRejectByMeasure.keys(),
    ...(voiceShadow.hotspotMeasures ?? hotspotMeasuresForFixture(fixtureId)),
  ])

  const measures = [...measureNumbers]
    .sort((left, right) => left - right)
    .map((measureNumber) =>
      buildMeasureQualification({
        measureNumber,
        structuralEntry: structuralByMeasure.get(measureNumber) ?? null,
        truthEntry: truthByMeasure.get(measureNumber) ?? null,
        structuralReject: structuralRejectByMeasure.get(measureNumber) ?? null,
        truthReject: truthRejectByMeasure.get(measureNumber) ?? null,
        perMeasureDelta: deltaByMeasure.get(measureNumber) ?? null,
      }),
    )

  const hotspotMeasures = voiceShadow.hotspotMeasures ?? hotspotMeasuresForFixture(fixtureId)
  const hotspotQualification = hotspotMeasures.map(
    (measureNumber) =>
      measures.find((entry) => entry.measureNumber === measureNumber) ?? {
        measureNumber,
        status: 'not-evaluated',
        blocker: QUALIFICATION_BLOCKER.IDENTITY,
      },
  )

  const truthApprovedCount = truthApproved.length
  const structuralAppliedCount =
    voiceShadow.structurallyAppliedCount ?? structuralApplied.length ?? 0
  const anyTruthApproved = truthApprovedCount > 0

  const blockerHistogram = {}
  for (const entry of measures) {
    if (!entry.blocker) {
      continue
    }
    blockerHistogram[entry.blocker] = (blockerHistogram[entry.blocker] ?? 0) + 1
  }

  const dominantBlocker = Object.entries(blockerHistogram).sort((left, right) => right[1] - left[1])[0]

  return {
    fixtureId,
    phase,
    constraintVersion:
      voiceShadow.constraintVersion ?? voiceShadow.solverDiagnostics?.constraintVersion ?? null,
    durationCoupledAppliedCount: voiceShadow.solverDiagnostics?.durationCoupledAppliedCount ?? 0,
    liveEligible: ENFORCED_LIVE_FIXTURES.includes(fixtureId),
    scoreGraphAvailable: true,
    truthAvailable,
    shadowStatus: voiceShadow.status ?? null,
    promoted: false,
    anyTruthApproved,
    truthApprovedCount,
    structuralAppliedCount,
    rejectedByTruthCount: voiceShadow.rejectedByTruth?.length ?? 0,
    structurallyRejectedCount: voiceShadow.rejectedMeasures?.length ?? 0,
    dominantBlocker: dominantBlocker ? { bucket: dominantBlocker[0], count: dominantBlocker[1] } : null,
    blockerHistogram,
    hotspotMeasures,
    hotspotQualification,
    measures,
    truthApprovedMeasures: truthApproved,
    structuralAppliedMeasures: structuralApplied,
    rejectedMeasures: voiceShadow.rejectedCandidateMeasures ?? [],
    globalDelta: voiceShadow.delta ?? null,
    hotspotDelta: voiceShadow.hotspotDelta ?? [],
    runtimeMetrics: voiceShadow.runtime ?? fixtureMetrics ?? null,
    shadowMetrics: voiceShadow.shadow ?? null,
    runtimeFrozenMatch: fixtureId === 'dense' && voiceShadow.runtime
      ? {
          wrongOnset: voiceShadow.runtime.wrongOnset === FROZEN_BASELINE.dense.wrongOnset,
          wrongDuration: voiceShadow.runtime.wrongDuration === FROZEN_BASELINE.dense.wrongDuration,
          chordMismatch: voiceShadow.runtime.chordMismatch === FROZEN_BASELINE.dense.chordMismatch,
          wrongPitch: voiceShadow.runtime.wrongPitch === FROZEN_BASELINE.dense.wrongPitch,
        }
      : null,
    recommendation: anyTruthApproved
      ? 'Phase 7 produced truth-approved measures — keep shadow-only; expand canary gating before any promotion discussion.'
      : structuralAppliedCount > 0
        ? 'Structural duration-coupled candidates exist but truth gate rejected all — refine tie/sustain floors or paired cross-staff moves.'
        : dominantBlocker?.[0] === QUALIFICATION_BLOCKER.STRUCTURAL_PRESERVATION
          ? 'Blocker is structural preservation — chord splits or same-start collisions after coupling; inspect coalesce + tie floors.'
          : dominantBlocker?.[0] === QUALIFICATION_BLOCKER.HARD_CONSTRAINTS
            ? 'Blocker is hard constraints (voice overlap) — duration coupling insufficient; inspect gapToNextOnset IR or multi-voice overlap.'
            : 'No structural candidates on live fixtures — extend lane detection or onset-column IR.',
  }
}

export function buildCorpusVoiceSerializationQualification(records = []) {
  const fixtures = ENFORCED_LIVE_FIXTURES.map((fixtureId) => {
    const record = records.find((entry) => entry.id === fixtureId)
    return buildVoiceSerializationQualification(record?.voiceSerializationShadow ?? null, {
      fixtureId,
      fixtureMetrics: record?.metrics ?? null,
    })
  })

  const anyTruthApproved = fixtures.some((entry) => entry.anyTruthApproved)
  const totalTruthApproved = fixtures.reduce((sum, entry) => sum + (entry.truthApprovedCount ?? 0), 0)
  const totalStructural = fixtures.reduce((sum, entry) => sum + (entry.structuralAppliedCount ?? 0), 0)

  const hardConstraintDominant = fixtures.every(
    (entry) => entry.dominantBlocker?.bucket === QUALIFICATION_BLOCKER.HARD_CONSTRAINTS,
  )
  const hotspotHardConstraint = fixtures.some((entry) =>
    entry.hotspotQualification?.some(
      (hotspot) => hotspot.blocker === QUALIFICATION_BLOCKER.HARD_CONSTRAINTS,
    ),
  )

  return {
    phase: '7',
    generatedAt: new Date().toISOString(),
    enforcedFixtures: ENFORCED_LIVE_FIXTURES,
    anyTruthApproved,
    totalTruthApproved,
    totalStructuralApplied: totalStructural,
    totalDurationCoupledApplied: fixtures.reduce(
      (sum, entry) => sum + (entry.durationCoupledAppliedCount ?? 0),
      0,
    ),
    verdict: anyTruthApproved
      ? `YES — ${totalTruthApproved} truth-approved measure(s) across enforced fixtures.`
      : 'NO — zero truth-approved measures on live enforced fixtures.',
    fixtures,
    phase8Recommendation: anyTruthApproved
      ? 'Expand truth-approved canaries; add per-measure promotion gate design (still shadow-only).'
      : hardConstraintDominant || hotspotHardConstraint
        ? 'Phase 8: paired cross-staff lane moves + sustain-aware release IR; duration coupling alone did not clear voice overlap on hotspots.'
        : totalStructural > 0
          ? 'Phase 8: truth-gate tuning on duration-coupled structural winners; verify no chord/pitch regression per measure.'
          : 'Phase 8: strengthen accompaniment-lane detection; add onsetColumns[] observation for live IR.',
    phase7Recommendation: anyTruthApproved
      ? 'Duration-coupled lane shadow produced truth-approved measures — remain shadow-only.'
      : hardConstraintDominant || hotspotHardConstraint
        ? 'Duration-coupled lane shadow ran but hotspots still blocked by hard constraints — see per-measure rejectedVariants.'
        : totalStructural > 0
          ? 'Duration-coupled structural candidates exist — truth gate is the remaining blocker.'
          : 'Duration-coupled variants did not structurally apply on live fixtures.',
  }
}

export function formatVoiceSerializationQualificationMarkdown(qualification, { indent = '' } = {}) {
  if (!qualification) {
    return ''
  }
  const lines = [
    `${indent}Voice serialization qualification (Phase ${qualification.phase ?? '7'}):`,
    `${indent}- Verdict: ${qualification.verdict ?? qualification.recommendation}`,
  ]
  if (qualification.anyTruthApproved != null) {
    lines.push(
      `${indent}- Truth-approved: ${qualification.truthApprovedCount ?? 0} | Structural: ${qualification.structuralAppliedCount ?? 0}`,
    )
  }
  if (qualification.hotspotQualification?.length) {
    lines.push(`${indent}- Hotspots:`)
    for (const hotspot of qualification.hotspotQualification) {
      const delta = hotspot.perMeasureDelta
        ? ` onsetΔ${hotspot.perMeasureDelta.wrongOnsetDelta ?? 0}`
        : ''
      lines.push(
        `${indent}  - m${hotspot.measureNumber}: ${hotspot.status}${hotspot.blocker ? ` (${hotspot.blocker})` : ''}${delta}`,
      )
    }
  }
  if (qualification.globalDelta) {
    const delta = qualification.globalDelta
    lines.push(
      `${indent}- Global shadow Δ: wrongOnset ${delta.wrongOnset ?? 0}, wrongDuration ${delta.wrongDuration ?? 0}, chord ${delta.chordMismatch ?? 0}`,
    )
  }
  return `${lines.join('\n')}\n`
}

export function formatVoiceSerializationQualificationDocument(corpus) {
  const lines = [
    '# OMR Engine V2 — Phase 7 Duration-Coupled Lane Qualification',
    '',
    `**Generated:** ${corpus.generatedAt}`,
    '**Status:** Diagnostic only — no runtime promotion.',
    '',
    '## Executive verdict',
    '',
    `**${corpus.verdict}**`,
    '',
    `- Truth-approved measures: **${corpus.totalTruthApproved}**`,
    `- Structurally applied (pre-truth): **${corpus.totalStructuralApplied}**`,
    '',
    '## Phase 8 recommendation',
    '',
    corpus.phase8Recommendation ?? corpus.phase7Recommendation,
    '',
    '## Phase 7 summary',
    '',
    corpus.phase7Recommendation ?? '',
    '',
  ]

  for (const fixture of corpus.fixtures) {
    lines.push(`## ${fixture.fixtureId}`)
    lines.push('')
    lines.push(`- ScoreGraph available: ${fixture.scoreGraphAvailable ? 'yes' : '**no**'}`)
    lines.push(`- Truth MXL evaluated: ${fixture.truthAvailable ? 'yes' : 'no'}`)
    lines.push(`- Shadow status: \`${fixture.shadowStatus ?? 'n/a'}\``)
    lines.push(`- Structural applied: **${fixture.structuralAppliedCount ?? 0}**`)
    lines.push(`- Truth approved: **${fixture.truthApprovedCount ?? 0}**`)
    if (fixture.dominantBlocker) {
      lines.push(`- Dominant blocker: ${fixture.dominantBlocker.bucket} (${fixture.dominantBlocker.count})`)
    }
    if (fixture.globalDelta) {
      lines.push(
        `- Global Δ: wrongOnset ${fixture.globalDelta.wrongOnset ?? 0}, wrongDuration ${fixture.globalDelta.wrongDuration ?? 0}, chord ${fixture.globalDelta.chordMismatch ?? 0}, wrongPitch ${fixture.globalDelta.wrongPitch ?? 0}`,
      )
    }
    if (fixture.runtimeFrozenMatch) {
      const match = Object.values(fixture.runtimeFrozenMatch).every(Boolean)
      lines.push(`- Dense frozen baseline: ${match ? 'MATCH' : 'DRIFT'}`)
    }
    if (fixture.hotspotQualification?.length) {
      lines.push('')
      lines.push('### Hotspot measures')
      lines.push('')
      lines.push('| Measure | Status | Blocker | Variant | Onset Δ |')
      lines.push('|---------|--------|---------|---------|--------:|')
      for (const hotspot of fixture.hotspotQualification) {
        const onsetDelta = hotspot.perMeasureDelta?.wrongOnsetDelta ?? '—'
        lines.push(
          `| m${hotspot.measureNumber} | ${hotspot.status} | ${hotspot.blocker ?? '—'} | ${hotspot.variantId ?? '—'} | ${onsetDelta} |`,
        )
      }
    }
    if (fixture.truthApprovedMeasures?.length) {
      lines.push('')
      lines.push('### Truth-approved measures')
      for (const entry of fixture.truthApprovedMeasures) {
        lines.push(
          `- m${entry.measureNumber}: ${entry.variantId} (soft Δ ${entry.softScoreDelta ?? 'n/a'})`,
        )
      }
    }
    lines.push('')
    lines.push(`> ${fixture.recommendation}`)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}
