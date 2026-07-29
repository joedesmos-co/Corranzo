/**
 * Developer helpers for copying OMR diagnostic bundles and managing trace flags.
 */

import {
  formatOmrDiagnosticHelp,
  getOmrDiagnosticFlags,
  setOmrDiagnosticFlag,
  OMR_DIAGNOSTIC_FLAG,
} from './omrDiagnosticFlags.js'
import { groupAccuracyReportErrors } from './omrDiagnosticGrouping.js'

function compactDiagnostics(diagnostics = {}) {
  if (!diagnostics || typeof diagnostics !== 'object') {
    return null
  }
  return {
    pages: diagnostics.pages ?? null,
    pagesWithSystems: diagnostics.pagesWithSystems ?? null,
    systems: diagnostics.systems ?? null,
    measures: diagnostics.measures ?? null,
    overallConfidence: diagnostics.overallConfidence ?? null,
    uncertainMeasures: diagnostics.uncertainMeasures ?? null,
    difficulty: diagnostics.difficulty ?? null,
    failureReasons: diagnostics.failureReasons ?? [],
    warnings: diagnostics.warnings ?? [],
    noteMatching: diagnostics.noteMatching ?? null,
    orphanNoteheads: diagnostics.orphanNoteheads ?? null,
    omrV3Confidence: diagnostics.omrV3Confidence
      ? {
          method: diagnostics.omrV3Confidence.method ?? null,
          overallConfidence: diagnostics.omrV3Confidence.overallConfidence ?? null,
          legacyConfidence: diagnostics.omrV3Confidence.legacyConfidence ?? null,
          structuralConfidence: diagnostics.omrV3Confidence.structuralConfidence ?? null,
        }
      : null,
    omrV3Comparison: diagnostics.omrV3Comparison
      ? {
          status: diagnostics.omrV3Comparison.status ?? null,
          disagreement: diagnostics.omrV3Comparison.disagreement ?? null,
          measures: diagnostics.omrV3Comparison.measures ?? null,
          notes: diagnostics.omrV3Comparison.notes ?? null,
          rhythm: diagnostics.omrV3Comparison.rhythm ?? null,
          chords: diagnostics.omrV3Comparison.chords ?? null,
          pitch: diagnostics.omrV3Comparison.pitch ?? null,
          confidence: diagnostics.omrV3Comparison.confidence ?? null,
        }
      : null,
    omrV3DeveloperDiagnostics: diagnostics.omrV3DeveloperDiagnostics
      ? {
          preferredEngine: diagnostics.omrV3DeveloperDiagnostics.preferredEngine ?? null,
          timing: diagnostics.omrV3DeveloperDiagnostics.timing ?? null,
          recognition: diagnostics.omrV3DeveloperDiagnostics.recognition ?? null,
          disagreementTelemetry:
            diagnostics.omrV3DeveloperDiagnostics.disagreementTelemetry ?? null,
        }
      : null,
    omrV3RuntimePromotion: diagnostics.omrV3RuntimePromotion
      ? {
          decision: diagnostics.omrV3RuntimePromotion.decision ?? null,
          comparisonMode: diagnostics.omrV3RuntimePromotion.comparisonMode ?? null,
          disagreement: diagnostics.omrV3RuntimePromotion.disagreement ?? null,
          latencyMs: diagnostics.omrV3RuntimePromotion.latencyMs ?? null,
          promotedToRuntime: diagnostics.omrV3RuntimePromotion.promotedToRuntime ?? false,
        }
      : null,
    performance: diagnostics.performance
      ? {
          totalMs: diagnostics.performance.totalMs ?? null,
          phases: Array.isArray(diagnostics.performance.phases)
            ? diagnostics.performance.phases.map((phase) => ({
                phase: phase.phase,
                ms: phase.ms,
              }))
            : [],
        }
      : null,
    scoreGraph: diagnostics.scoreGraph
      ? {
          totalNodes: diagnostics.scoreGraph.totalNodes ?? null,
          totalEdges: diagnostics.scoreGraph.totalEdges ?? null,
          measureCount: diagnostics.scoreGraph.measureCount ?? null,
        }
      : null,
    preprocessLog: diagnostics.preprocessLog ?? null,
    layoutConsistency: diagnostics.layoutConsistency ?? null,
    rhythmProvenance: diagnostics.rhythmProvenance
      ? {
          version: diagnostics.rhythmProvenance.version ?? 1,
          noteDurationCount: diagnostics.rhythmProvenance.noteDurationCount ?? 0,
          dotCandidateCount: diagnostics.rhythmProvenance.dotCandidateCount ?? 0,
          beamCandidateCount: diagnostics.rhythmProvenance.beamCandidateCount ?? 0,
          beamDurationOverwrittenLater:
            diagnostics.rhythmProvenance.beamDurationOverwrittenLater ?? 0,
          chordCoalesceOverrides:
            diagnostics.rhythmProvenance.chordCoalesceOverrides ?? 0,
          unassignedDots: diagnostics.rhythmProvenance.unassignedDots ?? 0,
          rejectedBeams: diagnostics.rhythmProvenance.rejectedBeams ?? 0,
          noteDurations: diagnostics.rhythmProvenance.noteDurations ?? [],
          dotCandidates: diagnostics.rhythmProvenance.dotCandidates ?? [],
          beamCandidates: diagnostics.rhythmProvenance.beamCandidates ?? [],
        }
      : null,
  }
}

export function buildOmrDiagnosticExport({
  diagnostics = null,
  accuracyReport = null,
  runMeta = null,
} = {}) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    flags: getOmrDiagnosticFlags(),
    run: runMeta,
    diagnostics: compactDiagnostics(diagnostics),
  }
  if (accuracyReport) {
    payload.accuracy = {
      summary: accuracyReport.summary ?? null,
      metrics: accuracyReport.metrics ?? null,
      totals: accuracyReport.totals ?? null,
      errorGrouping: groupAccuracyReportErrors(accuracyReport),
    }
  }
  return payload
}

/**
 * Structured DEV provenance package for the active score (duration/dot/beam).
 * Empty when provenance was disabled during the OMR run.
 */
export function buildOmrProvenancePackage({
  diagnostics = null,
  runMeta = null,
  activeScore = null,
} = {}) {
  const provenance = diagnostics?.rhythmProvenance ?? null
  return {
    version: 1,
    kind: 'omr-rhythm-provenance',
    exportedAt: new Date().toISOString(),
    flags: getOmrDiagnosticFlags(),
    run: runMeta,
    activeScore: activeScore
      ? {
          scoreId: activeScore.scoreId ?? null,
          generation: activeScore.generation ?? null,
          musicXmlSourceType: activeScore.musicXml?.sourceType ?? null,
          noteCount: activeScore.musicXml?.omrMeta?.noteCount ?? null,
          measureCount: activeScore.musicXml?.omrMeta?.measureCount ?? null,
          pdfFileName: activeScore.musicXml?.omrMeta?.pdfFileName ?? null,
        }
      : null,
    provenance: provenance ?? {
      enabled: false,
      noteDurations: [],
      dotCandidates: [],
      beamCandidates: [],
      hint: 'Enable DEV Provenance before OMR (scoreflow:omr-provenance=1), then re-run.',
    },
  }
}

export function serializeOmrDiagnosticExport(bundle) {
  return JSON.stringify(bundle, null, 2)
}

export async function copyOmrDiagnosticExport(bundle) {
  const text = serializeOmrDiagnosticExport(bundle)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return { ok: true, bytes: text.length }
  }
  return { ok: false, text, bytes: text.length }
}

export function downloadOmrProvenancePackage(bundle, fileName = null) {
  const text = serializeOmrDiagnosticExport(bundle)
  const resolvedName =
    fileName ||
    `omr-provenance-${bundle?.activeScore?.scoreId ?? 'score'}-${Date.now()}.json`
  if (typeof document === 'undefined') {
    return { ok: false, text, fileName: resolvedName, bytes: text.length }
  }
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = resolvedName
  anchor.click()
  URL.revokeObjectURL(url)
  return { ok: true, fileName: resolvedName, bytes: text.length }
}

export function toggleOmrTrace(enabled) {
  return setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, enabled)
}

export function toggleOmrDebug(enabled) {
  return setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, enabled)
}

export function toggleOmrProvenance(enabled) {
  return setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, enabled)
}

export function toggleOmrV3Compare(enabled) {
  return setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.V3_COMPARE, enabled)
}

export function toggleOmrV3Prefer(enabled) {
  return setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.V3_PREFER, enabled)
}

export function describeOmrDevTools() {
  return formatOmrDiagnosticHelp()
}
