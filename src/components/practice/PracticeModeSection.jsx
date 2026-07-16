import { PRACTICE_MODE } from '../../features/practice/practiceMode.js'
import PracticeHelpTip from './PracticeHelpTip.jsx'

const MODE_LABELS = {
  [PRACTICE_MODE.NORMAL]: 'Play Along',
  [PRACTICE_MODE.WAIT_FOR_YOU]: 'Wait For You',
}

export default function PracticeModeSection({
  practiceMode,
  onPracticeModeChange,
  disabled,
  hasMusicXml,
  waitForYouDisabled = false,
  waitForYouDisabledReason = '',
  compact = false,
}) {
  // Without a timing file there is no mode to pick; the Play section already
  // shows the "add a timing file" guidance, so don't repeat it here.
  if (!hasMusicXml) {
    return null
  }

  return (
    <section
      className={`practice-section practice-mode${compact ? ' practice-section--compact' : ''}`}
      aria-label="Practice mode"
      data-tour-id="practice-mode"
    >
      <h3
        className={`practice-section__title practice-section__title--static practice-section__title--editorial${
          compact ? '' : ' practice-section__title--with-tip'
        }`}
      >
        Mode
        {!compact && (
          <PracticeHelpTip label="About practice modes">
            Play Along keeps the score moving. Wait For You pauses at each note until you play it or tap Continue.
          </PracticeHelpTip>
        )}
      </h3>

      <div className="practice-mode__options" role="radiogroup" aria-label="Practice mode">
        {Object.values(PRACTICE_MODE).map((mode) => (
          <label
            key={mode}
            className={`practice-mode__option${
              practiceMode === mode ? ' practice-mode__option--selected' : ''
            }`}
          >
            <input
              type="radio"
              name="practice-mode"
              value={mode}
              checked={practiceMode === mode}
              disabled={
                disabled ||
                (mode === PRACTICE_MODE.WAIT_FOR_YOU && waitForYouDisabled)
              }
              onChange={() => onPracticeModeChange(mode)}
            />
            <span>{MODE_LABELS[mode]}</span>
          </label>
        ))}
      </div>
      {waitForYouDisabled && waitForYouDisabledReason && (
        <p className="practice-section__hint practice-empty-state">
          {waitForYouDisabledReason}
        </p>
      )}
    </section>
  )
}
