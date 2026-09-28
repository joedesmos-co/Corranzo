import { useEffect, useRef } from 'react'
import { focusFirstElement, handleFocusTrap } from '../utils/focusTrap.js'
import CorranzoMark from './shell/CorranzoMark.jsx'

export default function SessionRestoreOverlay({ onSkip }) {
  const dialogRef = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    focusFirstElement(dialogRef.current)
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return (
    <div
      className="session-restore-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-restore-title"
      ref={dialogRef}
      onKeyDown={event => {
        event.stopPropagation()
        handleFocusTrap(dialogRef.current, event)
        if (event.key === 'Escape' && onSkip) { event.preventDefault(); onSkip() }
      }}
    >
      <div className="session-restore-overlay__card">
        <span className="session-restore-overlay__logo" aria-hidden="true"><CorranzoMark size={36} /></span>
        <p id="session-restore-title" className="session-restore-overlay__title">
          Opening your last score
        </p>
        <p className="session-restore-overlay__hint">
          Your saved score and practice settings will be ready in a moment.
        </p>
        {typeof onSkip === 'function' && (
          <button
            type="button"
            className="session-restore-banner__btn session-restore-banner__btn--ghost session-restore-overlay__skip"
            onClick={onSkip}
          >
            Skip opening
          </button>
        )}
      </div>
    </div>
  )
}
