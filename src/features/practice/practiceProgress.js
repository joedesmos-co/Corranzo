import { resolvePracticePosition } from '../musicxml/beatNavigation.js'
import {
  getPerformedEntryAtTime,
  getPlaybackDurationSeconds,
  usesPerformedTimeline,
} from '../musicxml/performedTimeline.js'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Progress through the score for display (overall + within current measure).
 */
export function computePracticeProgress(timingMap, practiceTime) {
  if (!timingMap?.measures?.length) {
    return null
  }

  const position = resolvePracticePosition(timingMap, practiceTime)
  const durationSeconds = getPlaybackDurationSeconds(timingMap)

  const overallProgress =
    durationSeconds > 0 ? clamp(practiceTime / durationSeconds, 0, 1) : 0

  const performedEntry = getPerformedEntryAtTime(timingMap, practiceTime)
  const performedCount = timingMap.performedMeasureTimeline?.entries?.length ?? 0
  const measureOrdinalProgress =
    usesPerformedTimeline(timingMap) && performedEntry && performedCount > 1
      ? performedEntry.performedIndex / (performedCount - 1)
      : (() => {
          const measureIndex = position?.measureNumber
            ? timingMap.measures.findIndex((measure) => measure.number === position.measureNumber)
            : -1
          return timingMap.measures.length > 1 && measureIndex >= 0
            ? measureIndex / (timingMap.measures.length - 1)
            : 0
        })()

  const measureProgress = (() => {
    if (!performedEntry) {
      return null
    }
    const span = performedEntry.endTimeSeconds - performedEntry.startTimeSeconds
    if (span <= 0) {
      return 0
    }
    return clamp((practiceTime - performedEntry.startTimeSeconds) / span, 0, 1)
  })()

  return {
    measureNumber: position?.measureNumber ?? null,
    beatNumber: position?.beatNumber ?? null,
    beatInMeasure: position?.beatInMeasure ?? null,
    beatsPerMeasure: position?.beatsPerMeasure ?? 0,
    performedIndex: performedEntry?.performedIndex ?? null,
    repeatPass: performedEntry?.repeatPass ?? null,
    overallProgress,
    measureOrdinalProgress,
    measureProgress,
    durationSeconds,
  }
}
