export function quartersToSeconds(quarterTime, tempoChanges) {
  if (quarterTime <= 0) {
    return 0
  }

  let seconds = 0
  let cursor = 0

  for (let index = 0; index < tempoChanges.length; index += 1) {
    const change = tempoChanges[index]
    const nextQuarter = tempoChanges[index + 1]?.quarterTime ?? quarterTime
    const segmentEnd = Math.min(nextQuarter, quarterTime)
    const segmentQuarters = segmentEnd - cursor

    if (segmentQuarters > 0) {
      seconds += (segmentQuarters * 60) / change.bpm
      cursor = segmentEnd
    }

    if (cursor >= quarterTime) {
      break
    }
  }

  return seconds
}

export function getTempoAtQuarter(quarterTime, tempoChanges) {
  let active = tempoChanges[0]?.bpm ?? 120

  for (const change of tempoChanges) {
    if (change.quarterTime <= quarterTime) {
      active = change.bpm
    } else {
      break
    }
  }

  return active
}

export function getTempoAtTime(timingMap, timeSeconds) {
  if (!timingMap?.tempoChanges?.length) {
    return 120
  }

  let active = timingMap.tempoChanges[0].bpm

  for (const change of timingMap.tempoChanges) {
    const changeSeconds = quartersToSeconds(change.quarterTime, timingMap.tempoChanges)
    if (changeSeconds <= timeSeconds) {
      active = change.bpm
    }
  }

  return active
}
