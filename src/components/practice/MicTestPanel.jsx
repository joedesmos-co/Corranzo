import { MIC_SIGNAL_QUALITY_LABELS } from '../../features/microphone-input/micSignalQuality.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'

export default function MicTestPanel({ liveFrame, lastStableMidi, isListening }) {
  if (!isListening) {
    return (
      <div className="mic-test mic-test--idle">
        <p className="mic-test__hint">Enable the microphone above, then play single notes to test.</p>
      </div>
    )
  }

  const levelPercent = Math.round((liveFrame?.level ?? 0) * 100)
  const noteLabel =
    liveFrame?.noteLabel ??
    (lastStableMidi != null ? midiToNoteLabel(lastStableMidi) : null)
  const clarity = liveFrame?.clarityPercent ?? 0
  // Tuning offset of the live detected note (e.g. "+8¢" / "−12¢").
  const centsOffset = liveFrame?.midi != null && Number.isFinite(liveFrame?.centsOffset)
    ? `${liveFrame.centsOffset >= 0 ? '+' : '−'}${Math.abs(Math.round(liveFrame.centsOffset))}¢`
    : null
  const signalLabel =
    liveFrame?.signalLabel ??
    MIC_SIGNAL_QUALITY_LABELS[liveFrame?.signalQuality] ??
    'Listening…'

  const qualityClass = liveFrame?.signalQuality
    ? `mic-test__quality--${liveFrame.signalQuality}`
    : 'mic-test__quality--listening'

  return (
    <div className="mic-test" aria-label="Microphone test">
      <p className="mic-test__title">Mic test</p>
      <p className="mic-test__hint">
        Play one note at a time. Microphone mode is less reliable than a MIDI keyboard.
      </p>

      <div className="mic-test__meter-row">
        <span className="mic-test__meter-label">Input level</span>
        <div className="mic-test__meter" role="meter" aria-valuenow={levelPercent} aria-valuemin={0} aria-valuemax={100}>
          <div className="mic-test__meter-fill" style={{ width: `${levelPercent}%` }} />
        </div>
      </div>

      <dl className="mic-test__readout">
        <div>
          <dt>Detected note</dt>
          <dd>
            {noteLabel ?? '—'}
            {centsOffset && <span className="mic-test__cents"> {centsOffset}</span>}
          </dd>
        </div>
        <div>
          <dt>Clarity</dt>
          <dd>{liveFrame?.midi != null ? `${clarity}%` : '—'}</dd>
        </div>
        <div>
          <dt>Signal</dt>
          <dd className={`mic-test__quality ${qualityClass}`}>{signalLabel}</dd>
        </div>
      </dl>
    </div>
  )
}
