import CorranzoLogo from './CorranzoLogo.jsx'

export default function SessionRestoreOverlay() {
  return (
    <div className="session-restore-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="session-restore-overlay__card">
        <CorranzoLogo
          className="session-restore-overlay__logo"
          width={120}
          height={120}
          alt=""
          aria-hidden
        />
        <p className="session-restore-overlay__title">Restoring your last session</p>
        <p className="session-restore-overlay__hint">
          This usually takes a moment. File uploads are paused until restore finishes.
        </p>
      </div>
    </div>
  )
}
