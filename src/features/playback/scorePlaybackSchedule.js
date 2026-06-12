import { getTimeline } from '../musicxml/timeline.js'
import { getTempoAtTime } from '../musicxml/timingQuery.js'
import { parseMidiFile } from './parseMidiFile.js'
import {
  mapMidiEventsToPerformedTimeline,
  MIDI_MAP_METHOD,
} from './midiToPerformedMapping.js'

/**
 * Pure performed-timeline note schedule for tests and the playback engine.
 * `scoreTimeSeconds` is performed score time; `wallTimeSeconds` accounts for rate.
 */
export function buildScoreNoteSchedule(timingMap, { rate = 1 } = {}) {
  if (!timingMap || rate <= 0) {
    return []
  }

  return getTimeline(timingMap)
    .performedNotes()
    .filter((note) => !note.isRest && note.midi != null)
    .map((note) => ({
      type: 'note',
      scoreTimeSeconds: note.performedSeconds,
      baseDurationSeconds: Math.max(note.durationSeconds, 0.03),
      midi: note.midi,
      label: note.label,
      measureNumber: note.measureNumber,
      repeatPass: note.repeatPass ?? 1,
    }))
    .sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)
}

/** Metronome click times on performed beats. */
export function buildMetronomeSchedule(timingMap, { rate = 1, beatsPerClick = 1 } = {}) {
  const beats = getTimeline(timingMap).performedBeats
  return beats
    .filter((_, index) => index % beatsPerClick === 0)
    .map((beat) => ({
      type: 'metronome',
      scoreTimeSeconds: beat.timeSeconds,
      measureNumber: beat.measureNumber,
      beat: beat.beat,
      accent: beat.beat === 1,
    }))
}

export function applyPlaybackRate(events, rate) {
  if (rate <= 0) {
    return []
  }
  return events.map((event) => ({
    ...event,
    wallTimeSeconds: event.scoreTimeSeconds / rate,
    durationSeconds:
      event.durationSeconds != null
        ? Math.max(event.durationSeconds * (1 / rate), 0.03)
        : undefined,
  }))
}

export async function buildCombinedPlaybackSchedule(
  timingMap,
  midiArrayBuffer,
  { rate = 1, alignmentDiagnostics = null } = {},
) {
  const scoreEvents = buildScoreNoteSchedule(timingMap, { rate })
  const performedDuration = getTimeline(timingMap).performedDurationSeconds

  if (!midiArrayBuffer) {
    return {
      events: scoreEvents,
      noteEvents: scoreEvents,
      metronomeEvents: [],
      duration: performedDuration,
      tracks: [],
      mappingMethod: null,
      mappingWarning: null,
    }
  }

  const { midi, duration: midiDuration, tracks } = await parseMidiFile(midiArrayBuffer)
  const allMidiNotes = midi.tracks.flatMap((track) => track.notes)
  const mapped = mapMidiEventsToPerformedTimeline(
    allMidiNotes,
    midiDuration || performedDuration,
    timingMap,
    alignmentDiagnostics,
  )

  const noteEvents = mapped.events.map((event) => ({
    type: 'note',
    scoreTimeSeconds: event.scoreTimeSeconds,
    baseDurationSeconds: Math.max(event.durationSeconds, 0.03),
    name: event.name,
    velocity: event.velocity,
    source: event.source,
    measureNumber: event.measureNumber,
  }))

  return {
    events: noteEvents.length > 0 ? noteEvents : scoreEvents,
    noteEvents: noteEvents.length > 0 ? noteEvents : scoreEvents,
    metronomeEvents: buildMetronomeSchedule(timingMap, { rate }),
    duration: performedDuration,
    tracks: tracks.map(({ id, name, noteCount, muted }) => ({ id, name, noteCount, muted })),
    usesMidi: noteEvents.length > 0,
    mappingMethod: mapped.method ?? MIDI_MAP_METHOD.PROPORTIONAL,
    mappingWarning: mapped.warning ?? null,
  }
}

/** Effective quarter BPM at a score instant. */
export function effectiveTempoAtTime(timingMap, scoreTimeSeconds) {
  return getTempoAtTime(timingMap, scoreTimeSeconds) ?? 120
}

/** Display tempo accounting for playback rate (higher rate = faster BPM). */
export function displayTempoAtTime(timingMap, scoreTimeSeconds, rate = 1) {
  return effectiveTempoAtTime(timingMap, scoreTimeSeconds) * rate
}

export { MIDI_MAP_METHOD }
