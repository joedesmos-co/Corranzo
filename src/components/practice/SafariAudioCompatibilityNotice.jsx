/**
 * Shown when isSafariPlaybackLimited() is true (caller responsibility).
 */
export default function SafariAudioCompatibilityNotice({ className = '' }) {
  return (
    <div
      className={`practice-safari-audio-notice${className ? ` ${className}` : ''}`}
      role="status"
    >
      <p className="practice-safari-audio-notice__lead">
        <strong>Chrome or Edge recommended</strong> for MIDI playback and backing sound.
      </p>
      <p className="practice-safari-audio-notice__hint">
        Safari is great for reading the score, annotations, measure navigation, and Wait For You
        with <strong>Manual continue</strong>. Microphone input may work but is less predictable
        than on Chrome.
      </p>
    </div>
  )
}
