import { useCallback, useMemo } from 'react'
import {
  getBeatStartTime,
  getNeighborBeat,
  resolvePracticePosition,
} from '../musicxml/beatNavigation.js'
import {
  getFirstPerformedStartForMeasure,
  getMeasureStartTime,
} from '../musicxml/measureNavigation.js'

export default function useBeatNavigation(timingMap, practiceTime, onSeekToTime) {
  const position = useMemo(
    () => resolvePracticePosition(timingMap, practiceTime),
    [timingMap, practiceTime],
  )

  const currentBeat = position?.beat ?? null

  const previousBeat = useMemo(
    () => (currentBeat ? getNeighborBeat(timingMap, currentBeat, -1) : null),
    [timingMap, currentBeat],
  )

  const nextBeat = useMemo(
    () => (currentBeat ? getNeighborBeat(timingMap, currentBeat, 1) : null),
    [timingMap, currentBeat],
  )

  const seekToBeat = useCallback(
    (beat) => {
      if (!beat || !onSeekToTime) {
        return
      }
      onSeekToTime(getBeatStartTime(beat))
    },
    [onSeekToTime],
  )

  const goToPreviousBeat = useCallback(() => {
    if (previousBeat) {
      seekToBeat(previousBeat)
    }
  }, [previousBeat, seekToBeat])

  const goToNextBeat = useCallback(() => {
    if (nextBeat) {
      seekToBeat(nextBeat)
    }
  }, [nextBeat, seekToBeat])

  const goToCurrentMeasureStart = useCallback(() => {
    if (!position?.measure || !onSeekToTime) {
      return
    }
    if (position.measureStartTimeSeconds != null) {
      onSeekToTime(position.measureStartTimeSeconds)
      return
    }
    const performedStart = getFirstPerformedStartForMeasure(
      timingMap,
      position.measure.number,
    )
    onSeekToTime(performedStart ?? getMeasureStartTime(position.measure))
  }, [position?.measure, position?.measureStartTimeSeconds, onSeekToTime, timingMap])

  return {
    position,
    currentBeat,
    canGoPreviousBeat: Boolean(previousBeat),
    canGoNextBeat: Boolean(nextBeat),
    goToPreviousBeat,
    goToNextBeat,
    goToCurrentMeasureStart,
  }
}
