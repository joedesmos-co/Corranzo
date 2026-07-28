/**
 * Repeat / ending expansion — explicit interpreter over written measures.
 *
 * Each repeat section owns its own pass counter (keyed by section start index).
 * Leaving a section resets that section's pass to 1.
 * Same-measure forward+backward, repeat-to-beginning, times=N, and multi-measure
 * voltas are handled explicitly.
 *
 * Pathological OMR graphs (multiple orphan backwards, multiple closers for one
 * forward without endings) fall back to written order instead of expanding until
 * maxSteps — performed duration must stay musically plausible.
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

function buildWrittenOnlyEntries(measures) {
  const entries = []
  let performedTime = 0
  for (let index = 0; index < measures.length; index += 1) {
    const measure = measures[index]
    const duration = Math.max(0, measure.endTimeSeconds - measure.startTimeSeconds)
    entries.push({
      performedIndex: entries.length,
      writtenMeasureIndex: index,
      writtenMeasureNumber: measure.number,
      repeatPass: 1,
      startTimeSeconds: performedTime,
      endTimeSeconds: performedTime + duration,
    })
    performedTime += duration
  }
  return { entries, performedTime }
}

/** Index of the forward repeat that opens the current section (same measure counts). */
function findSectionStartIndex(markings, backwardIndex) {
  const backward = markings[backwardIndex]
  if (backward?.forwardRepeat) {
    return backwardIndex
  }
  for (let index = backwardIndex - 1; index >= 0; index -= 1) {
    const marking = markings[index] ?? {}
    if (marking.forwardRepeat) {
      return index
    }
    // Do not pair across a prior backward closer unless ending brackets keep
    // the same section open (1st/2nd endings). Otherwise this is repeat-to-
    // beginning / a new orphan — pairing with an older forward does not terminate.
    if (marking.backwardRepeat && !sectionHasEndingBrackets(markings, index, backwardIndex)) {
      return -1
    }
  }
  return -1
}

function sectionHasEndingBrackets(markings, sectionStart, backwardIndex) {
  for (let index = Math.max(0, sectionStart); index <= backwardIndex; index += 1) {
    const marking = markings[index] ?? {}
    if (
      marking.endingStartNumbers?.length ||
      marking.endingStop ||
      marking.endingDiscontinue
    ) {
      return true
    }
  }
  return false
}

/**
 * Structures that the linear expander cannot finish safely.
 * Legitimate single orphan (repeat-to-beginning) and volta pairs stay allowed.
 */
export function detectUnsafeRepeatExpansion(markings) {
  let orphanBackwardCount = 0
  let openForwardIndex = -1
  let backwardClosersInSection = 0

  for (let index = 0; index < markings.length; index += 1) {
    const marking = markings[index] ?? {}

    if (marking.forwardRepeat) {
      openForwardIndex = index
      backwardClosersInSection = 0
    }

    if (!marking.backwardRepeat) {
      continue
    }

    if (openForwardIndex < 0) {
      orphanBackwardCount += 1
      if (orphanBackwardCount > 1) {
        return {
          unsafe: true,
          reason: 'multiple-orphan-backward-repeats',
          atMeasureIndex: index,
        }
      }
      continue
    }

    backwardClosersInSection += 1
    if (
      backwardClosersInSection > 1 &&
      !sectionHasEndingBrackets(markings, openForwardIndex, index)
    ) {
      return {
        unsafe: true,
        reason: 'multiple-backward-closers-without-endings',
        atMeasureIndex: index,
        forwardMeasureIndex: openForwardIndex,
      }
    }

    // Simple (non-volta) closer consumes the open forward.
    if (!sectionHasEndingBrackets(markings, openForwardIndex, index)) {
      openForwardIndex = -1
      backwardClosersInSection = 0
    }
  }

  return { unsafe: false, reason: null }
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

  const unsafe = detectUnsafeRepeatExpansion(markings)
  if (unsafe.unsafe) {
    uncertain = true
  }

  return { uncertain, unsafe }
}

function sectionPassKey(sectionStart) {
  return sectionStart >= 0 ? sectionStart : -1
}

/**
 * Expand written measures into performed playback order (repeats + voltas).
 * Written measure times stay unchanged; performed entries use a cumulative clock.
 */
export function buildPerformedMeasureTimeline(measures, markings, writtenBeats) {
  const repeatSections = []
  const endings = []
  const { uncertain: initiallyUncertain, unsafe } = detectMalformedRepeats(markings)
  let uncertain = initiallyUncertain
  let navigationUnsupported = false
  let expansionAborted = false
  let abortReason = unsafe.unsafe ? unsafe.reason : null

  const hasRepeatMarks = markings.some(
    (mark) =>
      mark.forwardRepeat ||
      mark.backwardRepeat ||
      mark.endingStartNumbers?.length ||
      mark.endingStop ||
      mark.endingDiscontinue,
  )

  // Unsafe graphs must not drive performed duration — fall back before expanding.
  if (unsafe.unsafe) {
    const written = buildWrittenOnlyEntries(measures)
    return {
      entries: written.entries,
      performedBeats: [],
      performedDurationSeconds: written.performedTime,
      diagnostics: {
        writtenMeasureCount: measures.length,
        performedMeasureCount: written.entries.length,
        repeatSections: [],
        endings: [],
        endingPassCount: 1,
        hasRepeatMarks,
        fullyInterpreted: false,
        usesPerformedTimeline: false,
        navigationUnsupported: false,
        expansionAborted: true,
        abortReason: unsafe.reason,
        firstUnsafeMeasureIndex: unsafe.atMeasureIndex ?? null,
        warning:
          'Some repeat marks could not be linked reliably. Measure display follows written score order.',
      },
    }
  }

  let index = 0
  /** Pass within each repeat section (resets when that section completes). */
  const sectionPasses = new Map()
  let performedTime = 0
  let steps = 0
  /** Ending bracket active across measures until stop/discontinue. */
  let activeEndingNumbers = null
  const maxSteps = measures.length * 40 + 16
  const entries = []

  const getSectionPass = (sectionStart) => sectionPasses.get(sectionPassKey(sectionStart)) ?? 1
  const setSectionPass = (sectionStart, pass) => {
    sectionPasses.set(sectionPassKey(sectionStart), pass)
  }

  while (index < measures.length && steps < maxSteps) {
    steps += 1
    const marking = markings[index] ?? {}
    const measure = measures[index]
    const activeSectionStart = findSectionStartIndex(markings, index)
    const sectionPass = getSectionPass(activeSectionStart)

    if (marking.endingStartNumbers?.length) {
      endings.push({
        measureIndex: index,
        measureNumber: measure.number,
        numbers: marking.endingStartNumbers,
      })
      activeEndingNumbers = marking.endingStartNumbers
    }

    const activeEndingNumbersBeforeSkip = activeEndingNumbers
    const skipForVolta = !shouldPlayMeasureOnPass(marking, sectionPass, activeEndingNumbers)

    // Decide stop/discontinue membership before clearing the bracket (P8).
    const endingClosesHere = marking.endingStop || marking.endingDiscontinue

    if (skipForVolta) {
      if (endingClosesHere) {
        activeEndingNumbers = null
      }
      // Backward repeats may sit on a volta measure that is skipped on some
      // passes. Honor the jump only when skipping a *later* ending on an
      // earlier pass (e.g. skip ending 2 on pass 1). Do not re-jump when
      // skipping an earlier ending on a later pass (e.g. skip ending 1 on
      // pass 2) — that case must fall through to the next ending.
      if (marking.backwardRepeat) {
        const endingNumbers = marking.endingStartNumbers ?? activeEndingNumbersBeforeSkip
        const skippingLaterEnding =
          Array.isArray(endingNumbers) &&
          endingNumbers.some((number) => number > sectionPass)
        const sectionStart = findSectionStartIndex(markings, index)
        const maxPasses = marking.backwardRepeatTimes ?? 2
        const pass = getSectionPass(sectionStart)
        if (skippingLaterEnding && pass < maxPasses) {
          setSectionPass(sectionStart, pass + 1)
          index = sectionStart >= 0 ? sectionStart : 0
          continue
        }
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
      const pass = getSectionPass(sectionStart)

      if (sectionStart >= 0) {
        repeatSections.push({
          forwardMeasureIndex: sectionStart,
          forwardMeasureNumber: measures[sectionStart].number,
          backwardMeasureIndex: index,
          backwardMeasureNumber: measure.number,
          maxPasses,
        })

        if (pass < maxPasses) {
          setSectionPass(sectionStart, pass + 1)
          index = sectionStart
          continue
        }

        // Section complete — reset pass for what follows.
        setSectionPass(sectionStart, 1)
      } else {
        // Repeat-to-beginning: no forward repeat in this section (P7).
        if (pass < maxPasses) {
          setSectionPass(sectionStart, pass + 1)
          index = 0
          continue
        }
        setSectionPass(sectionStart, 1)
      }
    }

    index += 1
  }

  if (steps >= maxSteps) {
    uncertain = true
    expansionAborted = true
    abortReason = abortReason ?? 'max-steps'
  }

  // Pathological expansion: discard and use written order for duration/playback clock.
  if (expansionAborted || (uncertain && entries.length > measures.length * 4)) {
    const written = buildWrittenOnlyEntries(measures)
    return {
      entries: written.entries,
      performedBeats: [],
      performedDurationSeconds: written.performedTime,
      diagnostics: {
        writtenMeasureCount: measures.length,
        performedMeasureCount: written.entries.length,
        repeatSections: [],
        endings,
        endingPassCount: 1,
        hasRepeatMarks,
        fullyInterpreted: false,
        usesPerformedTimeline: false,
        navigationUnsupported,
        expansionAborted: true,
        abortReason: abortReason ?? 'uncertain-expansion',
        warning:
          'Some repeat marks could not be linked reliably. Measure display follows written score order.',
      },
    }
  }

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
      endingPassCount: getSectionPass(-1),
      hasRepeatMarks,
      fullyInterpreted: !uncertain && !navigationUnsupported,
      usesPerformedTimeline,
      navigationUnsupported,
      expansionAborted: false,
      abortReason: null,
      warning,
    },
  }
}
