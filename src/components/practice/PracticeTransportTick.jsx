import { memo } from 'react'
import { usePracticeSessionStable } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import PracticeTransportSection from './PracticeTransportSection.jsx'
import useRenderCount from '../../dev/useRenderCount.js'

function PracticeTransportTick() {
  useRenderCount('PracticeTransportTick')
  const stable = usePracticeSessionStable()
  const tick = usePracticeTick()

  return (
    <PracticeTransportSection
      hasMidi={stable.hasMidi}
      playbackFileName={stable.sources.playbackFileName}
      isLoading={stable.playback.isLoading}
      error={stable.playback.error}
      disabled={stable.playback.controlsDisabled}
      playDisabled={stable.playback.playDisabled}
      seekDisabled={stable.playback.seekDisabled}
      transportHint={stable.playback.transportHint}
      isPlaying={tick.playbackIsPlaying}
      currentTime={tick.playbackCurrentTime}
      duration={tick.playbackDuration}
      onPlay={stable.handlePlay}
      onPause={stable.playback.pause}
      onStop={stable.handleMidiStop}
      onSeek={stable.handleMidiSeek}
      onTestSound={stable.playback.testSound}
      compact
    />
  )
}

export default memo(PracticeTransportTick)
