import { WFY_STATUS } from '../../features/practice/waitForYouEngine.js'

export default function PracticeFullscreenHud({
  measureNumber,
  beatNumber,
  isPlaying,
  hasMidi,
  isWaitForYou,
  waitForYouStatus,
  overallProgress = 0,
  performedIndex = null,
  performedTotal = null,
  visible = true,
  onPlay,
  onPause,
  onWaitForYouContinue,
}) {
  const showWfyAction =
    isWaitForYou &&
    onWaitForYouContinue &&
    waitForYouStatus !== WFY_STATUS.COMPLETE &&
    waitForYouStatus !== WFY_STATUS.NO_CHECKPOINTS

  const passLabel =
    performedIndex != null && performedTotal != null && performedTotal > 1
      ? `Pass ${performedIndex + 1} of ${performedTotal}`
      : null

  return (
    <div
      className={`practice-fullscreen-hud${visible ? ' practice-fullscreen-hud--visible' : ''}`}
      aria-label="Practice controls"
    >
      <div className="practice-fullscreen-hud__timeline" aria-hidden>
        <div
          className="practice-fullscreen-hud__timeline-fill"
          style={{ width: `${Math.round(Math.min(1, Math.max(0, overallProgress)) * 100)}%` }}
        />
      </div>

      <div className="practice-fullscreen-hud__row">
        <div className="practice-fullscreen-hud__position">
          <span className="practice-fullscreen-hud__label">Now</span>
          <span className="practice-fullscreen-hud__value">
            M{measureNumber ?? '—'} · B{beatNumber ?? '—'}
          </span>
          {passLabel ? (
            <span className="practice-fullscreen-hud__pass">{passLabel}</span>
          ) : null}
        </div>

        {hasMidi && !isWaitForYou && (
          <button
            type="button"
            className="practice-fullscreen-hud__play"
            onClick={isPlaying ? onPause : onPlay}
            aria-label={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
        )}

        {showWfyAction && (
          <button
            type="button"
            className="practice-fullscreen-hud__play practice-fullscreen-hud__wfy"
            onClick={onWaitForYouContinue}
          >
            Continue
          </button>
        )}

        {isWaitForYou && waitForYouStatus === WFY_STATUS.WAITING && (
          <span className="practice-fullscreen-hud__wfy-badge" role="status">
            Your turn
          </span>
        )}
      </div>

      <p className="practice-fullscreen-hud__hint">
        {isWaitForYou
          ? 'Enter to continue · Esc exits fullscreen'
          : 'Space play · ← → pages · Shift+← → measures'}
      </p>
    </div>
  )
}
