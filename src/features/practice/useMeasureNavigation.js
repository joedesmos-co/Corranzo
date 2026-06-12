import { useCallback, useMemo } from 'react'
import {
  getFirstPerformedStartForMeasure,
  getMeasureBounds,
  getMeasureByNumber,
  getMeasureListIndex,
  getMeasureStartTime,
  getNeighborMeasure,
  getPerformedNeighborStartTime,
  resolveCurrentMeasure,
} from '../musicxml/measureNavigation.js'
import { usesPerformedTimeline } from '../musicxml/performedTimeline.js'

export default function useMeasureNavigation(timingMap, practiceTime, onSeekToTime) {
  const currentMeasure = useMemo(
    () => resolveCurrentMeasure(timingMap, practiceTime),
    [timingMap, practiceTime],
  )

  const bounds = useMemo(() => getMeasureBounds(timingMap), [timingMap])

  const previousMeasure = useMemo(
    () =>
      currentMeasure ? getNeighborMeasure(timingMap, currentMeasure, -1, practiceTime) : null,
    [timingMap, currentMeasure, practiceTime],
  )

  const nextMeasure = useMemo(
    () =>
      currentMeasure ? getNeighborMeasure(timingMap, currentMeasure, 1, practiceTime) : null,
    [timingMap, currentMeasure, practiceTime],
  )

  const seekToMeasure = useCallback(
    (measure) => {
      if (!measure || !onSeekToTime) {
        return
      }

      const performedStart = getFirstPerformedStartForMeasure(timingMap, measure.number)
      if (performedStart != null) {
        onSeekToTime(performedStart)
        return
      }

      onSeekToTime(getMeasureStartTime(measure))
    },
    [onSeekToTime, timingMap],
  )

  const goToPreviousMeasure = useCallback(() => {
    const performedStart = getPerformedNeighborStartTime(timingMap, practiceTime, -1)
    if (performedStart != null) {
      onSeekToTime(performedStart)
      return
    }
    if (previousMeasure) {
      seekToMeasure(previousMeasure)
    }
  }, [timingMap, practiceTime, onSeekToTime, previousMeasure, seekToMeasure])

  const goToNextMeasure = useCallback(() => {
    const performedStart = getPerformedNeighborStartTime(timingMap, practiceTime, 1)
    if (performedStart != null) {
      onSeekToTime(performedStart)
      return
    }
    if (nextMeasure) {
      seekToMeasure(nextMeasure)
    }
  }, [timingMap, practiceTime, onSeekToTime, nextMeasure, seekToMeasure])

  const goToMeasureNumber = useCallback(
    (measureNumber) => {
      const measure = getMeasureByNumber(timingMap, measureNumber)
      if (measure) {
        seekToMeasure(measure)
        return true
      }
      return false
    },
    [timingMap, seekToMeasure],
  )

  const currentMeasureIndex = currentMeasure
    ? getMeasureListIndex(timingMap, currentMeasure) + 1
    : null

  return {
    currentMeasure,
    currentMeasureIndex,
    bounds,
    previousMeasure,
    nextMeasure,
    canGoPrevious: usesPerformedTimeline(timingMap)
      ? Boolean(getPerformedNeighborStartTime(timingMap, practiceTime, -1) ?? previousMeasure)
      : Boolean(previousMeasure),
    canGoNext: usesPerformedTimeline(timingMap)
      ? Boolean(getPerformedNeighborStartTime(timingMap, practiceTime, 1) ?? nextMeasure)
      : Boolean(nextMeasure),
    goToPreviousMeasure,
    goToNextMeasure,
    goToMeasureNumber,
  }
}
