import MidiTransportControls from './MidiTransportControls.jsx'
import PracticePlaybackSettings from './PracticePlaybackSettings.jsx'

export default function PracticeTransportSection({
  hasMusicXml,
  hasMidi,
  playbackFileName,
  timingFileName,
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
  audioSource,
  instrumentStatus,
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
      className={`practice-section${compact ? ' practice-section--compact' : ''}`}
      aria-label="Playback"
    >
      <h3 className="practice-section__title practice-section__title--static">Playback</h3>

      <p className="practice-section__hint practice-section__hint--sound">
        ScoreFlow plays your MusicXML timing on a built-in piano
        {hasMidi ? ' (MIDI backing mapped to the score clock when provided)' : ''}. Tap Play once
        to unlock audio in Safari and on iPad.
      </p>

      {!canPlay ? (
        <p className="practice-section__hint">
          Add a MusicXML or MXL timing file in Library to enable playback and measure navigation.
        </p>
      ) : (
        <div className="practice-section__body practice-section__body--flat">
          {timingFileName && (
            <p className="practice-section__file" title={timingFileName}>
              {timingFileName}
            </p>
          )}
          {hasMidi && playbackFileName && (
            <p className="practice-section__file" title={playbackFileName}>
              {playbackFileName}
            </p>
          )}
          {isLoading && (
            <p className="practice-section__status practice-section__status--loading" role="status">
              Preparing playback…
            </p>
          )}
          {!isLoading && error && (
            <p className="practice-section__error" role="alert">
              {error}
            </p>
          )}

          {transportHint && (
            <p className="practice-section__hint practice-section__hint--inline">
              {transportHint}
            </p>
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
            audioSource={audioSource}
            instrumentStatus={instrumentStatus}
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
