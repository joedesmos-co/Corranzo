import {
  METRONOME_COUNT_IN_OPTIONS,
  METRONOME_SUBDIVISION_OPTIONS,
} from '../../features/playback/metronomeConstants.js'
import { usePracticeSessionStable } from '../../context/PracticeSessionContext.jsx'
import MetronomeBeatIndicator from './MetronomeBeatIndicator.jsx'

export default function PracticeMetronomeAdvancedSettings() {
  const stable = usePracticeSessionStable()
  const playback = stable.playback
  const disabled = playback.controlsDisabled || playback.isLoading

  return (
    <section
      className="practice-section practice-section--compact practice-metronome-advanced"
      aria-label="Metronome settings"
    >
      <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">
        Metronome
      </h3>

      <div className="practice-playback-settings">
        <label className="practice-playback-settings__label practice-playback-settings__label--inline">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={playback.metronomeLevel ?? 0.6}
            disabled={disabled}
            aria-label="Metronome volume"
            onChange={(event) => playback.setMetronomeLevel(Number(event.target.value))}
          />
        </label>

        <div className="practice-playback-settings__row practice-playback-settings__row--grid">
          <label className="practice-playback-settings__label" htmlFor="advanced-metronome-subdivision">
            Subdivision
            <select
              id="advanced-metronome-subdivision"
              value={playback.metronomeSubdivision}
              disabled={disabled}
              onChange={(event) => playback.setMetronomeSubdivision(event.target.value)}
            >
              {METRONOME_SUBDIVISION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="practice-playback-settings__label" htmlFor="advanced-metronome-count-in">
            Count-in
            <select
              id="advanced-metronome-count-in"
              value={playback.metronomeCountIn}
              disabled={disabled}
              onChange={(event) => playback.setMetronomeCountIn(Number(event.target.value))}
            >
              {METRONOME_COUNT_IN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <MetronomeBeatIndicator display={playback.metronomeDisplay} disabled={disabled} />
      </div>
    </section>
  )
}
