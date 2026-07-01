export default function AppViewPlaceholder({
  title,
  message,
  actionLabel = null,
  onAction = null,
  secondaryActionLabel = null,
  onSecondaryAction = null,
}) {
  return (
    <main className="app-view-placeholder" aria-live="polite">
      <h2 className="app-view-placeholder__title">{title}</h2>
      {message ? <p className="app-view-placeholder__message">{message}</p> : null}
      {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
        <div className="app-view-placeholder__actions">
          {actionLabel && onAction ? (
            <button type="button" className="upload-btn app-view-placeholder__action" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
          {secondaryActionLabel && onSecondaryAction ? (
            <button
              type="button"
              className="app-view-placeholder__secondary"
              onClick={onSecondaryAction}
            >
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}
