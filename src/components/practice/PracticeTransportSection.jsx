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
  transportHint: _transportHint,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  effectiveTempo,
  metronomeEnabled,
  metronomeLevel,
  metronomeSubdivision,
  metronomeCountIn,
  metronomeDisplay,
  mappingWarning,
  waitForYouActive = false,
  onPlaybackRateChange,
  onMetronomeEnabledChange,
  onMetronomeLevelChange,
  onMetronomeSubdivisionChange,
  onMetronomeCountInChange,
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
      data-tour-id="practice-playback"
    >
      <h3
        className={`practice-section__title practice-section__title--static practice-section__title--editorial${
          compact ? '' : ' practice-section__title--with-tip'
        }`}
      >
        Play
        {!compact && (
          <PracticeHelpTip label="About playback">
            Built-in instrument sound from your selection above. Optional MIDI file adds backing tracks.
          </PracticeHelpTip>
        )}
      </h3>

      {!canPlay ? (
        <p className="practice-section__hint">Add a timing file in Library to enable practice.</p>
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

          <PracticePlaybackSettings
            playbackRate={playbackRate ?? 1}
            onPlaybackRateChange={onPlaybackRateChange}
            effectiveTempo={effectiveTempo}
            metronomeEnabled={metronomeEnabled ?? false}
            onMetronomeEnabledChange={onMetronomeEnabledChange}
            metronomeLevel={metronomeLevel ?? 0.6}
            onMetronomeLevelChange={onMetronomeLevelChange}
            metronomeSubdivision={metronomeSubdivision}
            onMetronomeSubdivisionChange={onMetronomeSubdivisionChange}
            metronomeCountIn={metronomeCountIn}
            onMetronomeCountInChange={onMetronomeCountInChange}
            metronomeDisplay={metronomeDisplay}
            mappingWarning={mappingWarning}
            disabled={disabled || isLoading}
            showMetronomeDetails={false}
          />

          {/* In Wait For You, Continue lives next to the note target — hide
              transport play controls; Mode already shows the active mode. */}
          {!waitForYouActive && (
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
              simple={compact}
            />
          )}
        </div>
      )}
    </section>
  )
}
