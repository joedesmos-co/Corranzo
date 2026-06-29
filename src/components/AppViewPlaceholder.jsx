export default function AppViewPlaceholder({
  title,
  message,
  actionLabel = null,
  onAction = null,
}) {
  return (
    <main className="app-view-placeholder" aria-live="polite">
      <h2 className="app-view-placeholder__title">{title}</h2>
      {message ? <p className="app-view-placeholder__message">{message}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="upload-btn app-view-placeholder__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </main>
  )
}
