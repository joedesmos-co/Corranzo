/**
 * Per-system measure grid diagnostics for OMR pipeline reports.
 */

export function summarizeOmrMeasureGridDiagnostics(entries = []) {
  if (!entries.length) {
    return null
  }
  const totals = {
    systemCount: entries.length,
    measureCount: 0,
    barlineCount: 0,
    mergedNarrowSpans: 0,
    mergedTrailingSpans: 0,
    collapsedPairs: 0,
    suspiciousShortMeasures: 0,
    unreliableSystems: 0,
  }
  for (const entry of entries) {
    totals.measureCount += entry.finalMeasureCount ?? 0
    totals.barlineCount += entry.barlineCount ?? 0
    totals.mergedNarrowSpans += entry.mergedNarrowSpans ?? 0
    totals.mergedTrailingSpans += entry.mergedTrailingSpans ?? 0
    totals.collapsedPairs += entry.collapsedPairs ?? 0
    totals.suspiciousShortMeasures += entry.suspiciousShortMeasures ?? 0
    if (!entry.reliabilityConfident) {
      totals.unreliableSystems += 1
    }
  }
  return totals
}

export function formatOmrMeasureGridDiagnosticsReport(entries = []) {
  if (!entries.length) {
    return 'OMR measure grid diagnostics: none'
  }
  const lines = ['OMR measure grid diagnostics']
  const totals = summarizeOmrMeasureGridDiagnostics(entries)
  lines.push(
    `Systems: ${totals.systemCount}, measures: ${totals.measureCount}, barlines: ${totals.barlineCount}`,
  )
  lines.push(
    `Consolidation: merged-narrow=${totals.mergedNarrowSpans}, merged-trailing=${totals.mergedTrailingSpans}, collapsed-pairs=${totals.collapsedPairs}, suspicious-short=${totals.suspiciousShortMeasures}, unreliable-systems=${totals.unreliableSystems}`,
  )
  lines.push('Per system:')
  for (const entry of entries) {
    const widths = entry.spanWidthPercents?.length
      ? entry.spanWidthPercents.join(',')
      : 'n/a'
    lines.push(
      `  p${entry.page} s${entry.systemIndex + 1}: barlines=${entry.barlineCount}, measures ${entry.initialMeasureCount}→${entry.finalMeasureCount}, rel=${entry.reliabilityReason}, widths%=[${widths}]` +
        (entry.barlineRejectedSummary ? `, rejected=${entry.barlineRejectedSummary}` : '') +
        (entry.mergedNarrowSpans ? `, merged=${entry.mergedNarrowSpans}` : '') +
        (entry.mergedTrailingSpans ? `, trailing=${entry.mergedTrailingSpans}` : '') +
        (entry.collapsedPairs ? `, collapsed=${entry.collapsedPairs}` : '') +
        (entry.suspiciousShortMeasures ? `, short=${entry.suspiciousShortMeasures}` : ''),
    )
  }
  return lines.join('\n')
}
