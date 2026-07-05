import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import {
  buildWfyInputSelectorOptions,
  wfyInputSourceLabel,
} from '../../features/practice/wfyInputSourceOptions.js'

/**
 * Beginner-simple input chooser: Microphone or MIDI,
 * with a quiet "no device" fallback that keeps the Continue button flow. Picking
 * Microphone or MIDI is all the setup there is — permission + calibration /
 * connection start automatically downstream.
 *
 * The chooser rests collapsed behind a one-line summary of the current source;
 * the first-time choice happens in the entry modal, so the expanded radios are
 * only needed when changing input mid-session.
 */
export default function WaitForYouInputSourceSelector({
  checkpointMode,
  inputSource,
  onInputSourceChange,
  instrumentId = null,
  midiAvailable,
  microphoneAvailable,
  disabled = false,
}) {
  if (checkpointMode !== WFY_CHECKPOINT_MODE.NOTE) {
    return null
  }

  const options = buildWfyInputSelectorOptions({
    instrumentId,
    midiAvailable,
    microphoneAvailable,
  })

  const currentLabel = wfyInputSourceLabel(inputSource, instrumentId)

  return (
    <details className="wfy-input-source wfy-input-source--compact" data-tour-id="practice-input-source">
      <summary className="wfy-input-source__summary">
        <span className="wfy-input-source__current">Input: {currentLabel}</span>
        <span className="wfy-input-source__change">Change</span>
      </summary>

      <div
        className="wfy-input-source__body"
        role="radiogroup"
        aria-label="Wait For You input source"
      >
        <div className="wfy-input-source__options">
          {options.map((option) => (
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
          ))}
        </div>
      </div>
    </details>
  )
}
