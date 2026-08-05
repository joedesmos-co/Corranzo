/**
 * Digit-gated 3:2 tuplet recovery for vector OMR.
 *
 * Two modes:
 * 1. Full-bar uniform grid (frozen piano-rhythm-tuplets fixture)
 * 2. Local groups: one printed "3" owns one contiguous 3:2 group in one staff
 *
 * Does not invent tuplets from measure balancing alone — requires digit evidence.
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

function eventClef(event) {
  return event?.clef ?? event?.notes?.[0]?.clef ?? 'treble'
}

function eventNoteYs(event) {
  return (event?.notes ?? [])
    .map((note) => note.cy ?? note.y)
    .filter(Number.isFinite)
}

function eventCx(event) {
  if (Number.isFinite(event?.cx)) {
    return event.cx
  }
  return average((event?.notes ?? []).map((note) => note.cx ?? note.x))
}

function isLeftMarginDigit(glyph, imageData) {
  const x = glyph.x ?? glyph.cx
  const width = imageData?.width ?? 1000
  if (!Number.isFinite(x)) {
    return true
  }
  // Measure numbers and page furniture sit near the left margin.
  return x / width < 0.08
}

/**
 * Collect tuplet-number "3" glyphs near the note group (above or below heads).
 * Prefer note geometry over the measure box so mis-cut barlines still work.
 * Measure-number "3" glyphs sit higher above the system and are excluded.
 * Left-margin digits are rejected.
 */
export function collectTupletDigitThrees(glyphs, measureBox, imageData, noteEvents = []) {
  const noteXs = noteEvents
    .flatMap((event) =>
      (event.notes ?? []).map((note) => note.cx ?? note.x).filter(Number.isFinite),
    )
    .concat(noteEvents.map((event) => event.cx).filter(Number.isFinite))
  const noteYs = noteEvents.flatMap((event) => eventNoteYs(event)).filter(Number.isFinite)

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

  // Allow digits above OR below the note cluster (Mario places brackets below).
  const bandTop = meanNoteY - 100
  const bandBottom = meanNoteY + 100

  return (glyphs ?? []).filter((glyph) => {
    if (String(glyph.text ?? '') !== '3') {
      return false
    }
    if (isLeftMarginDigit(glyph, imageData)) {
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
    return y >= bandTop && y <= bandBottom
  })
}

/**
 * Collect candidate "3" glyphs for local groups without requiring the full
 * measure note cluster first (digits are matched to nearby staff events later).
 */
export function collectLocalTupletDigitThrees(glyphs, measureBox, imageData) {
  const bounds = measureBoundsPx(measureBox, imageData)
  return (glyphs ?? []).filter((glyph) => {
    if (String(glyph.text ?? '') !== '3') {
      return false
    }
    if (isLeftMarginDigit(glyph, imageData)) {
      return false
    }
    const x = glyph.x ?? glyph.cx
    const y = glyph.y ?? glyph.cy
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false
    }
    if (x < bounds.x0 - 20 || x > bounds.x1 + 20) {
      return false
    }
    if (y < bounds.y0 - 40 || y > bounds.y1 + 40) {
      return false
    }
    return true
  })
}

function buildOnsetColumns(noteEvents, mergePx = 8) {
  const sorted = [...noteEvents].sort(
    (left, right) =>
      (eventCx(left) ?? 0) - (eventCx(right) ?? 0) ||
      (left.startDivision ?? 0) - (right.startDivision ?? 0),
  )
  const columns = []
  for (const event of sorted) {
    const cx = eventCx(event) ?? 0
    const last = columns[columns.length - 1]
    if (last && Math.abs(cx - last.cx) <= mergePx) {
      last.events.push(event)
      last.cx = average([last.cx, cx])
      continue
    }
    columns.push({
      cx,
      startDivision: event.startDivision ?? 0,
      events: [event],
      clef: eventClef(event),
    })
  }
  return columns
}

function writtenEighthUnits(event) {
  const type = event.durationType
  const dotted = Boolean(event.dotted)
  let units
  if (type === 'quarter') {
    units = 2
  } else if (type === 'eighth') {
    units = 1
  } else if (type === 'sixteenth') {
    units = 0.5
  } else if (type === 'half') {
    units = 4
  } else {
    const div = event.durationDivisions ?? OMR_DURATION_DIVISIONS.eighth
    units = div / OMR_DURATION_DIVISIONS.eighth
  }
  if (dotted) {
    units *= 1.5
  }
  return units
}

function stampGroup(events, { groupId, startDivision, soundingDurations, writtenTypes }) {
  return events.map((event, index) => {
    const sounding = soundingDurations[index]
    const writtenType = writtenTypes[index] ?? event.durationType ?? 'eighth'
    const writtenDivisions =
      OMR_DURATION_DIVISIONS[writtenType] ?? OMR_DURATION_DIVISIONS.eighth
    return {
      ...event,
      startDivision: startDivision + soundingDurations.slice(0, index).reduce((s, v) => s + v, 0),
      durationDivisions: sounding,
      durationType: writtenType,
      dotted: false,
      timeModification: {
        actualNotes: 3,
        normalNotes: 2,
        groupId,
        slotIndex: index,
        tupletStart: index === 0,
        tupletStop: index === events.length - 1,
      },
      tupletRecovered: true,
      notes: (event.notes ?? []).map((note) => ({
        ...note,
        durationDivisions: writtenDivisions,
        durationType: writtenType,
      })),
    }
  })
}

/**
 * Local 3:2 recovery: each printed "3" may own one contiguous group.
 * Supports three equal eighths, or quarter+eighth (written 3 eighth-units).
 */
export function recoverLocalDigitGatedTripletGroups(
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
  const otherEvents = (events ?? []).filter((event) => event.type !== 'note')
  if (noteEvents.length < 2) {
    return { events, recovered: false, reason: 'too-few-notes', groups: 0 }
  }

  const digits = collectLocalTupletDigitThrees(glyphs, measureBox, imageData)
  if (!digits.length) {
    return { events, recovered: false, reason: 'no-local-digits', groups: 0 }
  }

  const quarterSpan = totalDivisions / Math.max(1, beats)
  const claimed = new Set()
  const replacements = new Map()
  let groupSerial = 0

  const digitsSorted = [...digits].sort((a, b) => (a.x ?? 0) - (b.x ?? 0))

  for (const digit of digitsSorted) {
    const digitX = digit.x ?? digit.cx
    const digitY = digit.y ?? digit.cy

    // Prefer events whose noteheads are near this digit in X and whose staff
    // Y is compatible (digit above or below that staff's notes).
    const scored = noteEvents
      .map((event, index) => {
        if (claimed.has(index)) {
          return null
        }
        const cx = eventCx(event)
        const ys = eventNoteYs(event)
        if (!Number.isFinite(cx) || !ys.length) {
          return null
        }
        const meanY = average(ys)
        const dx = Math.abs(cx - digitX)
        const dy = Math.abs(meanY - digitY)
        if (dx > 90 || dy > 110) {
          return null
        }
        // Fingering digits sit beside heads (near-zero dy). Tuplet numbers sit
        // clearly above or below the note cluster.
        if (dy < 16) {
          return null
        }
        return { event, index, cx, meanY, dx, dy, clef: eventClef(event) }
      })
      .filter(Boolean)
      .sort((a, b) => a.dx - b.dx || a.dy - b.dy)

    if (!scored.length) {
      continue
    }

    // Anchor staff = nearest event's clef.
    const clef = scored[0].clef
    const staffCandidates = scored.filter((row) => row.clef === clef)
    const staffEvents = staffCandidates.map((row) => row.event)
    const columns = buildOnsetColumns(staffEvents, 10)
    if (columns.length < 2) {
      continue
    }

    // Find the column closest to the digit; grow a local window.
    let anchor = 0
    let bestDx = Infinity
    columns.forEach((column, index) => {
      const dx = Math.abs(column.cx - digitX)
      if (dx < bestDx) {
        bestDx = dx
        anchor = index
      }
    })

    let chosen = null

    // Pattern A: three consecutive eighth-like columns.
    for (const start of [anchor - 1, anchor - 2, anchor, Math.max(0, anchor - 1)]) {
      if (start < 0 || start + 2 >= columns.length) {
        continue
      }
      const window = columns.slice(start, start + 3)
      const units = window.map((column) =>
        average(column.events.map((event) => writtenEighthUnits(event))),
      )
      // Accept eighths or short notes mis-packed as sixteenths under a digit.
      const allShort = units.every((unit) => unit >= 0.4 && unit <= 1.35)
      const gaps = [window[1].cx - window[0].cx, window[2].cx - window[1].cx]
      const meanGap = average(gaps)
      const spacingOk =
        Number.isFinite(meanGap) &&
        meanGap > 0 &&
        gaps.every((gap) => Math.abs(gap - meanGap) / meanGap <= 0.45)
      // Digit should sit roughly over the middle of the three columns.
      const midX = (window[0].cx + window[2].cx) / 2
      const digitCentered = Math.abs(digitX - midX) <= Math.max(36, meanGap * 1.1)
      if (allShort && spacingOk && digitCentered) {
        chosen = {
          columns: window,
          kind: 'three-eighths',
        }
        break
      }
    }

    // Pattern B: quarter + eighth (written 3 eighth-units) near digit.
    if (!chosen) {
      for (const start of [anchor - 1, anchor, Math.max(0, anchor - 1)]) {
        if (start < 0 || start + 1 >= columns.length) {
          continue
        }
        const left = columns[start]
        const right = columns[start + 1]
        const leftUnits = average(left.events.map((event) => writtenEighthUnits(event)))
        const rightUnits = average(right.events.map((event) => writtenEighthUnits(event)))
        const isQuarterEighth =
          leftUnits >= 1.6 && leftUnits <= 2.5 && rightUnits >= 0.75 && rightUnits <= 1.35
        const isEighthQuarter =
          leftUnits >= 0.75 && leftUnits <= 1.35 && rightUnits >= 1.6 && rightUnits <= 2.5
        if (!isQuarterEighth && !isEighthQuarter) {
          continue
        }
        const midX = (left.cx + right.cx) / 2
        if (Math.abs(digitX - midX) > 70) {
          continue
        }
        chosen = {
          columns: [left, right],
          kind: isQuarterEighth ? 'quarter-eighth' : 'eighth-quarter',
        }
        break
      }
    }

    if (!chosen) {
      continue
    }

    const groupEvents = chosen.columns.map((column) => {
      // Prefer the staff-matching event closest to the digit vertically.
      const ranked = [...column.events].sort((a, b) => {
        const ay = average(eventNoteYs(a)) ?? 0
        const by = average(eventNoteYs(b)) ?? 0
        return Math.abs(ay - digitY) - Math.abs(by - digitY)
      })
      return ranked[0]
    })

    // Avoid double-claiming events.
    const indexes = groupEvents.map((event) => noteEvents.indexOf(event))
    if (indexes.some((index) => index < 0 || claimed.has(index))) {
      continue
    }

    const groupStart = Math.min(...groupEvents.map((event) => event.startDivision ?? 0))
    // Snap group start to the beat containing the first event.
    const beatIndex = Math.max(0, Math.floor(groupStart / quarterSpan + 1e-6))
    const beatStart = beatIndex * quarterSpan
    const groupId = `local-tuplet:${groupSerial}:${Math.round(digitX)}:${clef}`
    groupSerial += 1

    let stamped
    if (chosen.kind === 'three-eighths') {
      const slot = quarterSpan / 3
      stamped = stampGroup(groupEvents, {
        groupId,
        startDivision: beatStart,
        soundingDurations: [slot, slot, slot],
        writtenTypes: ['eighth', 'eighth', 'eighth'],
      })
    } else if (chosen.kind === 'quarter-eighth') {
      stamped = stampGroup(groupEvents, {
        groupId,
        startDivision: beatStart,
        soundingDurations: [(quarterSpan * 2) / 3, quarterSpan / 3],
        writtenTypes: ['quarter', 'eighth'],
      })
    } else {
      stamped = stampGroup(groupEvents, {
        groupId,
        startDivision: beatStart,
        soundingDurations: [quarterSpan / 3, (quarterSpan * 2) / 3],
        writtenTypes: ['eighth', 'quarter'],
      })
    }

    indexes.forEach((index, slot) => {
      claimed.add(index)
      replacements.set(index, stamped[slot])
    })
  }

  if (!replacements.size) {
    return { events, recovered: false, reason: 'no-local-groups', groups: 0 }
  }

  const nextNotes = noteEvents.map((event, index) =>
    replacements.has(index) ? replacements.get(index) : event,
  )

  return {
    events: [...nextNotes, ...otherEvents].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    ),
    recovered: true,
    groups: groupSerial,
    digitCount: digits.length,
  }
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
          tupletStart: slot % 3 === 0,
          tupletStop: slot % 3 === 2,
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

function eventsLookFretted(noteEvents) {
  return (noteEvents ?? []).some((event) =>
    (event.notes ?? []).some(
      (note) =>
        Number.isFinite(note.string) ||
        Number.isFinite(note.fret) ||
        Number.isFinite(note?.technical?.string) ||
        Number.isFinite(note?.technical?.fret),
    ),
  )
}

/**
 * Prefer full-bar recovery when it applies; otherwise attempt local groups.
 * Local groups are intended for piano/grand-staff engavings with printed
 * tuplet numbers. Fretted/TAB measures abstain from local recovery to avoid
 * fingering-digit false positives.
 */
export function recoverVectorTupletEvents(events, options = {}) {
  const noteEvents = (events ?? []).filter((event) => event.type === 'note')
  const fullBar = recoverDigitGatedTripletEvents(events, options)
  if (fullBar.recovered) {
    return { ...fullBar, mode: 'full-bar' }
  }
  const localEnabled =
    options.enableLocalGroups !== false && !eventsLookFretted(noteEvents)
  if (!localEnabled) {
    return {
      events,
      recovered: false,
      reason: `full-bar:${fullBar.reason};local:disabled`,
      mode: null,
    }
  }
  const local = recoverLocalDigitGatedTripletGroups(events, options)
  if (local.recovered) {
    return { ...local, mode: 'local' }
  }
  return {
    events,
    recovered: false,
    reason: `full-bar:${fullBar.reason};local:${local.reason}`,
    mode: null,
  }
}
