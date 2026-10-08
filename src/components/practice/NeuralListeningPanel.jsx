/**
 * Neural Listening (Experimental) panel (Stage 8, L2) — DEV ONLY.
 *
 * Development-only toggle + live status for the pretrained-neural
 * listening prototype. Default OFF; production builds render nothing.
 *
 * When ON (and the microphone source is selected), the session routes
 * practice input through the neural hook; when OFF, the existing
 * spectral detector runs untouched. Switching back is instant.
 *
 * Shows: toggle, input device, model loading/readiness, backend,
 * warmed inference time, live input level, detected notes with
 * confidence, and rejected-input counts with reasons.
 */
import useMicNeuralFlag, { setMicNeuralEnabled } from '../../features/microphone-input/useMicNeuralFlag.js'

export default function NeuralListeningPanel({ session = null }) {
  if (!import.meta.env.DEV) {
    return null
  }
  return <NeuralListeningPanelDev session={session} />
}

function NeuralListeningPanelDev({ session = null }) {
  const [flagOn, setFlagOn] = useMicNeuralFlag()
  const enabled = flagOn
  const neural = session?.neuralMic?.neural ?? null
  const microphone = session?.microphone ?? null
  const phase = neural?.phase ?? (enabled ? 'idle' : 'off')

  function onToggle(event) {
    const next = event.target.checked
    setMicNeuralEnabled(next)
    setFlagOn(next)
  }

  const levelPercent = Math.round(Math.min(1, neural?.level ?? 0) * 100)
  const detected = neural?.detectedNotes ?? []
  const rejected = neural?.rejected ?? { count: 0, reason: null }
  const capture = microphone?.captureSettings ?? null

  return (
    <details className="practice-diagnostics__group" open={enabled}>
      <summary>Neural Listening (Experimental)</summary>
      <div className="practice-diagnostics__group-body">
        <label>
          <input type="checkbox" checked={enabled} onChange={onToggle} />{' '}
          Enable experimental neural listening
        </label>
        {!enabled && (
          <p>Off (default). The normal listening experience is unchanged. Turn on to try the neural path, turn off to switch back instantly.</p>
        )}
        {enabled && (
          <>
            <dl className="practice-diagnostics__kv">
              <div>
                <dt>Status</dt>
                <dd>{phase}{neural?.error ? ` — ${neural.error}` : ''}</dd>
              </div>
              <div>
                <dt>Backend</dt>
                <dd>{neural?.backend ?? '—'}</dd>
              </div>
              <div>
                <dt>Warmed inference</dt>
                <dd>{neural?.warmedMs != null ? `${neural.warmedMs} ms / 0.5 s window` : '—'}</dd>
              </div>
              <div>
                <dt>Input device</dt>
                <dd>{capture?.deviceId ? `id ${String(capture.deviceId).slice(0, 8)}…` : 'system default'}</dd>
              </div>
              <div>
                <dt>Capture</dt>
                <dd>{microphone?.isListening ? `${microphone?.sampleRate ?? '?'} Hz` : 'not listening'}</dd>
              </div>
              <div>
                <dt>Input level</dt>
                <dd>{levelPercent}%</dd>
              </div>
              <div>
                <dt>Detected notes</dt>
                <dd>{detected.length ? detected.map((note) => `${note.label ?? note.midi}`).join(', ') : '—'}</dd>
              </div>
              <div>
                <dt>Rejected inputs</dt>
                <dd>{rejected.count}{rejected.reason ? ` — ${rejected.reason}` : ''}</dd>
              </div>
            </dl>
            {phase === 'unavailable' && (
              <p className="practice-section__error">Neural mode unavailable on this hardware — spectral detection is running instead.</p>
            )}
          </>
        )}
      </div>
    </details>
  )
}
