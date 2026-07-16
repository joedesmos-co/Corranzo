import PracticeHelpTip from './PracticeHelpTip.jsx'

export default function PracticeFilesSummary({
  pdfFileName,
  hasMidi,
  hasMusicXml,
  playbackFileName,
  timingFileName,
  timingError = null,
  timingLoading = false,
}) {
  return (
    <div className="practice-files" aria-label="Loaded files">
      <div className={`practice-files__item${pdfFileName ? ' practice-files__item--ok' : ''}`}>
        <span className="practice-files__label">Sheet music (PDF)</span>
        <span className="practice-files__value practice-files__value--truncate" title={pdfFileName || undefined}>
          {pdfFileName || 'Not loaded — open from Library'}
        </span>
      </div>
      <div className={`practice-files__item${hasMusicXml ? ' practice-files__item--ok' : ''}`}>
        <span className="practice-files__label-row">
          <span className="practice-files__label">Timing file</span>
          <PracticeHelpTip label="About timing files">
            MusicXML/MXL supplies measures and beats for loops, Wait For You, and the score cursor.
            PDF alone cannot; MIDI is playback only.
          </PracticeHelpTip>
        </span>
        <span
          className="practice-files__value practice-files__value--truncate"
          title={hasMusicXml ? timingFileName || undefined : undefined}
        >
          {timingLoading
            ? 'Loading…'
            : hasMusicXml
              ? timingFileName || 'Loaded'
              : 'Not added yet'}
        </span>
        {timingError && (
          <span className="practice-files__hint practice-files__hint--error practice-files__hint--wrap" role="alert">
            {timingError}
          </span>
        )}
        {!hasMusicXml && !timingError && (
          <span className="practice-files__hint practice-empty-state practice-files__hint--wrap">
            Required — add MusicXML/MXL in Library.
          </span>
        )}
      </div>
      <div className={`practice-files__item${hasMidi ? ' practice-files__item--ok' : ''}`}>
        <span className="practice-files__label-row">
          <span className="practice-files__label">Sound file</span>
          <PracticeHelpTip label="About the sound file">
            Optional MIDI backing for Normal playback. Not required for Wait For You.
          </PracticeHelpTip>
        </span>
        <span
          className="practice-files__value practice-files__value--truncate"
          title={hasMidi ? playbackFileName || undefined : undefined}
        >
          {hasMidi ? playbackFileName || 'Loaded' : 'Not added (optional)'}
        </span>
      </div>
    </div>
  )
}
