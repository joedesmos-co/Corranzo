import PracticeLoopControls from './PracticeLoopControls.jsx'

export default function PracticeLoopCompactSection({ session }) {
  if (!session.hasMusicXml) {
    return null
  }

  const { loop, timingDisabled, isWaitForYou } = session

  return (
    <section className="practice-section practice-section--compact practice-loop-compact" aria-label="Loop">
      <div className="practice-section__header-row">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">Loop</h3>
        <label className="practice-loop__toggle practice-loop__toggle--inline">
          <input
            type="checkbox"
            checked={loop.enabled}
            disabled={timingDisabled || !loop.canEnable}
            onChange={(event) => loop.setLoopEnabled(event.target.checked)}
          />
          <span>On</span>
        </label>
      </div>

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
          Range sets Wait For You practice steps.
        </p>
      )}
    </section>
  )
}
