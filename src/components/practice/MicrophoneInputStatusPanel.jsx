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

function downloadMicDebugJson(json, prefix = 'scoreflow-mic-debug') {
  if (!json || typeof document === 'undefined') {
    return
  }
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${prefix}-${Date.now()}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * Simplified microphone panel. The main path is just a state line — permission
 * and calibration start automatically when Microphone is chosen, so there is no
 * "enable"/"test" button here. Test meter, access details and recovery controls
 * live under a collapsed "Troubleshooting" disclosure.
 */
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
  onExportDebugFrames,
  onExportMicTrace,
  compact = false,
}) {
  const supported = support === MIC_SUPPORT.SUPPORTED
  const showIosSafari = isMicSafariOrIos()
  const calibrating = Boolean(isListening && (liveFrame?.calibrating || !calibration))
  const calibrationFailed =
    calibration?.status === MIC_CALIBRATION_STATUS.NO_INPUT ||
    calibration?.status === MIC_CALIBRATION_STATUS.ROOM_NOISY
  const calibrationReady = calibration?.status === MIC_CALIBRATION_STATUS.READY
  const showDeveloperTraceExport = Boolean(import.meta.env?.DEV && onExportMicTrace)

  let statusLine = 'Starting microphone...'
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
  } else {
    statusLine = 'Starting microphone...'
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
        <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">
          Microphone
        </h3>
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

      {isChordCheckpoint && inputFeedback?.heardLabels?.length > 0 && (
        <p className="mic-input-status__chord-progress" role="status">
          Heard: {inputFeedback.heardLabels.join(' + ')}
          {inputFeedback.remainingLabels?.length
            ? `. Still need: ${inputFeedback.remainingLabels.join(', ')}`
            : ''}
        </p>
      )}

      {supported && !isGranted && permission === MIC_PERMISSION.DENIED && (
        <p className="mic-input-status__blocked" role="status">
          Microphone access is blocked. Allow it in your browser, or switch to MIDI above.
        </p>
      )}

      {errorMessage && permission === MIC_PERMISSION.ERROR && (
        <p className="practice-section__error" role="alert">
          {errorMessage}
        </p>
      )}

      {isChordCheckpoint && (
        <p className="mic-input-status__chord-note" role="note">
          {MIC_CHORD_MODE_HINTS[chordMicMode] ?? MIC_CHORD_MODE_HINTS[MIC_CHORD_MODES.ANY_TONE]}
        </p>
      )}

      <details className="practice-input-details mic-input-status__troubleshooting">
        <summary>Troubleshooting</summary>

        {showIosSafari && (
          <p className="mic-input-status__safari" role="note">
            Mic input may be less steady on iPhone and iPad. Manual always works.
          </p>
        )}

        <p className="mic-input-status__mvp-note">
          Best for single notes. Use MIDI for chords played together.
        </p>

        {supported && (
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

        <MicTestPanel
          liveFrame={liveFrame}
          lastStableMidi={lastHeardMidi}
          isListening={isListening}
        />

        <div className="mic-input-status__actions">
          {supported && !isGranted && onRequestAccess && (
            <button type="button" className="mic-input-status__btn" onClick={onRequestAccess}>
              Enable microphone
            </button>
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
          {supported && isGranted && onDisable && (
            <button type="button" className="mic-input-status__btn" onClick={onDisable}>
              Stop microphone
            </button>
          )}
          {onExportDebugFrames && (
            <button
              type="button"
              className="mic-input-status__btn mic-input-status__btn--debug"
              onClick={() => downloadMicDebugJson(onExportDebugFrames())}
            >
              Export mic debug JSON
            </button>
          )}
          {showDeveloperTraceExport && (
            <button
              type="button"
              className="mic-input-status__btn mic-input-status__btn--debug"
              onClick={() => downloadMicDebugJson(onExportMicTrace(), 'scoreflow-mic-trace')}
            >
              Export recent mic trace
            </button>
          )}
        </div>
      </details>
    </section>
  )
}
