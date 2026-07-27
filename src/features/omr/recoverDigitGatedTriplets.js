/**
 * Digit-gated 3:2 tuplet recovery for vector OMR.
 *
 * Requires visual "3" evidence near the note group plus equal-column spacing
 * (factor 3 columns per beat). Does not invent tuplets from measure balancing.
 */
import {
  OMR_DIVISIONS_PER_QUARTER,
  OMR_DURATION_DIVISIONS,
} from './omrRhythmConstants.js'

function average(values) {
  const nums = values.filter(Number.isFinite)
  if (!nums.length) {
    return null
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

function measureBoundsPx(measureBox, imageData) {
  const width = imageData?.width ?? 1000
  const height = imageData?.height ?? 1000
  return {
    x0: (measureBox.x0 ?? 0) * width,
    x1: (measureBox.x1 ?? 1) * width,
    y0: (measureBox.y0 ?? 0) * height,
    y1: (measureBox.y1 ?? 1) * height,
  }
}

/**
 * Collect tuplet-number "3" glyphs near the note group (above noteheads).
 * Prefer note geometry over the measure box so mis-cut barlines still work.
 * Measure-number "3" glyphs sit higher above the system and are excluded.
 */
export function collectTupletDigitThrees(glyphs, measureBox, imageData, noteEvents = []) {
  const noteXs = noteEvents
    .flatMap((event) =>
      (event.notes ?? []).map((note) => note.cx ?? note.x).filter(Number.isFinite),
    )
    .concat(
      noteEvents.map((event) => event.cx).filter(Number.isFinite),
    )
  const noteYs = noteEvents
    .flatMap((event) => (event.notes ?? []).map((note) => note.cy ?? note.y))
    .filter(Number.isFinite)

  let minX
  let maxX
  let meanNoteY
  if (noteXs.length && noteYs.length) {
    minX = Math.min(...noteXs) - 36
    maxX = Math.max(...noteXs) + 36
    meanNoteY = average(noteYs)
  } else {
    const bounds = measureBoundsPx(measureBox, imageData)
    minX = bounds.x0 - 12
    maxX = bounds.x1 + 12
    meanNoteY = (bounds.y0 + bounds.y1) / 2
  }

  const staffTop = meanNoteY - 90
  const staffBottom = meanNoteY - 4

  return (glyphs ?? []).filter((glyph) => {
    if (String(glyph.text ?? '') !== '3') {
      return false
    }
    const x = glyph.x ?? glyph.cx
    const y = glyph.y ?? glyph.cy
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false
    }
    if (x < minX || x > maxX) {
      return false
    }
    return y >= staffTop && y <= staffBottom
  })
}

/**
 * Recover a uniform 3-slots-per-beat grid when digit evidence supports 3:2.
 * Rewrites note onsets/durations and stamps timeModification on each event.
 */
export function recoverDigitGatedTripletEvents(
  events,
  {
    glyphs = [],
    measureBox = null,
    imageData = null,
    beats = 4,
    totalDivisions = 16,
  } = {},
) {
  const noteEvents = (events ?? []).filter((event) => event.type === 'note')
  const rests = (events ?? []).filter((event) => event.type !== 'note')
  // Allow one missed notehead in a 3:2 group (12 expected for 4/4).
  if (noteEvents.length < beats * 3 - 1) {
    return { events, recovered: false, reason: 'too-few-notes', noteCount: noteEvents.length }
  }

  const digits = collectTupletDigitThrees(glyphs, measureBox, imageData, noteEvents)
  // Need roughly one digit per beat-group (tolerate one miss).
  if (digits.length < Math.max(2, beats - 1)) {
    return { events, recovered: false, reason: 'insufficient-digits', digitCount: digits.length }
  }

  // Prefer one onset column per notehead. Chord-merged events under-count
  // columns on monophonic triplet runs (11 notes → 6 columns).
  const atomicEvents = noteEvents.flatMap((event) => {
    const notes = event.notes ?? []
    if (notes.length <= 1) {
      return [event]
    }
    return notes.map((note) => ({
      ...event,
      cx: note.cx ?? event.cx,
      notes: [note],
    }))
  })

  if (atomicEvents.length < beats * 3 - 1) {
    return {
      events,
      recovered: false,
      reason: 'too-few-atomic-notes',
      noteCount: atomicEvents.length,
    }
  }

  const sorted = [...atomicEvents].sort(
    (left, right) =>
      (left.cx ?? 0) - (right.cx ?? 0) ||
      (left.startDivision ?? 0) - (right.startDivision ?? 0),
  )
  const columns = []
  for (const event of sorted) {
    const start = event.startDivision ?? 0
    const cx = event.cx ?? average((event.notes ?? []).map((note) => note.cx)) ?? 0
    const last = columns[columns.length - 1]
    // Tight merge: only stack vertically aligned chord members, not neighbors.
    if (last && Math.abs(cx - last.cx) <= 8) {
      last.events.push(event)
      last.cx = average([last.cx, cx])
      continue
    }
    columns.push({ start, cx, events: [event] })
  }

  const columnCount = columns.length
  const targetColumns = beats * 3
  if (columnCount < targetColumns - 1 || columnCount > targetColumns) {
    return { events, recovered: false, reason: 'column-count', columnCount }
  }

  const positions = columns.map((column) => column.cx)
  const gaps = positions.slice(1).map((position, index) => position - positions[index])
  const meanGap = average(gaps)
  if (
    !Number.isFinite(meanGap) ||
    meanGap <= 0 ||
    gaps.some((gap) => Math.abs(gap - meanGap) / meanGap > 0.35)
  ) {
    return { events, recovered: false, reason: 'irregular-spacing' }
  }

  // Sounding slot on the internal divisions=4 grid; MusicXML scales to 12.
  const soundingSlot = totalDivisions / targetColumns
  const writtenDivisions = OMR_DURATION_DIVISIONS.eighth
  const timeModification = {
    actualNotes: 3,
    normalNotes: 2,
  }

  const recoveredNotes = []
  columns.forEach((column, index) => {
    // Stretch 11 columns across 12 slots when one notehead was missed.
    const slot =
      columnCount === targetColumns
        ? index
        : Math.round((index * (targetColumns - 1)) / Math.max(1, columnCount - 1))
    const groupId = `tuplet:${Math.floor(slot / 3)}:${beats}:${targetColumns}`
    const startDivision = slot * soundingSlot
    for (const event of column.events) {
      recoveredNotes.push({
        ...event,
        startDivision,
        durationDivisions: soundingSlot,
        durationType: 'eighth',
        dotted: false,
        timeModification: {
          ...timeModification,
          groupId,
          slotIndex: slot % 3,
        },
        tupletRecovered: true,
        notes: (event.notes ?? []).map((note) => ({
          ...note,
          durationDivisions: writtenDivisions,
          durationType: 'eighth',
        })),
      })
    }
  })

  return {
    events: [...recoveredNotes, ...rests].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    ),
    recovered: true,
    columnCount,
    digitCount: digits.length,
  }
}
