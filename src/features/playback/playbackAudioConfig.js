/**
 * Playback audio graph defaults and one-time Web Audio tuning.
 * Scheduling/timing is unchanged — this only shapes tone, headroom, and latency.
 */

/** Peak trigger velocity after the playback softening curve. */
export const MAX_SAFE_TRIGGER_VELOCITY = 0.92

/** Hear It waits for sampled voice decode (matches main playback readiness). */
export const REFERENCE_PLAYBACK_READINESS_MS = 12000

/** Main playback waits up to this long for samples before starting on synth. */
export const PLAY_READY_TIMEOUT_MS = 12000

/** Raw velocity input for Hear It before mapPlaybackVelocity. */
export const REFERENCE_VELOCITY_INPUT = 0.62

/** Gentle lowpass on the sampler path — tames pitch-shift harshness. */
export const SAMPLER_WARMTH_FILTER_HZ = 7200

/** Shared master FX defaults for sampled instrument voices. */
export const PLAYBACK_MASTER_FX = {
  reverbDecay: 2.15,
  reverbWet: 0.09,
  trimGain: 0.72,
  samplerWarmthHz: SAMPLER_WARMTH_FILTER_HZ,
  compressorThreshold: -22,
  compressorRatio: 2.0,
  compressorAttack: 0.008,
  compressorRelease: 0.18,
  compressorKnee: 12,
  limiterDb: -3.5,
}

let configured = false

/**
 * Tighten Tone's clock lookahead once audio is unlocked — lower perceived
 * latency for scheduled notes without changing score-time math.
 */
export function configurePlaybackAudioContext(tone) {
  if (configured || !tone?.getContext) {
    return
  }
  configured = true
  try {
    const context = tone.getContext()
    if (typeof context.lookAhead === 'number') {
      context.lookAhead = 0.05
    }
    if (typeof context.updateInterval === 'number') {
      context.updateInterval = 0.03
    }
  } catch {
    // Non-fatal — defaults still work.
  }
}

/** Test-only reset. */
export function __resetPlaybackAudioConfigForTests() {
  configured = false
}
