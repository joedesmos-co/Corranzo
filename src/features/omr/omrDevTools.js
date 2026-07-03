/**
 * Developer helpers for copying OMR diagnostic bundles and managing trace flags.
 */

import { formatOmrDiagnosticHelp, getOmrDiagnosticFlags, setOmrDiagnosticFlag, OMR_DIAGNOSTIC_FLAG } from './omrDiagnosticFlags.js'
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
    scoreGraph: diagnostics.scoreGraph
      ? {
          totalNodes: diagnostics.scoreGraph.totalNodes ?? null,
          totalEdges: diagnostics.scoreGraph.totalEdges ?? null,
          measureCount: diagnostics.scoreGraph.measureCount ?? null,
        }
      : null,
    preprocessLog: diagnostics.preprocessLog ?? null,
    layoutConsistency: diagnostics.layoutConsistency ?? null,
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

export function toggleOmrTrace(enabled) {
  return setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, enabled)
}

export function toggleOmrDebug(enabled) {
  return setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, enabled)
}

export function describeOmrDevTools() {
  return formatOmrDiagnosticHelp()
}
