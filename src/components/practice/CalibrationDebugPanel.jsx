import {
  buildCalibrationExportReport,
  downloadCalibrationReport,
} from '../../features/score-follow/calibrationDebug.js'

function formatConfidence(value) {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

function Metric({ label, value }) {
  return (
    <div className="calibration-debug-panel__metric">
      <dt>{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  )
}

export default function CalibrationDebugPanel({
  snapshot,
  pieceName,
  anchors = [],
  showOverlay,
  onShowOverlayChange,
  disabled = false,
}) {
  if (!snapshot) {
    return (
      <p className="practice-section__hint">
        Run score-follow setup to capture calibration diagnostics.
      </p>
    )
  }

  const smart = snapshot.smartCalibration ?? {}
  const debug = snapshot.debugReport ?? {}
  const warnings = snapshot.warnings ?? []

  function handleExport() {
    const report = buildCalibrationExportReport({
      snapshot,
      pieceName,
      anchors,
    })
    downloadCalibrationReport(report)
  }

  return (
    <div className="calibration-debug-panel">
      <dl className="calibration-debug-panel__grid">
        <Metric
          label="Overall confidence"
          value={formatConfidence(smart.overallConfidence ?? debug.confidence)}
        />
        <Metric label="Chosen strategy" value={smart.chosenStrategyLabel ?? smart.chosenStrategy} />
        <Metric label="Calibration time" value={smart.calibrationMs != null ? `${smart.calibrationMs} ms` : null} />
        <Metric label="Allocation mode" value={debug.allocationMode} />
        <Metric label="Stage" value={debug.stage} />
      </dl>

      {smart.perPageConfidence?.length > 0 && (
        <div className="calibration-debug-panel__section">
          <h4 className="calibration-debug-panel__subtitle">Page confidence</h4>
          <ul className="calibration-debug-panel__list">
            {smart.perPageConfidence.map((page) => (
              <li key={`page-${page.page}`}>
                Page {page.page}: {formatConfidence(page.confidence)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {smart.perSystemConfidence?.length > 0 && (
        <div className="calibration-debug-panel__section">
          <h4 className="calibration-debug-panel__subtitle">System confidence</h4>
          <ul className="calibration-debug-panel__list">
            {smart.perSystemConfidence.map((system) => (
              <li key={`system-${system.index}`}>
                System {system.index + 1}: {formatConfidence(system.confidence)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {smart.pageLayout?.length > 0 && (
        <div className="calibration-debug-panel__section">
          <h4 className="calibration-debug-panel__subtitle">Page layout</h4>
          <ul className="calibration-debug-panel__list">
            {smart.pageLayout.map((page) => (
              <li key={`layout-${page.page}`}>
                p{page.page} offset {page.offsetPx ?? '—'}px · scale {formatConfidence(page.contentScale)}
                {Number.isFinite(page.rotationDeg) ? ` · skew ${page.rotationDeg}°` : ''}
                {page.cropped ? ' · cropped' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {snapshot.fallbacks?.strategyScores?.length > 0 && (
        <div className="calibration-debug-panel__section">
          <h4 className="calibration-debug-panel__subtitle">Strategy scores</h4>
          <ul className="calibration-debug-panel__list">
            {snapshot.fallbacks.strategyScores.map((entry) => (
              <li key={entry.strategy}>
                {entry.label ?? entry.strategy}: {formatConfidence(entry.overall)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="calibration-debug-panel__section">
          <h4 className="calibration-debug-panel__subtitle">Warnings</h4>
          <ul className="calibration-debug-panel__warnings">
            {warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="calibration-debug-panel__actions">
        <label className="practice-playback-settings__check">
          <input
            type="checkbox"
            checked={Boolean(showOverlay)}
            disabled={disabled}
            onChange={(event) => onShowOverlayChange?.(event.target.checked)}
          />
          Show calibration overlay
        </label>
        <button
          type="button"
          className="practice-loop__btn practice-loop__btn--ghost"
          disabled={disabled}
          onClick={handleExport}
        >
          Export calibration report
        </button>
      </div>
    </div>
  )
}
