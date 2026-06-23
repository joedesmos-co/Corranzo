import { DEMO_PIECE } from '../dev/fixturePaths.js'

export default function DemoPieceCard({ loading = false, error = null, onLoad, compact = false }) {
  return (
    <article className={`demo-piece${compact ? ' demo-piece--compact' : ''}`}>
      <div className="demo-piece__copy">
        <p className="demo-piece__badge">Built-in demo</p>
        <h3 className="demo-piece__title">{DEMO_PIECE.title}</h3>
        <p className="demo-piece__subtitle">{DEMO_PIECE.subtitle}</p>
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
        <p className="demo-piece__error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
