import MidiTransportControls from './MidiTransportControls.jsx'
import PracticePlaybackSettings from './PracticePlaybackSettings.jsx'
import PracticeHelpTip from './PracticeHelpTip.jsx'

export default function PracticeTransportSection({
  hasMusicXml,
  isLoading,
  error,
  disabled,
  playDisabled,
  seekDisabled,
  transportHint,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  effectiveTempo,
  metronomeEnabled,
  metronomeLevel,
  mappingWarning,
  onPlaybackRateChange,
  onMetronomeEnabledChange,
  onMetronomeLevelChange,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onTestSound,
  compact = false,
}) {
  const canPlay = Boolean(hasMusicXml)

  return (
    <section
      className={`practice-section practice-transport${compact ? ' practice-section--compact' : ''}`}
      aria-label="Playback"
    >
      <h3 className="practice-section__title practice-section__title--static practice-section__title--with-tip">
        Playback
        <PracticeHelpTip label="About playback">
          Plays the score with the built-in piano. MIDI backing is optional.
        </PracticeHelpTip>
      </h3>

      {!canPlay ? (
        <p className="practice-section__hint">Timing file required.</p>
      ) : (
        <div className="practice-section__body practice-section__body--flat">
          {isLoading && (
            <p className="practice-section__status practice-section__status--loading" role="status">
              Loading…
            </p>
          )}
          {!isLoading && error && (
            <p className="practice-section__error" role="alert">
              {error}
            </p>
          )}

          {transportHint && (
            <span className="practice-status-chip">Wait For You active</span>
          )}

          <PracticePlaybackSettings
            playbackRate={playbackRate ?? 1}
            onPlaybackRateChange={onPlaybackRateChange}
            effectiveTempo={effectiveTempo}
            metronomeEnabled={metronomeEnabled ?? false}
            onMetronomeEnabledChange={onMetronomeEnabledChange}
            metronomeLevel={metronomeLevel ?? 0.6}
            onMetronomeLevelChange={onMetronomeLevelChange}
            mappingWarning={mappingWarning}
            disabled={disabled || isLoading}
          />

          <MidiTransportControls
            disabled={disabled || isLoading}
            playDisabled={playDisabled || isLoading}
            seekDisabled={seekDisabled || isLoading}
            isPlaying={isPlaying}
            currentTime={isLoading ? 0 : currentTime}
            duration={isLoading ? 0 : duration}
            onPlay={onPlay}
            onPause={onPause}
            onStop={onStop}
            onSeek={onSeek}
            onTestSound={onTestSound}
          />
        </div>
      )}
    </section>
  )
}
