import { memo } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import { computePracticeProgress } from '../../features/practice/practiceProgress.js'
import PracticeFullscreenHud from './PracticeFullscreenHud.jsx'
import useRenderCount from '../../dev/useRenderCount.js'

function PracticeFullscreenHudTick({
  onPlay,
  onPause,
  onWaitForYouContinue,
  chromeVisible = true,
}) {
  useRenderCount('PracticeFullscreenHudTick')
  const { session } = usePracticeSessionContext()
  const tick = usePracticeTick()
  const timingMap = session.timing.timingMap
  const practiceTime = tick.practiceTime
  const progress = timingMap ? computePracticeProgress(timingMap, practiceTime) : null
  const performedTotal = timingMap?.performedMeasureTimeline?.entries?.length ?? null

  return (
    <PracticeFullscreenHud
      measureNumber={session.beat.position?.measureNumber}
      beatNumber={session.beat.position?.beatNumber}
      isPlaying={tick.playbackIsPlaying}
      hasMidi={session.hasMidi}
      isWaitForYou={session.isWaitForYou}
      waitForYouStatus={session.waitForYou.status}
      overallProgress={progress?.overallProgress ?? 0}
      performedIndex={progress?.performedIndex}
      performedTotal={performedTotal}
      visible={chromeVisible}
      onPlay={onPlay}
      onPause={onPause}
      onWaitForYouContinue={onWaitForYouContinue}
    />
  )
}

export default memo(PracticeFullscreenHudTick)
