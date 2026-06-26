import { PRACTICE_MODE } from '../../features/practice/practiceMode.js'
import PracticeHelpTip from './PracticeHelpTip.jsx'

const MODE_LABELS = {
  [PRACTICE_MODE.NORMAL]: 'Playback',
  [PRACTICE_MODE.WAIT_FOR_YOU]: 'Wait For You',
}

export default function PracticeModeSection({
  practiceMode,
  onPracticeModeChange,
  disabled,
  hasMusicXml,
  compact = false,
}) {
  return (
    <section
      className={`practice-section practice-mode${compact ? ' practice-section--compact' : ''}`}
      aria-label="Practice mode"
    >
      <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial practice-section__title--with-tip">
        Mode
        <PracticeHelpTip label="About practice modes">
          Playback moves normally. Wait For You pauses for your input.
        </PracticeHelpTip>
      </h3>

      {!hasMusicXml ? (
        <p className="practice-section__hint practice-empty-state">
          Timing file required.
        </p>
      ) : (
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
                disabled={disabled}
                onChange={() => onPracticeModeChange(mode)}
              />
              <span>{MODE_LABELS[mode]}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}
