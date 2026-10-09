import { getTimeline } from '../musicxml/timeline.js'
import { getTempoAtTime } from '../musicxml/timingQuery.js'
import { parseMidiFile } from './parseMidiFile.js'
import {
  isPlayableTimingNote,
  sanitizePlaybackDurationSeconds,
} from './sanitizePlaybackNote.js'
import {
  mapMidiEventsToPerformedTimeline,
  MIDI_MAP_METHOD,
} from './midiToPerformedMapping.js'
import {
  applySustainToNotes,
  collectSustainEvents,
  extractSustainSpans,
  sustainedDuration,
} from './sustainPedal.js'
import { buildMetronomeSchedule } from './metronomeSchedule.js'
import {
  playbackDurationSecondsForNote,
  playbackVelocityForNote,
  articulationSourceForNote,
} from './staccatoPlayback.js'

/** Chords whose onsets fall inside this window strum as one gesture. */
export const STRUM_ONSET_WINDOW_SECONDS = 0.03
/** Downstroke string spacing (low→high pitch order). */
export const STRUM_STRING_GAP_SECONDS = 0.009
/** Per-string velocity slope across a strum (first string loudest). */
export const STRUM_VELOCITY_SLOPE = 0.03
export const STRUM_VELOCITY_FLOOR = 0.85

/** Hammer-on/pull-off: softer pick + bleed into the next attack (legato blur). */
export const SLUR_VELOCITY_RATIO = 0.8
export const SLUR_OVERLAP_SECONDS = 0.04

/** Palm-mute (muted event): short damped tone. */
export const MUTED_DURATION_RATIO = 0.35
export const MUTED_VELOCITY_RATIO = 0.8

/** Let-ring: the chord/note rings well past its written value (no re-attack). */
export const LET_RING_DURATION_RATIO = 2.0

/** Slur legato (any instrument): connected phrasing, no silence gap. */
export const LEGATO_OVERLAP_SECONDS = 0.04
export const LEGATO_TECHNIQUE_KIND = 'legato'

/** Techniques the runtime actually renders (vs recognizes-only). */
export const PERFORMED_TECHNIQUE_KINDS = Object.freeze(['hammer-on', 'pull-off', 'strum', 'muted', 'let-ring'])

/**
 * Split parsed techniques into performed vs recognized-only. Bends,
 * slides, vibrato and harmonics are recognized (preserved as evidence)
 * but NOT performed — Tone.Sampler cannot glide pitch per voice, so
 * claiming them would be dishonest. See the module docs for the recipe.
 */
export function splitPerformedTechniques(techniques = []) {
  const performed = []
  const recognizedOnly = []
  for (const technique of techniques ?? []) {
    const kind = technique?.kind ?? technique
    if (PERFORMED_TECHNIQUE_KINDS.includes(kind)) {
      performed.push(kind)
    } else if (kind != null) {
      recognizedOnly.push(kind)
    }
  }
  return { performed, recognizedOnly }
}

function techniqueKinds(note) {
  const list = []
  for (const technique of note?.guitarTechniques ?? []) {
    const kind = technique?.kind ?? technique
    if (kind != null && !list.includes(kind)) {
      list.push(kind)
    }
  }
  return list
}

/**
 * Pure performed-timeline note schedule for tests and the playback engine.
 * `scoreTimeSeconds` is performed score time; `wallTimeSeconds` accounts for rate.
 *
 * This is the canonical written→performed layer: written onsets/pitches are
 * never rewritten (except strum staggering, which offsets onsets by
 * milliseconds as a performance gesture and is flagged per event).
 */
export function buildScoreNoteSchedule(timingMap, { rate = 1, sustainPedal = false, instrumentId = null } = {}) {
  if (!timingMap || rate <= 0) {
    return []
  }

  const isGuitarFamily = instrumentId === 'guitar' || instrumentId === 'electric-guitar'
  const pedalSpans = sustainPedal && Array.isArray(timingMap.pedalSpans) ? timingMap.pedalSpans : []

  const events = getTimeline(timingMap)
    .performedNotes()
    .filter(isPlayableTimingNote)
    .map((note) => {
      const writtenDurationSeconds = sanitizePlaybackDurationSeconds(note.durationSeconds)
      let performedDurationSeconds = playbackDurationSecondsForNote({
        ...note,
        durationSeconds: writtenDurationSeconds,
      })
      let velocity = playbackVelocityForNote(note)
      const kinds = techniqueKinds(note)
      const { performed, recognizedOnly } = splitPerformedTechniques(kinds)
      const isSlurred = performed.includes('hammer-on') || performed.includes('pull-off')
      if (isSlurred) {
        // Legato approximation: softer pick + bleed into the next attack
        // (no silence gap). True pitch glide needs a mono technique
        // voice — documented, not claimed.
        velocity = Math.max(0.05, velocity * SLUR_VELOCITY_RATIO)
        performedDurationSeconds += SLUR_OVERLAP_SECONDS
      }
      const muted = note.muted === true || performed.includes('muted')
      if (muted) {
        performedDurationSeconds = Math.max(0.03, performedDurationSeconds * MUTED_DURATION_RATIO)
        velocity = Math.max(0.05, velocity * MUTED_VELOCITY_RATIO)
      }
      if (!muted && performed.includes('let-ring')) {
        // Let-ring: sustain without re-attack. A fixed multiple of the
        // written value — conservative, deterministic, and flagged.
        performedDurationSeconds = Math.max(
          performedDurationSeconds,
          sanitizePlaybackDurationSeconds(note.durationSeconds) * LET_RING_DURATION_RATIO,
        )
        performed.push('let-ring')
      }
      const slurredForward = (note.slurs ?? []).some(
        (slur) => slur?.type === 'start' || slur?.type === 'continue',
      )
      let legato = false
      if (!muted && slurredForward) {
        // Written-slur legato for any instrument: bleed into the next
        // attack (same physical approximation as hammer-on/pull-off).
        performedDurationSeconds += SLUR_OVERLAP_SECONDS
        legato = true
        if (!performed.includes(LEGATO_TECHNIQUE_KIND)) {
          performed.push(LEGATO_TECHNIQUE_KIND)
        }
      }
      if (pedalSpans.length) {
        performedDurationSeconds = sustainedDuration(
          note.performedSeconds,
          performedDurationSeconds,
          pedalSpans.map((span) => ({ start: span.startSeconds, end: span.endSeconds })),
        )
      }
      return {
        type: 'note',
        scoreTimeSeconds: note.performedSeconds,
        writtenOnsetSeconds: note.timeSeconds ?? note.performedSeconds,
        writtenDurationSeconds,
        baseDurationSeconds: performedDurationSeconds,
        performedDurationSeconds,
        staccato: Boolean(note.staccato),
        accent: Boolean(note.accent),
        tenuto: Boolean(note.tenuto),
        marcato: Boolean(note.marcato),
        fermata: Boolean(note.fermata),
        articulationSource: articulationSourceForNote(note),
        techniques: kinds,
        performedTechniques: performed,
        recognizedOnlyTechniques: recognizedOnly,
        legato,
        muted,
        tieChainId: note.tieChainId ?? null,
        attackCount: 1,
        midi: note.midi,
        label: note.label,
        measureNumber: note.measureNumber,
        repeatPass: note.repeatPass ?? 1,
        velocity,
        activeDynamicVelocity: note.velocity ?? null,
        activeTempoBpm: getTempoAtTime(timingMap, note.performedSeconds) ?? 120,
        partId: note.partId ?? null,
        staff: note.staff ?? null,
        ownerScoreId: timingMap.fileName ?? null,
      }
    })
    .sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)

  if (isGuitarFamily) {
    applyGuitarStrum(events)
  }
  return events
}

/**
 * Guitar strums: simultaneously written chord tones become a downstroke —
 * low→high pitch order, ~9 ms string spacing, slight velocity slope.
 * Piano chords (and arpeggios, which are never simultaneous) are untouched.
 * Mutates onset/velocity in place; flags every touched event.
 */
export function applyGuitarStrum(events) {
  let index = 0
  while (index < events.length) {
    let end = index + 1
    while (
      end < events.length &&
      Math.abs(events[end].scoreTimeSeconds - events[index].scoreTimeSeconds) <= STRUM_ONSET_WINDOW_SECONDS
    ) {
      end += 1
    }
    const chord = events.slice(index, end)
    if (chord.length > 1) {
      chord.sort((left, right) => (left.midi ?? 0) - (right.midi ?? 0))
      chord.forEach((event, stringIndex) => {
        event.scoreTimeSeconds = Math.round(
          (event.scoreTimeSeconds + stringIndex * STRUM_STRING_GAP_SECONDS) * 1000000,
        ) / 1000000
        event.velocity = Math.max(
          0.05,
          event.velocity * Math.max(STRUM_VELOCITY_FLOOR, 1 - stringIndex * STRUM_VELOCITY_SLOPE),
        )
        event.strummed = true
        event.strumIndex = stringIndex
        if (!event.performedTechniques.includes('strum')) {
          event.performedTechniques = [...event.performedTechniques, 'strum']
        }
      })
      chord.sort((left, right) => left.scoreTimeSeconds - right.scoreTimeSeconds)
      events.splice(index, chord.length, ...chord)
    }
    index = end
  }
  return events
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
  { rate = 1, alignmentDiagnostics = null, sustainPedal = false, instrumentId = null } = {},
) {
  const scoreEvents = buildScoreNoteSchedule(timingMap, { rate, sustainPedal, instrumentId })
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
        midi: Number.isFinite(note.midi) ? note.midi : null,
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
        midi: Number.isFinite(event.midi) ? event.midi : null,
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
