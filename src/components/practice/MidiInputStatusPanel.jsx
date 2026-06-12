import {
  WEB_MIDI_PERMISSION_LABELS,
  WEB_MIDI_SUPPORT,
} from '../../features/midi-input/webMidiConstants.js'
import { isSafariPlaybackLimited } from '../../features/platform/browserPracticeSupport.js'

export default function MidiInputStatusPanel({
  support,
  permission,
  devices,
  lastNote,
  errorMessage,
  isGranted,
  onRequestAccess,
  onRefreshDevices,
  listenHint,
  compact = false,
}) {
  const supported = support === WEB_MIDI_SUPPORT.SUPPORTED
  const isSafari = isSafariPlaybackLimited()

  return (
    <section
      className={`practice-section midi-input-status${compact ? ' practice-section--compact' : ''}`}
      aria-label="MIDI keyboard"
    >
      <h3 className="practice-section__title practice-section__title--static">MIDI keyboard</h3>

      <p className="practice-section__hint practice-section__hint--inline">
        {isGranted
          ? devices.length > 0
            ? `${devices.length} device(s) connected`
            : 'No keyboard detected — plug one in and refresh'
          : isSafari
            ? 'Web MIDI is limited on Safari — try Chrome or Edge for a MIDI keyboard, or use Manual continue'
            : supported
              ? 'Allow access to hear your playing in Wait For You'
              : 'Web MIDI is not available in this browser — try Chrome or Edge, or use Manual continue'}
        {lastNote ? ` · Last: ${lastNote.label}` : ''}
      </p>

      {!compact && (
        <dl className="midi-input-status__grid">
          <div>
            <dt>Browser</dt>
            <dd>{supported ? 'Supported' : 'Not supported'}</dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>{WEB_MIDI_PERMISSION_LABELS[permission] ?? permission}</dd>
          </div>
          <div>
            <dt>Devices</dt>
            <dd>{devices.length > 0 ? devices.length : 'None connected'}</dd>
          </div>
          <div>
            <dt>Last note</dt>
            <dd>{lastNote ? lastNote.label : '—'}</dd>
          </div>
        </dl>
      )}

      {errorMessage && <p className="practice-section__error">{errorMessage}</p>}
      {listenHint && <p className="practice-section__hint">{listenHint}</p>}

      <div className="midi-input-status__actions">
        {supported && !isGranted && (
          <button type="button" className="midi-input-status__btn" onClick={onRequestAccess}>
            Enable MIDI keyboard
          </button>
        )}
        {supported && isGranted && !compact && (
          <button type="button" className="midi-input-status__btn" onClick={onRefreshDevices}>
            Refresh devices
          </button>
        )}
      </div>
    </section>
  )
}
