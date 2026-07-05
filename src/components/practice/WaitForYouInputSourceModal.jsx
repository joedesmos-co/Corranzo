import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'
import { buildWfyInputModalActions } from '../../features/practice/wfyInputSourceOptions.js'

export default function WaitForYouInputSourceModal({
  open,
  onChooseSource,
  instrumentId = null,
  midiAvailable = false,
  microphoneAvailable = false,
}) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const enabledButton = dialogRef.current?.querySelector('button:not(:disabled)')
    enabledButton?.focus()

    return undefined
  }, [open])

  if (!open) {
    return null
  }

  const actions = buildWfyInputModalActions({
    instrumentId,
    midiAvailable,
    microphoneAvailable,
  })

  return createPortal(
    <div className="wfy-input-source-modal">
      <div className="wfy-input-source-modal__scrim" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="wfy-input-source-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wfy-input-source-modal-title"
      >
        <h2 id="wfy-input-source-modal-title">How do you want to play?</h2>
        <div className="wfy-input-source-modal__actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`wfy-input-source-modal__btn${
                action.primary ? ' wfy-input-source-modal__btn--primary' : ''
              }${action.quiet ? ' wfy-input-source-modal__btn--quiet' : ''}`}
              disabled={action.disabled}
              onClick={() => onChooseSource(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  )
}
