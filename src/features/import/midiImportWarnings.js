/**
 * Non-fatal warnings after MIDI loads for playback.
 */
export function analyzeMidiImport({ tracks, duration }) {
  const warnings = []

  if (!tracks?.length) {
    warnings.push({
      id: 'midi-no-tracks',
      message:
        'This MIDI file has no tracks. Playback will be silent — check the export from your notation app.',
    })
    return warnings
  }

  const totalNotes = tracks.reduce((sum, track) => sum + (track.noteCount ?? 0), 0)

  if (totalNotes === 0) {
    warnings.push({
      id: 'midi-no-notes',
      message:
        'No notes found in this MIDI file. It may be empty or contain only control data.',
    })
  }

  return warnings
}
