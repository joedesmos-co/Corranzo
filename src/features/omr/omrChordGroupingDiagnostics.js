/**
 * Per-measure chord/onset grouping diagnostics for vector OMR.
 */

function voiceForClef(clef) {
  return clef === 'bass' ? 2 : 1
}

export function summarizeMeasureSerialization(events = []) {
  const sorted = [...events].sort((left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0))
  let cursor = 0
  const sequence = []
  let forwardCount = 0
  let backupCount = 0

  for (const event of sorted) {
    if (event.type !== 'note' && event.type !== 'rest') {
      continue
    }
    const eventStart = Math.max(0, event.startDivision ?? 0)
    if (eventStart > cursor) {
      forwardCount += 1
      sequence.push({ type: 'forward', to: eventStart, amount: eventStart - cursor })
      cursor = eventStart
    } else if (eventStart < cursor) {
      backupCount += 1
      sequence.push({ type: 'backup', to: eventStart, amount: cursor - eventStart })
      cursor = eventStart
    }

    const duration = event.durationDivisions ?? 0
    if (event.type === 'rest') {
      const voice = voiceForClef(event.clef)
      sequence.push({ type: 'rest', startDivision: eventStart, durationDivisions: duration, voice })
      cursor += duration
      continue
    }

    const notes = event.notes ?? []
    notes.forEach((note, index) => {
      const voice = voiceForClef(note.clef ?? 'treble')
      sequence.push({
        type: index === 0 ? 'note' : 'chord',
        startDivision: eventStart,
        durationDivisions: duration,
        voice,
        midi: note.midi,
      })
    })
    cursor += duration
  }

  return { forwardCount, backupCount, sequence }
}

export function summarizeVectorChordGrouping(events = []) {
  const noteEvents = events.filter((event) => event.type === 'note')
  const byOnset = new Map()

  for (const event of noteEvents) {
    const start = event.startDivision ?? 0
    if (!byOnset.has(start)) {
      byOnset.set(start, [])
    }
    byOnset.get(start).push(event)
  }

  const onsets = [...byOnset.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([startDivision, onsetEvents]) => {
      const clefs = [
        ...new Set(
          onsetEvents.flatMap((event) => (event.notes ?? []).map((note) => note.clef ?? 'treble')),
        ),
      ]
      const voices = clefs.map((clef) => (clef === 'bass' ? 2 : 1))
      const noteCount = onsetEvents.reduce((sum, event) => sum + (event.notes?.length ?? 0), 0)
      const fragmentedSameClef = onsetEvents.some((event, index, entries) => {
        const clef = event.notes?.[0]?.clef ?? 'treble'
        return entries.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            (other.notes?.[0]?.clef ?? 'treble') === clef &&
            (other.notes?.length ?? 0) === 1 &&
            (event.notes?.length ?? 0) === 1,
        )
      })
      return {
        startDivision,
        eventCount: onsetEvents.length,
        noteCount,
        clefs,
        voices,
        fragmentedSameClef,
      }
    })

  let sequentialSameXCount = 0
  for (const event of noteEvents) {
    if ((event.notes?.length ?? 0) !== 1) {
      continue
    }
    const cx = event.notes[0]?.cx
    if (!Number.isFinite(cx)) {
      continue
    }
    const hasSequentialTwin = noteEvents.some(
      (other) =>
        other !== event &&
        other.startDivision !== event.startDivision &&
        (other.notes?.length ?? 0) === 1 &&
        Math.abs((other.notes[0]?.cx ?? 0) - cx) <= 12,
    )
    if (hasSequentialTwin) {
      sequentialSameXCount += 1
    }
  }

  return {
    onsetCount: onsets.length,
    noteEventCount: noteEvents.length,
    sequentialSameXCount,
    fragmentedOnsetCount: onsets.filter((entry) => entry.fragmentedSameClef).length,
    onsets,
    ...summarizeMeasureSerialization(events),
  }
}

export function summarizePageChordGrouping(measureRecords = []) {
  const perMeasure = measureRecords.map((record) => ({
    measureNumber: record.measureNumber,
    page: record.page,
    ...(record.vectorChordDiagnostics ?? summarizeVectorChordGrouping(record.events ?? [])),
  }))
  const totals = perMeasure.reduce(
    (acc, entry) => ({
      sequentialSameXCount: acc.sequentialSameXCount + (entry.sequentialSameXCount ?? 0),
      fragmentedOnsetCount: acc.fragmentedOnsetCount + (entry.fragmentedOnsetCount ?? 0),
    }),
    { sequentialSameXCount: 0, fragmentedOnsetCount: 0 },
  )
  return { totals, perMeasure }
}
