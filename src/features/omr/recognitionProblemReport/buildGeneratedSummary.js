/**
 * Compact structural summary of generated MusicXML / timing map.
 * Bounded — never dumps every note.
 */

export const GENERATED_SUMMARY_NOTE_SAMPLE_LIMIT = 0
export const GENERATED_SUMMARY_EVENT_CAP = 40

function histogram(values) {
  const counts = Object.create(null)
  for (const value of values) {
    if (value == null || value === '') continue
    const key = String(value)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function countTruthy(notes, predicate) {
  let count = 0
  for (const note of notes) {
    if (predicate(note)) count += 1
  }
  return count
}

export function buildGeneratedSummaryJson({
  timingMap = null,
  omrMeta = null,
  quality = null,
  diagnostics = null,
  exportedAt = null,
} = {}) {
  const notes = Array.isArray(timingMap?.notes) ? timingMap.notes : []
  const playable = notes.filter((note) => !note?.isRest && !note?.isTabMirror && note?.midi != null)
  const rests = notes.filter((note) => note?.isRest)
  const midis = playable.map((note) => Number(note.midi)).filter(Number.isFinite)
  const noteTypes = playable.map((note) => note?.type ?? note?.durationType ?? null)
  const measures = Array.isArray(timingMap?.measures) ? timingMap.measures : []
  const parts = Array.isArray(timingMap?.parts)
    ? timingMap.parts.map((part) => ({
        id: part?.id ?? null,
        name: part?.name ?? null,
        staveCount: part?.staves ?? part?.staveCount ?? null,
        hasTab: Boolean(part?.hasTabStaff ?? part?.tuning),
      }))
    : []

  const articulations = {
    staccato: countTruthy(playable, (n) => Boolean(n?.articulations?.staccato || n?.staccato)),
    accent: countTruthy(playable, (n) => Boolean(n?.articulations?.accent || n?.accent)),
    tenuto: countTruthy(playable, (n) => Boolean(n?.articulations?.tenuto || n?.tenuto)),
    fermata: countTruthy(playable, (n) => Boolean(n?.fermata)),
  }

  const tieStarts = countTruthy(playable, (n) => Boolean(n?.tieStart))
  const tieStops = countTruthy(playable, (n) => Boolean(n?.tieStop))
  const slurStarts = countTruthy(playable, (n) => Boolean(n?.slurStart))
  const slurStops = countTruthy(playable, (n) => Boolean(n?.slurStop))
  const chordCount = countTruthy(playable, (n) => Boolean(n?.isChord || n?.chord))

  const density =
    measures.length > 0
      ? {
          notesPerMeasureMean: Number((playable.length / measures.length).toFixed(3)),
          restsPerMeasureMean: Number((rests.length / measures.length).toFixed(3)),
        }
      : null

  const malformed = []
  for (const note of playable.slice(0, 500)) {
    if (!Number.isFinite(note?.midi)) {
      malformed.push({ kind: 'non-finite-midi', measure: note?.measureNumber ?? null })
    } else if (!Number.isFinite(note?.quarterTime) && !Number.isFinite(note?.timeSeconds)) {
      malformed.push({ kind: 'missing-onset', measure: note?.measureNumber ?? null })
    }
    if (malformed.length >= GENERATED_SUMMARY_EVENT_CAP) break
  }

  return {
    schema: 'corranzo-generated-summary',
    schemaVersion: 1,
    exportedAt: exportedAt ?? new Date().toISOString(),
    available: Boolean(timingMap) || Boolean(omrMeta),
    parts,
    staveSummary: {
      hasStandardStaff: timingMap?.notation?.hasStandardStaff ?? null,
      hasTabStaff: timingMap?.notation?.hasTabStaff ?? null,
      suggestedInstrumentId: timingMap?.notation?.suggestedInstrumentId ?? null,
    },
    measures: {
      count: measures.length || omrMeta?.measureCount || quality?.extractionSummary?.measureCount || 0,
      withRepeatMarking: measures.filter((m) => m?.marking?.repeat || m?.marking?.volta).length,
    },
    timeSignatures: Array.isArray(timingMap?.timeSignatures)
      ? timingMap.timeSignatures.slice(0, GENERATED_SUMMARY_EVENT_CAP).map((entry) => ({
          beats: entry.beats ?? null,
          beatType: entry.beatType ?? null,
          quarterTime: entry.quarterTime ?? null,
        }))
      : [],
    keySignatures: Array.isArray(timingMap?.keySignatures)
      ? timingMap.keySignatures.slice(0, GENERATED_SUMMARY_EVENT_CAP).map((entry) => ({
          fifths: entry.fifths ?? null,
          mode: entry.mode ?? null,
          staff: entry.staff ?? null,
          quarterTime: entry.quarterTime ?? null,
        }))
      : [],
    tempoEvents: Array.isArray(timingMap?.tempoChanges)
      ? timingMap.tempoChanges.slice(0, GENERATED_SUMMARY_EVENT_CAP).map((entry) => ({
          bpm: entry.bpm ?? null,
          quarterTime: entry.quarterTime ?? null,
        }))
      : Array.isArray(timingMap?.tempoEvents)
        ? timingMap.tempoEvents.slice(0, GENERATED_SUMMARY_EVENT_CAP).map((entry) => ({
            bpm: entry.bpm ?? null,
            quarterTime: entry.quarterTime ?? null,
          }))
        : [],
    repeatsEndings: measures
      .filter((m) => m?.marking)
      .slice(0, GENERATED_SUMMARY_EVENT_CAP)
      .map((m) => ({
        measure: m.number ?? null,
        marking: m.marking,
      })),
    noteTypeHistogram: histogram(noteTypes),
    pitchRange:
      midis.length > 0
        ? { minMidi: Math.min(...midis), maxMidi: Math.max(...midis), playableNotes: playable.length }
        : { minMidi: null, maxMidi: null, playableNotes: playable.length },
    restCount: rests.length,
    chordCount,
    tieCounts: { starts: tieStarts, stops: tieStops },
    slurCounts: { starts: slurStarts, stops: slurStops },
    articulationCounts: articulations,
    eventDensity: density,
    malformedEventSummary: {
      count: malformed.length,
      samples: malformed,
    },
    omrExtraction: {
      noteCount: omrMeta?.noteCount ?? null,
      measureCount: omrMeta?.measureCount ?? null,
      durationSeconds: omrMeta?.durationSeconds ?? null,
      acceptance: quality?.acceptance ?? null,
      confidenceBand: quality?.confidenceBand ?? null,
      pagesWithSystems: diagnostics?.pagesWithSystems ?? null,
      overallConfidence: diagnostics?.overallConfidence ?? quality?.overallConfidence ?? null,
    },
    noteSampleLimit: GENERATED_SUMMARY_NOTE_SAMPLE_LIMIT,
  }
}
