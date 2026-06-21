import { useState } from 'react'
import { CURSOR_HIDE_REASON, getCursorFollowHint } from '../../features/score-follow/scoreFollowVisibility.js'

function getSetupStatus({
  alignmentMode,
  anchors,
  enabled,
  canFollow,
  markingProgress,
  setupPhase,
  followNeedsSetup,
}) {
  if (setupPhase === 'running') {
    return { tone: 'active', title: 'Scanning PDF…', detail: null }
  }
  if (alignmentMode) {
    return {
      tone: 'active',
      title: `Mark measure ${markingProgress?.nextMeasure ?? '—'}`,
      detail: 'Tap where it begins on the score.',
    }
  }
  if (setupPhase === 'needs-setup' || followNeedsSetup) {
    return {
      tone: 'setup',
      title: 'Needs quick setup',
      detail: null,
    }
  }
  if (!anchors.length) {
    return {
      tone: 'setup',
      title: 'Waiting for PDF + timing',
      detail: null,
    }
  }
  if (!enabled) {
    return { tone: 'setup', title: 'Cursor off', detail: null }
  }
  if (canFollow) {
    return { tone: 'ready', title: 'Cursor ready', detail: null }
  }
  return { tone: 'setup', title: 'Almost ready', detail: null }
}

export default function ScoreFollowControls({
  hasPdf,
  hasTiming,
  enabled,
  onEnabledChange,
  alignmentMode,
  onAlignmentModeChange,
  placementMeasureNumber,
  onPlacementMeasureNumberChange,
  measureBounds,
  anchors,
  onDeleteAnchor,
  onClearAnchors,
  onClearManualMarkers,
  onUndoLastMarker,
  onAdvancePlacementMeasure,
  markingProgress,
  canFollow,
  debug,
  onRetryAutoSetup,
  onResetSemiAutoSetup,
  setupStatus,
  semiAutoSetup,
  isSemiAutoAnalyzing,
  anchorCounts,
  followNeedsSetup = false,
  embedded = false,
  // System-start fallback mode
  systemStartMode = false,
  systemStartMarkCount = 0,
  onEnterSystemStartMode,
  onConfirmSystemStartMarks,
  onUndoSystemStartMark,
  onExitSystemStartMode,
}) {
  const Root = embedded ? 'div' : 'aside'
  const rootClass = `score-follow-controls${embedded ? ' score-follow-controls--embedded' : ''}`
  const [markersListOpen, setMarkersListOpen] = useState(false)
  // Manual marking tools stay hidden behind this disclosure unless auto setup
  // genuinely fails — automatic setup is the product, manual is the rescue path.
  const [showAdjust, setShowAdjust] = useState(false)

  if (!hasPdf) {
    return (
      <Root className={rootClass} aria-label="Score follow">
        {!embedded && <h4 className="score-follow-controls__title">Score follow</h4>}
        <p className="score-follow-controls__empty">Load a PDF from the Library first.</p>
      </Root>
    )
  }

  if (!hasTiming) {
    return (
      <Root className={rootClass} aria-label="Score follow">
        {!embedded && <h4 className="score-follow-controls__title">Score follow</h4>}
        <p className="score-follow-controls__empty">
          Load MusicXML in Library to enable score follow.
        </p>
      </Root>
    )
  }

  const totalMeasures = markingProgress?.totalMeasures ?? measureBounds?.max ?? 1
  const markedCount = markingProgress?.markedCount ?? 0
  const nextMeasure = markingProgress?.nextMeasure ?? placementMeasureNumber
  const progressRatio =
    totalMeasures > 0 ? Math.min(1, markedCount / totalMeasures) : 0
  const manualCount = anchorCounts?.manual ?? 0

  const cardStatus = getSetupStatus({
    alignmentMode,
    anchors,
    enabled,
    canFollow,
    markingProgress,
    setupPhase: setupStatus?.phase,
    followNeedsSetup,
  })

  const hasAutoAnchors = (anchorCounts?.auto ?? 0) > 0
  // Auto setup genuinely failed (ran and produced no usable mapping) — the only
  // time the manual "Mark system starts" rescue path is surfaced up front.
  const autoFailed =
    semiAutoSetup?.status === 'failed' || setupStatus?.phase === 'failed'

  function handleStartMarking() {
    onAlignmentModeChange(true)
  }

  function handleDoneMarking() {
    onAlignmentModeChange(false)
  }

  function handleClearManual() {
    if (manualCount === 0) {
      return
    }
    if (
      window.confirm(
        `Remove all ${manualCount} manual marker${manualCount === 1 ? '' : 's'}? Auto markers will stay.`,
      )
    ) {
      onClearManualMarkers?.()
    }
  }

  function handleClearAll() {
    if (anchors.length === 0) {
      return
    }
    if (
      window.confirm(
        `Remove all ${anchors.length} marker${anchors.length === 1 ? '' : 's'} (manual and auto)?`,
      )
    ) {
      onClearAnchors?.()
    }
  }

  return (
    <Root className={rootClass} aria-label="Score follow">
      {!embedded && <h4 className="score-follow-controls__title">Score follow</h4>}

      {embedded && (
        <div
          className={`score-follow-controls__status-card score-follow-controls__status-card--${cardStatus.tone}`}
          role="status"
        >
          <p className="score-follow-controls__status-title">{cardStatus.title}</p>
          {cardStatus.detail && (
            <p className="score-follow-controls__status-detail">{cardStatus.detail}</p>
          )}
        </div>
      )}

      {/* System-start mode panel (shown when user is tapping system starts) */}
      {systemStartMode ? (
        <div className="score-follow-controls__system-start-panel">
          <p className="score-follow-controls__system-start-instruction">
            Tap the start of each staff line on the score.
          </p>
          <p className="score-follow-controls__system-start-count" role="status">
            {systemStartMarkCount === 0
              ? 'No systems marked yet'
              : `${systemStartMarkCount} system${systemStartMarkCount === 1 ? '' : 's'} marked`}
          </p>
          <div className="score-follow-controls__marking-actions">
            <button
              type="button"
              className="score-follow-controls__action-btn"
              onClick={onUndoSystemStartMark}
              disabled={systemStartMarkCount === 0}
            >
              Undo last
            </button>
            <button
              type="button"
              className="score-follow-controls__action-btn score-follow-controls__action-btn--secondary"
              onClick={onExitSystemStartMode}
            >
              Cancel
            </button>
            <button
              type="button"
              className="score-follow-controls__mark-done-btn"
              onClick={onConfirmSystemStartMarks}
              disabled={systemStartMarkCount === 0}
            >
              Done
            </button>
          </div>
          <p className="score-follow-controls__shortcuts">
            <kbd>⌫</kbd> undo · <kbd>Esc</kbd> cancel
          </p>
        </div>
      ) : alignmentMode ? (
        <div className="score-follow-controls__marking-panel">
          <div className="score-follow-controls__progress" role="status">
            <p className="score-follow-controls__progress-label">
              Marked <strong>{markedCount}</strong> of <strong>{totalMeasures}</strong> measures
            </p>
            <p className="score-follow-controls__progress-next">
              Next: <strong>measure {nextMeasure}</strong>
            </p>
            <div className="score-follow-controls__progress-bar" aria-hidden>
              <span
                className="score-follow-controls__progress-fill"
                style={{ width: `${progressRatio * 100}%` }}
              />
            </div>
          </div>

          <div className="score-follow-controls__marking-actions">
            <button
              type="button"
              className="score-follow-controls__action-btn"
              onClick={() => onUndoLastMarker?.()}
            >
              Undo last marker
            </button>
            <button
              type="button"
              className="score-follow-controls__action-btn score-follow-controls__action-btn--secondary"
              onClick={() => onAdvancePlacementMeasure?.()}
            >
              Skip measure
            </button>
            <button
              type="button"
              className="score-follow-controls__mark-done-btn"
              onClick={handleDoneMarking}
            >
              Done marking
            </button>
          </div>

          <p className="score-follow-controls__shortcuts" aria-label="Marking keyboard shortcuts">
            <kbd>Enter</kbd> skip · <kbd>Backspace</kbd> undo · <kbd>Esc</kbd> exit
          </p>

          <label className="score-follow-controls__row score-follow-controls__row--number">
            <span>Jump to measure</span>
            <input
              type="number"
              min={measureBounds?.min ?? 1}
              max={measureBounds?.max ?? totalMeasures}
              value={placementMeasureNumber}
              onChange={(event) =>
                onPlacementMeasureNumberChange(Number(event.target.value))
              }
            />
          </label>
        </div>
      ) : autoFailed ? (
        /* Last-resort fallback — only shown when auto setup genuinely failed. */
        <div className="score-follow-controls__auto-failed" role="group">
          <p className="score-follow-controls__auto-error">
            Auto setup could not find systems. Mark system starts.
          </p>
          <button
            type="button"
            className="score-follow-controls__system-start-btn"
            onClick={onEnterSystemStartMode}
            disabled={!onEnterSystemStartMode}
          >
            Mark system starts
          </button>
          <button
            type="button"
            className="score-follow-controls__auto-btn score-follow-controls__auto-btn--secondary"
            onClick={onRetryAutoSetup}
            disabled={!onRetryAutoSetup || isSemiAutoAnalyzing}
          >
            {isSemiAutoAnalyzing ? 'Scanning…' : 'Re-run auto setup'}
          </button>
        </div>
      ) : anchors.length > 0 && !isSemiAutoAnalyzing ? (
        /* Auto setup worked — keep manual tools tucked behind a disclosure. */
        <div className="score-follow-controls__adjust">
          <button
            type="button"
            className="score-follow-controls__adjust-toggle"
            onClick={() => setShowAdjust((value) => !value)}
            aria-expanded={showAdjust}
          >
            {showAdjust ? 'Hide adjustments' : 'Adjust cursor'}
          </button>
          {showAdjust && (
            <div className="score-follow-controls__adjust-panel">
              <button
                type="button"
                className="score-follow-controls__auto-btn score-follow-controls__auto-btn--secondary"
                onClick={onRetryAutoSetup}
                disabled={!onRetryAutoSetup || isSemiAutoAnalyzing}
              >
                Re-run auto setup
              </button>
              {hasAutoAnchors && (
                <button
                  type="button"
                  className="score-follow-controls__auto-btn score-follow-controls__auto-btn--secondary"
                  onClick={onResetSemiAutoSetup}
                  disabled={isSemiAutoAnalyzing}
                >
                  Clear auto guides
                </button>
              )}
              <button
                type="button"
                className="score-follow-controls__mark-start-btn score-follow-controls__mark-start-btn--secondary"
                onClick={handleStartMarking}
                disabled={isSemiAutoAnalyzing}
              >
                Fix / add markers manually
              </button>
            </div>
          )}
        </div>
      ) : null}

      <label className="score-follow-controls__row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          disabled={alignmentMode || isSemiAutoAnalyzing}
        />
        <span>Show moving cursor while practicing</span>
      </label>

      {!embedded && anchors.length === 0 && !alignmentMode && (
        <p className="score-follow-controls__empty">
          Tap <strong>Start marking measures</strong>, then tap where each measure begins on the PDF.
        </p>
      )}

      {anchors.length > 0 && !embedded && (
        <>
          <p className="score-follow-controls__status">
            {canFollow && debug?.currentMeasureNumber != null
              ? `At measure ${debug.currentMeasureNumber} · ${markedCount} of ${totalMeasures} marked`
              : canFollow
                ? `Following with ${markedCount} of ${totalMeasures} measures marked`
                : 'Turn on the moving cursor to follow along.'}
          </p>
          {enabled &&
            !debug?.cursorVisibleOnPage &&
            debug?.hideReason &&
            debug.hideReason !== CURSOR_HIDE_REASON.VISIBLE && (
              <p className="score-follow-controls__status score-follow-controls__status--hint">
                {getCursorFollowHint(debug.hideReason, {
                  cursorPage: debug.cursorPage,
                  visiblePageNumber: debug.visiblePageNumber,
                })}
              </p>
            )}
        </>
      )}

      {anchors.length > 0 && (
        <details
          className="score-follow-controls__markers-details"
          open={markersListOpen || alignmentMode}
          onToggle={(event) => setMarkersListOpen(event.currentTarget.open)}
        >
          <summary>
            View markers ({anchors.length}
            {manualCount > 0 || hasAutoAnchors
              ? ` · ${manualCount} manual${hasAutoAnchors ? `, ${anchorCounts.auto} auto` : ''}`
              : ''}
            )
          </summary>
          <ul className="score-follow-controls__list">
            {anchors.map((anchor) => (
              <li key={anchor.id} className="score-follow-controls__item">
                <span>
                  Measure {anchor.measureNumber}
                  <span className="score-follow-controls__item-meta"> · page {anchor.page}</span>
                  <span
                    className={`score-follow-controls__source-badge score-follow-controls__source-badge--${
                      anchor.source === 'auto' ? 'auto' : 'manual'
                    }`}
                  >
                    {anchor.source === 'auto' ? 'auto' : 'manual'}
                  </span>
                </span>
                <button
                  type="button"
                  className="score-follow-controls__delete"
                  onClick={() => onDeleteAnchor(anchor.id)}
                  aria-label={`Remove marker for measure ${anchor.measureNumber}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {(manualCount > 0 || anchors.length > 0) && (
        <div className="score-follow-controls__clear-row">
          {manualCount > 0 && (
            <button
              type="button"
              className="score-follow-controls__clear"
              onClick={handleClearManual}
            >
              Clear manual markers
            </button>
          )}
          {anchors.length > 0 && (
            <button
              type="button"
              className="score-follow-controls__clear score-follow-controls__clear--all"
              onClick={handleClearAll}
            >
              Remove all markers
            </button>
          )}
        </div>
      )}

      {!embedded && debug && (
        <dl className="score-follow-controls__debug">
          <div>
            <dt>Measure</dt>
            <dd>{debug?.currentMeasureNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>Cursor page</dt>
            <dd>{debug?.cursorPage ?? '—'}</dd>
          </div>
          <div>
            <dt>Visible page</dt>
            <dd>{debug?.visiblePageNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>Markers</dt>
            <dd>{debug?.anchorCount ?? 0}</dd>
          </div>
          <div className="score-follow-controls__debug-wide">
            <dt>Cursor on this page</dt>
            <dd>
              {debug?.cursorVisibleOnPage ? 'Yes' : 'No'}
              {!debug?.cursorVisibleOnPage && debug?.hideReasonLabel
                ? ` — ${debug.hideReasonLabel}`
                : ''}
            </dd>
          </div>
        </dl>
      )}
    </Root>
  )
}
