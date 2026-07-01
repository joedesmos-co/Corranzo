import { getTimeline } from '../musicxml/timeline.js'
import { ALIGNMENT_ASSESSMENT } from '../practice/computeAlignmentDiagnostics.js'

export const MIDI_MAP_METHOD = {
  MEASURE_ALIGNED: 'measure-aligned',
  PROPORTIONAL: 'proportional',
}

const clamp01 = (value) => Math.min(1, Math.max(0, value))

/**
 * Map one MIDI note onto a performed-timeline entry using the MIDI's OWN bar
 * position (`note.measurePosition`, e.g. 6.75 = three-quarters through the 7th
 * played bar). The integer part selects the performed entry (which already
 * encodes repeats + real, possibly-unequal measure durations); the fractional
 * part places the note inside that measure's performed window.
 *
 * This is the structurally-correct alignment: it honours tempo changes,
 * time-signature changes, and repeats, because it reuses the MIDI's bar grid
 * instead of assuming every measure is the same length.
 */
function mapByMidiBarPosition(note, entries) {
  const pos = note.measurePosition
  const idx = Math.min(entries.length - 1, Math.max(0, Math.floor(pos)))
  const entry = entries[idx]
  const localT = clamp01(pos - Math.floor(pos))
  const scoreStart = entry.startTimeSeconds
  const scoreSpan = Math.max(entry.endTimeSeconds - entry.startTimeSeconds, 1e-6)
  return {
    scoreTimeSeconds: scoreStart + localT * scoreSpan,
    durationSeconds: Math.max(note.duration, 0.03),
    name: note.name,
    velocity: note.velocity,
    source: 'midi',
    measureNumber: entry.writtenMeasureNumber,
  }
}

/**
 * Map MIDI time → performed score time using measure boundaries.
 *
 * Preferred path: when notes carry `measurePosition` (the MIDI file's own bar
 * grid, derived from its tempo + time-signature map), each note is placed in
 * the matching performed entry — correct even when measure durations differ
 * (tempo changes) or repeats expand the timeline.
 *
 * Fallback path (no bar grid available): the legacy equal-slice approximation,
 * which assumes every written measure occupies an equal slice of the MIDI file.
 * Only correct for constant-tempo, equal-length measures.
 */
export function mapMidiEventsMeasureAligned(midiNotes, midiDuration, timingMap) {
  const measures = timingMap?.measures ?? []
  if (!midiNotes?.length || !measures.length || midiDuration <= 0) {
    return { events: [], method: MIDI_MAP_METHOD.PROPORTIONAL, confidence: 'none' }
  }

  const tl = getTimeline(timingMap)
  const entries = tl.entries ?? []

  // Preferred: align by the MIDI's real bar grid when entries + positions exist.
  const haveBarGrid =
    entries.length > 0 && midiNotes.some((note) => Number.isFinite(note?.measurePosition))
  if (haveBarGrid) {
    const events = midiNotes.map((note) =>
      Number.isFinite(note?.measurePosition)
        ? mapByMidiBarPosition(note, entries)
        : null,
    )
    // If every note had a position, we're done; otherwise fill gaps below.
    if (events.every(Boolean)) {
      return { events, method: MIDI_MAP_METHOD.MEASURE_ALIGNED, confidence: 'structural' }
    }
  }

  const performedStarts = new Map()
  const performedEnds = new Map()

  for (const entry of entries) {
    const number = entry.writtenMeasureNumber
    if (!performedStarts.has(number)) {
      performedStarts.set(number, entry.startTimeSeconds)
    }
    performedEnds.set(number, entry.endTimeSeconds)
  }

  const measureCount = measures.length
  const sliceDuration = midiDuration / measureCount

  const events = midiNotes.map((note) => {
    if (Number.isFinite(note?.measurePosition) && entries.length > 0) {
      return mapByMidiBarPosition(note, entries)
    }

    const rawIndex = Math.min(
      measureCount - 1,
      Math.max(0, Math.floor(note.time / sliceDuration)),
    )
    const measure = measures[rawIndex]
    const midiSliceStart = rawIndex * sliceDuration
    const midiSliceEnd = rawIndex === measureCount - 1 ? midiDuration : (rawIndex + 1) * sliceDuration
    const sliceSpan = Math.max(midiSliceEnd - midiSliceStart, 1e-6)
    const localT = (note.time - midiSliceStart) / sliceSpan

    const scoreStart = performedStarts.get(measure.number) ?? measure.startTimeSeconds
    const scoreEnd =
      performedEnds.get(measure.number) ??
      measures[rawIndex + 1]?.startTimeSeconds ??
      tl.performedDurationSeconds
    const scoreSpan = Math.max(scoreEnd - scoreStart, 1e-6)

    const scoreTimeSeconds = scoreStart + localT * scoreSpan
    return {
      scoreTimeSeconds,
      durationSeconds: Math.max(note.duration * (scoreSpan / sliceSpan), 0.03),
      name: note.name,
      velocity: note.velocity,
      source: 'midi',
      measureNumber: measure.number,
    }
  })

  return { events, method: MIDI_MAP_METHOD.MEASURE_ALIGNED, confidence: 'structural' }
}

/** @deprecated Temporary fallback — proportional stretch when measure alignment is unavailable. */
export function mapMidiEventsProportional(midiNotes, midiDuration, performedDuration) {
  if (!midiNotes?.length || midiDuration <= 0 || performedDuration <= 0) {
    return { events: [], method: MIDI_MAP_METHOD.PROPORTIONAL, confidence: 'none' }
  }

  const scale = performedDuration / midiDuration
  const events = midiNotes.map((note) => ({
    scoreTimeSeconds: note.time * scale,
    durationSeconds: Math.max(note.duration * scale, 0.03),
    name: note.name,
    velocity: note.velocity,
    source: 'midi',
  }))

  return { events, method: MIDI_MAP_METHOD.PROPORTIONAL, confidence: 'low' }
}

/**
 * Choose measure-aligned mapping when structure exists; fall back to proportional
 * with an explicit warning when alignment confidence is low.
 */
export function mapMidiEventsToPerformedTimeline(
  midiNotes,
  midiDuration,
  timingMap,
  alignmentDiagnostics = null,
) {
  const performedDuration = getTimeline(timingMap).performedDurationSeconds
  const measures = timingMap?.measures ?? []

  const assessment = alignmentDiagnostics?.assessment
  const useMeasureAligned =
    measures.length >= 2 &&
    midiDuration > 0 &&
    performedDuration > 0 &&
    assessment !== ALIGNMENT_ASSESSMENT.UNLIKELY_MATCH

  if (useMeasureAligned) {
    const result = mapMidiEventsMeasureAligned(midiNotes, midiDuration, timingMap)
    const warning =
      assessment === ALIGNMENT_ASSESSMENT.UNCERTAIN
        ? 'MIDI mapped by measure with uncertain file alignment — timing may drift slightly.'
        : null
    return { ...result, warning }
  }

  const fallback = mapMidiEventsProportional(midiNotes, midiDuration, performedDuration)
  return {
    ...fallback,
    warning:
      'Timing sync may need help reading these files. Re-export matching files for tighter alignment.',
  }
}
