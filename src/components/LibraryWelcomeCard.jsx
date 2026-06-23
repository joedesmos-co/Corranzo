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
        Upload a <strong>PDF</strong> to read and <strong>MusicXML/MXL</strong> for timing
        (MIDI optional for sound), then practice interactively.
      </p>
      {onTrySample && (
        <p className="library-welcome__note">
          New here? Try the sample piece to see it in action.
        </p>
      )}
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
