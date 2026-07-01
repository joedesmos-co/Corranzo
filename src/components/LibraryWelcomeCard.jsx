import { dismissOnboarding } from '../features/session/practicePrefsStorage.js'
import {
  BETA_LABEL,
  LOCAL_ONLY_MESSAGE,
} from '../features/beta/betaInfo.js'
import DemoPieceCard from './DemoPieceCard.jsx'
import FeedbackLink from './FeedbackLink.jsx'
import CorranzoLogo from './CorranzoLogo.jsx'

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
        <CorranzoLogo className="library-welcome__logo" width={220} height={60} loading="eager" />
        <p className="library-welcome__eyebrow">{BETA_LABEL}</p>
        <h2 id="welcome-heading" className="library-welcome__title">
          Practice with a score that follows you
        </h2>
        <p className="library-welcome__summary">
          Corranzo helps you read a PDF score while playback and the cursor stay in sync. Try the
          demo first, then add your own sheet music and timing file when you are ready.
        </p>
        <p className="library-welcome__lead">
          MIDI is optional for backing sound. Your files stay in this browser.
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
        <h3 className="library-welcome__section-title practice-section__title--editorial">How it works</h3>
        <ol className="library-welcome__steps">
          <li>
            <span>1</span>
            <strong>Add files</strong>
            <small>PDF + timing</small>
          </li>
          <li>
            <span>2</span>
            <strong>Practice</strong>
            <small>Play, loop, wait</small>
          </li>
          <li>
            <span>3</span>
            <strong>Stay local</strong>
            <small>No account</small>
          </li>
        </ol>
      </div>

      <p className="library-welcome__best">
        Best setup: sheet music PDF + timing file. Add MIDI only when you want backing audio.
      </p>

      <footer className="library-welcome__footer">
        <p className="library-welcome__privacy">{LOCAL_ONLY_MESSAGE}</p>
      </footer>
    </section>
  )
}
