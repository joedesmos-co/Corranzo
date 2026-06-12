import MidiTrackList from './MidiTrackList.jsx'

export default function PracticeTracksCompactSection({ session }) {
  if (!session.hasMidi) {
    return null
  }

  const { playback } = session

  return (
    <section
      className="practice-section practice-section--compact practice-tracks-compact"
      aria-label="Tracks and hands"
    >
      <h3 className="practice-section__title practice-section__title--static">Tracks / hands</h3>
      <p className="practice-section__hint practice-section__hint--inline">
        Mute a hand while looping the other.
      </p>
      <MidiTrackList
        tracks={playback.tracks}
        disabled={playback.controlsDisabled}
        onToggleMute={session.handleToggleMute}
      />
    </section>
  )
}
