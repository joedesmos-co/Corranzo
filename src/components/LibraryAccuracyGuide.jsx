import { ACCURACY_TIERS, evaluateAccuracySetup } from '../features/import/accuracyGuide.js'
import { formatScoreTimingExtensionsList } from '../features/import/sourceNotationFiles.js'

export default function LibraryAccuracyGuide({ hasPdf, hasMusicXml }) {
  const status = evaluateAccuracySetup({ hasPdf, hasMusicXml })
  const extensions = formatScoreTimingExtensionsList()

  return (
    <section className="library-accuracy-guide" aria-label="Accuracy">
      <p
        className={`library-accuracy-guide__status library-accuracy-guide__status--${status.tierId}`}
        role="status"
      >
        <strong>{status.headline}</strong>
        <span className="library-accuracy-guide__status-detail"> {status.detail}</span>
      </p>

      <details className="library-accuracy-guide__more">
        <summary>Why MusicXML matters</summary>
        <div className="library-accuracy-guide__body">
          <p className="library-accuracy-guide__intro">
            Corranzo is most accurate with <strong>MusicXML or MXL</strong> from your notation app.
            A PDF alone is great for reading, but cannot tell the app exactly which note is which.
          </p>

          <ul className="library-accuracy-guide__tiers">
            {ACCURACY_TIERS.map((tier) => (
              <li
                key={tier.id}
                className={`library-accuracy-guide__tier${
                  status.tierId === tier.id ? ' library-accuracy-guide__tier--active' : ''
                }`}
              >
                <p className="library-accuracy-guide__tier-label">{tier.label}</p>
                <p className="library-accuracy-guide__tier-summary">{tier.summary}</p>
                <p className="library-accuracy-guide__tier-detail">{tier.detail}</p>
              </li>
            ))}
          </ul>

          <dl className="library-accuracy-guide__roles">
            <div>
              <dt>1 — Sheet music</dt>
              <dd>PDF — what you read on screen</dd>
            </div>
            <div>
              <dt>2 — Score timing</dt>
              <dd>
                {extensions} — measures, Wait For You, score follow (.mxl, .musicxml, .xml today)
              </dd>
            </div>
            <div>
              <dt>3 — Sound (optional)</dt>
              <dd>MIDI — backing audio only, not timing</dd>
            </div>
          </dl>
        </div>
      </details>
    </section>
  )
}
