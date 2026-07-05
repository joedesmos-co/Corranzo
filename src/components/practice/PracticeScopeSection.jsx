import {
  PRACTICE_SCOPE,
  PRACTICE_SCOPE_LABELS,
} from '../../features/practice/practiceScope.js'

export default function PracticeScopeSection({
  visible,
  practiceScope,
  onPracticeScopeChange,
  disabled = false,
  compact = false,
}) {
  if (!visible) {
    return null
  }

  const options = [
    PRACTICE_SCOPE.RIGHT_HAND,
    PRACTICE_SCOPE.LEFT_HAND,
    PRACTICE_SCOPE.BOTH_HANDS,
  ]

  return (
    <section
      className={`practice-section practice-scope${compact ? ' practice-section--compact' : ''}`}
      aria-label="Practice scope"
    >
      <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">
        Practice
      </h3>
      <div className="practice-scope__options" role="radiogroup" aria-label="Piano practice scope">
        {options.map((scope) => (
          <label
            key={scope}
            className={`practice-scope__option${
              practiceScope === scope ? ' practice-scope__option--selected' : ''
            }`}
          >
            <input
              type="radio"
              name="practice-scope"
              value={scope}
              checked={practiceScope === scope}
              disabled={disabled}
              onChange={() => onPracticeScopeChange(scope)}
            />
            <span>{PRACTICE_SCOPE_LABELS[scope]}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
