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
  disabled = false,
}) {
  return (
    <div className="practice-playback-settings">
      <div className="practice-playback-settings__row">
        <label className="practice-playback-settings__label" htmlFor="playback-rate">
          Tempo
          <span>
            {Math.round(playbackRate * 100)}%
            {effectiveTempo != null ? ` · ${effectiveTempo} BPM` : ''}
          </span>
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

      <div className="practice-playback-settings__row practice-playback-settings__row--metronome">
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
        <p className="practice-section__error">{mappingWarning}</p>
      )}
    </div>
  )
}
