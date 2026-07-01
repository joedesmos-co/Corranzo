import { OMR_DISCLAIMER } from './omrMusicalConstants.js'
import { aggregateBeamStemDiagnostics } from './beamStemReconstructionDiagnostics.js'
import {
  buildScoreGraph,
  summarizeScoreGraph,
  buildRuntimeVsScoreGraphReport,
} from './scoreGraph.js'

function average(values) {
  if (!values.length) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function mergeReasonCounts(target, source = {}) {
  for (const [reason, count] of Object.entries(source)) {
    target[reason] = (target[reason] ?? 0) + count
  }
}

function summarizeMusicalEventReconstruction(pages = []) {
  const summary = {
    adjustedEventCount: 0,
    adjustedNoteCount: 0,
    reasons: {},
  }
  for (const page of pages) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        const diagnostics = measure.musicalEventReconstructionDiagnostics
        if (!diagnostics) {
          continue
        }
        summary.adjustedEventCount += diagnostics.adjustedEventCount ?? 0
        summary.adjustedNoteCount += diagnostics.adjustedNoteCount ?? 0
        mergeReasonCounts(summary.reasons, diagnostics.reasons)
      }
    }
  }
  summary.reasons = Object.fromEntries(Object.entries(summary.reasons).sort())
  return summary
}

/**
 * Aggregate OMR confidence for pages, systems, and measures.
 */
export function buildOmrDiagnostics({
  pages = [],
  musical = {},
  uncertainMeasures = 0,
  totalMeasures = 0,
  includeScoreGraph = false,
} = {}) {
  const pageSummaries = pages.map((page) => ({
    page: page.page,
    confidence: average(page.systems?.map((system) => system.confidence) ?? []),
    systems: (page.systems ?? []).map((system) => ({
      systemIndex: system.systemIndex,
      confidence: system.confidence,
      measureCount: system.measures?.length ?? 0,
      measures: (system.measures ?? []).map((measure) => ({
        measureNumber: measure.measureNumber,
        confidence: measure.confidence,
        uncertain: Boolean(measure.uncertain),
        detectedNoteheads: measure.vectorNoteCount ?? measure.vectorNoteMatching?.detectedNoteheads ?? 0,
        emittedNoteheads: measure.vectorNoteMatching?.emittedNoteheads ?? 0,
        dedupedDuringGrouping: measure.vectorNoteMatching?.dedupedDuringGrouping ?? 0,
        musicalEventReconstruction: measure.musicalEventReconstructionDiagnostics ?? {
          adjustedEventCount: 0,
          adjustedNoteCount: 0,
          reasons: {},
        },
        beamStem: measure.beamStemDiagnostics ?? null,
      })),
    })),
  }))

  const allMeasureConfidence = pageSummaries.flatMap((page) =>
    page.systems.flatMap((system) => system.measures.map((measure) => measure.confidence)),
  )

  // ScoreGraph IR — observation only (Phase 1). Built from the same pages the
  // rest of this function reads; does not affect MusicXML or existing metrics.
  const scoreGraph = buildScoreGraph(pages)
  const scoreGraphSummary = summarizeScoreGraph(scoreGraph)
  const runtimeVsScoreGraph = buildRuntimeVsScoreGraphReport(pages, scoreGraph)

  const overallConfidence = average(allMeasureConfidence)
  const warnings = [OMR_DISCLAIMER]
  if (uncertainMeasures > 0) {
    warnings.push(`${uncertainMeasures} measure(s) have uncertain rhythm.`)
  }
  if (musical.tempo?.fromDefault) {
    warnings.push(`Tempo defaulted to ${musical.tempo.bpm} BPM.`)
  }

  return {
    pages: pageSummaries,
    overallConfidence,
    uncertainMeasures,
    totalMeasures,
    musical,
    musicalEventReconstruction: summarizeMusicalEventReconstruction(pages),
    beamStemReconstruction: aggregateBeamStemDiagnostics(pages),
    scoreGraph: scoreGraphSummary,
    runtimeVsScoreGraph,
    // Full IR is heavy (thousands of nodes on dense scores) and dev/shadow-only.
    // Off by default so runtime diagnostics stay lean and unchanged.
    ...(includeScoreGraph ? { scoreGraphFull: scoreGraph } : {}),
    warnings,
    disclaimer: OMR_DISCLAIMER,
  }
}

export function measureConfidenceFromRhythm(rhythm, pitchNotes = []) {
  const rhythmScore = rhythm.uncertain ? 0.55 : 0.82
  const pitchScore = pitchNotes.length
    ? average(pitchNotes.map((note) => note.pitchConfidence ?? 0.65))
    : 0.5
  return Math.min(0.95, rhythmScore * 0.55 + pitchScore * 0.45)
}

export function systemConfidenceFromMeasures(measures) {
  return average(measures.map((measure) => measure.confidence ?? 0.6))
}
