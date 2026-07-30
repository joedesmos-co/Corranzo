/**
 * Diagnostic-only tracer for dense column-locked gap packing.
 * Does NOT wire into production OMR. Mirrors critical onset/grouping decisions
 * so we can see where a visual chord column loses shared timing.
 */
import {
  OMR_CHORD_MERGE_X,
  OMR_DIVISIONS_PER_QUARTER,
} from '../../src/features/omr/omrRhythmConstants.js'
import {
  buildVectorEvents,
  coalesceSameOnsetChordEvents,
  resnapDenseChordOnsets,
  shouldInferRhythmFromPositions,
} from '../../src/features/omr/processVectorOmrPage.js'

function average(values) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return 0
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function candidateId(note, index = 0) {
  if (note?.candidateId) return String(note.candidateId)
  const cx = Number.isFinite(note?.cx) ? Math.round(note.cx) : 0
  const cy = Number.isFinite(note?.cy) ? Math.round(note.cy) : 0
  return `nh-${note?.clef ?? 'treble'}-${cx}-${cy}-${note?.midi ?? '?'}-${index}`
}

function vectorChordMergeXPx(notes, beats) {
  if (!notes?.length) return OMR_CHORD_MERGE_X
  const cxValues = notes.map((note) => note.cx).filter(Number.isFinite)
  if (!cxValues.length) return OMR_CHORD_MERGE_X
  const span = Math.max(...cxValues) - Math.min(...cxValues)
  if (span <= 0) return OMR_CHORD_MERGE_X
  const slotsPerMeasure = Math.max(4, beats * 4)
  const slotWidthPx = span / slotsPerMeasure
  return Math.max(OMR_CHORD_MERGE_X, Math.min(28, slotWidthPx * 2.2))
}

function beatSlotForPosition(positionInMeasure, slotsPerMeasure) {
  if (!Number.isFinite(positionInMeasure)) return null
  return Math.min(
    slotsPerMeasure - 1,
    Math.max(0, Math.floor(positionInMeasure * slotsPerMeasure)),
  )
}

function groupsShareBeatSlot(left, right, slotsPerMeasure, chordMergeX) {
  const leftNotes = left.notes ?? (Number.isFinite(left.cx) ? [{ cx: left.cx }] : [])
  const rightNotes = right.notes ?? (Number.isFinite(right.cx) ? [{ cx: right.cx }] : [])
  if (slotsPerMeasure) {
    const leftPosition = leftNotes[0]?.positionInMeasure ?? left.positionInMeasure
    const rightPosition = rightNotes[0]?.positionInMeasure ?? right.positionInMeasure
    if (Number.isFinite(leftPosition) && Number.isFinite(rightPosition)) {
      if (
        beatSlotForPosition(leftPosition, slotsPerMeasure) !==
        beatSlotForPosition(rightPosition, slotsPerMeasure)
      ) {
        return false
      }
    }
  }
  for (const leftNote of leftNotes) {
    for (const rightNote of rightNotes) {
      if (Math.abs(leftNote.cx - rightNote.cx) <= chordMergeX) return true
    }
  }
  return false
}

function groupVectorNoteheadsDiagnostic(notes, { beats = 4 } = {}) {
  const slotsPerMeasure = Math.max(4, beats * 4)
  const chordMergeX = vectorChordMergeXPx(notes, beats)
  const groups = []
  for (const note of notes) {
    let group = groups.find((entry) =>
      groupsShareBeatSlot(entry, { cx: note.cx, notes: [note] }, slotsPerMeasure, chordMergeX),
    )
    if (!group) {
      group = { cx: note.cx, notes: [] }
      groups.push(group)
    }
    group.notes.push(note)
    group.cx = average(group.notes.map((entry) => entry.cx))
  }
  return {
    chordMergeX,
    slotsPerMeasure,
    groups: groups
      .map((group, index) => ({
        groupIndex: index,
        cx: group.cx,
        xSpan:
          Math.max(...group.notes.map((n) => n.cx)) - Math.min(...group.notes.map((n) => n.cx)),
        notes: group.notes,
      }))
      .sort((left, right) => left.cx - right.cx),
  }
}

function snapStartDivision(rawStart, totalDivisions) {
  const grid = Math.max(1, OMR_DIVISIONS_PER_QUARTER / 2)
  const clamped = Math.max(0, Math.min(totalDivisions - 1, rawStart))
  return Math.min(totalDivisions - 1, Math.round(clamped / grid) * grid)
}

function startDivisionFromPosition(positionInMeasure, totalDivisions, denseMeasure, notes = []) {
  if (!Number.isFinite(positionInMeasure)) return 0
  const raw = Math.round(positionInMeasure * totalDivisions)
  const hasSecondaryBeam = (notes ?? []).some((note) => (note.beams ?? 0) >= 2)
  if (!denseMeasure && !hasSecondaryBeam) {
    return snapStartDivision(raw, totalDivisions)
  }
  const grid = Math.max(1, OMR_DIVISIONS_PER_QUARTER / 4)
  const clamped = Math.max(0, Math.min(totalDivisions - 1, raw))
  return Math.max(0, Math.min(totalDivisions - 1, Math.round(clamped / grid) * grid))
}

function groupAnchorPosition(group) {
  const positions = (group.notes ?? [])
    .map((note) => note.positionInMeasure)
    .filter(Number.isFinite)
  if (positions.length) return average(positions)
  return group.positionInMeasure ?? null
}

/**
 * Trace a synthetic measure through mirrored pre-event stages + production
 * buildVectorEvents / coalesce / resnap.
 */
export function traceColumnGapPacking({
  id,
  notes,
  beats = 4,
  beatType = 4,
  measureBox = { measureNumber: 1, page: 1 },
} = {}) {
  const stamped = notes.map((note, index) => ({
    ...note,
    candidateId: candidateId(note, index),
    stemGroup: note.stemGroup ?? note.stemGroupId ?? null,
    beamGroup: note.beamGroup ?? null,
    staff: note.staff ?? (note.clef === 'bass' ? 2 : 1),
    voice: note.voice ?? null,
  }))

  const totalDivisions = Math.round(beats * OMR_DIVISIONS_PER_QUARTER * (4 / beatType))
  const grouped = groupVectorNoteheadsDiagnostic(stamped, { beats })
  const denseMeasureByGroupCount = grouped.groups.length > beats
  const usePositionStarts = shouldInferRhythmFromPositions(
    grouped.groups.map((group) => ({
      notes: group.notes,
      cx: group.cx,
      positionInMeasure: groupAnchorPosition(group),
    })),
    beats,
  )
  const denseRhythmRule = denseMeasureByGroupCount
    ? `groups.length (${grouped.groups.length}) > beats (${beats})`
    : usePositionStarts
      ? 'shouldInferRhythmFromPositions=true (min gap < 0.55×quarter or groups>beats)'
      : 'sparse / sequential quarter path'

  // Assign diagnostic column IDs from geometric groups (visual columns).
  const columns = grouped.groups.map((group, index) => {
    const columnId = `diag-col-${index}`
    for (const note of group.notes) {
      note.diagColumnId = columnId
    }
    return {
      columnId,
      noteIds: group.notes.map((note) => note.candidateId),
      midis: group.notes.map((note) => note.midi),
      xSpan: group.xSpan,
      cx: group.cx,
      staff: [...new Set(group.notes.map((note) => note.staff))],
      stemDirections: [
        ...new Set(group.notes.map((note) => note.stemDirection ?? note.stem ?? null)),
      ],
    }
  })

  // Per-note independent onset (what happens if each tone were its own group).
  const perNoteIndependentOnset = stamped.map((note) => ({
    candidateId: note.candidateId,
    diagColumnId: note.diagColumnId,
    positionInMeasure: note.positionInMeasure,
    onsetSparse: startDivisionFromPosition(note.positionInMeasure, totalDivisions, false, [note]),
    onsetDense: startDivisionFromPosition(note.positionInMeasure, totalDivisions, true, [note]),
  }))

  // Group-level onset after position snap (mirrored).
  const groupOnsets = grouped.groups.map((group) => {
    const positionInMeasure = groupAnchorPosition(group)
    const prePackOnset = startDivisionFromPosition(
      positionInMeasure,
      totalDivisions,
      denseMeasureByGroupCount,
      group.notes,
    )
    return {
      columnId: group.notes[0]?.diagColumnId,
      positionInMeasure,
      prePackOnset,
      noteIds: group.notes.map((note) => note.candidateId),
    }
  })

  // Production end-to-end (no ownership wiring — baseline buildVectorEvents).
  const produced = buildVectorEvents(stamped, measureBox, { beats, beatType })
  const noteEvents = produced.filter((event) => event.type === 'note')

  const postPack = noteEvents.map((event, eventIndex) => ({
    eventId: `evt-${eventIndex}`,
    startDivision: event.startDivision,
    durationDivisions: event.durationDivisions,
    noteIds: (event.notes ?? []).map((note) => note.candidateId ?? candidateId(note)),
    midis: (event.notes ?? []).map((note) => note.midi),
    columns: [
      ...new Set((event.notes ?? []).map((note) => note.diagColumnId).filter(Boolean)),
    ],
    cx: average((event.notes ?? []).map((note) => note.cx)),
    xSpan:
      (event.notes?.length ?? 0) > 1
        ? Math.max(...event.notes.map((n) => n.cx)) - Math.min(...event.notes.map((n) => n.cx))
        : 0,
  }))

  const coalesced = coalesceSameOnsetChordEvents(noteEvents)
  const postCoalesce = coalesced
    .filter((event) => event.type === 'note')
    .map((event, eventIndex) => ({
      eventId: `coal-${eventIndex}`,
      startDivision: event.startDivision,
      durationDivisions: event.durationDivisions,
      noteIds: (event.notes ?? []).map((note) => note.candidateId ?? candidateId(note)),
      midis: (event.notes ?? []).map((note) => note.midi),
      columns: [
        ...new Set((event.notes ?? []).map((note) => note.diagColumnId).filter(Boolean)),
      ],
    }))

  const resnapped = resnapDenseChordOnsets(coalesced, totalDivisions)
  const postResnap = resnapped
    .filter((event) => event.type === 'note')
    .map((event, eventIndex) => ({
      eventId: `resnap-${eventIndex}`,
      startDivision: event.startDivision,
      durationDivisions: event.durationDivisions,
      denseChordOnsetResnapped: Boolean(event.denseChordOnsetResnapped),
      noteIds: (event.notes ?? []).map((note) => note.candidateId ?? candidateId(note)),
      midis: (event.notes ?? []).map((note) => note.midi),
      columns: [
        ...new Set((event.notes ?? []).map((note) => note.diagColumnId).filter(Boolean)),
      ],
    }))

  // Detect column splits across events.
  const columnToEvents = new Map()
  for (const event of postPack) {
    for (const columnId of event.columns) {
      if (!columnToEvents.has(columnId)) columnToEvents.set(columnId, [])
      columnToEvents.get(columnId).push(event.eventId)
    }
  }
  // Also: notes that shared a diagnostic column but ended in different events
  const noteToEvent = new Map()
  for (const event of postPack) {
    for (const noteId of event.noteIds) {
      noteToEvent.set(noteId, { eventId: event.eventId, startDivision: event.startDivision })
    }
  }
  const splitColumns = []
  for (const column of columns) {
    const eventIds = [
      ...new Set(
        column.noteIds
          .map((noteId) => noteToEvent.get(noteId)?.eventId)
          .filter(Boolean),
      ),
    ]
    const onsets = [
      ...new Set(
        column.noteIds
          .map((noteId) => noteToEvent.get(noteId)?.startDivision)
          .filter((value) => value != null),
      ),
    ]
    if (eventIds.length > 1 || onsets.length > 1) {
      splitColumns.push({
        columnId: column.columnId,
        eventIds,
        onsets,
        noteIds: column.noteIds,
      })
    }
  }

  // Independent-onset divergence inside a geometric column
  const independentSplit = columns
    .map((column) => {
      const rows = perNoteIndependentOnset.filter((row) => row.diagColumnId === column.columnId)
      const sparse = [...new Set(rows.map((row) => row.onsetSparse))]
      const dense = [...new Set(rows.map((row) => row.onsetDense))]
      return {
        columnId: column.columnId,
        sparseOnsetsDiverge: sparse.length > 1,
        denseOnsetsDiverge: dense.length > 1,
        sparse,
        dense,
        rows,
      }
    })
    .filter((entry) => entry.sparseOnsetsDiverge || entry.denseOnsetsDiverge)

  // Visual column split: near-x same-clef tones that never shared a diag column
  // because beat-slot gating refused the geometric merge, then landed on
  // different onsets so coalesce cannot reunite them.
  const visualSplits = []
  for (let i = 0; i < stamped.length; i += 1) {
    for (let j = i + 1; j < stamped.length; j += 1) {
      const left = stamped[i]
      const right = stamped[j]
      if ((left.clef ?? 'treble') !== (right.clef ?? 'treble')) continue
      if (Math.abs((left.cx ?? 0) - (right.cx ?? 0)) > OMR_CHORD_MERGE_X) continue
      const leftEvent = noteToEvent.get(left.candidateId)
      const rightEvent = noteToEvent.get(right.candidateId)
      if (!leftEvent || !rightEvent) continue
      if (leftEvent.eventId === rightEvent.eventId) continue
      if (leftEvent.startDivision === rightEvent.startDivision) continue
      visualSplits.push({
        noteIds: [left.candidateId, right.candidateId],
        midis: [left.midi, right.midi],
        dx: Math.abs((left.cx ?? 0) - (right.cx ?? 0)),
        positions: [left.positionInMeasure, right.positionInMeasure],
        onsets: [leftEvent.startDivision, rightEvent.startDivision],
        eventIds: [leftEvent.eventId, rightEvent.eventId],
      })
    }
  }

  const failingTransition =
    visualSplits.length > 0
      ? denseMeasureByGroupCount
        ? 'groupsShareBeatSlot beat-slot gate → separate groups → dense sixteenth onset snap → coalesce requires identical startDivision'
        : 'groupsShareBeatSlot beat-slot gate → separate groups → divergent onset snap → coalesce requires identical startDivision'
      : splitColumns.length > 0
        ? independentSplit.some((entry) => entry.denseOnsetsDiverge) && denseMeasureByGroupCount
          ? 'position→onset snap under denseMeasure (sixteenth grid) after groups.length > beats'
          : 'post-group event construction / coalesce (same-onset + |Δcx|≤10 required) or clef split'
        : null

  return {
    id,
    beats,
    totalDivisions,
    chordMergeX: grouped.chordMergeX,
    fixedCoalesceWindow: OMR_CHORD_MERGE_X,
    denseMeasureByGroupCount,
    usePositionStarts,
    denseRhythmEntered: denseMeasureByGroupCount || usePositionStarts,
    denseRhythmRule,
    groupCount: grouped.groups.length,
    columns,
    groupOnsets,
    perNoteIndependentOnset,
    independentSplit,
    visualSplits,
    stages: {
      postPack,
      postCoalesce,
      postResnap,
    },
    splitColumns,
    failingTransition,
    producedEventCount: noteEvents.length,
  }
}

export const GEOMETRY_FIXTURES = [
  {
    id: 'chord-column-split-during-onset-snap',
    description:
      'Visually stacked chord (Δcx≤5) straddling adjacent sixteenth beat-slots; dense group-count snap assigns different onsets; coalesce cannot reunite',
    beats: 4,
    notes: [
      { cx: 100, cy: 120, midi: 60, clef: 'treble', positionInMeasure: 0.22, candidateId: 'c-low' },
      { cx: 103, cy: 100, midi: 64, clef: 'treble', positionInMeasure: 0.31, candidateId: 'c-mid' },
      { cx: 105, cy: 80, midi: 67, clef: 'treble', positionInMeasure: 0.32, candidateId: 'c-high' },
      { cx: 170, cy: 100, midi: 62, clef: 'treble', positionInMeasure: 0.45, candidateId: 'n2' },
      { cx: 230, cy: 100, midi: 64, clef: 'treble', positionInMeasure: 0.6, candidateId: 'n3' },
      { cx: 290, cy: 100, midi: 65, clef: 'treble', positionInMeasure: 0.75, candidateId: 'n4' },
      { cx: 350, cy: 100, midi: 67, clef: 'treble', positionInMeasure: 0.9, candidateId: 'n5' },
    ],
  },
  {
    id: 'mixed-voice-stack-must-remain-separate',
    description: 'Opposing-stem voices near same x must not merge into one chord event',
    beats: 4,
    notes: [
      {
        cx: 120,
        cy: 90,
        midi: 72,
        clef: 'treble',
        stemDirection: 'up',
        positionInMeasure: 0.25,
        candidateId: 'voice-up',
        voice: 1,
      },
      {
        cx: 122,
        cy: 140,
        midi: 55,
        clef: 'treble',
        stemDirection: 'down',
        positionInMeasure: 0.25,
        candidateId: 'voice-down',
        voice: 2,
      },
      { cx: 200, cy: 100, midi: 67, clef: 'treble', positionInMeasure: 0.5, candidateId: 'later' },
    ],
  },
  {
    id: 'adjacent-dense-chords-no-broad-dense-mode',
    description:
      'Four adjacent two-note chords; document whether group count alone triggers dense-rhythm mode',
    beats: 4,
    notes: [
      { cx: 80, cy: 110, midi: 60, positionInMeasure: 0.1, candidateId: 'a1' },
      { cx: 81, cy: 90, midi: 64, positionInMeasure: 0.1, candidateId: 'a2' },
      { cx: 140, cy: 110, midi: 62, positionInMeasure: 0.3, candidateId: 'b1' },
      { cx: 141, cy: 90, midi: 65, positionInMeasure: 0.3, candidateId: 'b2' },
      { cx: 200, cy: 110, midi: 64, positionInMeasure: 0.5, candidateId: 'c1' },
      { cx: 201, cy: 90, midi: 67, positionInMeasure: 0.5, candidateId: 'c2' },
      { cx: 260, cy: 110, midi: 65, positionInMeasure: 0.7, candidateId: 'd1' },
      { cx: 261, cy: 90, midi: 69, positionInMeasure: 0.7, candidateId: 'd2' },
    ],
  },
  {
    id: 'whole-chord-resnap-as-unit',
    description: 'Multi-note chord events on odd sixteenths; resnap should move whole chords',
    beats: 4,
    notes: Array.from({ length: 8 }, (_, index) => {
      const col = Math.floor(index / 2)
      const tone = index % 2
      return {
        cx: 100 + col * 40 + tone,
        cy: 110 - tone * 20,
        midi: 60 + col + tone * 4,
        clef: 'treble',
        positionInMeasure: 0.05 + col * 0.12 + tone * 0.001,
        candidateId: `r${col}-${tone}`,
      }
    }).concat([
      { cx: 100, cy: 200, midi: 40, clef: 'bass', positionInMeasure: 0.05, candidateId: 'bass0' },
      { cx: 140, cy: 200, midi: 42, clef: 'bass', positionInMeasure: 0.17, candidateId: 'bass1' },
      { cx: 180, cy: 200, midi: 43, clef: 'bass', positionInMeasure: 0.29, candidateId: 'bass2' },
      { cx: 220, cy: 200, midi: 45, clef: 'bass', positionInMeasure: 0.41, candidateId: 'bass3' },
    ]),
  },
]
