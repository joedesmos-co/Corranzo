import { getTimeline } from '../musicxml/timeline.js'
import { getTempoAtTime } from '../musicxml/timingQuery.js'
import { parseMidiFile } from './parseMidiFile.js'
import {
  mapMidiEventsToPerformedTimeline,
  MIDI_MAP_METHOD,
} from './midiToPerformedMapping.js'
import {
  applySustainToNotes,
  collectSustainEvents,
  extractSustainSpans,
} from './sustainPedal.js'
import { buildMetronomeSchedule } from './metronomeSchedule.js'
import { playbackDurationSecondsForNote, playbackVelocityForNote } from './staccatoPlayback.js'

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
    .filter((note) => !note.isRest && note.midi != null && !note.suppressPlaybackAttack)
    .map((note) => {
      const writtenDurationSeconds = Math.max(note.durationSeconds, 0.03)
      return {
        type: 'note',
        scoreTimeSeconds: note.performedSeconds,
        writtenDurationSeconds,
        baseDurationSeconds: playbackDurationSecondsForNote(note),
        staccato: Boolean(note.staccato),
        accent: Boolean(note.accent),
        midi: note.midi,
        label: note.label,
        measureNumber: note.measureNumber,
        repeatPass: note.repeatPass ?? 1,
        velocity: playbackVelocityForNote(note),
      }
    })
    .sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)
}

/** Metronome click times on performed beats. */
export { buildMetronomeSchedule } from './metronomeSchedule.js'

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
  // Carry each note's position on the MIDI's OWN bar grid (tempo + time-signature
  // aware) so measure-aligned mapping can place it correctly even when measures
  // have unequal durations (tempo changes) — instead of assuming equal slices.
  const ticksToMeasures =
    typeof midi.header?.ticksToMeasures === 'function'
      ? (ticks) => midi.header.ticksToMeasures(ticks)
      : null
  const mapMidiDuration = midiDuration || performedDuration

  // Sustain pedal (CC64), global across tracks: lengthen note releases so
  // pedalled passages ring like a real piano. Applied to MIDI durations BEFORE
  // mapping — onsets are unchanged, so alignment/timing is untouched.
  const sustainSpans = extractSustainSpans(collectSustainEvents(midi))

  // Map each track separately so every note keeps its trackId (for per-hand
  // muting). The bar-grid mapping is per-note independent, so per-track mapping
  // is identical to mapping all notes at once — just grouped + tagged.
  const noteEvents = []
  let mappingMethod = null
  let mappingWarning = null
  midi.tracks.forEach((track, trackId) => {
    if (!track.notes?.length) {
      return
    }
    const trackNotes = applySustainToNotes(
      track.notes.map((note) => ({
        time: note.time,
        duration: note.duration,
        name: note.name,
        velocity: note.velocity,
        measurePosition:
          ticksToMeasures && Number.isFinite(note.ticks) ? ticksToMeasures(note.ticks) : null,
      })),
      sustainSpans,
    )
    const mapped = mapMidiEventsToPerformedTimeline(
      trackNotes,
      mapMidiDuration,
      timingMap,
      alignmentDiagnostics,
    )
    if (mappingMethod == null) {
      mappingMethod = mapped.method
      mappingWarning = mapped.warning ?? null
    }
    for (const event of mapped.events) {
      noteEvents.push({
        type: 'note',
        scoreTimeSeconds: event.scoreTimeSeconds,
        baseDurationSeconds: Math.max(event.durationSeconds, 0.03),
        name: event.name,
        velocity: event.velocity,
        source: event.source,
        measureNumber: event.measureNumber,
        trackId,
      })
    }
  })
  noteEvents.sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)

  return {
    events: noteEvents.length > 0 ? noteEvents : scoreEvents,
    noteEvents: noteEvents.length > 0 ? noteEvents : scoreEvents,
    metronomeEvents: buildMetronomeSchedule(timingMap),
    duration: performedDuration,
    tracks: tracks.map(({ id, name, noteCount, muted }) => ({ id, name, noteCount, muted })),
    usesMidi: noteEvents.length > 0,
    mappingMethod: mappingMethod ?? MIDI_MAP_METHOD.PROPORTIONAL,
    mappingWarning,
    sustainSpanCount: sustainSpans.length,
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
