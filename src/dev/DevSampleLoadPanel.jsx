import { DEMO_PIECE } from './fixturePaths.js'

export default function DevSampleLoadPanel({ loading, error, onLoad }) {
  return (
    <div className="library-sample panel panel--sample">
      <p className="library-sample__badge">Demo score</p>
      <h2 className="panel__title">Try sample piece</h2>
      <p className="panel__hint">
        <strong>{DEMO_PIECE.title}</strong> — {DEMO_PIECE.measureCount} measures across{' '}
        {DEMO_PIECE.pageCount} pages with real sheet music, timing, and playback. One click loads
        everything and opens Practice.
      </p>
      <ul className="library-sample__features">
        <li>Score cursor &amp; loops</li>
        <li>Wait For You &amp; note guide</li>
        <li>Dense piano playback</li>
      </ul>
      <button
        type="button"
        className="upload-btn upload-btn--sample"
        disabled={loading}
        onClick={onLoad}
      >
        {loading ? 'Loading demo score…' : 'Try sample piece'}
      </button>
      {error && (
        <p className="panel__error" role="alert">
          {error}
        </p>
      )}
      <p className="library-sample__credit">{DEMO_PIECE.attribution}</p>
    </div>
  )
}
