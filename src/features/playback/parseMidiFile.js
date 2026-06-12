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

function looksLikePianoTrackName(name) {
  return /piano|keyboard|grand|acoustic/i.test(name ?? '')
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

  const tracks = labelHandTracks(midi.tracks, summaryTracks)

  return {
    midi,
    duration: midi.duration,
    tracks,
  }
}
