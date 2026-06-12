import PracticeProgressBar from './PracticeProgressBar.jsx'

export default function PracticePositionPanel({
  disabled,
  position,
  progress,
  canGoPreviousBeat,
  canGoNextBeat,
  onPreviousBeat,
  onNextBeat,
  onGoToMeasureStart,
  embedded = false,
}) {
  const measureNumber = position?.measureNumber ?? '—'
  const beatNumber = position?.beatNumber ?? '—'
  const repeatPass = position?.repeatPass
  const showRepeatPass = repeatPass != null && repeatPass > 1
  const beatsPerMeasure = position?.beatsPerMeasure ?? 0
  const beatInMeasure = position?.beatInMeasure

  const beatPositionLabel =
    beatInMeasure != null && beatsPerMeasure > 0
      ? `Beat ${beatInMeasure} of ${beatsPerMeasure}`
      : null

  const className = embedded
    ? 'practice-position practice-position--embedded practice-position--hero'
    : 'practice-position'

  return (
    <div className={className} aria-label="Current position" aria-live="off">
      {!embedded && <h3 className="practice-position__title">Practice position</h3>}

      <div className="practice-position__hero">
        <div className="practice-position__hero-stat">
          <span className="practice-position__hero-label">Measure</span>
          <span className="practice-position__hero-value">{measureNumber}</span>
        </div>
        <div className="practice-position__hero-divider" aria-hidden />
        <div className="practice-position__hero-stat">
          <span className="practice-position__hero-label">Beat</span>
          <span className="practice-position__hero-value">{beatNumber}</span>
        </div>
      </div>

      {beatPositionLabel && (
        <p className="practice-position__hero-meta">{beatPositionLabel} in this measure</p>
      )}

      {showRepeatPass && (
        <p className="practice-position__hero-meta practice-position__hero-meta--repeat">
          Repeat pass {repeatPass}
        </p>
      )}

      {progress && (
        <div className="practice-position__progress-group">
          <PracticeProgressBar
            label="Piece timeline"
            value={progress.overallProgress}
          />
          {progress.measureProgress != null && (
            <PracticeProgressBar
              label={`Measure ${measureNumber}`}
              value={progress.measureProgress}
              subtle
            />
          )}
        </div>
      )}

      <div className="practice-position__controls">
        <button
          type="button"
          className="practice-position__btn"
          disabled={disabled || !canGoPreviousBeat}
          onClick={onPreviousBeat}
          aria-label="Previous beat (Shift+Left in score)"
          title="Previous beat"
        >
          ← Beat
        </button>
        <button
          type="button"
          className="practice-position__btn"
          disabled={disabled || !canGoNextBeat}
          onClick={onNextBeat}
          aria-label="Next beat (Shift+Right in score)"
          title="Next beat"
        >
          Beat →
        </button>
        <button
          type="button"
          className="practice-position__btn practice-position__btn--secondary"
          disabled={disabled || position?.measure == null}
          onClick={onGoToMeasureStart}
          aria-label="Go to start of current measure"
          title="Measure start"
        >
          ↩ Start
        </button>
      </div>
    </div>
  )
}
