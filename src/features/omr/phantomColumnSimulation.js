import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'
import { extractOnsetColumns } from './innerVoicePhaseCorrection.js'

const SIXTEENTH = 1
const PHANTOM_MOD = 3
const STACK_MOD = 1
const PHANTOM_STACK_GAP = 2
const DEFAULT_MIN_PAIRS = 2
const DEFAULT_MIN_STACK_NOTES = 4
const DEFAULT_STACK_SHIFT = -SIXTEENTH
const TERMINAL_EARLY_REGION_START = 9
const TERMINAL_FORWARD_SHIFT = SIXTEENTH

export const PHANTOM_COLUMN_STRATEGIES = {
  LINKED_STACK_REALIGN: 'linked-stack-realign',
  DROP_TERMINAL_PHANTOM: 'drop-terminal-phantom',
  SHIFT_TERMINAL_EARLY_FORWARD: 'shift-terminal-early-forward',
  DROP_AND_SHIFT_TERMINAL: 'drop-and-shift-terminal',
}

export {
  DEFAULT_MIN_PAIRS,
  DEFAULT_MIN_STACK_NOTES,
  DEFAULT_STACK_SHIFT,
  PHANTOM_MOD,
  PHANTOM_STACK_GAP,
  STACK_MOD,
  TERMINAL_EARLY_REGION_START,
  TERMINAL_FORWARD_SHIFT,
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

function columnByDivision(columns, startDivision) {
  return columns.find((column) => (column.startDivision ?? 0) === startDivision) ?? null
}

/**
 * Terminal Family B: columns in the last 1.5 beats landed one sixteenth early.
 * Signature (m94-like): solo @2.25q, 2-note stack @2.5q, quarter anchor @3.0q,
 * 4-note terminal stack @3.25q that should sit @3.5q.
 */
export function detectTerminalEarlyColumnCorrection(
  columns,
  {
    totalDivisions = OMR_DIVISIONS_PER_QUARTER * 4,
    terminalRegionStart = TERMINAL_EARLY_REGION_START,
    minTerminalStackNotes = 4,
  } = {},
) {
  const leadSolo = columnByDivision(columns, terminalRegionStart)
  const followStack = columnByDivision(columns, terminalRegionStart + 1)
  const quarterAnchor = columnByDivision(columns, terminalRegionStart + 3)
  const lateStack = columns
    .filter(
      (column) =>
        (column.startDivision ?? 0) > terminalRegionStart + 2 &&
        (column.startDivision ?? 0) < totalDivisions &&
        column.noteCount >= minTerminalStackNotes &&
        (column.startDivision ?? 0) % OMR_DIVISIONS_PER_QUARTER === 1,
    )
    .sort((left, right) => (right.startDivision ?? 0) - (left.startDivision ?? 0))[0]

  if (
    !leadSolo ||
    leadSolo.noteCount !== 1 ||
    !followStack ||
    followStack.noteCount !== 2 ||
    !quarterAnchor ||
    quarterAnchor.noteCount !== 2 ||
    (quarterAnchor.startDivision ?? 0) % OMR_DIVISIONS_PER_QUARTER !== 0 ||
    !lateStack
  ) {
    return null
  }

  const stackShifts = [
    { fromDivision: leadSolo.startDivision, toDivision: leadSolo.startDivision + TERMINAL_FORWARD_SHIFT },
    { fromDivision: followStack.startDivision, toDivision: followStack.startDivision + TERMINAL_FORWARD_SHIFT },
    { fromDivision: lateStack.startDivision, toDivision: lateStack.startDivision + TERMINAL_FORWARD_SHIFT },
  ].filter(({ toDivision }) => toDivision < totalDivisions)

  if (stackShifts.length < 3) {
    return null
  }

  return {
    phantomColumns: [
      {
        startDivision: leadSolo.startDivision,
        noteCount: leadSolo.noteCount,
        midis: [...columnMidis(leadSolo)],
      },
    ],
    stackShifts,
    shiftReason: 'terminal-early-forward-realign',
    pairs: [
      {
        phantomStartDivision: leadSolo.startDivision,
        stackStartDivision: followStack.startDivision,
        stackNoteCount: followStack.noteCount,
        duplicateMidis: [],
        splitsAttack: false,
      },
      {
        phantomStartDivision: null,
        stackStartDivision: lateStack.startDivision,
        stackNoteCount: lateStack.noteCount,
        duplicateMidis: [],
        splitsAttack: false,
      },
    ],
  }
}

function applyStackShift(measure, correction) {
  const shiftReason = correction.shiftReason ?? 'linked-stack-phantom-realign'
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
        ...new Set([...(event.phantomColumnReasons ?? []), shiftReason]),
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
function dropPhantomColumns(measure, phantomStarts) {
  const dropSet = new Set(phantomStarts)
  const events = (measure.events ?? []).filter((event) => {
    if (event.type !== 'note') {
      return true
    }
    return !dropSet.has(event.startDivision ?? 0)
  })
  return {
    ...measure,
    events,
    phantomColumnCorrection: {
      applied: true,
      droppedPhantomStarts: [...phantomStarts],
    },
  }
}

function detectCorrectionForStrategy(columns, options) {
  const strategy = options.strategy ?? PHANTOM_COLUMN_STRATEGIES.LINKED_STACK_REALIGN
  if (strategy === PHANTOM_COLUMN_STRATEGIES.SHIFT_TERMINAL_EARLY_FORWARD) {
    return detectTerminalEarlyColumnCorrection(columns, options)
  }
  if (strategy === PHANTOM_COLUMN_STRATEGIES.DROP_TERMINAL_PHANTOM) {
    const leadSolo = columnByDivision(columns, TERMINAL_EARLY_REGION_START)
    if (!leadSolo || leadSolo.noteCount !== 1) {
      return null
    }
    return {
      phantomColumns: [
        {
          startDivision: leadSolo.startDivision,
          noteCount: leadSolo.noteCount,
          midis: [...columnMidis(leadSolo)],
        },
      ],
      stackShifts: [],
      dropPhantomStarts: [leadSolo.startDivision],
      pairs: [],
    }
  }
  if (strategy === PHANTOM_COLUMN_STRATEGIES.DROP_AND_SHIFT_TERMINAL) {
    const terminal = detectTerminalEarlyColumnCorrection(columns, options)
    if (!terminal) {
      return null
    }
    return {
      ...terminal,
      stackShifts: terminal.stackShifts.filter(
        ({ fromDivision }) => fromDivision !== TERMINAL_EARLY_REGION_START,
      ),
      dropPhantomStarts: terminal.phantomColumns.map((column) => column.startDivision),
    }
  }
  return detectPhantomColumnCorrection(columns, options)
}

export function applyPhantomColumnCorrection(
  measures = [],
  {
    totalDivisions = OMR_DIVISIONS_PER_QUARTER * 4,
    minPairs = DEFAULT_MIN_PAIRS,
    minStackNotes = DEFAULT_MIN_STACK_NOTES,
    stackShift = DEFAULT_STACK_SHIFT,
    strategy = PHANTOM_COLUMN_STRATEGIES.LINKED_STACK_REALIGN,
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
    strategy,
  }

  for (const measure of measures) {
    const workingMeasure = cloneMeasures ? cloneMeasure(measure) : measure
    const columns = extractOnsetColumns(workingMeasure.events)
    const correction = detectCorrectionForStrategy(columns, {
      minPairs,
      minStackNotes,
      stackShift,
      strategy,
      totalDivisions,
    })
    if (!correction) {
      correctedMeasures.push(workingMeasure)
      continue
    }
    summary.candidateMeasures += 1
    const maxShiftedStart = correction.stackShifts?.length
      ? Math.max(...correction.stackShifts.map(({ toDivision }) => toDivision))
      : -1
    if (maxShiftedStart >= totalDivisions) {
      summary.rejectedReasons['shift-past-measure-end'] =
        (summary.rejectedReasons['shift-past-measure-end'] ?? 0) + 1
      correctedMeasures.push(workingMeasure)
      continue
    }
    let adjusted = workingMeasure
    if (correction.stackShifts?.length) {
      adjusted = applyStackShift(adjusted, correction)
    }
    if (correction.dropPhantomStarts?.length) {
      adjusted = dropPhantomColumns(adjusted, correction.dropPhantomStarts)
    }
    summary.appliedMeasures += 1
    if (summary.samples.length < 12) {
      summary.samples.push({
        measureNumber: measure.measureNumber ?? null,
        phantomStarts: correction.phantomColumns?.map((column) => column.startDivision) ?? [],
        stackShifts: correction.stackShifts ?? [],
        droppedPhantomStarts: correction.dropPhantomStarts ?? [],
        pairs: correction.pairs ?? [],
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

/** Offline variant probe — same as simulate but records strategy name explicitly. */
export function simulatePhantomColumnVariant(measures = [], options = {}) {
  return simulatePhantomColumnCorrection(measures, options)
}

/** Runtime helper — terminal Family B early columns shifted +0.25q (m94-like). */
export function applyTerminalEarlyColumnCorrection(measures = [], options = {}) {
  return applyPhantomColumnCorrection(measures, {
    ...options,
    strategy: PHANTOM_COLUMN_STRATEGIES.SHIFT_TERMINAL_EARLY_FORWARD,
  })
}
