/**
 * README.txt for recognition problem ZIP packages.
 */

export function buildRecognitionReportReadme({
  includeOriginalPdf = false,
  categoryLabel = 'Other',
  exportedAt = null,
} = {}) {
  const lines = [
    'Corranzo recognition problem report',
    '===================================',
    '',
    `Exported: ${exportedAt ?? new Date().toISOString()}`,
    `Problem category: ${categoryLabel}`,
    '',
    'This ZIP helps diagnose recognition or playback issues for one active score.',
    'It is a local export only — nothing is uploaded automatically.',
    '',
    'Contents',
    '--------',
    '- report.json            Structured report metadata (no PDF bytes by default)',
    '- provenance.json       Duration / dot / beam provenance when available',
    '- generated-summary.json Compact structural summary of generated timing',
    '- README.txt            This file',
  ]
  if (includeOriginalPdf) {
    lines.push('- original-score.pdf    Original PDF (explicitly included by you)')
  }
  lines.push(
    '',
    'Privacy',
    '-------',
    'The original PDF is not included unless you explicitly choose to include it.',
    'Full MusicXML, screenshots, account data, file-system paths, and unrelated',
    'browser storage are not included.',
    '',
    includeOriginalPdf
      ? 'This package includes the original PDF because you confirmed inclusion.'
      : 'This package does not include the original PDF.',
    '',
  )
  return lines.join('\n')
}
