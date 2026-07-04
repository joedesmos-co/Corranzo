import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'

export default function WaitForYouInputSourceModal({
  open,
  onChooseSource,
  midiAvailable = false,
  microphoneAvailable = false,
}) {
  if (!open) {
    return null
  }

  return (
    <div className="wfy-input-source-modal">
      <div className="wfy-input-source-modal__scrim" />
      <section
        className="wfy-input-source-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wfy-input-source-modal-title"
      >
        <h2 id="wfy-input-source-modal-title">How do you want to play?</h2>
        <div className="wfy-input-source-modal__actions">
          <button
            type="button"
            className="wfy-input-source-modal__btn wfy-input-source-modal__btn--primary"
            disabled={!microphoneAvailable}
            onClick={() => onChooseSource(WFY_INPUT_SOURCE.MICROPHONE)}
          >
            Use Microphone
          </button>
          <button
            type="button"
            className="wfy-input-source-modal__btn"
            disabled={!midiAvailable}
            onClick={() => onChooseSource(WFY_INPUT_SOURCE.MIDI)}
          >
            Use MIDI Keyboard
          </button>
          <button
            type="button"
            className="wfy-input-source-modal__btn wfy-input-source-modal__btn--quiet"
            onClick={() => onChooseSource(WFY_INPUT_SOURCE.MANUAL)}
          >
            Continue button
          </button>
        </div>
      </section>
    </div>
  )
}
