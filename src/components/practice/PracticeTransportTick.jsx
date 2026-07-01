import { memo } from 'react'
import { usePracticeSessionStable } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import PracticeTransportSection from './PracticeTransportSection.jsx'
import useRenderCount from '../../dev/useRenderCount.js'
import { WFY_STATUS } from '../../features/practice/waitForYouEngine.js'
import { WFY_DISPLAY_STATUS } from '../../features/practice/waitForYouDisplayStatus.js'

function PracticeTransportTick() {
  useRenderCount('PracticeTransportTick')
  const stable = usePracticeSessionStable()
  const tick = usePracticeTick()
  const waitForYouContinueDisabled =
    stable.waitForYou.status === WFY_STATUS.COMPLETE ||
    stable.waitForYou.status === WFY_STATUS.NO_CHECKPOINTS ||
    stable.waitForYou.displayStatus === WFY_DISPLAY_STATUS.CONTINUING

  return (
    <PracticeTransportSection
      hasMusicXml={stable.hasMusicXml}
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
      metronomeSubdivision={stable.playback.metronomeSubdivision}
      metronomeCountIn={stable.playback.metronomeCountIn}
      metronomeDisplay={stable.playback.metronomeDisplay}
      mappingWarning={stable.isDemoPiece ? null : stable.playback.mappingWarning}
      waitForYouActive={stable.waitForYou.active}
      waitForYouContinueDisabled={waitForYouContinueDisabled}
      onWaitForYouContinue={stable.waitForYou.markCorrectAndContinue}
      onPlaybackRateChange={stable.playback.setPlaybackRate}
      onMetronomeEnabledChange={stable.playback.setMetronomeEnabled}
      onMetronomeLevelChange={stable.playback.setMetronomeLevel}
      onMetronomeSubdivisionChange={stable.playback.setMetronomeSubdivision}
      onMetronomeCountInChange={stable.playback.setMetronomeCountIn}
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
