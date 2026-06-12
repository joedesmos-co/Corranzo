import { asNumber, ensureArray } from './xmlUtils.js'

function parseEndingNumbers(value) {
  if (value == null || value === '') {
    return []
  }
  return String(value)
    .split(/[, ]+/)
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number) && number > 0)
}

function readBarlineRepeat(barline) {
  const repeat = barline.repeat
  if (!repeat) {
    return null
  }
  const node = ensureArray(repeat)[0] ?? repeat
  return {
    direction: node['@_direction'] ?? null,
    times: asNumber(node['@_times'], NaN),
  }
}

function readBarlineEnding(barline) {
  const ending = barline.ending
  if (!ending) {
    return null
  }
  const node = ensureArray(ending)[0] ?? ending
  return {
    type: node['@_type'] ?? null,
    numbers: parseEndingNumbers(node['@_number']),
  }
}

/**
 * Read repeat / ending marks on a written measure (barline children).
 */
export function extractMeasureRepeatMarkings(measureNode) {
  let forwardRepeat = false
  let backwardRepeat = false
  let backwardRepeatTimes = null
  let endingStartNumbers = null
  let endingStop = false
  let endingDiscontinue = false

  for (const [key, value] of Object.entries(measureNode)) {
    if (key.startsWith('@_')) {
      continue
    }
    if (key !== 'barline') {
      continue
    }
    for (const barline of ensureArray(value)) {
      const location = barline['@_location'] ?? 'right'
      const repeat = readBarlineRepeat(barline)
      if (repeat?.direction === 'forward' && (location === 'left' || location === 'both')) {
        forwardRepeat = true
      }
      if (repeat?.direction === 'backward' && (location === 'right' || location === 'both')) {
        backwardRepeat = true
        if (Number.isFinite(repeat.times) && repeat.times > 1) {
          backwardRepeatTimes = repeat.times
        }
      }

      const ending = readBarlineEnding(barline)
      if (ending?.type === 'start' && ending.numbers.length > 0) {
        endingStartNumbers = ending.numbers
      }
      if (ending?.type === 'stop') {
        endingStop = true
      }
      if (ending?.type === 'discontinue') {
        endingDiscontinue = true
      }
    }
  }

  return {
    forwardRepeat,
    backwardRepeat,
    backwardRepeatTimes,
    endingStartNumbers,
    endingStop,
    endingDiscontinue,
  }
}

function findForwardRepeatIndex(markings, backwardIndex) {
  for (let index = backwardIndex - 1; index >= 0; index -= 1) {
    if (markings[index]?.forwardRepeat) {
      return index
    }
  }
  return -1
}

function shouldPlayMeasureOnPass(marking, pass, endingBracketNumbers) {
  if (endingBracketNumbers?.length) {
    return endingBracketNumbers.includes(pass)
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

/**
 * Expand written measures into a performed playback order (repeats + simple voltas).
 * Written measure times stay unchanged; performed entries use a cumulative performed clock.
 */
export function buildPerformedMeasureTimeline(measures, markings, writtenBeats) {
  const repeatSections = []
  const endings = []
  const entries = []
  let uncertain = false

  let index = 0
  let pass = 1
  let performedTime = 0
  let steps = 0
  let endingBracketNumbers = null
  const maxSteps = measures.length * 32 + 8

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
      endingBracketNumbers = marking.endingStartNumbers
    }

    if (marking.endingStop || marking.endingDiscontinue) {
      endingBracketNumbers = null
    }

    if (!shouldPlayMeasureOnPass(marking, pass, endingBracketNumbers)) {
      index += 1
      continue
    }

    const duration = Math.max(0, measure.endTimeSeconds - measure.startTimeSeconds)
    entries.push({
      performedIndex: entries.length,
      writtenMeasureIndex: index,
      writtenMeasureNumber: measure.number,
      repeatPass: pass,
      startTimeSeconds: performedTime,
      endTimeSeconds: performedTime + duration,
    })
    performedTime += duration

    if (marking.backwardRepeat) {
      const forwardIndex = findForwardRepeatIndex(markings, index)
      if (forwardIndex >= 0) {
        repeatSections.push({
          forwardMeasureIndex: forwardIndex,
          forwardMeasureNumber: measures[forwardIndex].number,
          backwardMeasureIndex: index,
          backwardMeasureNumber: measure.number,
        })

        const maxPasses = marking.backwardRepeatTimes ?? 2
        if (pass < maxPasses) {
          pass += 1
          index = forwardIndex
          continue
        }
      } else {
        uncertain = true
      }
    }

    index += 1
  }

  if (steps >= maxSteps) {
    uncertain = true
  }

  const hasRepeatMarks =
    repeatSections.length > 0 ||
    endings.length > 0 ||
    markings.some((mark) => mark.forwardRepeat || mark.backwardRepeat)

  const expanded = entries.length > measures.length
  const usesPerformedTimeline = expanded

  let warning = null
  if (uncertain) {
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
      endingPassCount: pass,
      hasRepeatMarks,
      fullyInterpreted: !uncertain,
      usesPerformedTimeline,
      warning,
    },
  }
}
