import { CURSOR_HIDE_REASON, getCursorFollowHint } from '../../features/score-follow/scoreFollowVisibility.js'

function formatDebugNumber(value) {
  return Number.isFinite(value) ? value.toFixed(4) : '—'
}

function formatMeasureBox(box) {
  if (!box) {
    return '—'
  }
  return `x ${formatDebugNumber(box.x0)}-${formatDebugNumber(box.x1)} · y ${formatDebugNumber(box.y0)}-${formatDebugNumber(box.y1)}${box.source ? ` · ${box.source}` : ''}`
}

function formatOmrMeasureBox(box) {
  if (!box) {
    return '—'
  }
  return `M${box.measureNumber ?? '—'} · p${box.pageNumber ?? '—'} · s${box.systemIndex ?? '—'} · x ${formatDebugNumber(box.xStart)}-${formatDebugNumber(box.xEnd)} · cursor ${formatDebugNumber(box.cursorX)} (${formatDebugNumber(box.cursorXWithinBox)})`
}

function getSetupStatus({
  alignmentMode,
  anchors,
  enabled,
  canFollow,
  markingProgress,
  setupPhase,
  followNeedsSetup,
  hasPdf,
  hasTiming,
  experimentalOmrPlayback = false,
  setupMessage = '',
}) {
  if (setupPhase === 'running') {
    return {
      tone: 'active',
      title: experimentalOmrPlayback
        ? setupMessage || 'Setting up score-follow…'
        : 'Scanning PDF…',
      detail: null,
    }
  }
  if (alignmentMode) {
    return {
      tone: 'active',
      title: `Mark measure ${markingProgress?.nextMeasure ?? '—'}`,
      detail: 'Tap where it begins on the score.',
    }
  }
  if (experimentalOmrPlayback && (setupPhase === 'failed' || !canFollow)) {
    return {
      tone: setupPhase === 'failed' ? 'setup' : 'ready',
      title: setupMessage || 'Experimental playback ready',
      detail: 'Experimental PDF playback may be inaccurate. For accurate playback, upload MusicXML/MXL.',
    }
  }
  if (setupPhase === 'needs-setup' || setupPhase === 'failed') {
    return {
      tone: 'setup',
      title: 'Needs quick setup',
      detail: null,
    }
  }
  if (followNeedsSetup && anchors.length > 0) {
    return {
      tone: 'setup',
      title: 'Needs quick setup',
      detail: null,
    }
  }
  if (!anchors.length) {
    return {
      tone: 'setup',
      title:
        hasPdf && hasTiming ? 'Preparing score follow…' : 'Waiting for PDF + timing',
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
  onUndoLastMarker,
  onAdvancePlacementMeasure,
  markingProgress,
  canFollow,
  debug,
  onRetryAutoSetup,
  onCancelAutoSetup,
  setupStatus,
  semiAutoSetup,
  isSemiAutoAnalyzing,
  followNeedsSetup = false,
  experimentalOmrPlayback = false,
  embedded = false,
  // System-start fallback mode
  systemStartMode = false,
  systemStartMarkCount = 0,
  onEnterSystemStartMode,
  onConfirmSystemStartMarks,
  onUndoSystemStartMark,
  onExitSystemStartMode,
  showCursorToggle = true,
  allowSystemStartFallback = true,
}) {
  const Root = embedded ? 'div' : 'aside'
  const rootClass = `score-follow-controls${embedded ? ' score-follow-controls--embedded' : ''}`

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
  const cardStatus = getSetupStatus({
    alignmentMode,
    anchors,
    enabled,
    canFollow,
    markingProgress,
    setupPhase: setupStatus?.phase,
    followNeedsSetup,
    hasPdf,
    hasTiming,
    experimentalOmrPlayback,
    setupMessage: setupStatus?.message,
  })

  // Auto setup genuinely failed (ran and produced no usable mapping) — the only
  // time the manual "Mark system starts" rescue path is surfaced up front.
  const autoFailed =
    semiAutoSetup?.status === 'failed' || setupStatus?.phase === 'failed'
  const omrScoreFollowUnavailable =
    experimentalOmrPlayback &&
    !alignmentMode &&
    !isSemiAutoAnalyzing &&
    !canFollow

  function handleDoneMarking() {
    onAlignmentModeChange(false)
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
      ) : isSemiAutoAnalyzing ? (
        <div className="score-follow-controls__auto-failed" role="status">
          <p className="score-follow-controls__auto-error">
            {semiAutoSetup?.message || setupStatus?.message || 'Scanning PDF…'}
          </p>
          <button
            type="button"
            className="score-follow-controls__auto-btn score-follow-controls__auto-btn--secondary"
            onClick={onCancelAutoSetup}
            disabled={!onCancelAutoSetup}
          >
            Cancel setup
          </button>
        </div>
      ) : omrScoreFollowUnavailable ? (
        <div className="score-follow-controls__auto-failed" role="group">
          <p className="score-follow-controls__auto-error">
            {setupStatus?.message || 'Experimental playback ready'}
          </p>
          <p className="score-follow-controls__status score-follow-controls__status--hint">
            Experimental PDF playback may be inaccurate. For accurate playback, upload MusicXML/MXL.
          </p>
          <button
            type="button"
            className="score-follow-controls__auto-btn score-follow-controls__auto-btn--secondary"
            onClick={onRetryAutoSetup}
            disabled={!onRetryAutoSetup || isSemiAutoAnalyzing}
          >
            {autoFailed ? 'Retry score-follow setup' : 'Try score-follow setup'}
          </button>
        </div>
      ) : autoFailed ? (
        /* Last-resort fallback — only shown when auto setup genuinely failed. */
        <div className="score-follow-controls__auto-failed" role="group">
          <p className="score-follow-controls__auto-error">
            {semiAutoSetup?.error ?? 'Auto setup could not find systems. Mark system starts.'}
          </p>
          {allowSystemStartFallback && (
            <button
              type="button"
              className="score-follow-controls__system-start-btn"
              onClick={onEnterSystemStartMode}
              disabled={!onEnterSystemStartMode}
            >
              Mark system starts
            </button>
          )}
          <button
            type="button"
            className="score-follow-controls__auto-btn score-follow-controls__auto-btn--secondary"
            onClick={onRetryAutoSetup}
            disabled={!onRetryAutoSetup || isSemiAutoAnalyzing}
          >
            {isSemiAutoAnalyzing ? 'Scanning…' : 'Re-run auto setup'}
          </button>
        </div>
      ) : null}

      {showCursorToggle && (
        <label className="score-follow-controls__row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
            disabled={alignmentMode || isSemiAutoAnalyzing}
          />
          <span>Show moving cursor while practicing</span>
        </label>
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

      {debug?.autoSetupRuntime && (
        <details className="score-follow-controls__auto-setup-debug">
          <summary>Advanced diagnostics</summary>
          <dl className="score-follow-controls__debug">
            <div>
              <dt>Setup phase</dt>
              <dd>{debug.autoSetupRuntime.setupStatusPhase ?? '—'}</dd>
            </div>
            <div>
              <dt>Setup status</dt>
              <dd>{debug.autoSetupRuntime.semiAutoSetupStatus ?? '—'}</dd>
            </div>
            <div>
              <dt>Detected systems</dt>
              <dd>{debug.autoSetupRuntime.detectedSystemCount ?? '—'}</dd>
            </div>
            <div>
              <dt>Timing measures</dt>
              <dd>{debug.autoSetupRuntime.timingMeasureCount ?? '—'}</dd>
            </div>
            <div>
              <dt>PDF pages</dt>
              <dd>{debug.autoSetupRuntime.pdfPageCount ?? '—'}</dd>
            </div>
            <div>
              <dt>Expected systems (MXL)</dt>
              <dd>{debug.autoSetupRuntime.expectedSystemCount ?? '—'}</dd>
            </div>
            <div>
              <dt>Allocation mode</dt>
              <dd>{debug.autoSetupRuntime.allocationMode ?? '—'}</dd>
            </div>
            <div>
              <dt>Layout confidence</dt>
              <dd>{debug.autoSetupRuntime.layoutConfidenceLevel ?? '—'}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>
                {debug.autoSetupRuntime.validationOk == null
                  ? '—'
                  : debug.autoSetupRuntime.validationOk
                    ? 'ok'
                    : debug.autoSetupRuntime.validationMessage ?? 'failed'}
              </dd>
            </div>
            <div>
              <dt>Plausible</dt>
              <dd>
                {debug.autoSetupRuntime.plausible == null
                  ? '—'
                  : debug.autoSetupRuntime.plausible
                    ? 'yes'
                    : 'no'}
              </dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{debug.autoSetupRuntime.confidence ?? '—'}</dd>
            </div>
            <div className="score-follow-controls__debug-wide">
              <dt>Per-system allocation</dt>
              <dd>
                {debug.autoSetupRuntime.perSystemAllocation?.length
                  ? debug.autoSetupRuntime.perSystemAllocation
                      .map(
                        (system) =>
                          `#${system.index} p${system.page} m${system.measureStart}-${system.measureEnd} (${system.measureCount})`,
                      )
                      .join(' · ')
                  : '—'}
              </dd>
            </div>
            <div className="score-follow-controls__debug-wide">
              <dt>Setup error</dt>
              <dd>{debug.autoSetupRuntime.setupError ?? '—'}</dd>
            </div>
            <div className="score-follow-controls__debug-wide">
              <dt>Needs quick setup reason</dt>
              <dd>{debug.autoSetupRuntime.needsQuickSetupReason ?? '—'}</dd>
            </div>
          </dl>
        </details>
      )}

      {!embedded && debug && (
        <dl className="score-follow-controls__debug">
          <div>
            <dt>Measure</dt>
            <dd>{debug?.currentMeasureNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>Measure index</dt>
            <dd>{debug?.cursorMapping?.measureIndex ?? '—'}</dd>
          </div>
          <div>
            <dt>Cursor page</dt>
            <dd>{debug?.cursorPage ?? '—'}</dd>
          </div>
          <div>
            <dt>Mapped page</dt>
            <dd>{debug?.cursorMapping?.pageNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>System</dt>
            <dd>{debug?.cursorMapping?.systemIndex ?? '—'}</dd>
          </div>
          <div>
            <dt>Visible page</dt>
            <dd>{debug?.visiblePageNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>Playback time</dt>
            <dd>{formatDebugNumber(debug?.cursorMapping?.playbackTime)}</dd>
          </div>
          <div>
            <dt>Markers</dt>
            <dd>{debug?.anchorCount ?? 0}</dd>
          </div>
          <div className="score-follow-controls__debug-wide">
            <dt>Measure box</dt>
            <dd>{formatMeasureBox(debug?.cursorMapping?.measureBoundingBox)}</dd>
          </div>
          {debug?.cursorMapping?.matchedOmrMeasureBox && (
            <div className="score-follow-controls__debug-wide">
              <dt>OMR box</dt>
              <dd>{formatOmrMeasureBox(debug.cursorMapping.matchedOmrMeasureBox)}</dd>
            </div>
          )}
          <div className="score-follow-controls__debug-wide">
            <dt>Interpolation source</dt>
            <dd>{debug?.cursorMapping?.interpolationSource ?? '—'}</dd>
          </div>
          <div className="score-follow-controls__debug-wide">
            <dt>Fallback tier</dt>
            <dd>{debug?.cursorMapping?.fallbackTier ?? '—'}</dd>
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
