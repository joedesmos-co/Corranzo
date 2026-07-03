import { DEMO_PIECE } from '../dev/fixturePaths.js'

export default function DemoPieceCard({
  demoPiece = DEMO_PIECE,
  loading = false,
  error = null,
  onLoad,
  onRetry,
  compact = false,
}) {
  const retry = onRetry ?? onLoad

  return (
    <article
      className={`demo-piece${compact ? ' demo-piece--compact' : ''}`}
      aria-labelledby="demo-piece-title"
    >
      <div className="demo-piece__copy">
        <p className="demo-piece__badge">Demo piece</p>
        <h3 id="demo-piece-title" className="demo-piece__title">
          {demoPiece.title}
        </h3>
        <p className="demo-piece__intro">No files needed. Open this and press Play.</p>
        <p className="demo-piece__subtitle">
          {demoPiece.subtitle}
          {demoPiece.measureCount != null && demoPiece.pageCount != null
            ? ` · ${demoPiece.measureCount} measures · ${demoPiece.pageCount} pages`
            : ''}
        </p>
      </div>
      <div className="demo-piece__action">
        <button
          type="button"
          className="demo-piece__button"
          disabled={loading}
          onClick={onLoad}
          aria-label={`Try demo: ${demoPiece.title}`}
        >
          {loading ? 'Opening…' : 'Try Demo Piece'}
        </button>
        <p className="demo-piece__credit">{demoPiece.attribution}</p>
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
              aria-label={`Retry loading demo: ${demoPiece.title}`}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </article>
  )
}
