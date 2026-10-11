/**
 * Spectral-flatness noise gate (Step 5, NEW domain) — pure + testable.
 *
 * ENERGY-based approaches all failed against noisy rooms: any RMS floor
 * high enough to block 0.016-RMS room tone also blocks pp playing
 * (measured: pp attack polls peak 0.024, and at 6 dB SNR the mix is
 * itself ~0.016 RMS). Flatness is a SHAPE metric instead:
 *
 *   flatness = geometric mean(power spectrum) / arithmetic mean(...)
 *
 * Broadband noise is spectrally FLAT (room tone measured 0.508-0.625
 * across every frame); harmonic music is PEAKY (clean notes <= 0.024,
 * speech <= 6e-6). Separates by 20x, in a different domain from every
 * previously rejected experiment.
 *
 * FAIL-OPEN by construction: the gate only ever SKIPS INFERENCE for
 * audio that is flat. If flatness dips below the threshold, the old
 * behavior runs. Music mixed with noise stays inferrable down to
 * measured -3 dB SNR (0.438, 9% margin below the threshold); the gate
 * degrades to the old behavior rather than suppressing playing.
 *
 * Sustained-note decays cannot trip it: activation frames are peaky and
 * re-arm immediately (same tail-all rule as the silence skip, opposite
 * direction). Silence returns 0 (not flat) — the RMS floor owns silence.
 */
export const FLATNESS_SKIP_THRESHOLD = 0.48
export const FLATNESS_SKIP_FRAMES = 5
/** Spectrum below this frequency (rumble/handling) is excluded. */
export const FLATNESS_MIN_HZ = 60
/**
 * Bins more than this many dB below the spectrum's own max carry no
 * measurable energy and are excluded (keeps the metric scale-relative:
 * an analyser reporting its -100 dB floor on every bin would otherwise
 * read as perfectly flat noise).
 */
export const FLATNESS_RELATIVE_FLOOR_DB = 70
/** At/below this peak dB the spectrum is silence, not flat noise. */
export const FLATNESS_SILENCE_DB = -90

/**
 * Spectral flatness from an AnalyserNode dB spectrum
 * (getFloatFrequencyData: Float32Array of dB values). Bins below
 * minHz or more than FLATNESS_RELATIVE_FLOOR_DB under the spectrum max
 * are excluded. Returns 0 when the spectrum is silent (the RMS floor
 * owns silence) or carries too few measurable bins.
 *
 * @param {Float32Array} dbBins
 * @param {number} binWidthHz sampleRate / fftSize
 */
export function spectralFlatnessFromDb(dbBins, binWidthHz) {
  if (!dbBins?.length || !Number.isFinite(binWidthHz) || binWidthHz <= 0) {
    return 0
  }
  let max = -Infinity
  for (let bin = 0; bin < dbBins.length; bin += 1) {
    if (Number.isFinite(dbBins[bin]) && dbBins[bin] > max) {
      max = dbBins[bin]
    }
  }
  if (!Number.isFinite(max) || max <= FLATNESS_SILENCE_DB) {
    return 0
  }
  const fromBin = Math.max(1, Math.ceil(FLATNESS_MIN_HZ / binWidthHz))
  const cutoff = max - FLATNESS_RELATIVE_FLOOR_DB
  let sumLog = 0
  let sum = 0
  let count = 0
  for (let bin = fromBin; bin < dbBins.length; bin += 1) {
    const db = dbBins[bin]
    if (!Number.isFinite(db) || db < cutoff) {
      continue
    }
    const power = 10 ** (db / 10)
    sumLog += Math.log(power)
    sum += power
    count += 1
  }
  if (count < 8 || sum <= 0) {
    return 0
  }
  const geometric = Math.exp(sumLog / count)
  return geometric / (sum / count)
}

/**
 * Tail-all-flat decision (mirrors shouldSkipSilence, inverted): skip
 * inference only when the last `frames` flatness readings ALL sit above
 * `threshold` (flat = noise). One peaky frame (an attack) re-arms
 * immediately, so attacks are never gated.
 */
export function shouldSkipFlatNoise(
  recentFlatness = [],
  threshold = FLATNESS_SKIP_THRESHOLD,
  frames = FLATNESS_SKIP_FRAMES,
) {
  if (!Array.isArray(recentFlatness) || recentFlatness.length < frames) {
    return false
  }
  const tail = recentFlatness.slice(-frames)
  return tail.every((value) => Number.isFinite(value) && value >= threshold)
}
