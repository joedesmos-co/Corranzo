import {
  INSTRUMENT_STATUS,
  INSTRUMENT_STATUS_LABEL,
} from '../../features/playback/pianoInstrument.js'

const RATE_STOPS = [0.5, 0.75, 1, 1.25, 1.5]

export default function PracticePlaybackSettings({
  playbackRate,
  onPlaybackRateChange,
  effectiveTempo,
  metronomeEnabled,
  onMetronomeEnabledChange,
  metronomeLevel,
  onMetronomeLevelChange,
  mappingWarning,
  audioSource,
  instrumentStatus,
  disabled = false,
}) {
  const instrumentLabel = instrumentStatus
    ? INSTRUMENT_STATUS_LABEL[instrumentStatus]
    : null

  return (
    <div className="practice-playback-settings">
      {audioSource && (
        <p className="practice-playback-settings__source" aria-live="polite">
          Audio: {audioSource === 'midi' ? 'MIDI backing' : 'MusicXML synth'}
        </p>
      )}

      {instrumentLabel && (
        <p
          className={`practice-playback-settings__instrument practice-playback-settings__instrument--${instrumentStatus}`}
          aria-live="polite"
        >
          {instrumentStatus === INSTRUMENT_STATUS.LOADING ? '⏳ ' : ''}
          {instrumentStatus === INSTRUMENT_STATUS.SAMPLED ? '🎹 ' : ''}
          {instrumentLabel}
        </p>
      )}

      <div className="practice-playback-settings__row">
        <label className="practice-playback-settings__label" htmlFor="playback-rate">
          Speed {Math.round(playbackRate * 100)}%
        </label>
        <input
          id="playback-rate"
          type="range"
          min={0.25}
          max={1.5}
          step={0.05}
          value={playbackRate}
          disabled={disabled}
          onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          list="playback-rate-stops"
        />
        <datalist id="playback-rate-stops">
          {RATE_STOPS.map((stop) => (
            <option key={stop} value={stop} />
          ))}
        </datalist>
      </div>

      {effectiveTempo != null && (
        <p className="practice-playback-settings__tempo" aria-live="polite">
          Effective tempo: {effectiveTempo} BPM
        </p>
      )}

      <div className="practice-playback-settings__row">
        <label className="practice-playback-settings__check">
          <input
            type="checkbox"
            checked={metronomeEnabled}
            disabled={disabled}
            onChange={(event) => onMetronomeEnabledChange(event.target.checked)}
          />
          Metronome
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={metronomeLevel}
          disabled={disabled || !metronomeEnabled}
          aria-label="Metronome level"
          onChange={(event) => onMetronomeLevelChange(Number(event.target.value))}
        />
      </div>

      {mappingWarning && (
        <p className="practice-section__hint practice-section__hint--inline">{mappingWarning}</p>
      )}
    </div>
  )
}
