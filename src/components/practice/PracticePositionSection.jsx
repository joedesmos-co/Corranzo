import MeasureNavigationControls from './MeasureNavigationControls.jsx'
import PracticePositionPanel from './PracticePositionPanel.jsx'
import { computePracticeProgress } from '../../features/practice/practiceProgress.js'

export default function PracticePositionSection({
  disabled,
  hasMusicXml,
  timingLoading = false,
  position,
  measureNavigation,
  beatNavigation,
  timingMap,
  practiceTime,
  compact = false,
}) {
  const sectionClass = `practice-section practice-section--position-focus${
    compact ? ' practice-section--compact' : ''
  }`
  const progress = timingMap ? computePracticeProgress(timingMap, practiceTime) : null

  if (!hasMusicXml) {
    return (
      <section className={sectionClass} aria-label="Position">
        <h3 className="practice-section__title practice-section__title--static">Where you are</h3>
        <p className="practice-section__hint practice-empty-state">
          Add a score timing file from the Library so the app can show measure and beat as you
          practice.
        </p>
      </section>
    )
  }

  if (timingLoading && !timingMap) {
    return (
      <section className={sectionClass} aria-label="Position">
        <h3 className="practice-section__title practice-section__title--static">Where you are</h3>
        <p className="practice-section__status practice-section__status--loading" role="status">
          Reading score timing…
        </p>
      </section>
    )
  }

  return (
    <section className={sectionClass} aria-label="Position">
      <h3 className="practice-section__title practice-section__title--static">Where you are</h3>
      <div className="practice-section__body practice-section__body--flat">
        <PracticePositionPanel
          disabled={disabled}
          position={position}
          progress={progress}
          canGoPreviousBeat={beatNavigation.canGoPreviousBeat}
          canGoNextBeat={beatNavigation.canGoNextBeat}
          onPreviousBeat={beatNavigation.goToPreviousBeat}
          onNextBeat={beatNavigation.goToNextBeat}
          onGoToMeasureStart={beatNavigation.goToCurrentMeasureStart}
          embedded
        />
        <MeasureNavigationControls
          disabled={disabled}
          currentMeasure={measureNavigation.currentMeasure}
          currentMeasureIndex={measureNavigation.currentMeasureIndex}
          bounds={measureNavigation.bounds}
          canGoPrevious={measureNavigation.canGoPrevious}
          canGoNext={measureNavigation.canGoNext}
          onPrevious={measureNavigation.goToPreviousMeasure}
          onNext={measureNavigation.goToNextMeasure}
          onGoToMeasure={measureNavigation.goToMeasureNumber}
          embedded
        />
      </div>
    </section>
  )
}
