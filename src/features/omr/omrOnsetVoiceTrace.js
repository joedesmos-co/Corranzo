/**
 * Per-measure onset / voice-phase trace for OMR benchmark diagnosis.
 * Diagnostic only — no detection or matcher logic.
 */

export const ONSET_VOICE_ERROR_CLASS = {
  DUPLICATE_PITCH_INSTANCE: 'duplicate-pitch-instance',
  UNIQUE_PITCH_SLOT_SHIFT: 'unique-pitch-slot-shift',
  CROSS_VOICE_MATCHER: 'cross-voice-matcher',
  SERIALIZATION_VOICE_SHIFT: 'serialization-voice-shift',
  OTHER: 'other',
}

const ONSET_DELTA_BUCKETS = [0.5, 0.75]

function labelCountInMeasure(entries = [], label) {
  if (!label) {
    return 0
  }
  return entries.filter((entry) => entry.truth?.label === label || entry.label === label).length
}

export function classifyWrongOnsetEntry(entry, { truthLabelsInMeasure = [] } = {}) {
  const pitchDelta = Math.abs(Number(entry.pitchDeltaSemitones) || 0)
  const truthVoice = entry.truth?.voice
  const generatedVoice = entry.generated?.voice
  const truthLabel = entry.truth?.label ?? null
  const generatedLabel = entry.generated?.label ?? null
  const sameLabel = truthLabel && truthLabel === generatedLabel

  if (pitchDelta >= 3 || (truthLabel && generatedLabel && truthLabel !== generatedLabel && pitchDelta > 0)) {
    return ONSET_VOICE_ERROR_CLASS.CROSS_VOICE_MATCHER
  }

  if (
    sameLabel &&
    truthVoice != null &&
    generatedVoice != null &&
    truthVoice !== generatedVoice &&
    pitchDelta === 0
  ) {
    return ONSET_VOICE_ERROR_CLASS.SERIALIZATION_VOICE_SHIFT
  }

  if (sameLabel && labelCountInMeasure(truthLabelsInMeasure, truthLabel) >= 2) {
    return ONSET_VOICE_ERROR_CLASS.DUPLICATE_PITCH_INSTANCE
  }

  if (sameLabel) {
    return ONSET_VOICE_ERROR_CLASS.UNIQUE_PITCH_SLOT_SHIFT
  }

  return ONSET_VOICE_ERROR_CLASS.OTHER
}

function eventTraceRow(entry, { pipelineEvent = null, errorClass = null } = {}) {
  const divisionsPerQuarter = 4
  const startDivision = pipelineEvent?.startDivision ?? null
  return {
    truthOnsetQuarters: entry.truth?.onsetQuarters ?? null,
    generatedOnsetQuarters: entry.generated?.onsetQuarters ?? null,
    onsetDiffQuarters: entry.onsetDiffQuarters ?? null,
    truthLabel: entry.truth?.label ?? null,
    generatedLabel: entry.generated?.label ?? null,
    pitchDeltaSemitones: entry.pitchDeltaSemitones ?? null,
    truthVoice: entry.truth?.voice ?? null,
    generatedVoice: entry.generated?.voice ?? null,
    truthClef: entry.truth?.clef ?? null,
    generatedClef: entry.generated?.clef ?? null,
    columnXNorm: pipelineEvent?.positionInMeasure ?? pipelineEvent?.notes?.[0]?.positionInMeasure ?? null,
    columnXPx: pipelineEvent?.cx ?? pipelineEvent?.notes?.[0]?.cx ?? null,
    assignedDivision: startDivision,
    assignedOnsetQuarters:
      startDivision == null ? null : startDivision / divisionsPerQuarter,
    serializationVoice: entry.generated?.voice ?? null,
    errorClass,
  }
}

export function buildMeasureOnsetTrace(
  report = {},
  measureNumber,
  { pipelineEvents = null } = {},
) {
  const wrongOnsets = (report.debug?.wrongOnsets ?? []).filter(
    (entry) => entry.measureNumber === measureNumber,
  )
  const truthLabelsInMeasure = wrongOnsets.map((entry) => ({ truth: entry.truth }))
  const eventsByStart = new Map()
  if (pipelineEvents?.length) {
    for (const event of pipelineEvents) {
      if (event.type !== 'note') {
        continue
      }
      eventsByStart.set(event.startDivision ?? 0, event)
    }
  }

  const rows = wrongOnsets.map((entry) => {
    const errorClass = classifyWrongOnsetEntry(entry, { truthLabelsInMeasure })
    const genStart =
      entry.generated?.onsetQuarters == null
        ? null
        : Math.round(entry.generated.onsetQuarters * 4)
    const pipelineEvent = genStart == null ? null : eventsByStart.get(genStart) ?? null
    return eventTraceRow(entry, { pipelineEvent, errorClass })
  })

  const histogram = Object.fromEntries(
    Object.values(ONSET_VOICE_ERROR_CLASS).map((bucket) => [bucket, 0]),
  )
  for (const row of rows) {
    histogram[row.errorClass] += 1
  }

  return {
    measureNumber,
    wrongOnsetCount: rows.length,
    rows,
    histogram,
    dominantDelta:
      rows.length > 0
        ? ONSET_DELTA_BUCKETS.find((delta) =>
            rows.every((row) => Math.abs(row.onsetDiffQuarters ?? 0) === delta),
          ) ?? null
        : null,
  }
}

export function summarizeOnsetVoicePhaseDiagnosis(
  report = {},
  { measureNumbers = [], pipelineEventsByMeasure = null } = {},
) {
  const wrongOnsets = report.debug?.wrongOnsets ?? []
  const targets =
    measureNumbers.length > 0
      ? measureNumbers
      : [...new Set(wrongOnsets.map((entry) => entry.measureNumber))].sort((a, b) => a - b)

  const perMeasure = targets.map((measureNumber) =>
    buildMeasureOnsetTrace(report, measureNumber, {
      pipelineEvents: pipelineEventsByMeasure?.get?.(measureNumber) ?? null,
    }),
  )

  const histogram = Object.fromEntries(
    Object.values(ONSET_VOICE_ERROR_CLASS).map((bucket) => [bucket, 0]),
  )
  let strictIndependent = 0
  let pitchOrDurationCoupled = 0
  const signedDelta = {}

  for (const entry of wrongOnsets) {
    const pitchDelta = Math.abs(Number(entry.pitchDeltaSemitones) || 0)
    const durationDelta = Math.abs(Number(entry.durationDiffQuarters) || 0)
    if (pitchDelta <= 0.01 && durationDelta <= 0.05) {
      strictIndependent += 1
    } else {
      pitchOrDurationCoupled += 1
    }
    const key = String(entry.onsetDiffQuarters ?? 0)
    signedDelta[key] = (signedDelta[key] ?? 0) + 1
    const measureLabels = wrongOnsets.filter((row) => row.measureNumber === entry.measureNumber)
    const errorClass = classifyWrongOnsetEntry(entry, {
      truthLabelsInMeasure: measureLabels.map((row) => ({ truth: row.truth })),
    })
    histogram[errorClass] += 1
  }

  const rankedMeasures = perMeasure
    .filter((entry) => entry.wrongOnsetCount > 0)
    .sort((left, right) => right.wrongOnsetCount - left.wrongOnsetCount)

  return {
    totalWrongOnsets: wrongOnsets.length,
    strictIndependent,
    pitchOrDurationCoupled,
    signedDeltaHistogram: signedDelta,
    errorClassHistogram: histogram,
    primaryErrorClass:
      Object.entries(histogram)
        .filter(([, count]) => count > 0)
        .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
    rankedMeasures,
    perMeasure,
  }
}
