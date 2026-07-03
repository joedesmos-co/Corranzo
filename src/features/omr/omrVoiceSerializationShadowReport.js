/**
 * Shadow voice-aware serialization benchmark comparison — runtime vs solver.
 * Diagnostic only; never promotes solver output.
 *
 * @see docs/OMR_V2_ROLLOUT_GATE.md Phase 6
 */

import { buildOmrMusicXml } from './buildOmrMusicXml.js'
import { evaluateOmrAccuracy } from './omrAccuracyEvaluator.js'
import { buildScoreGraph } from './scoreGraph.js'
import { reconstructMeasuresFromScoreGraph } from './scoreGraphEmit.js'
import { hotspotMeasuresForFixture } from './omrHotspotDiagnostics.js'
import { buildRhythmErrorAttribution } from './omrRhythmErrorAttribution.js'
import {
  solveScoreGraphVoiceSerializationShadow,
  summarizeVoiceSerializationShadowDiagnostics,
} from './scoreGraphVoiceSerializationShadow.js'
import {
  findMeasureEntry,
  measurePassesRhythmShadowTruthGate,
} from './omrRhythmShadowMeasureGate.js'

function pagesHaveMeasureEvents(pages = []) {
  for (const page of pages) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        if (Array.isArray(measure.events)) {
          return true
        }
      }
    }
  }
  return false
}

function resolveScoreGraph({ report = {}, scoreGraph = null, pages = [] } = {}) {
  if (scoreGraph?.measures?.length) {
    return scoreGraph
  }
  const stored = report.generatedOmrDiagnostics?.scoreGraphFull
  if (stored?.measures?.length) {
    return stored
  }
  if (pagesHaveMeasureEvents(pages)) {
    return buildScoreGraph(pages)
  }
  return null
}

function extractMetrics(report = {}) {
  return {
    wrongOnset: report.totals?.wrongOnsetCount ?? 0,
    wrongDuration: report.totals?.wrongDurationCount ?? 0,
    chordMismatch: report.totals?.chordMismatchCount ?? 0,
    wrongPitch: report.totals?.wrongPitchCount ?? 0,
    noteCountDiff: report.totals?.noteCountDifference ?? 0,
    measureCountDiff: report.totals?.measureCountDifference ?? 0,
    pitchAccuracy: report.metrics?.pitchAccuracy ?? null,
    durationAccuracy: report.metrics?.durationAccuracy ?? null,
    onsetAccuracy: report.metrics?.onsetAccuracy ?? null,
    chordGroupingAccuracy: report.metrics?.chordGroupingAccuracy ?? null,
    noteDetectionF1: report.metrics?.noteDetectionF1 ?? null,
  }
}

function metricDelta(shadow, runtime) {
  const delta = {}
  for (const key of Object.keys(runtime)) {
    const left = shadow[key]
    const right = runtime[key]
    if (typeof left === 'number' && typeof right === 'number') {
      delta[key] = Math.round((left - right) * 10000) / 10000
    }
  }
  return delta
}

function perMeasureDelta(runtimeReport, shadowReport) {
  const runtimeByMeasure = new Map(
    (runtimeReport.perMeasure ?? []).map((entry) => [entry.measureNumber, entry]),
  )
  const deltas = []
  for (const entry of shadowReport.perMeasure ?? []) {
    const baseline = runtimeByMeasure.get(entry.measureNumber)
    if (!baseline) {
      continue
    }
    deltas.push({
      measureNumber: entry.measureNumber,
      wrongOnsetDelta: (entry.wrongOnsetCount ?? 0) - (baseline.wrongOnsetCount ?? 0),
      wrongDurationDelta: (entry.wrongDurationCount ?? 0) - (baseline.wrongDurationCount ?? 0),
      chordMismatchDelta: (entry.chordMismatchCount ?? 0) - (baseline.chordMismatchCount ?? 0),
      wrongPitchDelta: (entry.wrongPitchCount ?? 0) - (baseline.wrongPitchCount ?? 0),
    })
  }
  return deltas.sort((left, right) => left.measureNumber - right.measureNumber)
}

function summarizeHotspotDelta(perMeasureDeltas, fixtureId) {
  const targets = new Set(hotspotMeasuresForFixture(fixtureId))
  return perMeasureDeltas.filter((entry) => targets.has(entry.measureNumber))
}

function evaluateAccuracyPair({ generatedMusicXml, groundTruthMusicXml, fixtureId, report, label }) {
  return evaluateOmrAccuracy({
    generatedMusicXml,
    groundTruthMusicXml,
    generatedFileName: `${fixtureId ?? 'fixture'}.${label}.xml`,
    groundTruthFileName: 'truth.xml',
    generatedOmrDiagnostics: report.generatedOmrDiagnostics,
    options: { exampleLimit: 99999 },
  })
}

function filterTruthApprovedMeasures({
  structurallyApplied,
  runtimeMeasures,
  musical,
  runtimeXml,
  groundTruthMusicXml,
  report,
  fixtureId,
  title,
}) {
  const runtimeEval = evaluateAccuracyPair({
    generatedMusicXml: runtimeXml,
    groundTruthMusicXml,
    fixtureId,
    report,
    label: 'runtime',
  })
  const approved = []
  const rejectedByTruth = []

  for (const measure of structurallyApplied) {
    const trialMeasures = runtimeMeasures.map((entry) =>
      entry.measureNumber === measure.measureNumber
        ? { ...entry, events: measure.events }
        : entry,
    )
    const trialXml = buildOmrMusicXml({
      title: `${title ?? fixtureId ?? 'shadow'}-trial-m${measure.measureNumber}`,
      measures: trialMeasures,
      musical,
      includeDisclaimer: true,
    })
    const trialEval = evaluateAccuracyPair({
      generatedMusicXml: trialXml,
      groundTruthMusicXml,
      fixtureId,
      report,
      label: `trial-m${measure.measureNumber}`,
    })
    const runtimeMeasure = findMeasureEntry(runtimeEval, measure.measureNumber)
    const trialMeasure = findMeasureEntry(trialEval, measure.measureNumber)
    const gate = measurePassesRhythmShadowTruthGate(runtimeMeasure, trialMeasure)
    if (gate.pass) {
      approved.push({
        ...measure,
        truthGateDelta: gate.delta,
      })
      continue
    }
    rejectedByTruth.push({
      measureNumber: measure.measureNumber,
      variantId: measure.variantId,
      variantLabel: measure.variantLabel,
      coalescedCount: measure.coalescedCount ?? 0,
      rejections: gate.rejections,
      delta: gate.delta,
    })
  }

  return { approved, rejectedByTruth, runtimeEval }
}

function buildShadowMeasuresFromApproval(runtimeMeasures, structurallyApplied, truthApproved) {
  const approvedNumbers = new Set(truthApproved.map((entry) => entry.measureNumber))
  return runtimeMeasures.map((measure) => {
    const solved = structurallyApplied.find(
      (entry) => entry.measureNumber === measure.measureNumber,
    )
    if (solved && approvedNumbers.has(measure.measureNumber)) {
      return { ...measure, events: solved.events }
    }
    return measure
  })
}

function assessShadowStatus(delta, { fixtureId, changedMeasures = 0 } = {}) {
  const chordRegression = (delta.chordMismatch ?? 0) > 0
  const durationRegression = (delta.wrongDuration ?? 0) > 0
  const onsetRegression = (delta.wrongOnset ?? 0) > 0
  const pitchRegression = (delta.wrongPitch ?? 0) > 0

  if (changedMeasures === 0) {
    return 'shadow-no-qualifying-measures'
  }

  if (chordRegression || durationRegression) {
    return 'diagnostic-only-regressed'
  }

  const improved =
    (delta.wrongOnset ?? 0) < 0 ||
    (delta.wrongDuration ?? 0) < 0 ||
    (delta.chordMismatch ?? 0) < 0
  const regressed = onsetRegression || pitchRegression

  const isDenseLike = fixtureId === 'dense'
  if (!isDenseLike) {
    return regressed ? 'diagnostic-only' : improved ? 'shadow-improved' : 'shadow-observed'
  }

  if (improved && !regressed) {
    return 'shadow-improved'
  }
  if (regressed && !improved) {
    return 'diagnostic-only-regressed'
  }
  return 'diagnostic-only-mixed'
}

/**
 * Build runtime vs voice-serialization-shadow comparison when ScoreGraph IR + truth exist.
 */
export function buildVoiceSerializationShadowBenchmarkComparison({
  report = {},
  fixtureId = null,
  groundTruthMusicXml = null,
  runtimeMusicXml = null,
  scoreGraph = null,
  title = null,
} = {}) {
  const pages = report.generatedOmrDiagnostics?.pages ?? []
  const resolvedGraph = resolveScoreGraph({ report, scoreGraph, pages })
  const musical = report.generatedOmrDiagnostics?.musical ?? {}

  if (!resolvedGraph?.measures?.length) {
    return {
      status: 'shadow-only-no-scoregraph',
      reason:
        'ScoreGraph IR measures missing — re-run live dashboard with includeScoreGraph or pass scoreGraphFull.',
      engine: 'v2-voice-serialization-shadow',
      promoted: false,
      fixtureId,
      hotspotMeasures: hotspotMeasuresForFixture(fixtureId),
      runtime: groundTruthMusicXml ? null : extractMetrics(report),
    }
  }

  const runtimeMeasures = reconstructMeasuresFromScoreGraph(resolvedGraph)
  const voiceSolved = solveScoreGraphVoiceSerializationShadow(resolvedGraph)
  const structurallyApplied = voiceSolved.measures.filter((measure) => measure.applied)

  const runtimeXml =
    runtimeMusicXml ??
    buildOmrMusicXml({
      title: title ?? report.summary?.generatedTitle ?? fixtureId ?? 'runtime',
      measures: runtimeMeasures,
      musical,
      includeDisclaimer: true,
    })

  let truthApproved = structurallyApplied
  let rejectedByTruth = []
  let runtimeEvalCached = null

  if (groundTruthMusicXml && structurallyApplied.length) {
    const filtered = filterTruthApprovedMeasures({
      structurallyApplied,
      runtimeMeasures,
      musical,
      runtimeXml,
      groundTruthMusicXml,
      report,
      fixtureId,
      title,
    })
    truthApproved = filtered.approved
    rejectedByTruth = filtered.rejectedByTruth
    runtimeEvalCached = filtered.runtimeEval
  } else if (groundTruthMusicXml) {
    truthApproved = []
  }

  const appliedMeasureCount = truthApproved.length
  const shadowMeasures = buildShadowMeasuresFromApproval(
    runtimeMeasures,
    structurallyApplied,
    truthApproved,
  )

  const shadowXml =
    appliedMeasureCount > 0
      ? buildOmrMusicXml({
          title: `${title ?? fixtureId ?? 'shadow'}-voice-serialization`,
          measures: shadowMeasures,
          musical,
          includeDisclaimer: true,
        })
      : runtimeXml

  const solverDiagnostics = summarizeVoiceSerializationShadowDiagnostics(voiceSolved.measures)
  const changedMeasures = truthApproved.map((measure) => ({
    measureNumber: measure.measureNumber,
    variantId: measure.variantId,
    variantLabel: measure.variantLabel,
    softScoreDelta: measure.softScoreDelta,
    familyReasons: measure.family?.reasons ?? [],
    coalescedCount: measure.coalescedCount ?? 0,
    truthGateDelta: measure.truthGateDelta ?? null,
    target: measure.acceptedVariant?.target ?? null,
  }))
  const structuralAppliedMeasures = structurallyApplied.map((measure) => ({
    measureNumber: measure.measureNumber,
    variantId: measure.variantId,
    variantLabel: measure.variantLabel,
    softScoreDelta: measure.softScoreDelta,
    familyReasons: measure.family?.reasons ?? [],
    coalescedCount: measure.coalescedCount ?? 0,
    target: measure.acceptedVariant?.target ?? null,
    durationCoupled: Boolean(measure.durationCoupled),
    durationCoupling: measure.durationCoupling ?? null,
    decision: measure.decision ?? null,
  }))
  const acceptedCandidateMeasures = changedMeasures
  const rejectedCandidateMeasures = [
    ...solverDiagnostics.rejectedCandidateMeasures,
    ...rejectedByTruth.map((entry) => ({
      measureNumber: entry.measureNumber,
      rejectReason: entry.rejections?.[0] ?? 'truth-gate-failed',
      bestVariantId: entry.variantId ?? null,
      familyReasons: [],
      rejectedVariants: [
        {
          variantId: entry.variantId,
          variantLabel: entry.variantLabel,
          rejectReason: entry.rejections?.join('+') ?? 'truth-gate-failed',
          violations: entry.rejections ?? [],
          coalescedCount: entry.coalescedCount ?? 0,
        },
      ],
      truthGateDelta: entry.delta ?? null,
    })),
  ]
  const rejectedMeasures = voiceSolved.measures
    .filter((measure) => measure.rejected && measure.family?.isCandidate)
    .map((measure) => ({
      measureNumber: measure.measureNumber,
      rejectReason: measure.rejectReason,
      bestVariantId: measure.bestVariantId ?? null,
      familyReasons: measure.family?.reasons ?? [],
      rejectedVariants: measure.rejectedVariants ?? [],
    }))

  const base = {
    engine: 'v2-voice-serialization-shadow',
    constraintVersion: solverDiagnostics.constraintVersion ?? 'phase-6-voice-lane',
    promoted: false,
    fixtureId,
    solverDiagnostics,
    structurallyAppliedCount: structurallyApplied.length,
    structuralAppliedMeasures,
    changedMeasures,
    acceptedCandidateMeasures,
    rejectedCandidateMeasures,
    rejectedMeasures,
    rejectedByTruth,
    coalescedChords: solverDiagnostics.coalescedChordLog ?? [],
    coalescedChordCount: solverDiagnostics.coalescedChordCount ?? 0,
    hotspotMeasures: hotspotMeasuresForFixture(fixtureId),
    runtimeXmlBytes: runtimeXml.length,
    shadowXmlBytes: shadowXml.length,
    identicalToRuntime: runtimeXml === shadowXml,
    scoreGraphSource: scoreGraph
      ? 'passed'
      : report.generatedOmrDiagnostics?.scoreGraphFull
        ? 'report-scoreGraphFull'
        : pagesHaveMeasureEvents(pages)
          ? 'pages-with-events'
          : 'unknown',
  }

  if (!groundTruthMusicXml) {
    return {
      ...base,
      status: 'shadow-only-no-truth',
      runtime: null,
      shadow: null,
      delta: null,
    }
  }

  const runtimeEval =
    runtimeEvalCached ??
    evaluateAccuracyPair({
      generatedMusicXml: runtimeXml,
      groundTruthMusicXml,
      fixtureId,
      report,
      label: 'runtime',
    })
  const shadowEval = evaluateAccuracyPair({
    generatedMusicXml: shadowXml,
    groundTruthMusicXml,
    fixtureId,
    report,
    label: 'shadow',
  })

  const runtimeMetrics = extractMetrics(runtimeEval)
  const shadowMetrics = extractMetrics(shadowEval)
  const delta = metricDelta(shadowMetrics, runtimeMetrics)
  const measureDeltas = perMeasureDelta(runtimeEval, shadowEval)
  const hotspotDelta = summarizeHotspotDelta(measureDeltas, fixtureId)
  const status = assessShadowStatus(delta, {
    fixtureId,
    changedMeasures: appliedMeasureCount,
  })

  const regressionReason =
    status === 'diagnostic-only-regressed'
      ? 'Shadow voice serialization solver regressed chord and/or duration — kept diagnostic-only.'
      : status === 'diagnostic-only-mixed'
        ? 'Shadow solver mixed wins/losses — not ready for promotion.'
        : status === 'shadow-no-qualifying-measures'
          ? 'No measures passed Phase 6 preservation + truth gates — shadow identical to runtime.'
          : null

  return {
    ...base,
    status,
    regressionReason,
    runtime: runtimeMetrics,
    shadow: shadowMetrics,
    delta,
    perMeasureDelta: measureDeltas,
    hotspotDelta,
    runtimeAttribution: buildRhythmErrorAttribution(runtimeEval),
    shadowAttribution: buildRhythmErrorAttribution(shadowEval),
  }
}

export function formatVoiceSerializationShadowMarkdown(comparison) {
  if (!comparison || comparison.status === 'unavailable') {
    return ''
  }
  const lines = ['', '### Voice serialization shadow (V2 Phase 7 — diagnostic only)', '']
  lines.push(`- Status: **${comparison.status}**`)
  lines.push(`- Promoted: **no**`)
  if (comparison.constraintVersion) {
    lines.push(`- Constraints: **${comparison.constraintVersion}**`)
  }
  if (comparison.reason) {
    lines.push(`- Note: ${comparison.reason}`)
  }
  if (comparison.regressionReason) {
    lines.push(`- Note: ${comparison.regressionReason}`)
  }
  lines.push(
    `- Solver: ${comparison.solverDiagnostics?.changedMeasures ?? 0} structurally applied (${comparison.solverDiagnostics?.durationCoupledAppliedCount ?? 0} duration-coupled) / ${comparison.acceptedCandidateMeasures?.length ?? 0} truth-approved / ${comparison.solverDiagnostics?.candidateMeasures ?? 0} candidates`,
  )
  if (comparison.coalescedChordCount) {
    lines.push(`- Coalesced chords: ${comparison.coalescedChordCount}`)
  }
  if (comparison.identicalToRuntime || comparison.status === 'shadow-no-qualifying-measures') {
    lines.push('- Shadow XML identical to runtime (no qualifying measures)')
  }
  if (comparison.runtime && comparison.shadow) {
    lines.push(
      `- Runtime vs shadow: wrongOnset ${comparison.runtime.wrongOnset} → ${comparison.shadow.wrongOnset} (Δ ${comparison.delta.wrongOnset}), wrongDuration ${comparison.runtime.wrongDuration} → ${comparison.shadow.wrongDuration} (Δ ${comparison.delta.wrongDuration}), chord ${comparison.runtime.chordMismatch} → ${comparison.shadow.chordMismatch} (Δ ${comparison.delta.chordMismatch})`,
    )
  }
  if (comparison.acceptedCandidateMeasures?.length) {
    const preview = comparison.acceptedCandidateMeasures
      .slice(0, 12)
      .map((entry) => `m${entry.measureNumber}:${entry.variantId}`)
      .join(', ')
    lines.push(
      `- Accepted measures: ${preview}${comparison.acceptedCandidateMeasures.length > 12 ? '…' : ''}`,
    )
  }
  if (comparison.rejectedCandidateMeasures?.length) {
    const preview = comparison.rejectedCandidateMeasures
      .slice(0, 8)
      .map((entry) => `m${entry.measureNumber}:${entry.rejectReason ?? 'rejected'}`)
      .join(', ')
    lines.push(
      `- Rejected measures: ${preview}${comparison.rejectedCandidateMeasures.length > 8 ? '…' : ''}`,
    )
  }
  if (comparison.hotspotDelta?.length) {
    const preview = comparison.hotspotDelta
      .map(
        (entry) =>
          `m${entry.measureNumber}(onsetΔ${entry.wrongOnsetDelta},durΔ${entry.wrongDurationDelta},chordΔ${entry.chordMismatchDelta})`,
      )
      .join(', ')
    lines.push(`- Hotspot deltas: ${preview}`)
  }
  return `${lines.join('\n')}\n`
}
