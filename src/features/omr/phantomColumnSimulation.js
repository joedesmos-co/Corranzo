import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'
import { extractOnsetColumns } from './innerVoicePhaseCorrection.js'

const SIXTEENTH = 1
const PHANTOM_MOD = 3
const STACK_MOD = 1
const PHANTOM_STACK_GAP = 2
const DEFAULT_MIN_PAIRS = 2
const DEFAULT_MIN_STACK_NOTES = 4
const DEFAULT_STACK_SHIFT = -SIXTEENTH

export {
  DEFAULT_MIN_PAIRS,
  DEFAULT_MIN_STACK_NOTES,
  DEFAULT_STACK_SHIFT,
  PHANTOM_MOD,
  PHANTOM_STACK_GAP,
  STACK_MOD,
}

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

function isPhantomColumn(column) {
  return column.noteCount === 1 && (column.startDivision ?? 0) % OMR_DIVISIONS_PER_QUARTER === PHANTOM_MOD
}

function isLinkedStackColumn(column, minStackNotes) {
  return (
    column.noteCount >= minStackNotes &&
    (column.startDivision ?? 0) % OMR_DIVISIONS_PER_QUARTER === STACK_MOD
  )
}

function columnMidis(column) {
  const midis = new Set()
  for (const event of column.events ?? []) {
    for (const note of event.notes ?? []) {
      if (Number.isFinite(note.midi)) {
        midis.add(note.midi)
      }
    }
  }
  return midis
}

function divisionToQuarter(startDivision) {
  return (startDivision ?? 0) / OMR_DIVISIONS_PER_QUARTER
}

/**
 * Family B signature: solo phantom columns at div%4===3 with linked stacks
 * two sixteenths later at div%4===1.
 */
export function detectPhantomColumnCorrection(
  columns,
  {
    minPairs = DEFAULT_MIN_PAIRS,
    minStackNotes = DEFAULT_MIN_STACK_NOTES,
    stackShift = DEFAULT_STACK_SHIFT,
  } = {},
) {
  const phantoms = columns.filter(isPhantomColumn)
  const stacks = columns.filter((column) => isLinkedStackColumn(column, minStackNotes))
  const pairs = phantoms.filter((phantom) =>
    stacks.some((stack) => (stack.startDivision ?? 0) === (phantom.startDivision ?? 0) + PHANTOM_STACK_GAP),
  )
  if (pairs.length < minPairs) {
    return null
  }

  const stackShifts = new Map()
  for (const phantom of pairs) {
    const stack = stacks.find(
      (candidate) => (candidate.startDivision ?? 0) === (phantom.startDivision ?? 0) + PHANTOM_STACK_GAP,
    )
    if (!stack) {
      continue
    }
    const fromDivision = stack.startDivision ?? 0
    const toDivision = fromDivision + stackShift
    if (toDivision < 0) {
      continue
    }
    stackShifts.set(fromDivision, toDivision)
  }
  if (stackShifts.size < 1) {
    return null
  }

  return {
    phantomColumns: pairs.map((column) => ({
      startDivision: column.startDivision,
      noteCount: column.noteCount,
      midis: [...columnMidis(column)],
    })),
    stackShifts: [...stackShifts.entries()].map(([fromDivision, toDivision]) => ({
      fromDivision,
      toDivision,
    })),
    pairs: pairs.map((phantom) => {
      const stack = stacks.find(
        (candidate) => (candidate.startDivision ?? 0) === (phantom.startDivision ?? 0) + PHANTOM_STACK_GAP,
      )
      const phantomMidis = columnMidis(phantom)
      const stackMidis = columnMidis(stack)
      const duplicateMidis = [...phantomMidis].filter((midi) => stackMidis.has(midi))
      return {
        phantomStartDivision: phantom.startDivision,
        stackStartDivision: stack?.startDivision ?? null,
        stackNoteCount: stack?.noteCount ?? 0,
        duplicateMidis,
        splitsAttack: duplicateMidis.length > 0,
      }
    }),
  }
}

export function diagnoseMeasurePhantomColumns(measure, options = {}) {
  const columns = extractOnsetColumns(measure.events)
  const correction = detectPhantomColumnCorrection(columns, options)
  return {
    measureNumber: measure.measureNumber ?? null,
    columns: columns.map((column) => ({
      startDivision: column.startDivision,
      onsetQuarter: divisionToQuarter(column.startDivision),
      noteCount: column.noteCount,
      role:
        isPhantomColumn(column)
          ? 'phantom-solo'
          : isLinkedStackColumn(column, options.minStackNotes ?? DEFAULT_MIN_STACK_NOTES)
            ? 'linked-stack'
            : column.noteCount === 1
              ? 'solo'
              : 'stack',
      midis: [...columnMidis(column)],
    })),
    correction,
  }
}

function applyStackShift(measure, correction) {
  const shiftByStart = new Map(
    correction.stackShifts.map(({ fromDivision, toDivision }) => [fromDivision, toDivision]),
  )
  const events = (measure.events ?? []).map((event) => {
    if (event.type !== 'note') {
      return event
    }
    const startDivision = event.startDivision ?? 0
    if (!shiftByStart.has(startDivision)) {
      return event
    }
    return {
      ...event,
      startDivision: shiftByStart.get(startDivision),
      phantomColumnAdjusted: true,
      phantomColumnReasons: [
        ...new Set([...(event.phantomColumnReasons ?? []), 'linked-stack-phantom-realign']),
      ],
    }
  })
  return {
    ...measure,
    events,
    phantomColumnCorrection: {
      applied: true,
      stackShifts: correction.stackShifts,
      phantomStarts: correction.phantomColumns.map((column) => column.startDivision),
    },
  }
}

/**
 * Realign stacks that sit +0.25q early beside Family B phantom solo columns.
 * Phantom solos are kept; stacks shift one sixteenth earlier.
 */
export function applyPhantomColumnCorrection(
  measures = [],
  {
    totalDivisions = OMR_DIVISIONS_PER_QUARTER * 4,
    minPairs = DEFAULT_MIN_PAIRS,
    minStackNotes = DEFAULT_MIN_STACK_NOTES,
    stackShift = DEFAULT_STACK_SHIFT,
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
    minPairs,
    minStackNotes,
    stackShift,
  }

  for (const measure of measures) {
    const workingMeasure = cloneMeasures ? cloneMeasure(measure) : measure
    const columns = extractOnsetColumns(workingMeasure.events)
    const correction = detectPhantomColumnCorrection(columns, { minPairs, minStackNotes, stackShift })
    if (!correction) {
      correctedMeasures.push(workingMeasure)
      continue
    }
    summary.candidateMeasures += 1
    const maxShiftedStart = Math.max(...correction.stackShifts.map(({ toDivision }) => toDivision))
    if (maxShiftedStart >= totalDivisions) {
      summary.rejectedReasons['shift-past-measure-end'] =
        (summary.rejectedReasons['shift-past-measure-end'] ?? 0) + 1
      correctedMeasures.push(workingMeasure)
      continue
    }
    const adjusted = applyStackShift(workingMeasure, correction)
    summary.appliedMeasures += 1
    if (summary.samples.length < 12) {
      summary.samples.push({
        measureNumber: measure.measureNumber ?? null,
        phantomStarts: correction.phantomColumns.map((column) => column.startDivision),
        stackShifts: correction.stackShifts,
        pairs: correction.pairs,
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
export function simulatePhantomColumnCorrection(measures = [], options = {}) {
  return applyPhantomColumnCorrection(measures, {
    ...options,
    cloneMeasures: true,
  })
}
