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
        {!pdfFileName && (
          <span className="practice-files__hint">Your score appears in the center panel.</span>
        )}
      </div>
      <div className={`practice-files__item${hasMusicXml ? ' practice-files__item--ok' : ''}`}>
        <span className="practice-files__label-row">
          <span className="practice-files__label">Timing file</span>
          <PracticeHelpTip label="About timing files">
            MusicXML/MXL (or future MuseScore source files) tells Corranzo where measures and beats
            fall in time — measure display, loops, Wait For You, and the score cursor. PDF alone cannot
            provide this; MIDI is playback only.
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
              : 'Missing — add a timing file in Library'}
        </span>
        {timingError && (
          <span className="practice-files__hint practice-files__hint--error practice-files__hint--wrap" role="alert">
            {timingError}
          </span>
        )}
        {!hasMusicXml && !timingError && (
          <span className="practice-files__hint practice-empty-state practice-files__hint--wrap">
            A timing file is required — export MusicXML or MXL from MuseScore or your notation app.
          </span>
        )}
      </div>
      <div className={`practice-files__item${hasMidi ? ' practice-files__item--ok' : ''}`}>
        <span className="practice-files__label-row">
          <span className="practice-files__label">Sound file</span>
          <PracticeHelpTip label="About the sound file">
            Optional MIDI backing audio for Normal playback. Not required for timing-only practice
            or Wait For You.
          </PracticeHelpTip>
        </span>
        <span
          className="practice-files__value practice-files__value--truncate"
          title={hasMidi ? playbackFileName || undefined : undefined}
        >
          {hasMidi ? playbackFileName || 'Loaded' : 'Optional — add from Library'}
        </span>
        {!hasMidi && (
          <span className="practice-files__hint practice-files__hint--wrap">
            Optional — add a MIDI file in Library if you want backing audio while you practice.
          </span>
        )}
      </div>
    </div>
  )
}
