import Icon from '../../design/Icon.jsx'
import PieceRow from '../collection/PieceRow.jsx'
import ScoreCover from '../collection/ScoreCover.jsx'
import { PRACTICE_LIBRARY_FIXTURES } from '../../dev/fixturePaths.js'
import { getInstrument } from '../../features/instruments/instruments.js'
import './home.css'

export default function Home({
  fileName,
  pdfFile,
  practiceReady,
  instrumentId,
  pageNumber = 1,
  onNavigate,
  onLoadPiece,
  sampleLoading = false,
  sampleError = null,
}) {
  const instrument = getInstrument(instrumentId)
  const starters = PRACTICE_LIBRARY_FIXTURES.filter((piece) => piece.instrumentId === instrumentId && piece.difficulty === 'Beginner').slice(0, 3)
  const featured = starters[0]
  const canResume = Boolean(fileName && practiceReady)
  const title = canResume ? fileName.replace(/\.[^.]+$/, '').replace(/ - (Piano|Guitar)$/, '') : featured?.title
  const openFeatured = () => canResume ? onNavigate('practice') : onLoadPiece?.(featured.id)

  return (
    <main className="cz-home" aria-labelledby="home-heading">
      <div className="cz-home__heading-line">
        <span className="cz-edition-label">Your practice room</span>
        <span className="cz-home__instrument">For {instrument.label.toLowerCase()} <span aria-hidden="true">/</span> At your pace</span>
      </div>
      <section className="cz-home__hero" aria-labelledby="home-heading">
        <div className="cz-home__welcome">
          <h1 id="home-heading">{canResume ? <>Back to<br />the <em>music.</em></> : <>Make room<br />for <em>music.</em></>}</h1>
          <p className="cz-home__lede">{canResume ? 'Your music is right here. Open the score and find your next phrase.' : 'A quiet place to hear your score, find your rhythm, and make a piece your own.'}</p>
          <button type="button" className="cz-collection-button" onClick={canResume ? openFeatured : () => onNavigate('import')}>
            <Icon name={canResume ? 'play' : 'import'} size={18} />
            {canResume ? 'Return to score' : 'Bring your own score'}
          </button>
          <p className="cz-home__footnote">{canResume ? `Page ${pageNumber} · ${instrument.label}` : 'Start with a PDF, or open a piece from the collection.'}</p>
        </div>
        <div className="cz-home__featured">
          <div className="cz-home__stand-heading">
            <span>{canResume ? 'On your music stand' : 'A good place to begin'}</span>
            <Icon name="music" size={19} />
          </div>
          <div className="cz-home__score-stage">
            <div className="cz-home__score-backing" />
            <ScoreCover file={canResume ? pdfFile : featured?.paths.pdf} />
            <span className="cz-home__edition" aria-hidden="true">CORRANZO / SCORE EDITIONS</span>
          </div>
          <div className="cz-home__featured-caption">
            <div>
              <h2>{title || 'Your next piece'}</h2>
              <p>{canResume ? 'Your current score' : `${featured?.attribution} · ${featured?.difficulty}`}</p>
            </div>
            <button type="button" className="cz-home__open-featured" aria-label={canResume ? `Reopen ${title}` : `Open featured score: ${title}`} disabled={!canResume && (sampleLoading || !onLoadPiece)} onClick={openFeatured}>
              <Icon name={sampleLoading ? 'clock' : 'next'} size={22} />
            </button>
          </div>
        </div>
      </section>
      {sampleError && <p className="cz-collection-error" role="alert">{sampleError} Open the piece again to retry.</p>}
      {fileName && !practiceReady && <p className="cz-collection-notice" role="status">Your score needs preparation. <button type="button" onClick={() => onNavigate('import')}>Continue import</button></p>}
      <section className="cz-home__collection" aria-labelledby="home-collection-heading">
        <div className="cz-home__section-heading">
          <div><span className="cz-edition-label">From the collection</span><h2 id="home-collection-heading">Start with something small.</h2></div>
          <button type="button" className="cz-text-link" onClick={() => onNavigate('library')}>Explore library <Icon name="next" size={16} /></button>
        </div>
        <div className="cz-piece-list">
          {starters.map((piece, index) => <PieceRow key={piece.id} piece={piece} number={index + 1} onOpen={onLoadPiece} disabled={sampleLoading} />)}
        </div>
        <p className="cz-home__collection-note">Public-domain editions. Ready to open, hear, and practice.</p>
      </section>
      <div className="cz-home__closing"><Icon name="music" size={17} /><span>A score. A little time. Something that stays with you.</span></div>
    </main>
  )
}
