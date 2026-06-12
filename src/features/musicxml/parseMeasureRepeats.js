/**
 * Repeat / ending expansion — explicit interpreter over written measures.
 *
 * Each repeat section owns its own pass counter. Leaving a section resets pass to 1.
 * Same-measure forward+backward, repeat-to-beginning, times=N, and multi-measure
 * voltas are handled explicitly.
 */

function shouldPlayMeasureOnPass(marking, pass, activeEndingNumbers) {
  if (activeEndingNumbers?.length) {
    return activeEndingNumbers.includes(pass)
  }
  if (marking.endingStartNumbers?.length) {
    return marking.endingStartNumbers.includes(pass)
  }
  return true
}

function buildPerformedBeats(entries, writtenBeats, measures) {
  if (!entries.length || !writtenBeats.length) {
    return []
  }

  const performedBeats = []
  for (const entry of entries) {
    const measure = measures[entry.writtenMeasureIndex]
    if (!measure) {
      continue
    }
    const writtenDuration = measure.endTimeSeconds - measure.startTimeSeconds
    if (writtenDuration <= 0) {
      continue
    }

    const measureBeats = writtenBeats.filter(
      (beat) => beat.measureNumber === entry.writtenMeasureNumber,
    )

    for (const beat of measureBeats) {
      const offset = (beat.timeSeconds - measure.startTimeSeconds) / writtenDuration
      const span = entry.endTimeSeconds - entry.startTimeSeconds
      performedBeats.push({
        measureNumber: beat.measureNumber,
        beat: beat.beat,
        quarterTime: beat.quarterTime,
        timeSeconds: entry.startTimeSeconds + offset * span,
        performedMeasureIndex: entry.performedIndex,
        repeatPass: entry.repeatPass,
      })
    }
  }

  return performedBeats
}

/** Index of the forward repeat that opens the current section (same measure counts). */
function findSectionStartIndex(markings, backwardIndex) {
  const backward = markings[backwardIndex]
  if (backward?.forwardRepeat) {
    return backwardIndex
  }
  for (let index = backwardIndex; index >= 0; index -= 1) {
    if (markings[index]?.forwardRepeat) {
      return index
    }
  }
  return -1
}

/** Heuristic scan for repeat marks that cannot be interpreted reliably. */
function detectMalformedRepeats(markings) {
  let seenForward = false
  let openForwardIndex = -1
  let uncertain = false

  for (let index = 0; index < markings.length; index += 1) {
    const marking = markings[index] ?? {}

    if (marking.backwardRepeat && !marking.forwardRepeat && !seenForward) {
      // Backward repeat before any forward repeat — only valid as repeat-to-beginning
      // when it is not the first measure (measure 1 backward with no partner is malformed).
      if (index === 0) {
        uncertain = true
      }
    }

    if (marking.forwardRepeat) {
      seenForward = true
      openForwardIndex = index
    }

    if (marking.backwardRepeat) {
      const sectionStart = findSectionStartIndex(markings, index)
      if (sectionStart < 0 && index === 0) {
        uncertain = true
      }
      openForwardIndex = -1
    }
  }

  if (openForwardIndex >= 0) {
    uncertain = true
  }

  return uncertain
}

/**
 * Expand written measures into performed playback order (repeats + voltas).
 * Written measure times stay unchanged; performed entries use a cumulative clock.
 */
export function buildPerformedMeasureTimeline(measures, markings, writtenBeats) {
  const repeatSections = []
  const endings = []
  const entries = []
  let uncertain = detectMalformedRepeats(markings)
  let navigationUnsupported = false

  let index = 0
  /** Pass within the active repeat section (resets when a section completes). */
  let sectionPass = 1
  let performedTime = 0
  let steps = 0
  /** Ending bracket active across measures until stop/discontinue. */
  let activeEndingNumbers = null
  const maxSteps = measures.length * 40 + 16

  while (index < measures.length && steps < maxSteps) {
    steps += 1
    const marking = markings[index] ?? {}
    const measure = measures[index]

    if (marking.endingStartNumbers?.length) {
      endings.push({
        measureIndex: index,
        measureNumber: measure.number,
        numbers: marking.endingStartNumbers,
      })
      activeEndingNumbers = marking.endingStartNumbers
    }

    const skipForVolta = !shouldPlayMeasureOnPass(marking, sectionPass, activeEndingNumbers)

    // Decide stop/discontinue membership before clearing the bracket (P8).
    const endingClosesHere = marking.endingStop || marking.endingDiscontinue

    if (skipForVolta) {
      if (endingClosesHere) {
        activeEndingNumbers = null
      }
      index += 1
      continue
    }

    const duration = Math.max(0, measure.endTimeSeconds - measure.startTimeSeconds)
    entries.push({
      performedIndex: entries.length,
      writtenMeasureIndex: index,
      writtenMeasureNumber: measure.number,
      repeatPass: sectionPass,
      startTimeSeconds: performedTime,
      endTimeSeconds: performedTime + duration,
    })
    performedTime += duration

    if (endingClosesHere) {
      activeEndingNumbers = null
    }

    if (marking.backwardRepeat) {
      const sectionStart = findSectionStartIndex(markings, index)
      const maxPasses = marking.backwardRepeatTimes ?? 2

      if (sectionStart >= 0) {
        repeatSections.push({
          forwardMeasureIndex: sectionStart,
          forwardMeasureNumber: measures[sectionStart].number,
          backwardMeasureIndex: index,
          backwardMeasureNumber: measure.number,
          maxPasses,
        })

        if (sectionPass < maxPasses) {
          sectionPass += 1
          index = sectionStart
          continue
        }

        // Section complete — reset pass for what follows.
        sectionPass = 1
      } else {
        // Repeat-to-beginning: no forward repeat in this section (P7).
        if (sectionPass < maxPasses) {
          sectionPass += 1
          index = 0
          continue
        }
        sectionPass = 1
      }
    }

    index += 1
  }

  if (steps >= maxSteps) {
    uncertain = true
  }

  const hasRepeatMarks = markings.some(
    (mark) =>
      mark.forwardRepeat ||
      mark.backwardRepeat ||
      mark.endingStartNumbers?.length ||
      mark.endingStop ||
      mark.endingDiscontinue,
  )

  const expanded = entries.length > measures.length
  const usesPerformedTimeline = expanded

  let warning = null
  if (navigationUnsupported) {
    warning =
      'Navigation marks (D.C., D.S., Fine, Coda) are not supported yet. Playback follows written order.'
  } else if (uncertain) {
    warning =
      'Some repeat marks could not be linked reliably. Measure display follows written score order.'
  } else if (hasRepeatMarks && !expanded) {
    warning =
      'Repeat marks were found but no extra passes were expanded. Display may follow written order only.'
  }

  const performedBeats = usesPerformedTimeline
    ? buildPerformedBeats(entries, writtenBeats, measures)
    : []

  return {
    entries,
    performedBeats,
    performedDurationSeconds: performedTime,
    diagnostics: {
      writtenMeasureCount: measures.length,
      performedMeasureCount: entries.length,
      repeatSections,
      endings,
      endingPassCount: sectionPass,
      hasRepeatMarks,
      fullyInterpreted: !uncertain && !navigationUnsupported,
      usesPerformedTimeline,
      navigationUnsupported,
      warning,
    },
  }
}
