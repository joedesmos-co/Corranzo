import { parseMidiFile } from './parseMidiFile.js'

/**
 * Read-only summary of a MIDI file for cross-checking with MusicXML timing.
 * Does not affect playback.
 */
export async function extractMidiProfile(arrayBuffer) {
  const { midi, duration } = await parseMidiFile(arrayBuffer)

  const notes = []
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      notes.push({
        midi: note.midi,
        timeSeconds: note.time,
      })
    }
  }

  notes.sort((a, b) => a.timeSeconds - b.timeSeconds || a.midi - b.midi)

  const tempos = midi.header.tempos.map((tempo) => ({
    bpm: Math.round(tempo.bpm * 10) / 10,
    timeSeconds: midi.header.ticksToSeconds(tempo.ticks),
  }))

  if (tempos.length === 0) {
    tempos.push({ bpm: 120, timeSeconds: 0 })
  }

  return {
    noteCount: notes.length,
    durationSeconds: duration,
    tempos,
    notes,
    firstNote: notes[0] ?? null,
  }
}
