import { DEMO_PIECE } from '../dev/fixturePaths.js'

export default function DemoPieceCard({
  loading = false,
  error = null,
  onLoad,
  onRetry,
  compact = false,
}) {
  const retry = onRetry ?? onLoad

  return (
    <article className={`demo-piece${compact ? ' demo-piece--compact' : ''}`}>
      <div className="demo-piece__copy">
        <p className="demo-piece__badge">Built-in demo</p>
        <h3 className="demo-piece__title">{DEMO_PIECE.title}</h3>
        <p className="demo-piece__subtitle">
          {DEMO_PIECE.subtitle}
          {DEMO_PIECE.measureCount != null && DEMO_PIECE.pageCount != null
            ? ` · ${DEMO_PIECE.measureCount} measures · ${DEMO_PIECE.pageCount} pages`
            : ''}
        </p>
      </div>
      <div className="demo-piece__action">
        <button
          type="button"
          className="demo-piece__button"
          disabled={loading}
          onClick={onLoad}
        >
          {loading ? 'Opening…' : 'Try demo'}
        </button>
        <p className="demo-piece__credit">{DEMO_PIECE.attribution}</p>
      </div>
      {error && (
        <div className="demo-piece__error-block" role="alert">
          <p className="demo-piece__error">{error}</p>
          {retry && (
            <button
              type="button"
              className="demo-piece__retry"
              disabled={loading}
              onClick={retry}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </article>
  )
}
