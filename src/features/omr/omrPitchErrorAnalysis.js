/**
 * Categorize OMR pitch mismatches for benchmark diagnostics.
 */

export const PITCH_ERROR_CATEGORY = {
  ACCIDENTAL: '±1-accidental',
  DIATONIC_STEP: '±2-diatonic',
  OCTAVE: '±octave',
  OCTAVE_OTHER: '±octave-other',
  OTHER: 'other',
}

export function categorizePitchDeltaSemitones(delta) {
  const magnitude = Math.abs(Number(delta) || 0)
  if (magnitude === 1) {
    return PITCH_ERROR_CATEGORY.ACCIDENTAL
  }
  if (magnitude === 2) {
    return PITCH_ERROR_CATEGORY.DIATONIC_STEP
  }
  if (magnitude === 12 || magnitude === 24 || magnitude === 36) {
    return PITCH_ERROR_CATEGORY.OCTAVE
  }
  if (magnitude % 12 === 0 && magnitude >= 12) {
    return PITCH_ERROR_CATEGORY.OCTAVE_OTHER
  }
  return PITCH_ERROR_CATEGORY.OTHER
}

export function summarizePitchErrors(wrongPitches = []) {
  const histogram = Object.fromEntries(
    Object.values(PITCH_ERROR_CATEGORY).map((category) => [category, 0]),
  )
  const signed = {}
  for (const entry of wrongPitches) {
    const delta = Number(entry.pitchDeltaSemitones) || 0
    const category = categorizePitchDeltaSemitones(delta)
    histogram[category] += 1
    const key = String(delta)
    signed[key] = (signed[key] ?? 0) + 1
  }
  return {
    total: wrongPitches.length,
    histogram,
    signed,
    sample: wrongPitches.slice(0, 40).map((entry) => ({
      m: entry.measureNumber,
      d: entry.pitchDeltaSemitones,
      truth: entry.truth?.label ?? null,
      gen: entry.generated?.label ?? null,
    })),
  }
}
