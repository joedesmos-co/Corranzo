import { memo } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import PracticePositionSection from './PracticePositionSection.jsx'
import useRenderCount from '../../dev/useRenderCount.js'

function PracticePositionTick() {
  useRenderCount('PracticePositionTick')
  const { session } = usePracticeSessionContext()
  const tick = usePracticeTick()

  return (
    <PracticePositionSection
      disabled={session.timingDisabled}
      hasMusicXml={session.hasMusicXml}
      timingLoading={session.timing.isLoading}
      position={session.beat.position}
      measureNavigation={session.measure}
      beatNavigation={session.beat}
      timingMap={session.timing.timingMap}
      practiceTime={tick.practiceTime}
      compact
    />
  )
}

export default memo(PracticePositionTick)
