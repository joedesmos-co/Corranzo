export default function MidiTrackList({ tracks, disabled, onToggleMute }) {
  if (tracks.length === 0) {
    return (
      <p className="midi-tracks__empty">No tracks in this MIDI file.</p>
    )
  }

  return (
    <ul className="midi-tracks">
      {tracks.map((track) => (
        <li key={track.id} className="midi-tracks__item">
          <label className="midi-tracks__label">
            <input
              type="checkbox"
              checked={!track.muted}
              disabled={disabled}
              onChange={(event) => onToggleMute(track.id, !event.target.checked)}
            />
            <span className="midi-tracks__name">{track.name}</span>
            <span className="midi-tracks__meta">{track.noteCount} notes</span>
          </label>
        </li>
      ))}
    </ul>
  )
}
