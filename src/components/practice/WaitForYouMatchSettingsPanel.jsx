import {
  CHORD_WINDOW_MS_MAX,
  CHORD_WINDOW_MS_MIN,
  MIC_CHORD_MODES,
  TRANSPOSITION_MAX,
  TRANSPOSITION_MIN,
} from '../../features/practice/waitForYouMatchSettings.js'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'

export default function WaitForYouMatchSettingsPanel({
  checkpointMode,
  settings,
  rawSettings,
  onUpdateSetting,
  onResetSettings,
  disabled,
}) {
  if (checkpointMode !== WFY_CHECKPOINT_MODE.NOTE) {
    return null
  }

  return (
    <details className="wait-for-you__settings">
      <summary className="wait-for-you__settings-summary">Note matching</summary>

      <div className="wait-for-you__settings-body">
        <fieldset className="wait-for-you__settings-fieldset">
          <legend>Pitch</legend>
          <label className="wait-for-you__settings-row">
            <input
              type="checkbox"
              checked={rawSettings.exactPitch}
              disabled={disabled}
              onChange={(event) => onUpdateSetting('exactPitch', event.target.checked)}
            />
            <span>Require exact pitch</span>
          </label>

          <label className="wait-for-you__settings-row">
            <input
              type="checkbox"
              checked={rawSettings.allowOctaveMistakes}
              disabled={disabled}
              onChange={(event) => onUpdateSetting('allowOctaveMistakes', event.target.checked)}
            />
            <span>Ignore wrong octave</span>
          </label>
        </fieldset>

        <fieldset className="wait-for-you__settings-fieldset">
          <legend>Keyboard transpose</legend>
          <label className="wait-for-you__settings-row">
            <input
              type="checkbox"
              checked={rawSettings.transpositionEnabled}
              disabled={disabled}
              onChange={(event) => onUpdateSetting('transpositionEnabled', event.target.checked)}
            />
            <span>Transpose input</span>
          </label>

          <label className="wait-for-you__settings-row wait-for-you__settings-row--number">
            <span>Semitones</span>
            <input
              type="number"
              min={TRANSPOSITION_MIN}
              max={TRANSPOSITION_MAX}
              step={1}
              value={rawSettings.transpositionOffset}
              disabled={disabled || !rawSettings.transpositionEnabled}
              onChange={(event) =>
                onUpdateSetting('transpositionOffset', Number(event.target.value))
              }
            />
          </label>
        </fieldset>

        <fieldset className="wait-for-you__settings-fieldset">
          <legend>Chords</legend>
          <label className="wait-for-you__settings-row wait-for-you__settings-row--number">
            <span>Chord timing (ms)</span>
            <input
              type="number"
              min={CHORD_WINDOW_MS_MIN}
              max={CHORD_WINDOW_MS_MAX}
              step={50}
              value={rawSettings.chordWindowMs}
              disabled={disabled}
              onChange={(event) => onUpdateSetting('chordWindowMs', Number(event.target.value))}
            />
          </label>
          <p className="wait-for-you__settings-fieldset-hint">
            How long you have to play all notes in a chord (MIDI).
          </p>
        </fieldset>

        <fieldset className="wait-for-you__settings-fieldset">
          <legend>Microphone chords</legend>
          <p className="wait-for-you__settings-fieldset-hint">
            Mic hears one note at a time. These options only apply to microphone input.
          </p>
          {Object.entries({
            [MIC_CHORD_MODES.ANY_TONE]: 'Any correct chord tone',
            [MIC_CHORD_MODES.BASS]: 'Bass tone only',
            [MIC_CHORD_MODES.TOP]: 'Top tone only',
          }).map(([value, label]) => (
            <label key={value} className="wait-for-you__settings-row">
              <input
                type="radio"
                name="mic-chord-mode"
                checked={rawSettings.micChordMode === value}
                disabled={disabled}
                onChange={() => onUpdateSetting('micChordMode', value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <button
          type="button"
          className="wait-for-you__settings-reset"
          disabled={disabled}
          onClick={onResetSettings}
        >
          Reset to defaults
        </button>
      </div>

      <p className="wait-for-you__settings-hint">
        {settings.transpositionEnabled && settings.transpositionOffset !== 0
          ? `Input transposed ${settings.transpositionOffset > 0 ? '+' : ''}${settings.transpositionOffset} semitones.`
          : 'No transposition.'}{' '}
        Chord notes must arrive within {settings.chordWindowMs} ms.
      </p>
    </details>
  )
}
