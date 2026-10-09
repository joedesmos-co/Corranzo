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
export const PERFORMED_TECHNIQUE_KINDS = Object.freeze([
  'hammer-on', 'pull-off', 'strum', 'muted', 'let-ring',
  // Pitch-and-time techniques below are performed by the per-note
  // technique voice (Player-based, independent per note — chords never
  // bend together). See buildPitchCurve / expandOrnamentEvents.
  'bend', 'slide', 'vibrato', 'trill', 'mordent', 'inverted-mordent',
  'turn', 'inverted-turn', 'arpeggio',
])

/** Default whole-step bend when <bend-alter> is absent. */
export const BEND_DEFAULT_SEMITONES = 2
/** Bend ramp time (clamped to the note duration). */
export const BEND_RAMP_SECONDS = 0.3
/** Vibrato defaults: typical classical/guitar hand vibrato (±1/2 semitone). */
export const VIBRATO_RATE_HZ = 5.5
export const VIBRATO_DEPTH_SEMITONES = 0.5
export const VIBRATO_DELAY_SECONDS = 0.15
/** Hammer-on/pull-off pick transient removal (connected sound). */
export const SLUR_ATTACK_SECONDS = 0.03
/** Arpeggiated chord stagger (fingerpicked, even dynamics). */
export const ARPEGGIO_GAP_SECONDS = 0.012

/**
 * Split parsed techniques into performed vs recognized-only. Harmonics
 * (and anything unknown) are recognized (preserved as evidence) but NOT
 * performed — a harmonic partial stack cannot be voiced honestly from a
 * single-layer sample, so claiming it would be dishonest.
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
  // NOTE: `guitarTechniques` is the parser's generic performance-technique
  // field — it carries trills, bends, slides etc. for piano too. The name
  // is historical; the schedule treats it as instrument-agnostic.
  const list = []
  for (const technique of note?.guitarTechniques ?? []) {
    const kind = technique?.kind ?? technique
    if (kind != null && !list.includes(kind)) {
      list.push(kind)
    }
  }
  return list
}

function findTechnique(note, kind) {
  for (const technique of note?.guitarTechniques ?? []) {
    if ((technique?.kind ?? technique) === kind) {
      return technique
    }
  }
  return null
}

/** Major/natural-minor scale pitch classes for a key signature. */
function scalePitchClasses(keySignature) {
  const fifths = Number(keySignature?.fifths) || 0
  const minor = String(keySignature?.mode ?? '').toLowerCase() === 'minor'
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]
  const sharpOrder = [6, 1, 8, 3, 10, 5, 11]
  const flatOrder = [10, 3, 8, 1, 6, 5, 11]
  const altered = new Set()
  for (let index = 0; index < Math.min(7, Math.abs(fifths)); index += 1) {
    altered.add(fifths > 0 ? sharpOrder[index] : flatOrder[index])
  }
  return scale.map((pc) => {
    if (altered.has(pc)) {
      return (pc + (fifths > 0 ? 1 : 11)) % 12
    }
    return pc
  })
}

/** Diatonic upper-neighbor semitones (fallback: whole step). */
export function upperAuxSemitones(midi, keySignature) {
  const pc = ((Math.round(midi) % 12) + 12) % 12
  const scale = scalePitchClasses(keySignature)
  let best = null
  for (const degree of scale) {
    const above = (degree - pc + 12) % 12
    if (above > 0 && (best == null || above < best)) {
      best = above
    }
  }
  return best ?? 2
}

/** Diatonic lower-neighbor semitones, negative (fallback: whole step). */
export function lowerAuxSemitones(midi, keySignature) {
  const pc = ((Math.round(midi) % 12) + 12) % 12
  const scale = scalePitchClasses(keySignature)
  let best = null
  for (const degree of scale) {
    const below = (pc - degree + 12) % 12
    if (below > 0 && (best == null || below < best)) {
      best = below
    }
  }
  return best == null ? -2 : -best
}

/**
 * Per-note pitch curve for bend/slide/vibrato, or null for plain notes.
 * Curves are semitone offsets over time — the technique voice realizes
 * them per note, so polyphonic bends stay independent.
 */
export function buildPitchCurve(note, { durationSeconds }) {
  const bend = findTechnique(note, 'bend')
  if (bend && typeof bend === 'object') {
    const semitones = Number.isFinite(bend.semitones) ? bend.semitones : BEND_DEFAULT_SEMITONES
    const rampSeconds = Math.min(BEND_RAMP_SECONDS, Math.max(0.05, durationSeconds * 0.4))
    if (bend.preBend) {
      return { type: 'prebend-release', semitones, rampSeconds }
    }
    if (bend.release) {
      return { type: 'bend-release', semitones, rampSeconds }
    }
    return { type: 'bend', semitones, rampSeconds }
  }
  if (findTechnique(note, 'vibrato')) {
    return {
      type: 'vibrato',
      rateHz: VIBRATO_RATE_HZ,
      depthSemitones: VIBRATO_DEPTH_SEMITONES,
      delaySeconds: Math.min(VIBRATO_DELAY_SECONDS, Math.max(0, durationSeconds * 0.3)),
    }
  }
  return null
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
      const slideMarking = (note.guitarTechniques ?? []).find(
        (technique) => (technique?.kind ?? technique) === 'slide' && typeof technique === 'object',
      )
      const slideType = slideMarking?.type === 'stop' ? 'stop' : slideMarking?.type === 'start' ? 'start' : null
      const arpeggioMarking = (note.guitarTechniques ?? []).find(
        (technique) => (technique?.kind ?? technique) === 'arpeggio' && typeof technique === 'object',
      )
      // Hammer-on/pull-off voice shaping: softer pick (above) + a pick
      // transient-free attack rendered by the technique voice (below).
      const slurAttack = isSlurred ? { attackSeconds: SLUR_ATTACK_SECONDS } : null
      const pitchCurve = performed.includes('slide')
        ? { type: 'slide', targetMidi: null, glideSeconds: 0.3 }
        : buildPitchCurve(note, { durationSeconds: performedDurationSeconds })
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
        slideType,
        slideTargetMidi: null,
        arpeggioDirection: arpeggioMarking?.direction ?? null,
        pitchCurve,
        slurAttack,
        ornamentKind: null,
        string: note.string ?? null,
        fret: note.fret ?? null,
        keySignature: note.keySignature ?? null,
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
  resolveSlideTargets(events)
  return expandOrnamentEvents(events)
}

/**
 * Pair slide starts with the next slide stop (same part+staff, forward in
 * performed time). Fills pitchCurve.targetMidi on starts; demotes unpaired
 * starts back to recognized-only — an un-aimed slide must not glide.
 */
export function resolveSlideTargets(events) {
  const starts = events.filter((event) => (event.slideType ?? null) === 'start')
  for (const start of starts) {
    const target = events
      .filter(
        (candidate) =>
          candidate !== start &&
          (candidate.slideType ?? null) === 'stop' &&
          (candidate.partId ?? null) === (start.partId ?? null) &&
          (candidate.staff ?? null) === (start.staff ?? null) &&
          (candidate.repeatPass ?? 1) === (start.repeatPass ?? 1) &&
          candidate.scoreTimeSeconds >= start.scoreTimeSeconds - 1e-9 &&
          candidate.midi != null,
      )
      .sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)[0]
    if (target) {
      start.pitchCurve = {
        type: 'slide',
        targetMidi: target.midi,
        glideSeconds: Math.max(0.05, Math.min(start.performedDurationSeconds * 0.7, 0.6)),
      }
      start.slideTargetMidi = target.midi
    } else {
      start.pitchCurve = null
      start.performedTechniques = (start.performedTechniques ?? []).filter((kind) => kind !== 'slide')
      if (!start.recognizedOnlyTechniques.includes('slide')) {
        start.recognizedOnlyTechniques = [...start.recognizedOnlyTechniques, 'slide']
      }
    }
  }
  return events
}

const ORNAMENT_KINDS = Object.freeze(['trill', 'mordent', 'inverted-mordent', 'turn', 'inverted-turn'])

/** Sub-division plan for ornaments: [midiOffsets..., ] in equal time slices. */
function ornamentOffsets(kind, midi, keySignature) {
  const upper = upperAuxSemitones(midi, keySignature)
  const lower = lowerAuxSemitones(midi, keySignature)
  switch (kind) {
    case 'trill': return null // count depends on duration; see below
    case 'mordent': return [0, upper, 0]
    case 'inverted-mordent': return [0, lower, 0]
    case 'turn': return [upper, 0, lower, 0]
    case 'inverted-turn': return [lower, 0, upper, 0]
    default: return null
  }
}

/**
 * Expand ornamented events into timed sub-events (mechanical, equal
 * slices — symbolic timing, not stylistic rubato; documented as such).
 * Arpeggios stagger the onset group instead of subdividing.
 */
export function expandOrnamentEvents(events) {
  const output = []
  // Arpeggiate marks usually sit on the first chord note only — an onset
  // group staggers when ANY member carries the marking.
  const onsetGroups = new Map()
  for (const event of events) {
    const key = `${event.partId ?? ''}|${event.repeatPass ?? 1}|${Math.round((event.writtenOnsetSeconds ?? 0) * 1000)}`
    if (!onsetGroups.has(key)) {
      onsetGroups.set(key, [])
    }
    onsetGroups.get(key).push(event)
  }
  for (const group of onsetGroups.values()) {
    if (!group.some((event) => (event.techniques ?? []).includes('arpeggio'))) {
      continue
    }
    const playable = group.filter((event) => (event.writtenDurationSeconds ?? 0) > 0.031 && event.midi != null)
    if (playable.length < 2) {
      continue
    }
    const direction = group.find((event) => event.arpeggioDirection)?.arpeggioDirection ?? 'up'
    playable.sort((a, b) => (direction === 'down' ? b.midi - a.midi : a.midi - b.midi))
    const base = Math.min(...playable.map((event) => event.writtenOnsetSeconds ?? event.scoreTimeSeconds))
    playable.forEach((event, index) => {
      event.scoreTimeSeconds = Math.round((base + index * ARPEGGIO_GAP_SECONDS) * 1000000) / 1000000
      if (!event.performedTechniques.includes('arpeggio')) {
        event.performedTechniques = [...event.performedTechniques, 'arpeggio']
      }
      event.arpeggiated = true
      event.arpeggioIndex = index
    })
  }

  for (const event of events) {
    const kind = (event.techniques ?? []).find((technique) => ORNAMENT_KINDS.includes(technique))
    if (!kind || event.midi == null) {
      output.push(event)
      continue
    }
    let offsets = ornamentOffsets(kind, event.midi, event.keySignature)
    if (kind === 'trill') {
      const upper = upperAuxSemitones(event.midi, event.keySignature)
      const count = Math.max(2, Math.min(16, Math.floor(event.performedDurationSeconds / 0.09)))
      offsets = Array.from({ length: count }, (_, index) => (index % 2 === 0 ? 0 : upper))
    }
    if (!offsets || offsets.length < 2) {
      output.push(event)
      continue
    }
    const slice = event.performedDurationSeconds / offsets.length
    offsets.forEach((offset, index) => {
      output.push({
        ...event,
        midi: event.midi + offset,
        label: undefined,
        scoreTimeSeconds: Math.round((event.scoreTimeSeconds + index * slice) * 1000000) / 1000000,
        writtenDurationSeconds: event.writtenDurationSeconds / offsets.length,
        baseDurationSeconds: slice,
        performedDurationSeconds: slice,
        velocity: event.velocity,
        techniques: [kind],
        performedTechniques: [kind],
        recognizedOnlyTechniques: [],
        pitchCurve: null,
        slurAttack: null,
        ornamentKind: kind,
        ornamentIndex: index,
        ornamentCount: offsets.length,
        attackCount: 1,
      })
    })
  }
  output.sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)
  return output
}

/**
 * Guitar strums: simultaneously written chord tones become a downstroke —
 * low→high pitch order, ~9 ms string spacing, slight velocity slope.
 * Piano chords are untouched (arpeggios expand separately and never
 * reach the strum pass as simultaneous events).
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
