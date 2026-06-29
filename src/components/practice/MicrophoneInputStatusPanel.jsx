import {
  MIC_PERMISSION,
  MIC_PERMISSION_LABELS,
  MIC_SUPPORT,
} from '../../features/microphone-input/micInputConstants.js'
import { isMicSafariOrIos } from '../../features/microphone-input/micEnvironment.js'
import {
  MIC_CALIBRATION_STATUS,
  MIC_CALIBRATION_STATUS_LABELS,
} from '../../features/microphone-input/micCalibration.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'
import { MIC_CHORD_MODES } from '../../features/practice/waitForYouMatchSettings.js'
import MicTestPanel from './MicTestPanel.jsx'

const MIC_CHORD_MODE_HINTS = {
  [MIC_CHORD_MODES.ANY_TONE]:
    'Mic hears one note at a time. Play each chord tone in turn, or switch to MIDI for chords together.',
  [MIC_CHORD_MODES.BASS]:
    'Experimental: mic listens for the lowest chord tone only. MIDI is best for full chords.',
  [MIC_CHORD_MODES.TOP]:
    'Experimental: mic listens for the highest chord tone only. MIDI is best for full chords.',
}

function calibrationLabel({ liveFrame, calibration }) {
  if (liveFrame?.calibrating || calibration?.status === MIC_CALIBRATION_STATUS.MEASURING) {
    return MIC_CALIBRATION_STATUS_LABELS[MIC_CALIBRATION_STATUS.MEASURING]
  }
  if (calibration?.status) {
    return MIC_CALIBRATION_STATUS_LABELS[calibration.status] ?? ''
  }
  return MIC_CALIBRATION_STATUS_LABELS[MIC_CALIBRATION_STATUS.READY]
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
  onRetryCalibration,
  compact = false,
}) {
  const supported = support === MIC_SUPPORT.SUPPORTED
  const showIosSafari = isMicSafariOrIos()
  const calibrating = Boolean(isListening && (liveFrame?.calibrating || !calibration))
  const calibrationFailed =
    calibration?.status === MIC_CALIBRATION_STATUS.NO_INPUT ||
    calibration?.status === MIC_CALIBRATION_STATUS.ROOM_NOISY
  const calibrationReady = calibration?.status === MIC_CALIBRATION_STATUS.READY

  let statusLine = 'Mic off'
  if (!supported) {
    statusLine = 'Mic unavailable'
  } else if (permission === MIC_PERMISSION.DENIED) {
    statusLine = 'Mic blocked'
  } else if (permission === MIC_PERMISSION.ERROR) {
    statusLine = 'Mic error'
  } else if (isListening && calibrating) {
    statusLine = 'Calibrating…'
  } else if (isListening) {
    statusLine = calibrationReady ? 'Mic ready' : 'Mic listening'
  } else if (isGranted) {
    statusLine = 'Mic ready'
  }

  const detectedNote =
    liveFrame?.noteLabel && liveFrame?.gateOpen ? liveFrame.noteLabel : null
  const heardLine =
    inputFeedback?.message ??
    (lastHeardMidi != null
      ? `Last confirmed: ${midiToNoteLabel(lastHeardMidi)}`
      : detectedNote
        ? `Detecting ${detectedNote}…`
        : null)

  return (
    <section
      className={`practice-section mic-input-status${compact ? ' practice-section--compact' : ''}`}
      aria-label="Microphone input"
    >
      <div className="practice-input-status__header">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">Input</h3>
        <span
          className={`practice-status-chip${
            isListening && (calibrationReady || !calibrating) ? ' practice-status-chip--ready' : ''
          }`}
        >
          {statusLine}
        </span>
      </div>

      {isListening && (
        <p
          className={`mic-input-status__calibration mic-input-status__calibration--${
            calibrating ? 'measuring' : calibration?.status ?? 'ready'
          }`}
          role="status"
          aria-live="polite"
        >
          {calibrationLabel({ liveFrame, calibration })}
        </p>
      )}

      {isListening && calibrationFailed && onRetryCalibration && (
        <button
          type="button"
          className="mic-input-status__btn mic-input-status__btn--retry"
          onClick={onRetryCalibration}
        >
          Retry calibration
        </button>
      )}

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

      {isChordCheckpoint && (
        <p className="mic-input-status__chord-note" role="note">
          {MIC_CHORD_MODE_HINTS[chordMicMode] ?? MIC_CHORD_MODE_HINTS[MIC_CHORD_MODES.ANY_TONE]}
        </p>
      )}

      {compact && (
        <details className="practice-input-details">
          <summary>Test & details</summary>
          {showIosSafari && (
            <p className="mic-input-status__safari" role="note">
              Mic input may be less steady on iPhone and iPad. Manual always works.
            </p>
          )}
          <p className="mic-input-status__mvp-note">
            Best for single notes. Use MIDI for chords played together.
          </p>
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
