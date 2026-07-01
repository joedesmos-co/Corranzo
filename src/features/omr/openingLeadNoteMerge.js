import { extractOnsetColumns } from './innerVoicePhaseCorrection.js'

const DEFAULT_MAX_LEAD_GAP = 1
const DEFAULT_MIN_STACK_NOTES = 3
const OPENING_START_DIVISION = 0

export { DEFAULT_MAX_LEAD_GAP, DEFAULT_MIN_STACK_NOTES }

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

/**
 * Opening beat can split a lead treble tone one sixteenth before the rest of the
 * chord (x-slot snap). Merge the lone div-0 column into the adjacent stack.
 */
export function detectOpeningLeadNoteMerge(
  columns,
  {
    maxLeadGap = DEFAULT_MAX_LEAD_GAP,
    minStackNotes = DEFAULT_MIN_STACK_NOTES,
  } = {},
) {
  const sorted = [...columns].sort(
    (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
  )
  const lead = sorted[0]
  const stack = sorted[1]
  if (!lead || !stack) {
    return null
  }
  if (
    (lead.startDivision ?? 0) !== OPENING_START_DIVISION ||
    lead.noteCount !== 1 ||
    (stack.startDivision ?? 0) <= OPENING_START_DIVISION ||
    (stack.startDivision ?? 0) > maxLeadGap ||
    stack.noteCount < minStackNotes
  ) {
    return null
  }
  return {
    fromDivision: OPENING_START_DIVISION,
    toDivision: stack.startDivision,
    stackNoteCount: stack.noteCount,
  }
}

function applyMerge(measure, merge) {
  const events = (measure.events ?? []).map((event) => {
    if (event.type !== 'note') {
      return event
    }
    const startDivision = event.startDivision ?? 0
    if (startDivision !== merge.fromDivision) {
      return event
    }
    return {
      ...event,
      startDivision: merge.toDivision,
      openingLeadNoteMerged: true,
      openingLeadNoteMergeReasons: [
        ...new Set([...(event.openingLeadNoteMergeReasons ?? []), 'opening-lead-into-stack']),
      ],
    }
  })
  return {
    ...measure,
    events,
    openingLeadNoteMerge: {
      applied: true,
      fromDivision: merge.fromDivision,
      toDivision: merge.toDivision,
      stackNoteCount: merge.stackNoteCount,
    },
  }
}

export function applyOpeningLeadNoteMerge(
  measures = [],
  {
    maxLeadGap = DEFAULT_MAX_LEAD_GAP,
    minStackNotes = DEFAULT_MIN_STACK_NOTES,
    cloneMeasures = false,
  } = {},
) {
  const beforeNoteCount = noteCountInMeasures(measures)
  const correctedMeasures = []
  const summary = {
    candidateMeasures: 0,
    appliedMeasures: 0,
    samples: [],
    noteCountChanged: false,
    measureCountChanged: false,
    maxLeadGap,
    minStackNotes,
  }

  for (const measure of measures) {
    const workingMeasure = cloneMeasures ? cloneMeasure(measure) : measure
    const columns = extractOnsetColumns(workingMeasure.events)
    const merge = detectOpeningLeadNoteMerge(columns, { maxLeadGap, minStackNotes })
    if (!merge) {
      correctedMeasures.push(workingMeasure)
      continue
    }
    summary.candidateMeasures += 1
    const adjusted = applyMerge(workingMeasure, merge)
    summary.appliedMeasures += 1
    if (summary.samples.length < 12) {
      summary.samples.push({
        measureNumber: measure.measureNumber ?? null,
        fromDivision: merge.fromDivision,
        toDivision: merge.toDivision,
        stackNoteCount: merge.stackNoteCount,
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

/** Offline benchmark helper — clones input measures before applying merge. */
export function simulateOpeningLeadNoteMerge(measures = [], options = {}) {
  return applyOpeningLeadNoteMerge(measures, {
    ...options,
    cloneMeasures: true,
  })
}
