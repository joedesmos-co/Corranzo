export default function MetronomeBeatIndicator({ display, disabled = false }) {
  if (disabled || !display) {
    return null
  }

  const beatsPerMeasure = display.beatsPerMeasure ?? 4
  const slots = Array.from({ length: beatsPerMeasure }, (_, index) => index + 1)
  const activeBeat = display.beat
  const isCountIn = display.phase === 'count-in'

  return (
    <div
      className={`metronome-beat-indicator${isCountIn ? ' metronome-beat-indicator--count-in' : ''}`}
      aria-live="polite"
      aria-label={
        isCountIn
          ? `Count-in beat ${activeBeat ?? ''}`
          : `Metronome beat ${activeBeat ?? ''}`
      }
    >
      {isCountIn && (
        <span className="metronome-beat-indicator__status">Count-in</span>
      )}
      <div className="metronome-beat-indicator__beats" role="list">
        {slots.map((beatNumber) => {
          const isActive = activeBeat === beatNumber
          const isDownbeat = beatNumber === 1
          return (
            <span
              key={beatNumber}
              role="listitem"
              className={[
                'metronome-beat-indicator__beat',
                isActive ? 'metronome-beat-indicator__beat--active' : '',
                isDownbeat ? 'metronome-beat-indicator__beat--downbeat' : '',
                isActive && display.accent ? 'metronome-beat-indicator__beat--accent' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {beatNumber}
            </span>
          )
        })}
      </div>
    </div>
  )
}
