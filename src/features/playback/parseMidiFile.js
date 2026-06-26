import { Midi } from '@tonejs/midi'

export function getTrackLabel(track, index) {
  if (track.name?.trim()) {
    return track.name.trim()
  }
  if (track.instrument?.name?.trim()) {
    return track.instrument.name.trim()
  }
  return `Track ${index + 1}`
}

function averageMidiPitch(track) {
  if (!track.notes?.length) {
    return 60
  }
  const sum = track.notes.reduce((total, note) => total + note.midi, 0)
  return sum / track.notes.length
}

/** Piano in common English / non-English / technical spellings. */
const PIANO_NAME_PATTERN = /piano|keyboard|grand|acoustic|klavier|clavier|pianoforte|fl(ü|ue?)gel/i

function looksLikePianoTrackName(name) {
  return PIANO_NAME_PATTERN.test(name ?? '')
}

const HAND_NAMES = new Set(['Left hand', 'Right hand'])

/**
 * Replace technical / non-English piano instrument names (e.g. "Klavier 1",
 * "Pianoforte", "Flügel") with friendly "Piano N" labels — the fallback when a
 * hand could not be inferred. Tracks already resolved to a specific hand are
 * left untouched, and non-piano instruments are never renamed.
 */
export function friendlyPianoLabels(tracks) {
  const pianoTracks = tracks.filter(
    (track) => !HAND_NAMES.has(track.name) && looksLikePianoTrackName(track.name),
  )
  if (pianoTracks.length === 0) {
    return tracks
  }
  const numbered = pianoTracks.length > 1
  let counter = 0
  return tracks.map((track) => {
    if (HAND_NAMES.has(track.name) || !looksLikePianoTrackName(track.name)) {
      return track
    }
    counter += 1
    return { ...track, name: numbered ? `Piano ${counter}` : 'Piano' }
  })
}

/** Names that carry no hand info (Mutopia MIDI, music21 exports, DAW defaults). */
function isGenericHandTrackName(name) {
  const trimmed = name?.trim() ?? ''
  if (!trimmed) {
    return true
  }
  return (
    /^track\s*\d+$/i.test(trimmed) ||
    /^part\s*\d+$/i.test(trimmed) ||
    /^one:$/i.test(trimmed) ||
    /^two:$/i.test(trimmed)
  )
}

/**
 * Label two piano tracks as left/right hand by average pitch when possible.
 */
export function labelHandTracks(midiTracks, summaryTracks) {
  if (midiTracks.length !== 2 || summaryTracks.length !== 2) {
    return summaryTracks
  }

  const pianoLike = summaryTracks.every((track, index) =>
    looksLikePianoTrackName(track.name || midiTracks[index]?.name),
  )
  const genericTwoHand =
    summaryTracks.every((track, index) =>
      isGenericHandTrackName(track.name || midiTracks[index]?.name),
    ) && midiTracks.every((track) => (track.notes?.length ?? 0) > 0)

  if (!pianoLike && !genericTwoHand) {
    return summaryTracks
  }

  const pitch0 = averageMidiPitch(midiTracks[0])
  const pitch1 = averageMidiPitch(midiTracks[1])
  const lowerIndex = pitch0 <= pitch1 ? 0 : 1
  const higherIndex = 1 - lowerIndex

  return summaryTracks.map((track, index) => {
    if (index === lowerIndex) {
      return { ...track, name: 'Left hand' }
    }
    if (index === higherIndex) {
      return { ...track, name: 'Right hand' }
    }
    return track
  })
}

/**
 * Parse a MIDI file into a Tone.js Midi instance and summary metadata.
 * Note times are in seconds and include tempo-map changes from the file.
 */
export async function parseMidiFile(arrayBuffer) {
  const midi = new Midi(arrayBuffer)

  const summaryTracks = midi.tracks.map((track, index) => ({
    id: index,
    name: getTrackLabel(track, index),
    noteCount: track.notes.length,
    muted: false,
  }))

  // Infer Left/Right hand for a 2-track piano score; otherwise normalize any
  // remaining technical piano names (e.g. "Klavier 1") to friendly "Piano N".
  const handed = labelHandTracks(midi.tracks, summaryTracks)
  const tracks = friendlyPianoLabels(handed)

  return {
    midi,
    duration: midi.duration,
    tracks,
  }
}
