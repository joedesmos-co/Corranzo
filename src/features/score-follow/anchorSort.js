import { getAnchorPlaybackTime } from '../musicxml/performedTimeline.js'

/** Sort anchors by performed playback time at the given practice instant. */
export function sortAnchorsByMeasure(anchors, timingMap, practiceTime = 0) {
  return [...anchors].sort((left, right) => {
    const timeLeft =
      getAnchorPlaybackTime(timingMap, left.measureNumber, practiceTime) ??
      Number.POSITIVE_INFINITY
    const timeRight =
      getAnchorPlaybackTime(timingMap, right.measureNumber, practiceTime) ??
      Number.POSITIVE_INFINITY
    if (timeLeft !== timeRight) {
      return timeLeft - timeRight
    }
    return left.measureNumber - right.measureNumber
  })
}
