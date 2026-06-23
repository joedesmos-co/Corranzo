import { memo } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import PracticePositionSection from './PracticePositionSection.jsx'
import PracticeCollapsibleSection from './PracticeCollapsibleSection.jsx'
import useRenderCount from '../../dev/useRenderCount.js'

function PracticePositionTick({ collapsible = false }) {
  useRenderCount('PracticePositionTick')
  const { session } = usePracticeSessionContext()
  const tick = usePracticeTick()

  const content = (
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
      showTitle={!collapsible}
    />
  )

  if (!collapsible) {
    return content
  }

  const summary = session.hasMusicXml
    ? `Measure ${session.beat.position?.measureNumber ?? '—'} · Beat ${
        session.beat.position?.beatNumber ?? '—'
      }`
    : 'Timing unavailable'

  return (
    <PracticeCollapsibleSection title="Position" summary={summary} defaultOpen={false}>
      {content}
    </PracticeCollapsibleSection>
  )
}

export default memo(PracticePositionTick)
