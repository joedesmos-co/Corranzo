import { memo } from 'react'
import { formatTime } from '../../features/playback/formatTime.js'
import { quantizePracticeTime } from '../../context/PracticeTickContext.jsx'

function MidiTransportControls({
  disabled,
  playDisabled = false,
  seekDisabled = false,
  testSoundDisabled = false,
  isPlaying,
  currentTime,
  duration,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onTestSound,
  playbackBlockedTitle,
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const playTitle =
    playbackBlockedTitle ?? (playDisabled ? 'Playback unavailable' : 'Play (Space)')

  function handleSeek(event) {
    const value = Number(event.target.value)
    onSeek((value / 1000) * duration)
  }

  return (
    <div className="midi-transport">
      <div className="midi-transport__buttons">
        <button
          type="button"
          className={`midi-transport__btn${
            isPlaying ? ' midi-transport__btn--active' : ''
          }`}
          disabled={disabled || playDisabled}
          onClick={onPlay}
          aria-label={playTitle}
          aria-pressed={isPlaying}
          title={playTitle}
        >
          ▶
        </button>
        <button
          type="button"
          className="midi-transport__btn"
          disabled={disabled}
          onClick={onPause}
          aria-label="Pause (Space)"
          title="Pause (Space)"
        >
          ❚❚
        </button>
        <button
          type="button"
          className="midi-transport__btn"
          disabled={disabled}
          onClick={onStop}
          aria-label="Stop"
        >
          ■
        </button>
        {onTestSound && (
          <button
            type="button"
            className="midi-transport__btn midi-transport__btn--test"
            disabled={disabled || testSoundDisabled}
            onClick={onTestSound}
            aria-label="Test sound"
            title="Test sound (checks speakers without MIDI)"
          >
            ♪
          </button>
        )}
      </div>

      <div className="midi-transport__timeline">
        <span className="midi-transport__time">{formatTime(currentTime)}</span>
        <input
          type="range"
          className="midi-transport__seek"
          min={0}
          max={1000}
          step={1}
          value={Math.round(progress * 10)}
          disabled={disabled || seekDisabled || duration <= 0}
          onChange={handleSeek}
          aria-label="Seek"
        />
        <span className="midi-transport__time">{formatTime(duration)}</span>
      </div>
    </div>
  )
}

function transportPropsEqual(prev, next) {
  if (prev.disabled !== next.disabled) return false
  if (prev.playDisabled !== next.playDisabled) return false
  if (prev.seekDisabled !== next.seekDisabled) return false
  if (prev.isPlaying !== next.isPlaying) return false
  if (prev.duration !== next.duration) return false
  if (quantizePracticeTime(prev.currentTime) !== quantizePracticeTime(next.currentTime)) {
    return false
  }
  return true
}

export default memo(MidiTransportControls, transportPropsEqual)
