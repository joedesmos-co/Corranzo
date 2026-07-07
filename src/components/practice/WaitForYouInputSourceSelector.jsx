import {
  buildWfyInputSelectorGroups,
  buildWfyInputSelectorOptions,
  wfyInputSourceLabel,
} from '../../features/practice/wfyInputSourceOptions.js'

/**
 * Collapsed practice input chooser. The first-time choice happens in the entry
 * modal; this control is for changing input mid-session.
 */
export default function WaitForYouInputSourceSelector({
  inputSource,
  onInputSourceChange,
  instrumentId = null,
  midiAvailable,
  microphoneAvailable,
  disabled = false,
}) {
  const options = buildWfyInputSelectorOptions({
    instrumentId,
    midiAvailable,
    microphoneAvailable,
  })
  const { primary, advanced } = buildWfyInputSelectorGroups(options)

  const currentLabel = wfyInputSourceLabel(inputSource, instrumentId)

  const renderOption = (option) => (
    <label
      key={option.id}
      className={`wfy-input-source__option${
        !option.available ? ' wfy-input-source__option--disabled' : ''
      }${inputSource === option.id ? ' wfy-input-source__option--selected' : ''}`}
      title={option.hint}
    >
      <input
        type="radio"
        name="wfy-input-source"
        value={option.id}
        checked={inputSource === option.id}
        disabled={disabled || !option.available}
        onChange={() => onInputSourceChange(option.id)}
      />
      <span className="wfy-input-source__option-text">
        <span className="wfy-input-source__option-label">{option.label}</span>
        <span className="wfy-input-source__option-hint">{option.hint}</span>
      </span>
    </label>
  )

  return (
    <details className="wfy-input-source wfy-input-source--compact" data-tour-id="practice-input-source">
      <summary className="wfy-input-source__summary">
        <span className="wfy-input-source__current">Input: {currentLabel}</span>
        <span className="wfy-input-source__change">Change</span>
      </summary>

      <div
        className="wfy-input-source__body"
        role="radiogroup"
        aria-label="Practice input source"
      >
        <div className="wfy-input-source__options">{primary.map(renderOption)}</div>
        {advanced.length > 0 ? (
          <details className="wfy-input-source__advanced">
            <summary className="wfy-input-source__advanced-summary">More options</summary>
            <div className="wfy-input-source__options wfy-input-source__options--advanced">
              {advanced.map(renderOption)}
            </div>
          </details>
        ) : null}
      </div>
    </details>
  )
}
