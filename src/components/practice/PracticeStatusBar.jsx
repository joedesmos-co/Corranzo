import { ALIGNMENT_ASSESSMENT } from '../../features/practice/computeAlignmentDiagnostics.js'

function StatusItem({ label, loaded, fileName, hint }) {
  return (
    <div className={`practice-status__item${loaded ? ' practice-status__item--ok' : ''}`}>
      <span className="practice-status__label">{label}</span>
      {hint && <span className="practice-status__hint">{hint}</span>}
      <span className="practice-status__value">
        {loaded ? fileName || 'Loaded' : 'Not loaded'}
      </span>
    </div>
  )
}

function alignmentShortLabel(diagnostics, isLoading) {
  if (isLoading) {
    return 'Checking…'
  }
  if (!diagnostics) {
    return '—'
  }
  if (diagnostics.assessment === ALIGNMENT_ASSESSMENT.LIKELY_MATCH) {
    return 'Sound and timing files likely match'
  }
  if (diagnostics.assessment === ALIGNMENT_ASSESSMENT.UNLIKELY_MATCH) {
    return 'Sound and timing files may not match'
  }
  return 'Could not verify file match'
}

export default function PracticeStatusBar({
  pdfFileName,
  hasMidi,
  hasMusicXml,
  playbackFileName,
  timingFileName,
  alignmentDiagnostics,
  isAlignmentLoading,
  showPdf = true,
  showAlignment = false,
}) {
  const showAlignmentRow = showAlignment && hasMidi && hasMusicXml

  return (
    <div className="practice-status" role="status" aria-label="File details">
      <h3 className="practice-status__heading">Loaded files (detail)</h3>
      <div className="practice-status__grid">
        {showPdf && (
          <StatusItem label="PDF score" loaded={Boolean(pdfFileName)} fileName={pdfFileName} />
        )}
        <StatusItem
          label="Sound file"
          loaded={hasMidi}
          fileName={playbackFileName}
          hint="Optional backing audio"
        />
        <StatusItem
          label="Score timing"
          loaded={hasMusicXml}
          fileName={timingFileName}
          hint="Measure & beat intelligence"
        />
        {showAlignmentRow && (
          <div className="practice-status__item practice-status__item--alignment">
            <span className="practice-status__label">Sound vs timing</span>
            <span className="practice-status__value">
              {alignmentShortLabel(alignmentDiagnostics, isAlignmentLoading)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
