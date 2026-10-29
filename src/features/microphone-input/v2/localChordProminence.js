/**
 * Score-conditioned LOCAL chord-tone prominence (research → production).
 *
 * The normal chord scorer uses a 2048-sample window and a global noise floor.
 * A quiet chord tone can be genuinely present as a stable local spectral peak
 * yet sit below that global floor (measured: UIowa C-major E4 fundamental
 * 0.0065 vs floor 0.0080 at 2048, but a 21x local peak at 8192).
 *
 * This module does NOT treat an expected score note as evidence. It selects
 * an undetected expected tone only as a probe target, then requires:
 *   - at least one other expected tone strongly detected in the same frame,
 *   - a long-window (8192) fundamental that is a strong local peak against
 *     nearby semitone probes and above an absolute magnitude floor,
 *   - no integer-harmonic relationship to a strong detected peer,
 *   - no strong subharmonic energy (f/2, f/3, f/4) that would explain the
 *     peak as a harmonic of a lower sounding note (octave/ghost guard).
 *
 * Measured separation on existing rights-cleared clips (8192, 400 ms):
 *   true weak tones: UIowa C-major E4 21.7x, Cmaj7 E4 24.3x, Cmaj7 C4 88x
 *   false families:  transposed jazz 1.0-1.7x, eg08 0.2-0.7x,
 *                    Cmaj7-expectation B4 on C triad 0.8-1.2x,
 *                    C4+G4 expecting E4 0.6-2.0x, noise 1.0-1.2x
 *   octave ghost C5 on C4: 288x local but blocked by the C4 subharmonic.
 *
 * The rescue is deliberately bounded to incomplete chords with a strong peer;
 * it never scans blind pitches and never lowers the normal detection floor.
 */

import { midiToFrequency } from '../micSyntheticClips.js'
import {
  goertzelMagnitude,
  hannWindow,
  SPECTRAL_NOISE_FLOOR_ABSOLUTE_MIN,
} from './micSpectralAnalysis.js'

export const LOCAL_PROMINENCE_DEFAULTS = Object.freeze({
  windowSamples: 8192,
  minProminence: 6,
  minPeakRatio: 1.3,
  // Measured true weak tone (Vienna Schubert A3) 0.00081; false families
  // (C4+G4 expecting E4, transposed dyads, noise) 0.00004-0.00013.
  minFundamentalMagnitude: 0.0007,
  // Strong peer means "the chord is present", not "a second note is loud".
  // Measured true Schubert companions 1.6-2.2 ratio / 0.30-0.47 confidence;
  // the local/subharmonic guards remain the actual false-tone discriminator.
  minStrongPeerRatio: 1.6,
  minStrongPeerConfidence: 0.3,
  probeSemitones: Object.freeze([-2.5, -2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2, 2.5]),
  subharmonicDivisors: Object.freeze([2, 3, 4]),
  subharmonicLocalMultiple: 2,
  subharmonicFundamentalRatio: 0.25,
  maxIntegerHarmonic: 8,
  integerHarmonicTolerance: 0.06,
})

const windowCache = new Map()
// Reused long-window scratch. The rescue is synchronous and single-threaded;
// this avoids a fresh 32 KB Float32Array on every incomplete chord frame while
// preserving the exact sample*window products and Goertzel inputs.
let windowedScratch = new Float32Array(0)

function cachedHann(size) {
  if (!windowCache.has(size)) {
    windowCache.set(size, hannWindow(size))
  }
  return windowCache.get(size)
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function isIntegerHarmonicOf(frequency, peerFrequency, options = {}) {
  if (!(frequency > 0) || !(peerFrequency > 0)) return false
  const ratio = frequency / peerFrequency
  const maxHarmonic = options.maxIntegerHarmonic ?? LOCAL_PROMINENCE_DEFAULTS.maxIntegerHarmonic
  const tolerance = options.integerHarmonicTolerance ??
    LOCAL_PROMINENCE_DEFAULTS.integerHarmonicTolerance
  for (let harmonic = 2; harmonic <= maxHarmonic; harmonic += 1) {
    if (Math.abs(ratio - harmonic) <= tolerance) {
      return true
    }
  }
  return false
}

/**
 * @param {object} options
 * @param {Float32Array|number[]} options.samples full live capture buffer
 * @param {number} options.sampleRate
 * @param {Array} options.notes scored expected notes from the normal pass
 * @param {number[]} options.expectedMidis
 * @returns {{ notes: Array, rescuedMidis: number[] }}
 */
export function applyLocalChordProminenceRescue({
  samples,
  sampleRate,
  notes = [],
  expectedMidis = [],
  options = {},
} = {}) {
  const settings = { ...LOCAL_PROMINENCE_DEFAULTS, ...options }
  if (
    settings.enabled === false ||
    !samples?.length ||
    !sampleRate ||
    expectedMidis.length < 2 ||
    notes.length < 2
  ) {
    return { notes, rescuedMidis: [] }
  }
  if (notes.every((note) => note.detected)) {
    return { notes, rescuedMidis: [] }
  }

  const strongPeers = notes.filter(
    (note) =>
      note.detected &&
      (note.ratio ?? 0) >= settings.minStrongPeerRatio &&
      (note.confidence ?? 0) >= settings.minStrongPeerConfidence,
  )
  if (!strongPeers.length) {
    return { notes, rescuedMidis: [] }
  }

  const size = Math.min(
    settings.windowSamples,
    samples.length,
  )
  if (size < Math.floor(settings.windowSamples * 0.8)) {
    return { notes, rescuedMidis: [] }
  }
  const tail = samples.length > size
    ? samples.subarray(samples.length - size)
    : samples
  const hann = cachedHann(size)
  if (windowedScratch.length !== size) {
    windowedScratch = new Float32Array(size)
  }
  for (let index = 0; index < size; index += 1) {
    windowedScratch[index] = tail[index] * hann[index]
  }
  const windowed = windowedScratch
  const rescuedMidis = []

  for (const note of notes) {
    if (note.detected) continue
    // The normal pass explicitly vetoed these as octave/deep-bass artifacts;
    // local prominence must not override a harmonic veto.
    if (note.deepBassOctaveArtifact || note.highLowerOctaveArtifact) continue
    const frequency = midiToFrequency(note.midi)
    const fundamental = goertzelMagnitude(windowed, sampleRate, frequency)
    if (!(fundamental >= settings.minFundamentalMagnitude)) continue

    const probes = settings.probeSemitones.map((semitones) =>
      goertzelMagnitude(windowed, sampleRate, frequency * 2 ** (semitones / 12)),
    )
    const localMedian = median(probes)
    const localMax = probes.length ? Math.max(...probes) : 0
    const prominence = fundamental / (localMedian + 1e-12)
    const peakRatio = fundamental / (localMax + 1e-12)
    if (
      prominence < settings.minProminence ||
      peakRatio < settings.minPeakRatio
    ) {
      continue
    }

    if (
      strongPeers.some((peer) =>
        isIntegerHarmonicOf(frequency, midiToFrequency(peer.midi), settings),
      )
    ) {
      continue
    }

    const subFloor = Math.max(
      localMedian * settings.subharmonicLocalMultiple,
      fundamental * settings.subharmonicFundamentalRatio,
      SPECTRAL_NOISE_FLOOR_ABSOLUTE_MIN,
    )
    const subharmonicBlocked = settings.subharmonicDivisors.some((divisor) => {
      const energy = goertzelMagnitude(windowed, sampleRate, frequency / divisor)
      return energy > subFloor && energy > SPECTRAL_NOISE_FLOOR_ABSOLUTE_MIN
    })
    if (subharmonicBlocked) continue

    note.detected = true
    note.detectionSource = 'local-prominence'
    note.localProminenceRescue = true
    note.localProminence = prominence
    note.localPeakRatio = peakRatio
    note.localFundamental = fundamental
    rescuedMidis.push(note.midi)
  }

  return { notes, rescuedMidis }
}
