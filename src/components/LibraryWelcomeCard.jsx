import { dismissOnboarding } from '../features/session/practicePrefsStorage.js'
import {
  BETA_LABEL,
  LOCAL_ONLY_MESSAGE,
} from '../features/beta/betaInfo.js'
import DemoPieceCard from './DemoPieceCard.jsx'
import FeedbackButton from './FeedbackButton.jsx'

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
          Practice with the score in front of you.
        </h2>
        <p className="library-welcome__lead">
          Load a PDF and MusicXML. ScoreFlow follows along, loops passages, and can wait
          for you.
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
          <FeedbackButton
            label="Copy feedback prompt"
            copiedLabel="Copied — send to your beta contact"
          />
          <button type="button" className="library-welcome__btn" onClick={handleDismiss}>
            Continue to Library
          </button>
        </div>
      </footer>
    </section>
  )
}
