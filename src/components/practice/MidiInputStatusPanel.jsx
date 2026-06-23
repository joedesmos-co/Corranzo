import {
  WEB_MIDI_PERMISSION_LABELS,
  WEB_MIDI_SUPPORT,
} from '../../features/midi-input/webMidiConstants.js'
import { isSafariFamilyBrowser } from '../../features/platform/browserPracticeSupport.js'

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
  const isSafari = isSafariFamilyBrowser()
  const statusLabel = isGranted
    ? devices.length > 0
      ? 'MIDI ready'
      : 'MIDI disconnected'
    : supported
      ? 'MIDI off'
      : 'MIDI unavailable'

  return (
    <section
      className={`practice-section midi-input-status${compact ? ' practice-section--compact' : ''}`}
      aria-label="MIDI keyboard"
    >
      <div className="practice-input-status__header">
        <h3 className="practice-section__title practice-section__title--static">Input</h3>
        <span
          className={`practice-status-chip${
            isGranted && devices.length > 0 ? ' practice-status-chip--ready' : ''
          }`}
        >
          {statusLabel}
        </span>
      </div>

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

      {compact && (
        <details className="practice-input-details">
          <summary>Details</summary>
          <p className="practice-section__hint">
            {isGranted
              ? devices.length > 0
                ? `${devices.length} keyboard${devices.length === 1 ? '' : 's'} connected`
                : 'Plug in a keyboard, then reopen Practice.'
              : supported
                ? 'Enable MIDI for automatic note matching.'
                : isSafari
                  ? 'Safari does not support Web MIDI. Use Mic or Manual.'
                  : 'Use Chrome or Edge for Web MIDI.'}
            {lastNote ? ` Last note: ${lastNote.label}.` : ''}
          </p>
          {listenHint && <p className="practice-section__hint">{listenHint}</p>}
          {supported && isGranted && (
            <button type="button" className="midi-input-status__btn" onClick={onRefreshDevices}>
              Refresh devices
            </button>
          )}
        </details>
      )}
    </section>
  )
}
