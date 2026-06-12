import { getTimeline } from '../musicxml/timeline.js'
import { ALIGNMENT_ASSESSMENT } from '../practice/computeAlignmentDiagnostics.js'

export const MIDI_MAP_METHOD = {
  MEASURE_ALIGNED: 'measure-aligned',
  PROPORTIONAL: 'proportional',
}

/**
 * Piecewise-linear map: MIDI time → performed score time using measure boundaries.
 * Each written measure occupies an equal slice of the MIDI file; within a slice,
 * time interpolates between performed measure window start/end (first occurrence).
 */
export function mapMidiEventsMeasureAligned(midiNotes, midiDuration, timingMap) {
  const measures = timingMap?.measures ?? []
  if (!midiNotes?.length || !measures.length || midiDuration <= 0) {
    return { events: [], method: MIDI_MAP_METHOD.PROPORTIONAL, confidence: 'none' }
  }

  const tl = getTimeline(timingMap)
  const performedStarts = new Map()
  const performedEnds = new Map()

  for (const entry of tl.entries) {
    const number = entry.writtenMeasureNumber
    if (!performedStarts.has(number)) {
      performedStarts.set(number, entry.startTimeSeconds)
    }
    performedEnds.set(number, entry.endTimeSeconds)
  }

  const measureCount = measures.length
  const sliceDuration = midiDuration / measureCount

  const events = midiNotes.map((note) => {
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
      'MIDI-to-score sync uses proportional stretch (low confidence). Re-export matching files for tighter alignment.',
  }
}
