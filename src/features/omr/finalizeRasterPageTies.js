/**
 * Raster enrich stamps detectTieToNext as orphan note.tieStart flags (never
 * tieStop). Those leak into MusicXML as incorrect-tie. Convert soft candidates
 * into real start/stop pairs only when the destination is the next same-pitch
 * note on the same staff/clef; drop everything else.
 */

const MAX_TIE_DX_PX = 160

function isLaterOnset(left, right) {
  return (
    right.measureNumber > left.measureNumber ||
    (right.measureNumber === left.measureNumber &&
      right.startDivision > left.startDivision)
  )
}

function flattenNoteInstances(measureRecords) {
  const instances = []
  for (const record of measureRecords) {
    for (let eventIndex = 0; eventIndex < (record.events ?? []).length; eventIndex += 1) {
      const event = record.events[eventIndex]
      if (event?.type !== 'note') {
        continue
      }
      for (let noteIndex = 0; noteIndex < (event.notes ?? []).length; noteIndex += 1) {
        const note = event.notes[noteIndex]
        instances.push({
          measureNumber: record.measureNumber,
          eventIndex,
          noteIndex,
          startDivision: event.startDivision ?? 0,
          midi: note.midi,
          clef: note.clef ?? 'treble',
          cx: note.cx ?? event.cx,
          cy: note.cy,
          articType: note.articulation?.type ?? null,
          note,
          event,
        })
      }
    }
  }
  return instances.sort(
    (left, right) =>
      left.measureNumber - right.measureNumber ||
      left.startDivision - right.startDivision ||
      left.cx - right.cx ||
      left.midi - right.midi,
  )
}

function clearAllTieMarks(measureRecords) {
  for (const record of measureRecords) {
    for (const event of record.events ?? []) {
      delete event.tieStart
      delete event.tieStop
      for (const note of event.notes ?? []) {
        delete note.tieStart
        delete note.tieStop
      }
    }
  }
}

function hasInterveningOnset(instances, fromIndex, toIndex) {
  const from = instances[fromIndex]
  const to = instances[toIndex]
  for (let index = fromIndex + 1; index < toIndex; index += 1) {
    const mid = instances[index]
    if (mid.clef !== from.clef) {
      continue
    }
    if (
      mid.measureNumber === to.measureNumber &&
      mid.startDivision === to.startDivision
    ) {
      continue
    }
    if (isLaterOnset(from, mid) && isLaterOnset(mid, to)) {
      return true
    }
  }
  return false
}

function findNextSamePitch(instances, fromIndex) {
  const from = instances[fromIndex]
  for (let index = fromIndex + 1; index < instances.length; index += 1) {
    const candidate = instances[index]
    if (candidate.clef !== from.clef) {
      continue
    }
    if (candidate.midi !== from.midi) {
      continue
    }
    if (!isLaterOnset(from, candidate)) {
      continue
    }
    if (hasInterveningOnset(instances, fromIndex, index)) {
      continue
    }
    return { instance: candidate, index }
  }
  return null
}

/**
 * Turn enrich-time orphan tieStart flags into validated per-pitch pairs.
 * Unpaired candidates (scan noise, staccato dots, slur-like marks) are dropped.
 */
export function finalizeRasterPageTies(measureRecords = []) {
  if (!measureRecords.length) {
    return {
      diagnostics: {
        enrichCandidateCount: 0,
        appliedTieCount: 0,
        droppedOrphanCount: 0,
        droppedStaccatoCount: 0,
      },
    }
  }

  const instances = flattenNoteInstances(measureRecords)
  const candidates = []
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index]
    if (!instance.note.tieStart) {
      continue
    }
    candidates.push(index)
  }

  clearAllTieMarks(measureRecords)

  let appliedTieCount = 0
  let droppedOrphanCount = 0
  let droppedStaccatoCount = 0
  const usedDestination = new Set()

  for (const fromIndex of candidates) {
    const from = instances[fromIndex]
    if (from.articType === 'staccato') {
      droppedStaccatoCount += 1
      continue
    }

    const next = findNextSamePitch(instances, fromIndex)
    if (!next) {
      droppedOrphanCount += 1
      continue
    }
    if (usedDestination.has(next.index) || next.instance.articType === 'staccato') {
      droppedOrphanCount += 1
      continue
    }

    const sameMeasure = next.instance.measureNumber === from.measureNumber
    const adjacentMeasure = next.instance.measureNumber === from.measureNumber + 1
    const dx = next.instance.cx - from.cx
    if (sameMeasure) {
      if (!(dx >= 8 && dx <= MAX_TIE_DX_PX)) {
        droppedOrphanCount += 1
        continue
      }
    } else if (adjacentMeasure) {
      const destAtStart = (next.instance.startDivision ?? 0) <= 4
      if (!((dx > 0 && dx <= MAX_TIE_DX_PX) || (dx <= 0 && destAtStart))) {
        droppedOrphanCount += 1
        continue
      }
    } else {
      droppedOrphanCount += 1
      continue
    }

    const fromChord = (from.event.notes?.length ?? 0) !== 1
    const toChord = (next.instance.event.notes?.length ?? 0) !== 1
    if (sameMeasure && (fromChord || toChord)) {
      droppedOrphanCount += 1
      continue
    }

    from.note.tieStart = true
    next.instance.note.tieStop = true
    if (!fromChord) {
      from.event.tieStart = true
    }
    if (!toChord) {
      next.instance.event.tieStop = true
    }
    usedDestination.add(next.index)
    appliedTieCount += 1
  }


  // Narrow orphan-start keep: highest-midi staccato enrich candidate late in a
  // non-final measure with no later same-pitch on that staff. Recovers the
  // artic-scan cross-bar written start (mispitched/mis-articulated head) without
  // reopening early-measure staccato FP floods.
  const maxMeasure = instances.reduce(
    (max, inst) => Math.max(max, inst.measureNumber),
    0,
  )
  const orphanKeep = new Map()
  for (const fromIndex of candidates) {
    const from = instances[fromIndex]
    if (from.note.tieStart || from.note.tieStop) {
      continue
    }
    if (from.articType !== 'staccato') {
      continue
    }
    if (from.measureNumber >= maxMeasure) {
      continue
    }
    if ((from.startDivision ?? 0) < 4) {
      continue
    }
    const notes = from.event.notes ?? []
    const topMidi = Math.max(...notes.map((note) => note.midi ?? -Infinity))
    if (from.midi !== topMidi) {
      continue
    }
    const laterSame = instances.some(
      (inst, idx) =>
        idx > fromIndex &&
        inst.measureNumber === from.measureNumber &&
        inst.clef === from.clef &&
        inst.midi === from.midi &&
        isLaterOnset(from, inst),
    )
    if (laterSame) {
      continue
    }
    const prev = orphanKeep.get(from.measureNumber)
    if (!prev || from.midi > prev.midi) {
      orphanKeep.set(from.measureNumber, { fromIndex, midi: from.midi })
    }
  }
  let orphanStartKeepCount = 0
  for (const { fromIndex } of orphanKeep.values()) {
    const from = instances[fromIndex]
    from.note.tieStart = true
    orphanStartKeepCount += 1
  }

  return {
    diagnostics: {
      enrichCandidateCount: candidates.length,
      appliedTieCount,
      droppedOrphanCount,
      droppedStaccatoCount,
      orphanStartKeepCount,
    },
  }
}
