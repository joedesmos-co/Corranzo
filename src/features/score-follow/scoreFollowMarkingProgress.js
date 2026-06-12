/**
 * Progress stats for manual score-follow marking.
 */
export function getScoreFollowMarkingProgress({
  anchors,
  timingMap,
  placementMeasureNumber,
}) {
  const measures = timingMap?.measures ?? []
  const minMeasure = measures[0]?.number ?? 1
  const maxMeasure = measures.length ? measures[measures.length - 1].number : 1
  const markedMeasureNumbers = new Set(
    (anchors ?? []).map((anchor) => Number(anchor.measureNumber)),
  )

  return {
    markedCount: markedMeasureNumbers.size,
    totalMeasures: maxMeasure,
    minMeasure,
    maxMeasure,
    nextMeasure: placementMeasureNumber,
    markedMeasureNumbers,
  }
}

/** First measure number in [min, max] with no anchor. */
export function findNextUnmarkedMeasureNumber(anchors, { min = 1, max = 1 } = {}) {
  const marked = new Set((anchors ?? []).map((anchor) => Number(anchor.measureNumber)))
  for (let measureNumber = min; measureNumber <= max; measureNumber += 1) {
    if (!marked.has(measureNumber)) {
      return measureNumber
    }
  }
  return max
}
