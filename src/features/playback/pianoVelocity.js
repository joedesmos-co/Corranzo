/**
 * Map raw MIDI/MusicXML velocity (0–1) to playback gain with a softer,
 * piano-like curve — wider dynamic range without harsh clipping.
 */
export function mapPlaybackVelocity(velocity) {
  const value = typeof velocity === 'number' ? velocity : 0.72
  const clamped = Math.min(1, Math.max(0, value))
  return Math.min(0.88, Math.max(0.22, clamped ** 1.35 * 0.78 + 0.12))
}
