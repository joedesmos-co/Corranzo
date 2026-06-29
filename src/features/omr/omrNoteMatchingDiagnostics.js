/**
 * Summarize per-measure note detection vs emission for OMR benchmarks.
 */

export function countEmittedNoteheads(events = []) {
  return events
    .filter((event) => event.type === 'note')
    .reduce((sum, event) => sum + (event.notes?.length ?? 0), 0)
}

export function summarizeMeasureNoteMatching(measureRecord) {
  const detected = measureRecord?.vectorNoteCount ?? 0
  const emitted = countEmittedNoteheads(measureRecord?.events ?? [])
  return {
    measureNumber: measureRecord?.measureNumber ?? null,
    page: measureRecord?.page ?? null,
    detectedNoteheads: detected,
    emittedNoteheads: emitted,
    dedupedDuringGrouping: Math.max(0, detected - emitted),
  }
}

export function summarizeNoteMatchingReport(measureRecords = [], truthNotesByMeasure = null) {
  const perMeasure = measureRecords.map(summarizeMeasureNoteMatching)
  const totals = perMeasure.reduce(
    (acc, entry) => ({
      detectedNoteheads: acc.detectedNoteheads + entry.detectedNoteheads,
      emittedNoteheads: acc.emittedNoteheads + entry.emittedNoteheads,
      dedupedDuringGrouping: acc.dedupedDuringGrouping + entry.dedupedDuringGrouping,
    }),
    { detectedNoteheads: 0, emittedNoteheads: 0, dedupedDuringGrouping: 0 },
  )

  const hotspots = [...perMeasure]
    .filter((entry) => entry.dedupedDuringGrouping > 0)
    .sort((left, right) => right.dedupedDuringGrouping - left.dedupedDuringGrouping)
    .slice(0, 20)

  const truthByMeasure = truthNotesByMeasure ?? new Map()
  const measureBalance = perMeasure.map((entry) => {
    const truthCount = truthByMeasure.get(entry.measureNumber) ?? null
    return {
      ...entry,
      truthNoteheads: truthCount,
      generatedDelta:
        truthCount == null ? null : entry.emittedNoteheads - truthCount,
    }
  })

  return {
    totals,
    hotspots,
    perMeasure: measureBalance,
  }
}

export function groupTruthNotesByMeasure(truthNotes = []) {
  const grouped = new Map()
  for (const note of truthNotes) {
    if (note.isRest || note.midi == null) {
      continue
    }
    const measureNumber = note.measureNumber
    grouped.set(measureNumber, (grouped.get(measureNumber) ?? 0) + 1)
  }
  return grouped
}
