/**
 * Harmonic-sibling consolidation.
 *
 * The pitch model reports note FRAMES per pitch bin. A real note excites its
 * own bin AND, through harmonic leakage, the bins an octave (and a twelfth)
 * above it. When both cross the reporting threshold the score gets two notes
 * where the instrument played one: the fundamental and a spurious sibling.
 *
 * Measured on two dense GuitarSet performances (scripts/audio-vision-pitch-evidence.mjs):
 * of 151 wrong-pitch notes, 114 (75 %) had the reference pitch ALSO reported at
 * the same moment - they are extra harmonic siblings, not substitutions. And in
 * 97 of the 151 the model's own probability matrix already gave the reference
 * pitch the higher value: the evidence to collapse them is present.
 *
 * Two independent pieces of evidence decide which of a pair is the real note:
 *
 *   model strength    the model's reported amplitude for the note
 *   spectral evidence the audio's harmonic salience at the pitch, from the
 *                     actual samples (fundamental + harmonics, odd harmonics
 *                     weighted in so an octave cannot masquerade as a
 *                     fundamental)
 *
 * A note is removed only when it is weaker on BOTH - it is the sibling. A real
 * octave doubling (a guitarist playing E2 and E4 together) is loud in both and
 * is kept. The melody (highest) and the bass (lowest) of an onset are never
 * removed, so the line and the root cannot be eaten by the rule.
 */

const HARMONIC_INTERVALS = new Set([12, 24]) // octave, two octaves
const FIFTH_PLUS_OCTAVE = 19 // a twelfth: also harmonic leakage, stronger in the model

/**
 * Harmonic salience of a pitch in a short window: Hann-windowed magnitude at
 * f0 and its first harmonics, weighted so the fundamental and the third
 * harmonic dominate (that is what separates a note from its octave).
 */
export function harmonicSalience(samples, sampleRate, startSeconds, midi, { harmonics = 6, windowSeconds = 0.09, preRollSeconds = 0.01 } = {}) {
  if (!samples?.length || !Number.isFinite(startSeconds) || !Number.isFinite(midi)) return 0
  const f0 = 440 * 2 ** ((midi - 69) / 12)
  if (f0 <= 0 || f0 >= sampleRate / 2) return 0
  const from = Math.max(0, Math.round((startSeconds - preRollSeconds) * sampleRate))
  const length = Math.min(Math.floor(windowSeconds * sampleRate), samples.length - from)
  if (length < 256) return 0
  let total = 0
  for (let h = 1; h <= harmonics; h += 1) {
    const freq = f0 * h
    if (freq >= sampleRate / 2) break
    const omega = (2 * Math.PI * freq) / sampleRate
    let real = 0
    let imag = 0
    for (let i = 0; i < length; i += 1) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1))
      const value = samples[from + i] * w
      real += value * Math.cos(omega * i)
      imag -= value * Math.sin(omega * i)
    }
    const magnitude = Math.sqrt(real * real + imag * imag) / Math.max(1, length / 2)
    total += magnitude / (h === 1 ? 0.6 : h)
  }
  return total
}

function onsetSeconds(note, timeOf) {
  return timeOf ? timeOf(note) : (note.startSeconds ?? note.seconds ?? note.timeSeconds ?? 0)
}

/**
 * Cluster notes that sound together. A rounding grid is not enough: the model
 * often reports a fundamental and its sibling a few milliseconds apart, which
 * can straddle a grid boundary and hide the pair. Notes join a cluster when
 * they start within `tolerance` of the cluster's first onset.
 */
function clusterByOnset(notes, timeOf, tolerance = 0.03) {
  const sorted = [...notes].sort((a, b) => onsetSeconds(a, timeOf) - onsetSeconds(b, timeOf))
  const clusters = []
  for (const note of sorted) {
    const seconds = onsetSeconds(note, timeOf)
    const last = clusters[clusters.length - 1]
    if (last && seconds - last.at <= tolerance) last.notes.push(note)
    else clusters.push({ at: seconds, notes: [note] })
  }
  return clusters
}

/**
 * Drop harmonic siblings that are weaker on both the model's amplitude and the
 * audio's harmonic salience.
 *
 * `notes` need `midi`, `startSeconds` (or a `timeOf`), and `amplitude`.
 * Returns fresh arrays; the input notes are never mutated.
 */
export function dropHarmonicSiblings(notes, {
  samples = null,
  sampleRate = 22050,
  timeOf = null,
  enabled = true,
  amplitudeRatio = 0.85,
  salienceRatio = 0.85,
  includeTwelfth = true,
  salienceOf = null,
} = {}) {
  const list = Array.isArray(notes) ? notes : []
  if (!enabled || list.length < 2) return { notes: [...list], removed: 0, dropped: [], reason: 'disabled' }
  // Cluster simultaneous notes so only notes that sound together compete.
  const groups = clusterByOnset(list, timeOf)
  const salienceCache = new Map()
  const salience = (note) => {
    const midi = Math.round(note.midi)
    const seconds = timeOf ? timeOf(note) : (note.startSeconds ?? note.seconds ?? 0)
    const cacheKey = `${midi}@${Math.round(seconds * 100) / 100}`
    if (salienceCache.has(cacheKey)) return salienceCache.get(cacheKey)
    const value = salienceOf
      ? salienceOf(note)
      : (samples ? harmonicSalience(samples, sampleRate, seconds, midi) : 0)
    salienceCache.set(cacheKey, value)
    return value
  }
  const removed = []
  const kept = []
  for (const cluster of groups) {
    const group = cluster.notes
    if (group.length < 2) { kept.push(...group); continue }
    const sorted = [...group].sort((a, b) => b.midi - a.midi)
    // The melody (top) and the bass (bottom) are protected only when there is
    // an INNER voice to remove. In a two-note onset both notes are the
    // extremes, and the evidence has to decide: a real octave doubling is
    // loud in both and survives, a harmonic leak is weak in both and goes.
    const protectExtremes = sorted.length >= 3
    const melody = protectExtremes ? sorted[0] : null
    const bass = protectExtremes ? sorted[sorted.length - 1] : null
    const drop = new Set()
    for (let i = 0; i < sorted.length; i += 1) {
      const upper = sorted[i]
      if (drop.has(upper)) continue
      for (let j = i + 1; j < sorted.length; j += 1) {
        const lower = sorted[j]
        if (drop.has(lower)) continue
        const interval = Math.round(upper.midi) - Math.round(lower.midi)
        if (!HARMONIC_INTERVALS.has(interval) && !(includeTwelfth && interval === FIFTH_PLUS_OCTAVE)) continue
        // Never remove the melody or the bass of the onset.
        if (upper === melody || lower === bass) continue
        const upperAmplitude = Number(upper.amplitude ?? upper.strength ?? 0)
        const lowerAmplitude = Number(lower.amplitude ?? lower.strength ?? 0)
        const upperSalience = salience(upper)
        const lowerSalience = salience(lower)
        // The sibling is the one that is weaker on BOTH pieces of evidence.
        const upperIsSibling = upperAmplitude <= lowerAmplitude * amplitudeRatio && upperSalience <= lowerSalience * salienceRatio
        const lowerIsSibling = lowerAmplitude <= upperAmplitude * amplitudeRatio && lowerSalience <= upperSalience * salienceRatio
        if (upperIsSibling && !lowerIsSibling) { drop.add(upper); break }
        if (lowerIsSibling && !upperIsSibling) drop.add(lower)
      }
    }
    for (const note of group) {
      if (drop.has(note)) removed.push(note)
      else kept.push(note)
    }
  }
  kept.sort((a, b) => onsetSeconds(a, timeOf) - onsetSeconds(b, timeOf) || a.midi - b.midi)
  return { notes: kept, removed: removed.length, dropped: removed }
}
