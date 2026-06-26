import MidiTrackList from './MidiTrackList.jsx'

export default function PracticeTracksSection({
  hasMidi,
  tracks,
  disabled,
  onToggleMute,
}) {
  return (
    <section className="practice-section" aria-label="Tracks">
      <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">
        Tracks / hands
      </h3>

      {!hasMidi ? (
        <p className="practice-section__hint">
          Track controls appear when a playback file is loaded.
        </p>
      ) : (
        <div className="practice-section__body practice-section__body--flat">
          <p className="practice-section__hint practice-section__hint--inline">
            Mute tracks to practice one hand at a time.
          </p>
          <MidiTrackList
            tracks={tracks}
            disabled={disabled}
            onToggleMute={onToggleMute}
          />
        </div>
      )}
    </section>
  )
}
