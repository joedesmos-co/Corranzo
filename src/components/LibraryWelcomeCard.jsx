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
          Practice sheet music with a score that follows you
        </h2>
        <p className="library-welcome__summary">
          Corranzo is a sheet music practice app. Upload PDF sheet music with MIDI and MusicXML
          files, then practice with synchronized playback and a moving score-follow cursor — so you
          can learn pieces more effectively.
        </p>
        <p className="library-welcome__lead">
          Try the built-in demo, or add your own files when you are ready.
        </p>
        <div className="library-welcome__actions">
          <button type="button" className="library-welcome__btn" onClick={handleDismiss}>
            Add your score
          </button>
          <FeedbackLink label="Email feedback" />
        </div>
      </div>

      {onTrySample && (
        <DemoPieceCard
          loading={sampleLoading}
          error={sampleError}
          onLoad={onTrySample}
          onRetry={onTrySample}
        />
      )}

      <div className="library-welcome__how" aria-label="How it works">
        <h3 className="library-welcome__section-title">How it works</h3>
        <ol className="library-welcome__steps">
          <li>
            <span>1</span>
            <strong>Add files</strong>
            <small>PDF + MusicXML</small>
          </li>
          <li>
            <span>2</span>
            <strong>Practice</strong>
            <small>Play, loop, or wait</small>
          </li>
          <li>
            <span>3</span>
            <strong>Stay local</strong>
            <small>No account</small>
          </li>
        </ol>
      </div>

      <p className="library-welcome__best">
        Best now: piano PDF + MusicXML/MIDI. Some PDFs may need setup.
      </p>

      <footer className="library-welcome__footer">
        <p className="library-welcome__privacy">{LOCAL_ONLY_MESSAGE}</p>
      </footer>
    </section>
  )
}
