import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { buildWfyInputModalLayout } from '../../features/practice/wfyInputSourceOptions.js'

export default function WaitForYouInputSourceModal({
  open,
  onChooseSource,
  onDismiss = null,
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

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && typeof onDismiss === 'function') {
        event.preventDefault()
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onDismiss])

  if (!open) {
    return null
  }

  const layout = buildWfyInputModalLayout({
    instrumentId,
    midiAvailable,
    microphoneAvailable,
  })

  const isSimplifiedLayout = layout.layout === 'guitar' || layout.layout === 'piano'

  return createPortal(
    <div className="wfy-input-source-modal">
      <div
        className="wfy-input-source-modal__scrim"
        aria-hidden="true"
        onClick={() => {
          if (typeof onDismiss === 'function') {
            onDismiss()
          }
        }}
      />
      <section
        ref={dialogRef}
        className="wfy-input-source-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wfy-input-source-modal-title"
      >
        <h2 id="wfy-input-source-modal-title">How should Corranzo hear you?</h2>

        {isSimplifiedLayout ? (
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
