import {
  MIC_PERMISSION,
  MIC_PERMISSION_LABELS,
  MIC_SUPPORT,
} from '../../features/microphone-input/micInputConstants.js'
import { isMicSafariOrIos } from '../../features/microphone-input/micEnvironment.js'
import {
  MIC_CALIBRATION_STATUS_LABELS,
} from '../../features/microphone-input/micCalibration.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'
import { MIC_CHORD_MODES } from '../../features/practice/waitForYouMatchSettings.js'
import MicTestPanel from './MicTestPanel.jsx'

const MIC_CHORD_MODE_HINTS = {
  [MIC_CHORD_MODES.ANY_TONE]: 'Experimental: play any correct chord tone (one note at a time).',
  [MIC_CHORD_MODES.BASS]: 'Experimental: listen for the lowest chord tone only.',
  [MIC_CHORD_MODES.TOP]: 'Experimental: listen for the highest chord tone only.',
}

export default function MicrophoneInputStatusPanel({
  support,
  permission,
  errorMessage,
  isGranted,
  isListening,
  lastHeardMidi,
  liveFrame = null,
  calibration = null,
  inputFeedback = null,
  isChordCheckpoint = false,
  chordMicMode = MIC_CHORD_MODES.ANY_TONE,
  onRequestAccess,
  onDisable,
  compact = false,
}) {
  const supported = support === MIC_SUPPORT.SUPPORTED
  const showIosSafari = isMicSafariOrIos()

  let statusLine = 'Mic off'
  if (!supported) {
    statusLine = 'Mic unavailable'
  } else if (permission === MIC_PERMISSION.DENIED) {
    statusLine = 'Mic blocked'
  } else if (permission === MIC_PERMISSION.ERROR) {
    statusLine = 'Mic error'
  } else if (isListening) {
    statusLine = 'Mic listening'
  } else if (isGranted) {
    statusLine = 'Mic ready'
  }

  const heardLine =
    inputFeedback?.message ??
    (lastHeardMidi != null
      ? `Last confirmed note: ${midiToNoteLabel(lastHeardMidi)}`
      : liveFrame?.noteLabel
        ? `Hearing ${liveFrame.noteLabel}…`
        : null)

  return (
    <section
      className={`practice-section mic-input-status${compact ? ' practice-section--compact' : ''}`}
      aria-label="Microphone input"
    >
      <div className="practice-input-status__header">
        <h3 className="practice-section__title practice-section__title--static">Input</h3>
        <span
          className={`practice-status-chip${
            isListening || isGranted ? ' practice-status-chip--ready' : ''
          }`}
        >
          {statusLine}
        </span>
      </div>

      {heardLine && (
        <p
          className={`mic-input-status__heard${
            inputFeedback?.tone === 'error'
              ? ' mic-input-status__heard--wrong'
              : inputFeedback?.tone === 'success'
                ? ' mic-input-status__heard--correct'
                : ''
          }`}
          role="status"
          aria-live="polite"
        >
          {heardLine}
        </p>
      )}

      {!compact && supported && (
        <dl className="mic-input-status__grid">
          <div>
            <dt>Access</dt>
            <dd>{MIC_PERMISSION_LABELS[permission] ?? permission}</dd>
          </div>
          <div>
            <dt>Last confirmed</dt>
            <dd>{lastHeardMidi != null ? midiToNoteLabel(lastHeardMidi) : '—'}</dd>
          </div>
        </dl>
      )}

      {errorMessage && permission === MIC_PERMISSION.ERROR && (
        <p className="practice-section__error" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="mic-input-status__actions">
        {supported && !isGranted && (
          <button type="button" className="mic-input-status__btn" onClick={onRequestAccess}>
            Enable microphone
          </button>
        )}
        {supported && isGranted && (
          <button type="button" className="mic-input-status__btn" onClick={onDisable}>
            Stop microphone
          </button>
        )}
      </div>

      {compact && (
        <details className="practice-input-details">
          <summary>Test & details</summary>
          {showIosSafari && (
            <p className="mic-input-status__safari" role="note">
              Mic input may be less steady on iPhone and iPad. Manual always works.
            </p>
          )}
          {isListening && (liveFrame?.calibrating || calibration) && (
            <p
              className={`mic-input-status__calibration mic-input-status__calibration--${
                liveFrame?.calibrating ? 'measuring' : calibration?.status ?? 'ready'
              }`}
              role="status"
              aria-live="polite"
            >
              {liveFrame?.calibrating
                ? MIC_CALIBRATION_STATUS_LABELS.measuring
                : MIC_CALIBRATION_STATUS_LABELS[calibration?.status] ?? ''}
            </p>
          )}
          <p className="mic-input-status__mvp-note">
            Listens for one note at a time. Use Continue if a note is missed.
          </p>
          {isChordCheckpoint && (
            <p className="mic-input-status__chord-note" role="note">
              {MIC_CHORD_MODE_HINTS[chordMicMode] ??
                MIC_CHORD_MODE_HINTS[MIC_CHORD_MODES.ANY_TONE]}
            </p>
          )}
          <MicTestPanel
            liveFrame={liveFrame}
            lastStableMidi={lastHeardMidi}
            isListening={isListening}
          />
        </details>
      )}
    </section>
  )
}
