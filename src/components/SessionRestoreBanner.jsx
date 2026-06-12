import { RESTORE_STATUS } from '../hooks/useSessionPersistence.js'

export default function SessionRestoreBanner({
  status,
  message,
  onDismiss,
  onClearSaved,
}) {
  if (
    !message ||
    status === RESTORE_STATUS.NONE ||
    status === RESTORE_STATUS.IDLE ||
    status === RESTORE_STATUS.RESTORING
  ) {
    return null
  }

  const tone =
    status === RESTORE_STATUS.FAILED || status === RESTORE_STATUS.EXPIRED
      ? 'error'
      : status === RESTORE_STATUS.PARTIAL
        ? 'info'
        : 'success'

  return (
    <div className={`session-restore-banner session-restore-banner--${tone}`} role="status">
      <p className="session-restore-banner__message">{message}</p>
      <div className="session-restore-banner__actions">
        <button type="button" className="session-restore-banner__btn" onClick={onDismiss}>
          Dismiss
        </button>
        {(status === RESTORE_STATUS.FAILED || status === RESTORE_STATUS.EXPIRED) && (
          <button
            type="button"
            className="session-restore-banner__btn session-restore-banner__btn--ghost"
            onClick={onClearSaved}
          >
            Clear saved session
          </button>
        )}
      </div>
    </div>
  )
}
