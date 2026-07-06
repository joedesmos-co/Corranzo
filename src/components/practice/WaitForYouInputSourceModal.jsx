import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { buildWfyInputModalLayout } from '../../features/practice/wfyInputSourceOptions.js'

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

  const layout = buildWfyInputModalLayout({
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

        {layout.layout === 'guitar' ? (
          <div className="wfy-input-source-modal__guitar">
            <div className="wfy-input-source-modal__actions">
              {layout.primaryActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="wfy-input-source-modal__btn wfy-input-source-modal__btn--primary"
                  disabled={action.disabled}
                  onClick={() => onChooseSource(action.id)}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {layout.fallbackLink ? (
              <button
                type="button"
                className="wfy-input-source-modal__link"
                onClick={() => onChooseSource(layout.fallbackLink.id)}
              >
                {layout.fallbackLink.label}
              </button>
            ) : null}

            {layout.advancedActions.length > 0 ? (
              <details className="wfy-input-source-modal__advanced">
                <summary className="wfy-input-source-modal__advanced-summary">More options</summary>
                <div className="wfy-input-source-modal__advanced-body">
                  {layout.advancedActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="wfy-input-source-modal__btn wfy-input-source-modal__btn--secondary"
                      onClick={() => onChooseSource(action.id)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : (
          <div className="wfy-input-source-modal__actions">
            {layout.primaryActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={`wfy-input-source-modal__btn${
                  action.primary ? ' wfy-input-source-modal__btn--primary' : ''
                }`}
                disabled={action.disabled}
                onClick={() => onChooseSource(action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
