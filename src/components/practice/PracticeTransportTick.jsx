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
      hasMusicXml={stable.hasMusicXml}
      hasMidi={stable.hasMidi}
      playbackFileName={stable.sources.playbackFileName}
      timingFileName={stable.sources.timingFileName}
      isLoading={stable.playback.isLoading}
      error={stable.playback.error}
      disabled={stable.playback.controlsDisabled}
      playDisabled={stable.playback.playDisabled}
      seekDisabled={stable.playback.seekDisabled}
      transportHint={stable.playback.transportHint}
      isPlaying={tick.playbackIsPlaying}
      currentTime={tick.playbackCurrentTime}
      duration={tick.playbackDuration}
      playbackRate={stable.playback.playbackRate}
      effectiveTempo={stable.playback.effectiveTempo}
      metronomeEnabled={stable.playback.metronomeEnabled}
      metronomeLevel={stable.playback.metronomeLevel}
      mappingWarning={stable.playback.mappingWarning}
      audioSource={stable.playback.audioSource}
      instrumentStatus={stable.playback.instrumentStatus}
      onPlaybackRateChange={stable.playback.setPlaybackRate}
      onMetronomeEnabledChange={stable.playback.setMetronomeEnabled}
      onMetronomeLevelChange={stable.playback.setMetronomeLevel}
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
