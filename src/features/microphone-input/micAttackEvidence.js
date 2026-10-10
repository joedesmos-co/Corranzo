/**
 * Per-note attack evidence (M1) — pure + testable, no audio APIs.
 *
 * The neural model emits note candidates WITHOUT confidence or onset
 * strength, so confirmation cannot tell an independently struck note
 * from a harmonic ghost by timing alone (measured negatives: energy,
 * span-ratio, union-persistence and generic flux-admission vetoes all
 * overlap true notes — see harmonicGhostVetoes docstring). This module
 * derives INDEPENDENT evidence from capture-ring audio:
 *
 * - spectral flux envelope (HF-difference onset bursts),
 * - attack snapshots: 88-pitch Goertzel band energies captured at each
 *   flux peak (i.e. "which pitches were present when someone struck"),
 * - attack-presence query: was this pitch energized at any recent
 *   attack (the discriminator that saves late-detected true notes hot
 *   while vetoing decay-phase confabulation that never sounded).
 *
 * Live and scorer paths MUST use the same functions + constants so the
 * frozen benchmarks validate the shipped behavior exactly.
 */

export const ATTACK_EVIDENCE = {
  /** Flux frame length (5 ms at any rate). */
  fluxFrameSeconds: 0.005,
  /** HF emphasis gain inside the log flux. */
  fluxHfGain: 50,
  /** Peak search radius around a candidate onset. */
  fluxWindowMs: 60,
  /** Absolute raw-flux floor: below this no attack context exists
   * (measured: room tone peaks 0.026, pp attack peaks 0.059). */
  fluxContextFloor: 0.04,
  /** Trailing context for flux normalization (10 s). */
  fluxContextSeconds: 10,
  /** Goertzel window for band snapshots (~186 ms @44.1 kHz). */
  bandWindowSeconds: 0.186,
  /**
   * Snapshot band window starts this far AFTER the flux peak. The pick
   * burst itself is broadband (every pitch reads energy at every pick),
   * so bands are measured on the harmonic ring that follows, not the
   * transient. Measured: centering on the pick contaminates the Eb4 bin
   * to 63% of peak via the E4 pick burst.
   */
  bandDelaySeconds: 0.04,
  /** Flux peaks above this start a snapshot (measured: soft E2 pick
   * peaks ~0.03-0.05; room tone max 0.026 — snapshots in pure noise are
   * harmless: flat bands anchor nothing). */
  snapshotPeakThreshold: 0.025,
  /** Lowest/highest snapshot pitch. */
  bandLoMidi: 21,
  bandHiMidi: 108,
  /** Attack snapshots retained (matches the 4 s confirm retention). */
  snapshotRetentionSeconds: 4.0,
  /** Presence looks back this far for an attack containing the pitch. */
  presenceWindowSeconds: 4.0,
}

export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function goertzelAt(samples, start, length, sampleRate, freq) {
  const end = Math.min(start + length, samples.length)
  const n = end - start
  if (n <= 0) {
    return 0
  }
  const omega = (2 * Math.PI * freq) / sampleRate
  const coeff = 2 * Math.cos(omega)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  for (let i = start; i < end; i += 1) {
    s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  return Math.sqrt(Math.max(power, 0)) / n
}

/**
 * Spectral-flux envelope over mono samples. Returns { flux, frameHop,
 * sampleRate }: flux[f] is the positive log HF-energy increase at
 * frame f (5 ms frames). Raw (unnormalized) units — callers normalize
 * against trailing context (fluxAtMs) so room tone can never inflate
 * itself (measured room peak 0.026 vs pp attack 0.059).
 */
export function computeFluxEnvelope(samples, sampleRate) {
  const frameHop = Math.max(1, Math.floor(sampleRate * ATTACK_EVIDENCE.fluxFrameSeconds))
  const count = Math.floor(samples.length / frameHop)
  const hf = new Float32Array(count)
  for (let f = 0; f < count; f += 1) {
    let energy = 0
    let prev = 0
    const start = f * frameHop
    const end = Math.min(start + frameHop, samples.length)
    for (let i = start; i < end; i += 1) {
      const diff = samples[i] - prev
      energy += diff * diff
      prev = samples[i]
    }
    hf[f] = Math.sqrt(energy / Math.max(end - start, 1))
  }
  const flux = new Float32Array(count)
  for (let f = 1; f < count; f += 1) {
    flux[f] = Math.max(
      0,
      Math.log1p(hf[f] * ATTACK_EVIDENCE.fluxHfGain) - Math.log1p(hf[f - 1] * ATTACK_EVIDENCE.fluxHfGain),
    )
  }
  return { flux, frameHop, sampleRate }
}

/**
 * Normalized attack flux at timeMs (0..1): peak raw flux within
 * ±fluxWindowMs divided by the trailing-context max. Returns 0 when no
 * attack context exists (trailing max below fluxContextFloor) — silence
 * and decay-phase audio report no attack evidence, never inflated
 * self-normalization.
 *
 * @param envelope from computeFluxEnvelope
 * @param timeMs candidate onset in the SAME clock as bufferStartMs
 * @param bufferStartMs capture time of samples[0]
 */
export function fluxAtMs(envelope, timeMs, bufferStartMs = 0) {
  const { flux, frameHop, sampleRate } = envelope
  if (!flux?.length) {
    return 0
  }
  const toFrame = (ms) => Math.round((((ms - bufferStartMs) / 1000) * sampleRate) / frameHop)
  const center = toFrame(timeMs)
  const radius = Math.max(1, Math.round(ATTACK_EVIDENCE.fluxWindowMs / (ATTACK_EVIDENCE.fluxFrameSeconds * 1000)))
  let peak = 0
  for (let f = Math.max(1, center - radius); f <= Math.min(flux.length - 1, center + radius); f += 1) {
    if (flux[f] > peak) {
      peak = flux[f]
    }
  }
  const contextFrames = Math.floor(ATTACK_EVIDENCE.fluxContextSeconds / ATTACK_EVIDENCE.fluxFrameSeconds)
  let trailingMax = 0
  for (let f = Math.max(1, center - contextFrames); f <= Math.min(flux.length - 1, center + radius); f += 1) {
    if (flux[f] > trailingMax) {
      trailingMax = flux[f]
    }
  }
  if (!(trailingMax >= ATTACK_EVIDENCE.fluxContextFloor)) {
    return 0
  }
  return Math.min(1, peak / trailingMax)
}

/**
 * Capture attack snapshots from an envelope: every flux peak above
 * peakThreshold (raw units) becomes { timeMs, bands } with Goertzel
 * magnitudes for bandLoMidi..bandHiMidi measured on the raw samples.
 * Snapshots older than snapshotRetentionSeconds (relative to nowMs)
 * are dropped. Pure: pass previous snapshots to continue a session.
 */
export function captureAttackSnapshots({
  samples,
  sampleRate,
  envelope,
  bufferStartMs = 0,
  nowMs = null,
  previous = [],
  peakThreshold = ATTACK_EVIDENCE.snapshotPeakThreshold,
} = {}) {
  const { flux, frameHop } = envelope
  const toMs = (f) => bufferStartMs + ((f * frameHop) / sampleRate) * 1000
  const windowLen = Math.min(samples.length, Math.floor(sampleRate * ATTACK_EVIDENCE.bandWindowSeconds))
  const delaySamples = Math.floor(sampleRate * ATTACK_EVIDENCE.bandDelaySeconds)
  const snapshots = [...previous]
  // Local-maximum peak picking above threshold, 30 ms refractory.
  const refractory = Math.max(1, Math.round(0.03 / ATTACK_EVIDENCE.fluxFrameSeconds))
  let lastPeak = -Infinity
  for (let f = 1; f < flux.length - 1; f += 1) {
    if (flux[f] >= peakThreshold && flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && f - lastPeak > refractory) {
      lastPeak = f
      const ringStart = f * frameHop + delaySamples
      const start = Math.max(0, Math.min(samples.length - windowLen, Math.round(ringStart)))
      const bands = new Float32Array(ATTACK_EVIDENCE.bandHiMidi - ATTACK_EVIDENCE.bandLoMidi + 1)
      for (let midi = ATTACK_EVIDENCE.bandLoMidi; midi <= ATTACK_EVIDENCE.bandHiMidi; midi += 1) {
        bands[midi - ATTACK_EVIDENCE.bandLoMidi] = goertzelAt(samples, start, windowLen, sampleRate, midiToFrequency(midi))
      }
      snapshots.push({ timeMs: toMs(f), peak: flux[f], bands })
    }
  }
  const cutoff = (nowMs ?? toMs(flux.length - 1)) - ATTACK_EVIDENCE.snapshotRetentionSeconds * 1000
  return snapshots.filter((snapshot) => snapshot.timeMs >= cutoff)
}

/**
 * Harmonic-comb attack presence: summed band energy across the pitch's
 * harmonic series (f0 x1..x4), each normalized by the snapshot's peak
 * band, best snapshot within presenceWindowSeconds before timeMs.
 *
 * Single-bin presence INVERTS in mixes (a loud neighbor partial's skirt
 * swamps weak fundamentals: Eb4 read 63% from E4's 330 Hz skirt while
 * E2's own 82 Hz read 6%). The comb requires the pitch's SERIES to have
 * sounded: true notes score high even when delimited late; decay-phase
 * confabulation (never present at any attack) scores ~0. Octave ghosts
 * score high (their series is the parent's even partials) — they are
 * NOT this veto's target (see V2 sustain-divergence).
 *
 * Returns { presence (0..~4), snapshotAgeMs }.
 */
export function attackCombPresence(snapshots, midi, timeMs, harmonics = 4) {
  const base = Math.round(midi)
  let best = 0
  let bestAge = null
  for (const snapshot of snapshots ?? []) {
    const age = timeMs - snapshot.timeMs
    if (!(age >= 0) || age > ATTACK_EVIDENCE.presenceWindowSeconds * 1000) {
      continue
    }
    let peak = 0
    for (let i = 0; i < snapshot.bands.length; i += 1) {
      if (snapshot.bands[i] > peak) {
        peak = snapshot.bands[i]
      }
    }
    if (peak <= 0) {
      continue
    }
    let comb = 0
    for (let h = 1; h <= harmonics; h += 1) {
      const harmonicMidi = base + 12 * Math.log2(h)
      const lo = Math.floor(harmonicMidi)
      const hi = Math.ceil(harmonicMidi)
      let energy = 0
      for (let m = lo; m <= hi; m += 1) {
        const index = m - ATTACK_EVIDENCE.bandLoMidi
        if (index >= 0 && index < snapshot.bands.length && snapshot.bands[index] > energy) {
          energy = snapshot.bands[index]
        }
      }
      comb += energy / peak
    }
    if (comb > best) {
      best = comb
      bestAge = age
    }
  }
  return { presence: best, snapshotAgeMs: bestAge }
}
