/**
 * Map raw MIDI/MusicXML velocity (0–1) to playback gain with a piano-like
 * curve that preserves dynamic ordering (pp < p < mp < mf < f < ff).
 *
 * Audio-renderer only — does not alter Playback Semantics velocities.
 */
export function mapPlaybackVelocity(velocity) {
  const value = typeof velocity === 'number' ? velocity : 0.72
  const clamped = Math.min(1, Math.max(0, value))
  // Mild compression keeps soft notes audible without flattening ff.
  const shaped = clamped ** 1.22 * 0.88 + 0.08
  return Math.min(0.92, Math.max(0.12, shaped))
}
