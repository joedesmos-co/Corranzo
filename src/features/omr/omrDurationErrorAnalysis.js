/**
 * Categorize OMR duration mismatches for benchmark diagnostics.
 */

export const DURATION_ERROR_CATEGORY = {
  TOO_SHORT: 'too-short',
  TOO_LONG: 'too-long',
  BEAMED_SUBDIVISION: 'beamed-subdivision',
  BASS_SUSTAIN: 'bass-sustain',
  MELODY_ACCOMPANIMENT: 'melody-accompaniment',
  REST_GAP: 'rest-gap',
  TIE_SUSTAIN: 'tie-sustain',
  ONSET_COUPLED: 'onset-coupled',
  OTHER: 'other',
}

export function categorizeDurationError(entry) {
  const truthDur = Number(entry.truth?.durationQuarters)
  const genDur = Number(entry.generated?.durationQuarters)
  const signedDelta = genDur - truthDur
  const absDelta = Math.abs(signedDelta)
  const onsetDelta = Math.abs(Number(entry.onsetDiffQuarters) || 0)
  const pitchDelta = Math.abs(Number(entry.pitchDeltaSemitones) || 0)

  if (onsetDelta > 0.2 && pitchDelta <= 1) {
    return DURATION_ERROR_CATEGORY.ONSET_COUPLED
  }

  if (absDelta <= 0.2) {
    return DURATION_ERROR_CATEGORY.OTHER
  }

  if (signedDelta < -0.2) {
    if (truthDur >= 1.5 && genDur <= 1) {
      return DURATION_ERROR_CATEGORY.TOO_SHORT
    }
    if (truthDur >= 1.5 && genDur < truthDur * 0.6) {
      const truthLabel = entry.truth?.label ?? ''
      const genLabel = entry.generated?.label ?? ''
      const truthOctave = parseInt(truthLabel.match(/\d+/)?.[0] ?? '4', 10)
      const genOctave = parseInt(genLabel.match(/\d+/)?.[0] ?? '4', 10)
      if (truthOctave <= 3 || genOctave <= 3) {
        return DURATION_ERROR_CATEGORY.BASS_SUSTAIN
      }
      return DURATION_ERROR_CATEGORY.MELODY_ACCOMPANIMENT
    }
    return DURATION_ERROR_CATEGORY.TOO_SHORT
  }

  if (truthDur <= 0.5 && genDur > truthDur) {
    return DURATION_ERROR_CATEGORY.BEAMED_SUBDIVISION
  }
  if (genDur >= 1.5 && truthDur <= 1) {
    return DURATION_ERROR_CATEGORY.TOO_LONG
  }
  return DURATION_ERROR_CATEGORY.TOO_LONG
}

export function summarizeDurationErrors(wrongDurations = []) {
  const histogram = Object.fromEntries(
    Object.values(DURATION_ERROR_CATEGORY).map((category) => [category, 0]),
  )
  for (const entry of wrongDurations) {
    histogram[categorizeDurationError(entry)] += 1
  }
  return histogram
}
