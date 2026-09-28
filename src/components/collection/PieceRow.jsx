import Icon from '../../design/Icon.jsx'

/** A score is a title and a way in, not a collection of nested panels. */
export default function PieceRow({ piece, number, onOpen, disabled = false, opening = false }) {
  return (
    <article className="cz-piece-row">
      <span className="cz-piece-row__number" aria-hidden="true">{String(number).padStart(2, '0')}</span>
      <div className="cz-piece-row__work">
        <h3 className="cz-piece-row__title">{piece.title || 'Untitled score'}</h3>
        <p className="cz-piece-row__composer">{piece.attribution}</p>
      </div>
      <span className="cz-piece-row__level">{piece.difficulty}</span>
      <span className="cz-piece-row__duration">{piece.approxDuration}</span>
      <button
        type="button"
        className="cz-piece-row__open"
        aria-label={`Open score: ${piece.title || 'Untitled score'}`}
        disabled={disabled || !onOpen}
        onClick={() => onOpen(piece.id)}
      >
        <span>{opening ? 'Opening…' : 'Open score'}</span>
        <Icon name="next" size={18} />
      </button>
    </article>
  )
}
