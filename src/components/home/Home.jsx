import Icon from '../../design/Icon.jsx'
import PieceRow from '../collection/PieceRow.jsx'
import ScoreCover from '../collection/ScoreCover.jsx'
import { PRACTICE_LIBRARY_FIXTURES } from '../../dev/fixturePaths.js'
import { getInstrument } from '../../features/instruments/instruments.js'
import './home.css'

export default function Home({
  fileName, pdfFile, practiceReady, instrumentId, pageNumber = 1,
  onNavigate, onLoadPiece, sampleLoading = false, sampleError = null,
}) {
  const instrument = getInstrument(instrumentId)
  const starters = PRACTICE_LIBRARY_FIXTURES.filter((piece) => piece.instrumentId === instrumentId && piece.difficulty === 'Beginner').slice(0, 3)
  const featured = starters[0]
  const canResume = Boolean(fileName && practiceReady)
  const title = canResume ? fileName.replace(/\.[^.]+$/, '').replace(/ - (Piano|Guitar)$/, '') : featured?.title
  const openFeatured = () => canResume ? onNavigate('practice') : featured && onLoadPiece?.(featured.id)

  return (
    <main className="cz-home" aria-labelledby="home-heading">
      <header className="cz-home__heading-line">
        <div><span className="cz-edition-label">The practice room</span><h1 id="home-heading">Today’s practice.</h1></div>
        <span className="cz-home__instrument">{instrument.label} <span aria-hidden="true">/</span> At your pace</span>
      </header>
      <div className="cz-home__stand">
        <section className="cz-home__featured" aria-labelledby="stand-title">
          <div className="cz-home__stand-heading"><span className="cz-edition-label">{canResume ? 'On your stand' : 'Begin with a short piece'}</span><span className="cz-home__page">{canResume ? `Page ${pageNumber}` : 'From the collection'}</span></div>
          <div className="cz-home__work"><h2 id="stand-title">{title || 'Your next piece'}</h2><p>{canResume ? `Your current score · ${instrument.label}` : `${featured?.attribution || ''} · ${instrument.label}`}</p></div>
          <div className="cz-home__score-stage"><ScoreCover file={canResume ? pdfFile : featured?.paths.pdf} pageNumber={canResume ? pageNumber : 1} /></div>
          <div className="cz-home__stand-footer">
            <span className="cz-home__score-context">{canResume ? 'Pick up where you left off.' : `${featured?.difficulty || 'Ready to explore'}${featured?.measureCount ? ` · ${featured.measureCount} measures` : ''}`}</span>
            <button type="button" className="cz-collection-button" aria-label={canResume ? 'Return to score' : `Open featured score: ${title}`} disabled={!canResume && (sampleLoading || !onLoadPiece || !featured)} onClick={openFeatured}><Icon name="play" size={17} />{sampleLoading ? 'Opening…' : canResume ? 'Return to score' : 'Open score'}</button>
          </div>
        </section>
        <aside className="cz-home__margin" aria-labelledby="practice-prompt-title">
          <span className="cz-edition-label">At the stand</span>
          <h2 id="practice-prompt-title">A passage at a time.</h2>
          <ol className="cz-home__practice-prompts">
            <li><span>Listen</span><p>Hear the phrase before you play it.</p></li>
            <li><span>Isolate</span><p>Loop a few bars. Leave room to listen to your hands.</p></li>
            <li><span>Repeat</span><p>Find a comfortable tempo, then bring it up gradually.</p></li>
          </ol>
          <div className="cz-home__bring"><p>Something else on your stand?</p><button type="button" className="cz-text-link" onClick={() => onNavigate('import')}>Bring your own score <Icon name="import" size={16} /></button></div>
        </aside>
      </div>
      {sampleError && <p className="cz-collection-error" role="alert">{sampleError} Open the piece again to retry.</p>}
      {fileName && !practiceReady && <p className="cz-collection-notice" role="status">Your score needs preparation. <button type="button" onClick={() => onNavigate('import')}>Continue import</button></p>}
      <section className="cz-home__collection" aria-labelledby="home-collection-heading">
        <div className="cz-home__section-heading"><h2 id="home-collection-heading">A little more repertoire</h2><button type="button" className="cz-text-link" onClick={() => onNavigate('library')}>Explore library <Icon name="next" size={16} /></button></div>
        <div className="cz-piece-list">{starters.map((piece, index) => <PieceRow key={piece.id} piece={piece} number={index + 1} onOpen={onLoadPiece} disabled={sampleLoading} />)}</div>
        <p className="cz-home__collection-note">Public-domain editions, ready to play.</p>
      </section>
    </main>
  )
}
