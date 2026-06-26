import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'

/**
 * Compact MIDI diagnostics for beta: connected device, latency estimate, note
 * count, sustain state, and currently-held notes. Read-only.
 */
export default function MidiDiagnosticsPanel({
  statusLabel,
  latencyMs = null,
  noteCount = 0,
  sustain = false,
  activeNotes = [],
  lastNote = null,
}) {
  return (
    <section className="practice-section midi-diagnostics practice-section--compact" aria-label="MIDI diagnostics">
      <div className="practice-input-status__header">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">MIDI diagnostics</h3>
        <span
          className={`practice-status-chip${sustain ? ' practice-status-chip--ready' : ''}`}
          title="Sustain pedal (CC64)"
        >
          {sustain ? 'Sustain ⬇' : 'Sustain ⬆'}
        </span>
      </div>

      <dl className="midi-diagnostics__grid">
        <div>
          <dt>Device</dt>
          <dd>{statusLabel}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{latencyMs != null ? `~${latencyMs} ms` : '—'}</dd>
        </div>
        <div>
          <dt>Notes played</dt>
          <dd>{noteCount}</dd>
        </div>
        <div>
          <dt>Last note</dt>
          <dd>{lastNote ? `${lastNote.label} · vel ${lastNote.velocity}` : '—'}</dd>
        </div>
        <div className="midi-diagnostics__active">
          <dt>Active notes</dt>
          <dd>
            {activeNotes.length > 0 ? (
              <span className="midi-diagnostics__chips">
                {activeNotes.map((midi) => (
                  <span key={midi} className="midi-diagnostics__chip">
                    {midiToNoteLabel(midi)}
                  </span>
                ))}
              </span>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}
