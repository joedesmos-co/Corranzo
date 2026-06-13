/**
 * Informational note for Safari-family browsers (including iPad).
 * Playback works after a tap unlocks audio; Web MIDI is the one gap.
 */
export default function SafariAudioCompatibilityNotice({ className = '' }) {
  return (
    <div
      className={`practice-safari-audio-notice${className ? ` ${className}` : ''}`}
      role="status"
    >
      <p className="practice-safari-audio-notice__lead">
        <strong>Safari tip:</strong> press Play once to unlock sound — playback and the metronome
        work after that first tap.
      </p>
      <p className="practice-safari-audio-notice__hint">
        Web MIDI keyboards are not available on Safari. For Wait For You, use the microphone or
        <strong> Manual continue</strong>; on a Mac, Chrome and Edge also support MIDI keyboards.
      </p>
    </div>
  )
}
