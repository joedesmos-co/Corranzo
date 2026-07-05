import {
  WFY_INPUT_SOURCE,
  WFY_INPUT_SOURCE_LABELS,
} from '../../features/microphone-input/micInputConstants.js'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'

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
  midiAvailable,
  microphoneAvailable,
  disabled = false,
}) {
  if (checkpointMode !== WFY_CHECKPOINT_MODE.NOTE) {
    return null
  }

  const primaryOptions = [
    {
      id: WFY_INPUT_SOURCE.MICROPHONE,
      label: 'Use Microphone',
      hint: 'Acoustic or electric instruments',
      available: microphoneAvailable,
    },
    {
      id: WFY_INPUT_SOURCE.MIDI,
      label: 'Use MIDI',
      hint: 'Keyboards & digital pianos',
      available: midiAvailable,
    },
  ]

  const currentLabel =
    WFY_INPUT_SOURCE_LABELS[inputSource] ?? WFY_INPUT_SOURCE_LABELS[WFY_INPUT_SOURCE.MANUAL]

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
          {primaryOptions.map((option) => (
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

        <label
          className={`wfy-input-source__manual${
            inputSource === WFY_INPUT_SOURCE.MANUAL ? ' wfy-input-source__manual--selected' : ''
          }`}
          title="No device needed"
        >
          <input
            type="radio"
            name="wfy-input-source"
            value={WFY_INPUT_SOURCE.MANUAL}
            checked={inputSource === WFY_INPUT_SOURCE.MANUAL}
            disabled={disabled}
            onChange={() => onInputSourceChange(WFY_INPUT_SOURCE.MANUAL)}
          />
          <span>No device — use the {WFY_INPUT_SOURCE_LABELS[WFY_INPUT_SOURCE.MANUAL]}</span>
        </label>
      </div>
    </details>
  )
}
