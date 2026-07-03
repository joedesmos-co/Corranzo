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

/** Root-cause buckets for pitch errors at correct onset (diagnosis only). */
export const PITCH_ROOT_CAUSE = {
  GROUPING_ARTIFACT: 'grouping-artifact',
  STAFF_CLEF_REGISTER: 'staff/clef/register',
  ACCIDENTAL_MISS: 'accidental-miss',
  COURTESY_ACCIDENTAL: 'courtesy-accidental',
  KEY_SIGNATURE: 'key-signature',
  LEDGER_LINE: 'ledger-line',
  DIATONIC_STEP: 'diatonic-step',
  OTHER: 'other',
}

const PITCH_ROOT_CAUSE_ORDER = [
  PITCH_ROOT_CAUSE.GROUPING_ARTIFACT,
  PITCH_ROOT_CAUSE.STAFF_CLEF_REGISTER,
  PITCH_ROOT_CAUSE.ACCIDENTAL_MISS,
  PITCH_ROOT_CAUSE.COURTESY_ACCIDENTAL,
  PITCH_ROOT_CAUSE.KEY_SIGNATURE,
  PITCH_ROOT_CAUSE.LEDGER_LINE,
  PITCH_ROOT_CAUSE.DIATONIC_STEP,
  PITCH_ROOT_CAUSE.OTHER,
]

function parsePitchLabel(label) {
  const match = /^([A-G])([#b]*)(-?\d+)$/.exec(String(label ?? ''))
  if (!match) {
    return null
  }
  const [, step, accidental = '', octaveText] = match
  const sharps = (accidental.match(/#/g) ?? []).length
  const flats = (accidental.match(/b/g) ?? []).length
  return {
    step,
    alter: sharps - flats,
    octave: Number(octaveText),
  }
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

/**
 * Classify a wrong-pitch evaluator row by proven root cause using only fields
 * available in accuracy reports (no piece-specific logic).
 */
export function classifyPitchErrorRootCause(
  entry,
  { onsetToleranceQuarters = 0.08, durationToleranceQuarters = 0.2 } = {},
) {
  const onsetOk = Math.abs(Number(entry.onsetDiffQuarters) || 0) <= onsetToleranceQuarters
  const durationOk = Math.abs(Number(entry.durationDiffQuarters) || 0) <= durationToleranceQuarters
  if (!onsetOk || !durationOk) {
    return PITCH_ROOT_CAUSE.GROUPING_ARTIFACT
  }

  const delta = Number(entry.pitchDeltaSemitones) || 0
  const abs = Math.abs(delta)
  const truth = parsePitchLabel(entry.truth?.label)
  const generated = parsePitchLabel(entry.generated?.label)

  if (abs >= 12 || abs % 12 === 0) {
    return PITCH_ROOT_CAUSE.STAFF_CLEF_REGISTER
  }
  if (abs >= 10) {
    return PITCH_ROOT_CAUSE.STAFF_CLEF_REGISTER
  }

  if (abs === 1 && truth && generated) {
    if (truth.step === generated.step && truth.octave === generated.octave) {
      if (truth.alter !== 0 && generated.alter === 0) {
        return PITCH_ROOT_CAUSE.ACCIDENTAL_MISS
      }
      if (truth.alter === 0 && generated.alter !== 0) {
        return PITCH_ROOT_CAUSE.COURTESY_ACCIDENTAL
      }
      return PITCH_ROOT_CAUSE.ACCIDENTAL_MISS
    }
    return PITCH_ROOT_CAUSE.KEY_SIGNATURE
  }

  if (abs === 2) {
    if (truth && generated && truth.step !== generated.step) {
      return PITCH_ROOT_CAUSE.DIATONIC_STEP
    }
    return PITCH_ROOT_CAUSE.STAFF_CLEF_REGISTER
  }

  if (abs >= 5) {
    return PITCH_ROOT_CAUSE.STAFF_CLEF_REGISTER
  }

  return PITCH_ROOT_CAUSE.OTHER
}

export function summarizePitchErrorRootCauses(
  wrongPitches = [],
  options = {},
) {
  const histogram = Object.fromEntries(
    PITCH_ROOT_CAUSE_ORDER.map((bucket) => [bucket, 0]),
  )
  const atCorrectOnset = []
  for (const entry of wrongPitches) {
    const bucket = classifyPitchErrorRootCause(entry, options)
    histogram[bucket] += 1
    const onsetOk =
      Math.abs(Number(entry.onsetDiffQuarters) || 0) <=
      (options.onsetToleranceQuarters ?? 0.08)
    if (onsetOk) {
      atCorrectOnset.push({ entry, bucket })
    }
  }

  const atOnsetHistogram = Object.fromEntries(
    PITCH_ROOT_CAUSE_ORDER.map((bucket) => [bucket, 0]),
  )
  for (const { bucket } of atCorrectOnset) {
    atOnsetHistogram[bucket] += 1
  }

  const ranked = PITCH_ROOT_CAUSE_ORDER.map((bucket) => ({
    bucket,
    count: histogram[bucket],
  }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count)

  return {
    total: wrongPitches.length,
    atCorrectOnsetCount: atCorrectOnset.length,
    histogram,
    atCorrectOnsetHistogram: atOnsetHistogram,
    ranked,
    primaryRootCause: ranked[0] ?? null,
  }
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
