import {
  MIC_PERMISSION,
  MIC_PERMISSION_LABELS,
  MIC_SUPPORT,
} from '../../features/microphone-input/micInputConstants.js'
import { isMicSafariOrIos } from '../../features/microphone-input/micEnvironment.js'
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
  inputFeedback = null,
  isChordCheckpoint = false,
  chordMicMode = MIC_CHORD_MODES.ANY_TONE,
  onRequestAccess,
  onDisable,
  compact = false,
}) {
  const supported = support === MIC_SUPPORT.SUPPORTED
  const showIosSafari = isMicSafariOrIos()

  let statusLine = 'Enable your microphone to play along.'
  if (!supported) {
    statusLine = 'Microphone input is not available in this browser.'
  } else if (permission === MIC_PERMISSION.DENIED) {
    statusLine =
      'Microphone access was blocked. Allow the mic in your browser settings, or choose Manual continue below.'
  } else if (permission === MIC_PERMISSION.ERROR) {
    statusLine = errorMessage || 'Could not open the microphone.'
  } else if (isListening) {
    statusLine = 'Listening for single notes — works best in a quiet room.'
  } else if (isGranted) {
    statusLine = 'Microphone ready — use the test area below, then play the highlighted note.'
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
      <h3 className="practice-section__title practice-section__title--static">Microphone</h3>

      {showIosSafari && (
        <p className="mic-input-status__safari" role="note">
          On iPhone or iPad, microphone listening can be less steady. Use Manual continue anytime,
          or try Chrome on a computer with a MIDI keyboard for the most reliable match.
        </p>
      )}

      <p className="practice-section__hint practice-section__hint--inline">{statusLine}</p>

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

      <p className="mic-input-status__mvp-note">
        Microphone mode listens for one note at a time — not full chords. Manual continue always
        works if a note is missed.
      </p>

      {isChordCheckpoint && (
        <p className="mic-input-status__chord-note" role="note">
          {MIC_CHORD_MODE_HINTS[chordMicMode] ?? MIC_CHORD_MODE_HINTS[MIC_CHORD_MODES.ANY_TONE]}
        </p>
      )}

      <MicTestPanel
        liveFrame={liveFrame}
        lastStableMidi={lastHeardMidi}
        isListening={isListening}
      />

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
    </section>
  )
}
