export function usesPerformedTimeline(timingMap) {
  return Boolean(timingMap?.performedMeasureTimeline?.diagnostics?.usesPerformedTimeline)
}

export function getPerformedEntryAtTime(timingMap, timeSeconds) {
  const entries = timingMap?.performedMeasureTimeline?.entries
  if (!entries?.length) {
    return null
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (timeSeconds >= entry.startTimeSeconds) {
      return entry
    }
  }

  return entries[0]
}

export function getPerformedEntryAtIndex(timingMap, performedIndex) {
  const entries = timingMap?.performedMeasureTimeline?.entries
  if (!entries?.length || performedIndex == null) {
    return null
  }
  return entries[performedIndex] ?? null
}

export function getPerformedBeats(timingMap) {
  if (usesPerformedTimeline(timingMap)) {
    return timingMap.performedMeasureTimeline.performedBeats ?? []
  }
  return timingMap?.beats ?? []
}

export function getPlaybackDurationSeconds(timingMap) {
  if (!timingMap) {
    return 0
  }
  if (usesPerformedTimeline(timingMap)) {
    return timingMap.performedMeasureTimeline.performedDurationSeconds ?? timingMap.durationSeconds
  }
  return timingMap.durationSeconds ?? timingMap.writtenDurationSeconds ?? 0
}

/**
 * Playback-time window for a written measure at the current practice instant (handles repeats).
 */
export function getMeasurePlaybackWindow(timingMap, measureNumber, timeSeconds) {
  if (measureNumber == null || timeSeconds == null) {
    return null
  }

  if (usesPerformedTimeline(timingMap)) {
    const entries = timingMap.performedMeasureTimeline?.entries ?? []
    const active = entries.find(
      (entry) =>
        entry.writtenMeasureNumber === measureNumber &&
        timeSeconds >= entry.startTimeSeconds &&
        timeSeconds < entry.endTimeSeconds,
    )
    if (active) {
      return {
        startTimeSeconds: active.startTimeSeconds,
        endTimeSeconds: active.endTimeSeconds,
        performedIndex: active.performedIndex,
        repeatPass: active.repeatPass,
      }
    }

    let fallback = null
    for (const entry of entries) {
      if (entry.writtenMeasureNumber !== measureNumber) {
        continue
      }
      if (entry.startTimeSeconds <= timeSeconds) {
        fallback = entry
      }
    }
    if (fallback) {
      return {
        startTimeSeconds: fallback.startTimeSeconds,
        endTimeSeconds: fallback.endTimeSeconds,
        performedIndex: fallback.performedIndex,
        repeatPass: fallback.repeatPass,
      }
    }
    return null
  }

  const measure = timingMap.measures?.find((candidate) => candidate.number === measureNumber)
  if (!measure) {
    return null
  }
  if (timeSeconds < measure.startTimeSeconds - 0.001) {
    return null
  }
  return {
    startTimeSeconds: measure.startTimeSeconds,
    endTimeSeconds: measure.endTimeSeconds,
    performedIndex: null,
    repeatPass: null,
  }
}

/** Anchor sort / bracket time — performed start when repeats are active. */
export function getAnchorPlaybackTime(timingMap, measureNumber, practiceTime) {
  const window = getMeasurePlaybackWindow(timingMap, measureNumber, practiceTime)
  if (window) {
    return window.startTimeSeconds
  }
  const measure = timingMap?.measures?.find((candidate) => candidate.number === measureNumber)
  if (!measure || measure.startTimeSeconds > practiceTime + 0.02) {
    return null
  }
  return measure.startTimeSeconds
}
