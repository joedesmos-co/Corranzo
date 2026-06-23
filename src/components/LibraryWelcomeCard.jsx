import { dismissOnboarding } from '../features/session/practicePrefsStorage.js'
import {
  BETA_LABEL,
  LOCAL_ONLY_MESSAGE,
} from '../features/beta/betaInfo.js'
import DemoPieceCard from './DemoPieceCard.jsx'
import FeedbackLink from './FeedbackLink.jsx'

export default function LibraryWelcomeCard({
  onDismiss,
  onTrySample,
  sampleLoading = false,
  sampleError = null,
}) {
  function handleDismiss() {
    dismissOnboarding()
    onDismiss?.()
  }

  return (
    <section className="library-welcome" aria-labelledby="welcome-heading">
      <div className="library-welcome__intro">
        <p className="library-welcome__eyebrow">{BETA_LABEL}</p>
        <h2 id="welcome-heading" className="library-welcome__title">
          Practice music with a score that follows you.
        </h2>
        <p className="library-welcome__lead">
          Corranzo is an early beta. Load a PDF with MusicXML, then follow the score,
          loop passages, or use Wait For You.
        </p>
      </div>

      <div className="library-welcome__how" aria-label="How it works">
        <h3 className="library-welcome__section-title">How it works</h3>
        <ol className="library-welcome__steps">
          <li>
            <span>1</span>
            <strong>Add a score</strong>
            <small>PDF + MusicXML</small>
          </li>
          <li>
            <span>2</span>
            <strong>Practice</strong>
            <small>Play, loop, or wait</small>
          </li>
          <li>
            <span>3</span>
            <strong>Keep your history</strong>
            <small>Stored on this device</small>
          </li>
        </ol>
      </div>

      <div className="library-welcome__works" aria-label="What works best right now">
        <h3 className="library-welcome__section-title">What works best right now</h3>
        <ul>
          <li>Piano PDF + MusicXML/MIDI</li>
          <li>Demo piece included</li>
          <li>Some PDFs may need setup</li>
        </ul>
      </div>

      {onTrySample && (
        <DemoPieceCard
          loading={sampleLoading}
          error={sampleError}
          onLoad={onTrySample}
        />
      )}

      <footer className="library-welcome__footer">
        <p className="library-welcome__privacy">{LOCAL_ONLY_MESSAGE}</p>
        <div className="library-welcome__actions">
          <FeedbackLink label="Email feedback" />
          <button type="button" className="library-welcome__btn" onClick={handleDismiss}>
            Start practicing
          </button>
        </div>
      </footer>
    </section>
  )
}
