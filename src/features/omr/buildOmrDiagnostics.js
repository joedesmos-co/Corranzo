import { OMR_DISCLAIMER } from './omrMusicalConstants.js'

function average(values) {
  if (!values.length) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Aggregate OMR confidence for pages, systems, and measures.
 */
export function buildOmrDiagnostics({
  pages = [],
  musical = {},
  uncertainMeasures = 0,
  totalMeasures = 0,
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
      })),
    })),
  }))

  const allMeasureConfidence = pageSummaries.flatMap((page) =>
    page.systems.flatMap((system) => system.measures.map((measure) => measure.confidence)),
  )

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
