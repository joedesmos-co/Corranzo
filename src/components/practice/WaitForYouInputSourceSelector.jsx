import {
  WFY_INPUT_SOURCE,
  WFY_INPUT_SOURCE_LABELS,
} from '../../features/microphone-input/micInputConstants.js'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'

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

  const options = [
    {
      id: WFY_INPUT_SOURCE.MIDI,
      label: WFY_INPUT_SOURCE_LABELS[WFY_INPUT_SOURCE.MIDI],
      available: midiAvailable,
      hint: 'Most accurate',
    },
    {
      id: WFY_INPUT_SOURCE.MICROPHONE,
      label: WFY_INPUT_SOURCE_LABELS[WFY_INPUT_SOURCE.MICROPHONE],
      available: microphoneAvailable,
      hint: 'Acoustic piano — less exact',
    },
    {
      id: WFY_INPUT_SOURCE.MANUAL,
      label: WFY_INPUT_SOURCE_LABELS[WFY_INPUT_SOURCE.MANUAL],
      available: true,
      hint: 'Tap when ready',
    },
  ]

  return (
    <div className="wfy-input-source" role="radiogroup" aria-label="How you continue">
      <p className="wfy-input-source__label">How you continue</p>
      <div className="wfy-input-source__options">
        {options.map((option) => (
          <label
            key={option.id}
            className={`wfy-input-source__option${
              !option.available ? ' wfy-input-source__option--disabled' : ''
            }${inputSource === option.id ? ' wfy-input-source__option--selected' : ''}`}
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
  )
}
