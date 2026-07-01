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
  onRotatePage,
  onApplyAutoRotations,
  visiblePageNumber = 1,
  disabled = false,
  setupPhase = null,
}) {
  const hasAnchors = anchors.length >= 2

  if (!snapshot) {
    return (
      <div className="calibration-debug-panel">
        <p className="practice-section__hint">
          {hasAnchors
            ? 'Calibration snapshot is not loaded yet. Re-run auto setup to refresh diagnostics, or wait for setup to finish.'
            : 'Run score cursor setup to capture calibration diagnostics.'}
        </p>
        {hasAnchors && onRotatePage && (
          <div className="calibration-debug-panel__actions">
            <button
              type="button"
              className="practice-loop__btn practice-loop__btn--ghost"
              disabled={disabled}
              onClick={() => onRotatePage(visiblePageNumber)}
            >
              Rotate page
            </button>
          </div>
        )}
      </div>
    )
  }

  const smart = snapshot.smartCalibration ?? {}
  const debug = snapshot.debugReport ?? {}
  const coverage = smart.coverage ?? null
  const warnings = snapshot.warnings ?? []
  const displayOverall =
    smart.adjustedOverallConfidence ?? smart.overallConfidence ?? debug.confidence
  const rawOverall = smart.rawOverallConfidence ?? smart.overallConfidence ?? debug.confidence
  const orientation = snapshot.orientation ?? null
  const viewerCorrected = snapshot.viewerCorrectionApplied !== false
  const orientationValue = orientation
    ? `${orientation.maxRotation ?? 0}°${orientation.anyUncertain ? ' (uncertain)' : ''}`
    : '0°'
  const correctionSummary = orientation?.correctionPaths?.length
    ? orientation.correctionPaths.join(', ')
    : orientation?.anyAutoCorrected
      ? 'auto-detect'
      : 'none'
  const correctionLabel = orientation?.anyRotated || orientation?.anyAutoCorrected
    ? viewerCorrected
      ? `Applied (${correctionSummary})`
      : 'Not applied'
    : 'Not needed'

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
      {setupPhase && setupPhase !== 'idle' && (
        <p className="calibration-debug-panel__status" role="status">
          Setup state: {setupPhase}
        </p>
      )}

      <dl className="calibration-debug-panel__grid">
        <Metric
          label="Overall confidence"
          value={formatConfidence(displayOverall)}
        />
        {Number.isFinite(rawOverall) &&
          Number.isFinite(displayOverall) &&
          Math.abs(rawOverall - displayOverall) > 0.02 && (
            <Metric label="Raw measure-weighted" value={formatConfidence(rawOverall)} />
          )}
        {coverage?.pdfPageCount != null && (
          <Metric
            label="Pages calibrated"
            value={`${coverage.calibratedPageCount}/${coverage.pdfPageCount}`}
          />
        )}
        <Metric label="Chosen strategy" value={smart.chosenStrategyLabel ?? smart.chosenStrategy} />
        <Metric label="Calibration time" value={smart.calibrationMs != null ? `${smart.calibrationMs} ms` : null} />
        <Metric label="Allocation mode" value={debug.allocationMode} />
        <Metric label="Stage" value={debug.stage} />
        <Metric label="Detected rotation" value={orientationValue} />
        <Metric label="Correction path" value={correctionSummary} />
        <Metric label="Viewer correction" value={correctionLabel} />
        {orientation?.anyRotated && (
          <Metric
            label="Orientation confidence"
            value={formatConfidence(
              (orientation.pages ?? []).find((page) => page.rotation)?.confidence,
            )}
          />
        )}
      </dl>

      {orientation?.pages?.length > 0 && (
        <div className="calibration-debug-panel__section">
          <h4 className="calibration-debug-panel__subtitle">Per-page orientation</h4>
          <ul className="calibration-debug-panel__list">
            {orientation.pages.map((page) => (
              <li key={`orient-${page.page}`}>
                Page {page.page}: {page.rotation ?? 0}°
                {page.uncertain ? ' (uncertain)' : ''}
                {page.correctionPath ? ` · ${page.correctionPath}` : ''}
                {Number.isFinite(page.horizontalLineScore) && Number.isFinite(page.verticalLineScore)
                  ? ` · H/V ${page.horizontalLineScore.toFixed(4)}/${page.verticalLineScore.toFixed(4)}`
                  : ''}
                {Number.isFinite(page.confidence) ? ` · ${formatConfidence(page.confidence)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {coverage?.missingPages?.length > 0 && (
        <div className="calibration-debug-panel__section">
          <h4 className="calibration-debug-panel__subtitle">Missing page calibration</h4>
          <ul className="calibration-debug-panel__warnings">
            {coverage.missingPages.map((page) => (
              <li key={`missing-${page}`}>Page {page} has no system/layout calibration data.</li>
            ))}
          </ul>
        </div>
      )}

      {smart.perPageConfidence?.length > 0 && (
        <div className="calibration-debug-panel__section">
          <h4 className="calibration-debug-panel__subtitle">Page confidence</h4>
          <ul className="calibration-debug-panel__list">
            {smart.perPageConfidence.map((page) => (
              <li
                key={`page-${page.page}`}
                className={
                  page.confidence < 0.85 ? 'calibration-debug-panel__list-item--weak' : undefined
                }
              >
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
              <li
                key={`system-${system.index}`}
                className={
                  system.confidence < 0.55
                    ? 'calibration-debug-panel__list-item--low'
                    : system.confidence < 0.75
                      ? 'calibration-debug-panel__list-item--weak'
                      : undefined
                }
              >
                System {system.index + 1} (p{system.page}): {formatConfidence(system.confidence)}
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
        {onRotatePage && (
          <button
            type="button"
            className="practice-loop__btn practice-loop__btn--ghost"
            disabled={disabled}
            onClick={() => onRotatePage(visiblePageNumber)}
          >
            Rotate page
          </button>
        )}
        {onApplyAutoRotations && orientation?.anyRotated && !viewerCorrected && (
          <button
            type="button"
            className="practice-loop__btn practice-loop__btn--ghost"
            disabled={disabled}
            onClick={onApplyAutoRotations}
          >
            Auto-rotate PDF
          </button>
        )}
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
