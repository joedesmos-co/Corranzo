import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'

const SIXTEENTH = 1
const DEFAULT_MIN_STACK_NOTES = 3
const NARROW_MIN_STACK_NOTES = 5
const MIN_PAIRS = 2
const MIN_RUN_START_DIVISION = OMR_DIVISIONS_PER_QUARTER * 2

export { NARROW_MIN_STACK_NOTES }

function cloneEvent(event) {
  return {
    ...event,
    notes: [...(event.notes ?? [])],
  }
}

function cloneMeasure(measure) {
  return {
    ...measure,
    events: (measure.events ?? []).map(cloneEvent),
  }
}

function noteCountInMeasures(measures = []) {
  return measures.reduce(
    (total, measure) =>
      total +
      (measure.events ?? []).reduce(
        (eventTotal, event) => eventTotal + (event.type === 'note' ? event.notes?.length ?? 0 : 0),
        0,
      ),
    0,
  )
}

function sortEvents(events) {
  return [...events].sort(
    (left, right) =>
      (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
      (left.notes?.[0]?.clef === 'bass' ? -1 : 1) - (right.notes?.[0]?.clef === 'bass' ? -1 : 1),
  )
}

function hasBeamEvidence(event) {
  return (event?.notes ?? []).some(
    (note) => (note.beams ?? 0) > 0 || (note.beamStrength ?? 0) >= 8,
  )
}

export function extractOnsetColumns(events = []) {
  const byStart = new Map()
  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    const startDivision = event.startDivision ?? 0
    const bucket =
      byStart.get(startDivision) ??
      {
        startDivision,
        events: [],
        noteCount: 0,
        hasBeam: false,
      }
    bucket.events.push(event)
    bucket.noteCount += event.notes?.length ?? 0
    if (hasBeamEvidence(event)) {
      bucket.hasBeam = true
    }
    byStart.set(startDivision, bucket)
  }
  return [...byStart.values()].sort((left, right) => left.startDivision - right.startDivision)
}

function divisionGap(left, right) {
  return (right.startDivision ?? 0) - (left.startDivision ?? 0)
}

function isSoloColumn(column) {
  return column.noteCount === 1
}

function isStackColumn(column, minStackNotes) {
  return column.noteCount >= minStackNotes
}

function spacingValid(run) {
  for (let index = 1; index < run.length; index += 1) {
    const gap = divisionGap(run[index - 1], run[index])
    const expectStack = index % 2 === 1
    if (expectStack) {
      if (gap !== SIXTEENTH) {
        return false
      }
      continue
    }
    if (gap !== SIXTEENTH && gap !== SIXTEENTH * 2) {
      return false
    }
  }
  return true
}

function trimRunForMeasureEnd(run, totalDivisions) {
  const trimmed = [...run]
  while (trimmed.length >= MIN_PAIRS * 2) {
    const maxShiftedStart = (trimmed[trimmed.length - 1].startDivision ?? 0) + SIXTEENTH
    if (maxShiftedStart < totalDivisions) {
      return trimmed
    }
    trimmed.pop()
  }
  return null
}

function runPassesGuards(run, totalDivisions, minStackNotes) {
  const shiftableRun = trimRunForMeasureEnd(run, totalDivisions)
  if (!shiftableRun || shiftableRun.length < MIN_PAIRS * 2) {
    return { ok: false, reason: 'shift-past-measure-end' }
  }
  if ((shiftableRun[0].startDivision ?? 0) < MIN_RUN_START_DIVISION) {
    return { ok: false, reason: 'before-beat-two' }
  }
  if (!spacingValid(shiftableRun)) {
    return { ok: false, reason: 'spacing-invalid' }
  }
  for (let index = 0; index < shiftableRun.length; index += 2) {
    const solo = shiftableRun[index]
    if (!isSoloColumn(solo)) {
      return { ok: false, reason: 'solo-size-invalid' }
    }
    if (solo.hasBeam || solo.events.some((event) => hasBeamEvidence(event))) {
      return { ok: false, reason: 'solo-beam-evidence' }
    }
    const stack = shiftableRun[index + 1]
    if (!stack || !isStackColumn(stack, minStackNotes)) {
      return { ok: false, reason: 'stack-size-invalid' }
    }
  }
  return { ok: true, run: shiftableRun }
}

/**
 * Detect {solo, stack}+ runs that look one sixteenth early (solo on .25 or .0 slots).
 */
export function detectInnerVoicePhaseWindow(
  columns,
  {
    totalDivisions = OMR_DIVISIONS_PER_QUARTER * 4,
    minStackNotes = DEFAULT_MIN_STACK_NOTES,
  } = {},
) {
  for (let start = 0; start < columns.length - 1; start += 1) {
    if (!isSoloColumn(columns[start])) {
      continue
    }
    const run = [columns[start]]
    let index = start + 1
    while (index < columns.length) {
      const expectStack = run.length % 2 === 1
      const column = columns[index]
      if (expectStack) {
        if (!isStackColumn(column, minStackNotes)) {
          break
        }
        run.push(column)
        index += 1
        continue
      }
      if (!isSoloColumn(column)) {
        break
      }
      run.push(column)
      index += 1
    }
    const guard = runPassesGuards(run, totalDivisions, minStackNotes)
    if (!guard.ok) {
      continue
    }
    const shiftableRun = guard.run
    const earlySolos = shiftableRun.filter((_, runIndex) => runIndex % 2 === 0)
    const earlyCount = earlySolos.filter(
      (column) => (column.startDivision ?? 0) % OMR_DIVISIONS_PER_QUARTER !== 2,
    ).length
    if (earlyCount < Math.ceil(earlySolos.length / 2)) {
      continue
    }
    return {
      run: shiftableRun,
      shiftDivisions: SIXTEENTH,
      startDivision: shiftableRun[0].startDivision,
      endDivision: shiftableRun[shiftableRun.length - 1].startDivision,
    }
  }
  return null
}

function applyPhaseShift(measure, window, totalDivisions) {
  const shiftedStarts = new Set(window.run.map((column) => column.startDivision))
  const events = sortEvents(
    (measure.events ?? []).map((event) => {
      if (event.type !== 'note') {
        return event
      }
      const startDivision = event.startDivision ?? 0
      if (!shiftedStarts.has(startDivision)) {
        return event
      }
      const nextStart = startDivision + window.shiftDivisions
      if (nextStart >= totalDivisions) {
        return event
      }
      return {
        ...event,
        startDivision: nextStart,
        innerVoicePhaseAdjusted: true,
        innerVoicePhaseReasons: [
          ...new Set([...(event.innerVoicePhaseReasons ?? []), 'solo-stack-phase-shift']),
        ],
      }
    }),
  )
  return {
    ...measure,
    events,
    innerVoicePhaseCorrection: {
      applied: true,
      shiftDivisions: window.shiftDivisions,
      startDivision: window.startDivision,
      endDivision: window.endDivision,
      columnCount: window.run.length,
    },
  }
}

/**
 * Runtime + offline correction: shift matched solo/stack windows +0.25q.
 * Default minStackNotes is the narrow m33-like slice (>= 5).
 */
export function applyInnerVoicePhaseCorrection(
  measures = [],
  {
    totalDivisions = OMR_DIVISIONS_PER_QUARTER * 4,
    minStackNotes = NARROW_MIN_STACK_NOTES,
    cloneMeasures = false,
  } = {},
) {
  const beforeNoteCount = noteCountInMeasures(measures)
  const correctedMeasures = []
  const summary = {
    candidateMeasures: 0,
    appliedMeasures: 0,
    rejectedReasons: {},
    samples: [],
    noteCountChanged: false,
    measureCountChanged: false,
    minStackNotes,
  }

  for (const measure of measures) {
    const workingMeasure = cloneMeasures ? cloneMeasure(measure) : measure
    const columns = extractOnsetColumns(workingMeasure.events)
    const window = detectInnerVoicePhaseWindow(columns, { totalDivisions, minStackNotes })
    if (!window) {
      correctedMeasures.push(workingMeasure)
      continue
    }
    summary.candidateMeasures += 1
    const guard = runPassesGuards(window.run, totalDivisions, minStackNotes)
    if (!guard.ok) {
      summary.rejectedReasons[guard.reason] = (summary.rejectedReasons[guard.reason] ?? 0) + 1
      correctedMeasures.push(workingMeasure)
      continue
    }
    const adjusted = applyPhaseShift(workingMeasure, { ...window, run: guard.run }, totalDivisions)
    summary.appliedMeasures += 1
    if (summary.samples.length < 12) {
      summary.samples.push({
        measureNumber: measure.measureNumber ?? null,
        startDivision: window.startDivision,
        endDivision: window.endDivision,
        shiftDivisions: window.shiftDivisions,
        columnCount: guard.run.length,
        columnSizes: guard.run.map((column) => column.noteCount),
      })
    }
    correctedMeasures.push(adjusted)
  }

  const afterNoteCount = noteCountInMeasures(correctedMeasures)
  summary.noteCountChanged = beforeNoteCount !== afterNoteCount
  summary.measureCountChanged = correctedMeasures.length !== measures.length
  summary.noteCountBefore = beforeNoteCount
  summary.noteCountAfter = afterNoteCount

  return {
    measures: correctedMeasures,
    summary,
  }
}

/** Offline benchmark helper — clones input measures before applying correction. */
export function simulateInnerVoicePhaseCorrection(measures = [], options = {}) {
  return applyInnerVoicePhaseCorrection(measures, {
    ...options,
    cloneMeasures: true,
    minStackNotes: options.minStackNotes ?? DEFAULT_MIN_STACK_NOTES,
  })
}
