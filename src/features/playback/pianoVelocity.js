/**
 * Map raw MIDI/MusicXML velocity (0–1) to playback gain with a piano-like
 * curve that preserves dynamic ordering (pp < p < mp < mf < f < ff).
 *
 * Audio-renderer only — does not alter Playback Semantics velocities.
 *
 * The exponent was widened from 1.22 to 1.7 after measuring the rendered
 * output: an 8-note fff chord peaked at 0.21 against a -3.5 dB limiter
 * (0.67), so there was more than 3x unused headroom while pp→fff spanned
 * only ~7.5 dB. A real piano spans roughly 20 dB over the same written
 * range, so soft notes were being flattened into the middle of the scale
 * instead of sitting quiet behind the loud ones. 1.7 spreads pp→fff to
 * ~15 dB and keeps every existing ordering assertion.
 */
export function mapPlaybackVelocity(velocity) {
  const value = typeof velocity === 'number' ? velocity : 0.72
  const clamped = Math.min(1, Math.max(0, value))
  // Wider exponent keeps soft notes audible without flattening ff.
  const shaped = clamped ** 1.7 * 0.95
  return Math.min(0.92, Math.max(0.12, shaped))
}
