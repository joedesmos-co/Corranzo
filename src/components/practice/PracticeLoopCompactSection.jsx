import PracticeCollapsibleSection from './PracticeCollapsibleSection.jsx'
import PracticeLoopControls from './PracticeLoopControls.jsx'

function loopSummary(loop) {
  if (!loop.region?.isValid) {
    return 'Off'
  }
  return `${loop.enabled ? 'On' : 'Off'} · ${loop.region.label}`
}

export default function PracticeLoopCompactSection({ session }) {
  if (!session.hasMusicXml) {
    return null
  }

  const { loop, timingDisabled, isWaitForYou } = session

  return (
    <PracticeCollapsibleSection
      title="Loop"
      summary={loopSummary(loop)}
      defaultOpen={loop.enabled}
      ariaLabel="Loop"
    >
      <div className="practice-loop-compact">
        <label className="practice-loop__toggle practice-loop__toggle--inline">
          <input
            type="checkbox"
            checked={loop.enabled}
            disabled={timingDisabled || !loop.canEnable}
            onChange={(event) => loop.setLoopEnabled(event.target.checked)}
          />
          <span>Loop on</span>
        </label>

        <PracticeLoopControls
          variant="compact"
          disabled={timingDisabled}
          region={loop.region}
          hasLoop={loop.hasLoop}
          canEnable={loop.canEnable}
          enabled={loop.enabled}
          snapMode={loop.snapMode}
          hasMidi={session.hasMidi}
          hideHeaderToggle
          showSnapInCompact
          onSnapModeChange={loop.setLoopSnapMode}
          onSetStart={loop.setStartFromCurrent}
          onSetEnd={loop.setEndFromCurrent}
          onClear={loop.clearLoop}
          onToggleEnabled={loop.setLoopEnabled}
        />

        {isWaitForYou && (
          <p className="practice-section__hint practice-loop-compact__hint">
            Loop range sets which notes Wait For You stops at.
          </p>
        )}
      </div>
    </PracticeCollapsibleSection>
  )
}
