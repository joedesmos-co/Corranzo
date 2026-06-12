import { dismissOnboarding } from '../features/session/practicePrefsStorage.js'

export default function LibraryWelcomeCard({ onDismiss, onTrySample, sampleLoading = false }) {
  function handleDismiss() {
    dismissOnboarding()
    onDismiss?.()
  }

  return (
    <section className="library-welcome" aria-label="Welcome">
      <h2 className="library-welcome__title">Welcome to ScoreFlow</h2>
      <p className="library-welcome__lead">
        Upload your sheet music and practice interactively.
      </p>
      <ol className="library-welcome__roles">
        <li>
          <strong>Sheet music (PDF)</strong> — the score you read
        </li>
        <li>
          <strong>Score timing (MusicXML/MXL)</strong> — where measures and notes live in time
        </li>
        <li>
          <strong>Sound (optional MIDI)</strong> — backing audio if you want it
        </li>
      </ol>
      <p className="library-welcome__note">
        For best accuracy, export MusicXML or MXL from MuseScore or your notation app — not a PDF
        scan alone.
      </p>
      <div className="library-welcome__actions">
        {onTrySample && (
          <button
            type="button"
            className="library-welcome__btn library-welcome__btn--sample"
            disabled={sampleLoading}
            onClick={onTrySample}
          >
            {sampleLoading ? 'Loading sample…' : 'Try sample piece'}
          </button>
        )}
        <button type="button" className="library-welcome__btn" onClick={handleDismiss}>
          Got it
        </button>
      </div>
    </section>
  )
}
