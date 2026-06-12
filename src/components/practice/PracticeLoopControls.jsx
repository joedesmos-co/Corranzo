import { formatTime } from '../../features/playback/formatTime.js'
import { LOOP_SNAP_MODE } from '../../features/practice/practiceLoopRegion.js'

export default function PracticeLoopControls({
  disabled,
  region,
  hasLoop,
  canEnable,
  enabled,
  snapMode,
  onSnapModeChange,
  onSetStart,
  onSetEnd,
  onClear,
  onToggleEnabled,
  hasMidi,
  hideHeaderToggle = false,
  showSnapInCompact = false,
  variant = 'full',
}) {
  const rangeLabel = region?.isValid ? region.label : 'No loop set'
  const isCompact = variant === 'compact'
  const snapGroupName = `loop-snap-${variant}`

  return (
    <div
      className={`practice-loop practice-loop--embedded${isCompact ? ' practice-loop--compact' : ''}`}
      aria-label="Practice loop"
    >
      {!hideHeaderToggle && (
        <div className="practice-loop__header">
          <h3 className="practice-loop__title">Section loop</h3>
          <label className="practice-loop__toggle">
            <input
              type="checkbox"
              checked={enabled}
              disabled={disabled || !canEnable}
              onChange={(event) => onToggleEnabled(event.target.checked)}
            />
            <span>Loop on</span>
          </label>
        </div>
      )}

      {(!isCompact || showSnapInCompact) && (
        <div
          className={`practice-loop__snap${isCompact ? ' practice-loop__snap--compact' : ''}`}
          role="group"
          aria-label="Loop snap mode"
        >
          <span className="practice-loop__snap-label">Snap</span>
          <label className="practice-loop__snap-option">
            <input
              type="radio"
              name={snapGroupName}
              checked={snapMode === LOOP_SNAP_MODE.MEASURE}
              disabled={disabled}
              onChange={() => onSnapModeChange(LOOP_SNAP_MODE.MEASURE)}
            />
            <span>Measure</span>
          </label>
          <label className="practice-loop__snap-option">
            <input
              type="radio"
              name={snapGroupName}
              checked={snapMode === LOOP_SNAP_MODE.BEAT}
              disabled={disabled}
              onChange={() => onSnapModeChange(LOOP_SNAP_MODE.BEAT)}
            />
            <span>Beat</span>
          </label>
        </div>
      )}

      <div className="practice-loop__actions">
        <button
          type="button"
          className="practice-loop__btn"
          disabled={disabled}
          onClick={onSetStart}
        >
          Set start
        </button>
        <button
          type="button"
          className="practice-loop__btn"
          disabled={disabled}
          onClick={onSetEnd}
        >
          Set end
        </button>
        <button
          type="button"
          className="practice-loop__btn practice-loop__btn--ghost"
          disabled={disabled || !hasLoop}
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      <div className="practice-loop__summary">
        <p className="practice-loop__range">{rangeLabel}</p>
        {!isCompact && region?.isValid && (
          <p className="practice-loop__duration">
            Loop duration: {formatTime(region.durationSeconds)}
            <span className="practice-loop__times">
              {' '}
              ({formatTime(region.startTimeSeconds)} → {formatTime(region.endTimeSeconds)})
            </span>
          </p>
        )}
        {isCompact && region?.isValid && (
          <p className="practice-loop__duration practice-loop__duration--compact">
            {formatTime(region.startTimeSeconds)} → {formatTime(region.endTimeSeconds)}
          </p>
        )}
        {!isCompact && !hasMidi && hasLoop && (
          <p className="practice-loop__hint">
            Load a playback file to hear automatic looping during playback.
          </p>
        )}
        {!isCompact && hasMidi && hasLoop && !enabled && (
          <p className="practice-loop__hint">Turn on loop to repeat this section during playback.</p>
        )}
        {isCompact && hasMidi && hasLoop && !enabled && (
          <p className="practice-loop__hint">Turn on loop to repeat this section.</p>
        )}
      </div>
    </div>
  )
}
