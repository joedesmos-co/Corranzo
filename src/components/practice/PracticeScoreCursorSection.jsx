export default function PracticeScoreCursorSection({ scoreFollow, disabled = false }) {
  if (!scoreFollow?.hasTiming) {
    return null
  }

  const setupPhase = scoreFollow.setupStatus?.phase
  const busy = scoreFollow.alignmentMode || scoreFollow.isSemiAutoAnalyzing
  const canToggle = !disabled && !busy
  const targetPreference = scoreFollow.guitarScoreTarget
  const showTargetPreference = Boolean(targetPreference?.selectable)
  const statusLabel = busy
    ? 'Setting up'
    : scoreFollow.enabled && scoreFollow.canFollow
      ? 'On'
      : scoreFollow.enabled
        ? 'Ready'
        : 'Off'

  return (
    <section
      className="practice-section practice-section--compact practice-score-cursor"
      aria-label="Score cursor"
      data-tour-id="score-cursor"
    >
      <div className="practice-section__header-row">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">
          Cursor
        </h3>
        <span
          className={`practice-status-chip${
            scoreFollow.enabled && scoreFollow.canFollow ? ' practice-status-chip--ready' : ''
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <label className="practice-score-cursor__toggle">
        <input
          type="checkbox"
          checked={Boolean(scoreFollow.enabled)}
          disabled={!canToggle}
          onChange={(event) => scoreFollow.setEnabled(event.target.checked)}
        />
        <span>Show cursor on score</span>
      </label>

      {showTargetPreference && (
        <div className="practice-score-cursor__target" aria-label="Guitar cursor target">
          {targetPreference.options.map((option) => (
            <button
              key={option.target}
              type="button"
              className="practice-score-cursor__target-option"
              aria-pressed={targetPreference.activeTarget === option.target}
              disabled={!canToggle}
              onClick={() => targetPreference.setTarget(option.target)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {setupPhase === 'failed' && (
        <p className="practice-section__hint practice-score-cursor__hint">
          Cursor setup failed — open Advanced → Practice setup.
        </p>
      )}
    </section>
  )
}
