/**
 * Next-gen automatic score alignment — Phase 1: exportable alignment report.
 *
 * Composes a reconciliation result + layout-confidence grade into a single
 * structured, exportable report (Objective 4):
 *   - per-system confidence table (detected barlines vs expected measures)
 *   - detected barline count vs expected measure count
 *   - warnings for weak pages/systems and structural reconciliation issues
 *   - the recommended follow action (auto / confirm / manual)
 *
 * `buildAlignmentReport` returns a plain object; `formatAlignmentReportText`
 * renders a fixed-width table for CLIs/diagnostics; `serializeAlignmentReport`
 * returns pretty JSON. All pure.
 */
import { LAYOUT_CONFIDENCE_LABEL } from './layoutAssessment.js'
import { decideFollowAction, FOLLOW_ACTION_LABEL } from './alignmentConfidencePolicy.js'

export const ALIGNMENT_REPORT_VERSION = 1

function collectWarnings(reconciliation) {
  const warnings = []
  const flags = reconciliation?.flags ?? {}
  const totals = reconciliation?.totals ?? {}

  if (flags.barlineTotalMismatch) {
    warnings.push(
      `Detected ${totals.detectedBarlineTotal} barlines but the score has ${totals.expectedMeasureCount} measures.`,
    )
  }
  for (const index of flags.weakSystems ?? []) {
    const system = reconciliation.perSystem?.[index]
    warnings.push(
      `System ${index + 1} is weak (confidence ${fmt(system?.confidence)}; ` +
        `detected ${system?.detectedBarlines ?? '—'} vs expected ${system?.expectedMeasures ?? '—'}).`,
    )
  }
  if (flags.systemCountMismatch) {
    warnings.push('Number of detected systems differs from the score layout.')
  }
  if (flags.pageCountMismatch) {
    warnings.push('PDF page count differs from the score layout.')
  }
  if (flags.hasPickup) {
    warnings.push('Score begins with a pickup (anacrusis) measure — verify measure 1 alignment.')
  }
  if (flags.hasRepeats) {
    warnings.push(
      `Score contains repeats/voltas (performed ≈ ${fmt(flags.repeatExpansionRatio)}× written) — ` +
        'the cursor revisits written measures; per-measure anchors stay valid.',
    )
  }
  if (flags.timeSignatureChangeCount > 0) {
    warnings.push(`${flags.timeSignatureChangeCount} time-signature change(s) in the score.`)
  }
  if (flags.tempoChangeCount > 0) {
    warnings.push(`${flags.tempoChangeCount} tempo change(s) in the score.`)
  }
  return warnings
}

/**
 * @param {object} params
 * @param {object} params.reconciliation       result of reconcilePdfLayoutWithScore
 * @param {object} [params.timingMap]           parsed timing map (for title)
 * @param {string|null} [params.layoutConfidence] LAYOUT_CONFIDENCE.*
 * @param {string|null} [params.pieceId]
 * @param {string} [params.generatedAt]         ISO timestamp (injectable for tests)
 */
export function buildAlignmentReport({
  reconciliation,
  timingMap = null,
  layoutConfidence = null,
  pieceId = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const decision = decideFollowAction({ layoutConfidence, reconciliation })
  return {
    version: ALIGNMENT_REPORT_VERSION,
    pieceId,
    title: timingMap?.title ?? null,
    generatedAt,
    layoutConfidence,
    layoutConfidenceLabel: layoutConfidence ? LAYOUT_CONFIDENCE_LABEL[layoutConfidence] ?? null : null,
    decision: {
      ...decision,
      label: FOLLOW_ACTION_LABEL[decision.action] ?? decision.action,
    },
    totals: reconciliation?.totals ?? null,
    flags: reconciliation?.flags ?? null,
    perSystem: reconciliation?.perSystem ?? [],
    warnings: collectWarnings(reconciliation),
  }
}

export function serializeAlignmentReport(report) {
  return JSON.stringify(report, null, 2)
}

function fmt(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—'
}

function pad(value, width) {
  const str = String(value)
  return str.length >= width ? str : str + ' '.repeat(width - str.length)
}

/** Fixed-width, human-readable rendering for diagnostics / exported reports. */
export function formatAlignmentReportText(report) {
  const lines = []
  lines.push(`Alignment report${report.title ? ` — ${report.title}` : ''}`)
  if (report.pieceId) {
    lines.push(`Piece: ${report.pieceId}`)
  }
  if (report.layoutConfidenceLabel) {
    lines.push(`Layout confidence: ${report.layoutConfidenceLabel}`)
  }
  lines.push(`Recommended action: ${report.decision.label}`)
  for (const reason of report.decision.reasons ?? []) {
    lines.push(`  · ${reason}`)
  }

  const totals = report.totals ?? {}
  lines.push('')
  lines.push(
    `Measures: ${totals.expectedMeasureCount ?? '—'} | ` +
      `Detected barlines: ${totals.detectedBarlineTotal ?? '—'} | ` +
      `Systems: ${totals.systemCount ?? '—'} | ` +
      `Mean conf: ${fmt(totals.meanConfidence)} | Min conf: ${fmt(totals.minConfidence)}`,
  )

  lines.push('')
  lines.push(
    `${pad('System', 8)}${pad('Page', 6)}${pad('Detected', 10)}${pad('Expected', 10)}${pad('Δ', 5)}${pad('Conf', 7)}`,
  )
  lines.push('-'.repeat(46))
  for (const system of report.perSystem ?? []) {
    lines.push(
      pad(system.systemIndex + 1, 8) +
        pad(system.page ?? '—', 6) +
        pad(system.detectedBarlines ?? '—', 10) +
        pad(system.expectedMeasures ?? '—', 10) +
        pad(system.delta ?? '—', 5) +
        pad(fmt(system.confidence) + (system.weak ? ' !' : ''), 7),
    )
  }

  if ((report.warnings ?? []).length) {
    lines.push('')
    lines.push('Warnings:')
    for (const warning of report.warnings) {
      lines.push(`  ! ${warning}`)
    }
  }

  return lines.join('\n')
}
