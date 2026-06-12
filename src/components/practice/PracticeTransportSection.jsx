import MidiTransportControls from './MidiTransportControls.jsx'
import { isSafariPlaybackLimited } from '../../features/platform/browserPracticeSupport.js'

export default function PracticeTransportSection({
  hasMidi,
  playbackFileName,
  isLoading,
  error,
  disabled,
  playDisabled,
  seekDisabled,
  transportHint,
  isPlaying,
  currentTime,
  duration,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onTestSound,
  compact = false,
}) {
  const safariLimited = isSafariPlaybackLimited()
  const playbackBlockedTitle = safariLimited
    ? 'MIDI playback is not available in Safari — use Chrome or Edge, or practice with Wait For You and measure navigation'
    : undefined

  return (
    <section
      className={`practice-section${compact ? ' practice-section--compact' : ''}`}
      aria-label="Playback"
    >
      <h3 className="practice-section__title practice-section__title--static">Playback</h3>

      <p className="practice-section__hint practice-section__hint--sound">
        MIDI files contain note data only — ScoreFlow synthesizes a basic built-in piano sound in
        your browser (not a recorded performance). It will not match a real piano, but playback
        stays reliable without a large sound library.
      </p>

      {!hasMidi ? (
        <p className="practice-section__hint">
          Optional: add a sound file (.mid) in Library for backing audio playback.
        </p>
      ) : (
        <div className="practice-section__body practice-section__body--flat">
          {playbackFileName && (
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

          <MidiTransportControls
            disabled={disabled || isLoading}
            playDisabled={playDisabled || isLoading || safariLimited}
            seekDisabled={seekDisabled || isLoading || safariLimited}
            playbackBlockedTitle={playbackBlockedTitle}
            testSoundDisabled={disabled || isLoading || safariLimited}
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
