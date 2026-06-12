import { getTimeline } from '../musicxml/timeline.js'
import { parseMidiFile } from './parseMidiFile.js'

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
      scoreTimeSeconds: note.performedSeconds,
      wallTimeSeconds: note.performedSeconds / rate,
      durationSeconds: Math.max(note.durationSeconds / rate, 0.03),
      midi: note.midi,
      label: note.label,
      measureNumber: note.measureNumber,
      repeatPass: note.repeatPass ?? 1,
    }))
    .sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)
}

/** Map MIDI-file seconds onto performed score seconds (proportional until measure mapper exists). */
export function mapMidiEventsToPerformed(midiNotes, midiDuration, performedDuration) {
  if (!midiNotes?.length || midiDuration <= 0 || performedDuration <= 0) {
    return []
  }

  const scale = performedDuration / midiDuration
  return midiNotes.map((note) => ({
    scoreTimeSeconds: note.time * scale,
    wallTimeSeconds: note.time * scale,
    durationSeconds: Math.max(note.duration * scale, 0.03),
    name: note.name,
    velocity: note.velocity,
    source: 'midi',
  }))
}

export async function buildCombinedPlaybackSchedule(timingMap, midiArrayBuffer, { rate = 1 } = {}) {
  const scoreEvents = buildScoreNoteSchedule(timingMap, { rate })
  if (!midiArrayBuffer) {
    return { events: scoreEvents, duration: getTimeline(timingMap).performedDurationSeconds, tracks: [] }
  }

  const { midi, duration: midiDuration, tracks } = await parseMidiFile(midiArrayBuffer)
  const performedDuration = getTimeline(timingMap).performedDurationSeconds
  const allMidiNotes = midi.tracks.flatMap((track) => track.notes)
  const midiEvents = mapMidiEventsToPerformed(allMidiNotes, midiDuration || performedDuration, performedDuration)
    .map((event) => ({ ...event, wallTimeSeconds: event.scoreTimeSeconds / rate }))

  return {
    events: midiEvents.length > 0 ? midiEvents : scoreEvents,
    duration: performedDuration,
    tracks: tracks.map(({ id, name, noteCount, muted }) => ({ id, name, noteCount, muted })),
    usesMidi: midiEvents.length > 0,
  }
}

/** Metronome click times on performed beats (for future event stream). */
export function buildMetronomeSchedule(timingMap, { rate = 1, beatsPerClick = 1 } = {}) {
  const beats = getTimeline(timingMap).performedBeats
  return beats
    .filter((_, index) => index % beatsPerClick === 0)
    .map((beat) => ({
      scoreTimeSeconds: beat.timeSeconds,
      wallTimeSeconds: beat.timeSeconds / rate,
      measureNumber: beat.measureNumber,
      beat: beat.beat,
    }))
}
