import { PRACTICE_MODE, PRACTICE_MODE_LABELS } from '../../features/practice/practiceMode.js'
import PracticeHelpTip from './PracticeHelpTip.jsx'

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
      <h3 className="practice-section__title practice-section__title--static practice-section__title--with-tip">
        Practice mode
        <PracticeHelpTip label="About practice modes">
          Normal playback follows your sound file. Wait For You waits until you play the right
          note (or tap continue) before moving on.
        </PracticeHelpTip>
      </h3>

      {!hasMusicXml ? (
        <p className="practice-section__hint practice-empty-state">
          Add a score timing file from the Library to unlock Wait For You and measure tracking.
        </p>
      ) : (
        <div className="practice-mode__options" role="radiogroup" aria-label="Practice mode">
          {Object.values(PRACTICE_MODE).map((mode) => (
            <label key={mode} className="practice-mode__option">
              <input
                type="radio"
                name="practice-mode"
                value={mode}
                checked={practiceMode === mode}
                disabled={disabled}
                onChange={() => onPracticeModeChange(mode)}
              />
              <span>{PRACTICE_MODE_LABELS[mode]}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}
