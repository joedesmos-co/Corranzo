import CorranzoLogo from './CorranzoLogo.jsx'

export default function SessionRestoreOverlay({ onSkip }) {
  return (
    <div
      className="session-restore-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-restore-title"
      aria-busy="true"
    >
      <div className="session-restore-overlay__card">
        <CorranzoLogo
          className="session-restore-overlay__logo"
          width={120}
          height={120}
          alt=""
          aria-hidden
        />
        <p id="session-restore-title" className="session-restore-overlay__title">
          Restoring your last session
        </p>
        <p className="session-restore-overlay__hint">
          This usually takes a moment. File uploads are paused until restore finishes.
        </p>
        {typeof onSkip === 'function' && (
          <button
            type="button"
            className="session-restore-banner__btn session-restore-banner__btn--ghost session-restore-overlay__skip"
            onClick={onSkip}
          >
            Skip restore
          </button>
        )}
      </div>
    </div>
  )
}
