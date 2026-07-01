import {
  METRONOME_COUNT_IN_OPTIONS,
  METRONOME_SUBDIVISION_OPTIONS,
} from '../../features/playback/metronomeConstants.js'
import MetronomeBeatIndicator from './MetronomeBeatIndicator.jsx'

const RATE_STOPS = [0.5, 0.75, 1, 1.25, 1.5]

export default function PracticePlaybackSettings({
  playbackRate,
  onPlaybackRateChange,
  effectiveTempo,
  metronomeEnabled,
  onMetronomeEnabledChange,
  metronomeLevel,
  onMetronomeLevelChange,
  metronomeSubdivision,
  onMetronomeSubdivisionChange,
  metronomeCountIn,
  onMetronomeCountInChange,
  metronomeDisplay,
  mappingWarning,
  disabled = false,
  showMetronomeDetails = true,
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
        {showMetronomeDetails && (
          <label className="practice-playback-settings__label practice-playback-settings__label--inline">
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={metronomeLevel}
              disabled={disabled}
              aria-label="Metronome volume"
              onChange={(event) => onMetronomeLevelChange(Number(event.target.value))}
            />
          </label>
        )}
      </div>

      {showMetronomeDetails && (
        <div className="practice-playback-settings__row practice-playback-settings__row--grid">
          <label className="practice-playback-settings__label" htmlFor="metronome-subdivision">
            Subdivision
            <select
              id="metronome-subdivision"
              value={metronomeSubdivision}
              disabled={disabled}
              onChange={(event) => onMetronomeSubdivisionChange(event.target.value)}
            >
              {METRONOME_SUBDIVISION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="practice-playback-settings__label" htmlFor="metronome-count-in">
            Count-in
            <select
              id="metronome-count-in"
              value={metronomeCountIn}
              disabled={disabled}
              onChange={(event) => onMetronomeCountInChange(Number(event.target.value))}
            >
              {METRONOME_COUNT_IN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {showMetronomeDetails && (
        <MetronomeBeatIndicator display={metronomeDisplay} disabled={disabled} />
      )}

      {mappingWarning && (
        <p className="practice-section__error">{mappingWarning}</p>
      )}
    </div>
  )
}
