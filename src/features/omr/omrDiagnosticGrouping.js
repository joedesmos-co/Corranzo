/**
 * Unified OMR accuracy error grouping for benchmarks and developer reports.
 * Composes existing pitch/duration categorizers — no detection logic changes.
 */

import { OMR_ACCURACY_SOURCE } from './omrAccuracyEvaluator.js'
import { summarizeDurationErrors } from './omrDurationErrorAnalysis.js'
import { summarizePitchErrors } from './omrPitchErrorAnalysis.js'
import {
  articulationGapFromDiagnostics,
  summarizeSemanticDefectClasses,
} from './omrSemanticDefectClass.js'

export const DETECTION_ERROR_BUCKET = {
  MISSING: 'missing-notes',
  EXTRA: 'extra-notes',
  CHORD: 'chord-grouping',
}

/**
 * Canonical, human-readable error buckets surfaced in the benchmark dashboard.
 * These are OBSERVATIONS derived from existing report fields — no detection or
 * threshold logic depends on them.
 */
export const NAMED_ERROR_BUCKET = {
  PITCH: 'pitch',
  DURATION: 'duration',
  ONSET: 'onset',
  CHORD: 'chord',
  TIES: 'ties',
  SLURS: 'slurs',
  TUPLETS: 'tuplets',
  ACCIDENTALS: 'accidentals',
  RESTS: 'rests',
  EXTRA_MISSING: 'extra/missing-notes',
}

const NAMED_ERROR_BUCKET_ORDER = [
  NAMED_ERROR_BUCKET.PITCH,
  NAMED_ERROR_BUCKET.DURATION,
  NAMED_ERROR_BUCKET.ONSET,
  NAMED_ERROR_BUCKET.CHORD,
  NAMED_ERROR_BUCKET.TIES,
  NAMED_ERROR_BUCKET.SLURS,
  NAMED_ERROR_BUCKET.TUPLETS,
  NAMED_ERROR_BUCKET.ACCIDENTALS,
  NAMED_ERROR_BUCKET.RESTS,
  NAMED_ERROR_BUCKET.EXTRA_MISSING,
]

function toCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) {
    return null
  }
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export function topHistogramEntries(histogram = {}, limit = 5) {
  return Object.entries(histogram)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([category, count]) => ({ category, count }))
}

export function mergeHistograms(histograms = []) {
  const merged = {}
  for (const histogram of histograms) {
    if (!histogram || typeof histogram !== 'object') {
      continue
    }
    for (const [category, count] of Object.entries(histogram)) {
      merged[category] = (merged[category] ?? 0) + (Number(count) || 0)
    }
  }
  return merged
}

export function summarizeDetectionErrors(totals = {}) {
  const buckets = {
    [DETECTION_ERROR_BUCKET.MISSING]: Number(totals.missingNoteCount) || 0,
    [DETECTION_ERROR_BUCKET.EXTRA]: Number(totals.extraNoteCount) || 0,
    [DETECTION_ERROR_BUCKET.CHORD]: Number(totals.chordMismatchCount) || 0,
  }
  const total = Object.values(buckets).reduce((sum, count) => sum + count, 0)
  return {
    total,
    buckets,
    top: topHistogramEntries(buckets, 3),
  }
}

/**
 * Roll up all error signals for one accuracy report into the canonical named
 * buckets (pitch, duration, onset, chord, ties, slurs, tuplets, accidentals,
 * rests, extra/missing). Counts are observed from existing report fields:
 *   - matched-note errors come from `report.totals`,
 *   - tie/slur/rest/accidental signals come from `generatedOmrDiagnostics`.
 * Purely descriptive — never used for pass/fail.
 */
export function summarizeNamedErrorBuckets(report = {}) {
  const totals = report.totals ?? {}
  const diagnostics = report.generatedOmrDiagnostics ?? {}
  const ties = diagnostics.ties ?? {}
  const rests = diagnostics.rests ?? {}
  const tuplets = diagnostics.tuplets ?? {}

  const detectedTies = toCount(ties.detectedTieCount)
  const appliedTies = toCount(ties.appliedTieCount)
  // Ties detected but not applied are the measurable tie gap.
  const tieGap = Math.max(0, detectedTies - appliedTies)

  const restGlyphs = toCount(rests.detectedRestGlyphCount)
  const restApplied = toCount(rests.appliedRestEventCount)
  const restGap = Math.max(0, restGlyphs - restApplied) + toCount(rests.skippedMixedRestCount)

  // Tuplet diagnostics are optional; count detected-but-unapplied when present.
  const tupletDetected = toCount(tuplets.detectedTupletCount)
  const tupletApplied = toCount(tuplets.appliedTupletCount)
  const tupletGap = tuplets.detectedTupletCount != null
    ? Math.max(0, tupletDetected - tupletApplied)
    : 0

  const buckets = {
    [NAMED_ERROR_BUCKET.PITCH]: toCount(totals.wrongPitchCount),
    [NAMED_ERROR_BUCKET.DURATION]: toCount(totals.wrongDurationCount),
    [NAMED_ERROR_BUCKET.ONSET]: toCount(totals.wrongOnsetCount),
    [NAMED_ERROR_BUCKET.CHORD]: toCount(totals.chordMismatchCount),
    [NAMED_ERROR_BUCKET.TIES]: tieGap,
    // Slur backlog: unpaired slur glyphs / rejected arcs after applied slur pairs.
    [NAMED_ERROR_BUCKET.SLURS]: toCount(ties.uncertainSlurCount),
    [NAMED_ERROR_BUCKET.TUPLETS]: tupletGap,
    // Accidental-sized pitch deltas (±1 semitone) are the observable accidental signal.
    [NAMED_ERROR_BUCKET.ACCIDENTALS]: toCount(
      summarizePitchErrors(report.debug?.wrongPitches ?? []).histogram['±1-accidental'],
    ),
    [NAMED_ERROR_BUCKET.RESTS]: restGap,
    [NAMED_ERROR_BUCKET.EXTRA_MISSING]:
      toCount(totals.missingNoteCount) + toCount(totals.extraNoteCount),
  }

  const total = Object.values(buckets).reduce((sum, count) => sum + count, 0)
  const ranked = NAMED_ERROR_BUCKET_ORDER.map((bucket) => ({
    bucket,
    count: buckets[bucket],
  }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)

  const largest = ranked[0] ?? null

  return {
    buckets,
    total,
    ranked,
    largestBucket: largest
      ? {
          bucket: largest.bucket,
          count: largest.count,
          share: total > 0 ? round(largest.count / total) : null,
        }
      : null,
  }
}

/**
 * Diagnose whether chord-grouping mismatches are a PRIMARY grouping defect or a
 * DOWNSTREAM symptom of onset / note-detection errors in the same measure.
 *
 * The accuracy evaluator re-buckets notes by onset when comparing chord groups,
 * so a note whose onset lands in an adjacent sub-beat bucket is counted as a
 * "chord mismatch" even though grouping logic is fine. This helper attributes
 * each mismatch example to the measure's other errors. Purely descriptive.
 *
 * Returns per-example and per-note coupling counts plus a `coupledShare`.
 */
export function analyzeChordMismatchCoupling(report = {}) {
  const examples = report.debug?.chordGroupMismatches ?? []
  const perMeasure = report.perMeasure ?? []
  const measureByNumber = new Map(
    perMeasure.map((measure) => [String(measure.measureNumber), measure]),
  )

  let coupledExamples = 0
  let isolatedExamples = 0
  let coupledNotes = 0
  let isolatedNotes = 0
  const isolatedMeasures = new Set()

  for (const example of examples) {
    const measure = measureByNumber.get(String(example.measureNumber))
    const truthCount = toCount(example.truthCount)
    const generatedCount = toCount(example.generatedCount)
    const notes = Math.abs(truthCount - generatedCount) || Math.max(truthCount, generatedCount)
    const hasOnsetError = toCount(measure?.wrongOnsetCount) > 0
    const hasDetectionError =
      toCount(measure?.missingNoteCount) + toCount(measure?.extraNoteCount) > 0
    const coupled = Boolean(measure) && (hasOnsetError || hasDetectionError)

    if (coupled) {
      coupledExamples += 1
      coupledNotes += notes
    } else {
      isolatedExamples += 1
      isolatedNotes += notes
      if (example.measureNumber != null) {
        isolatedMeasures.add(example.measureNumber)
      }
    }
  }

  const exampleCount = examples.length
  return {
    exampleCount,
    coupledExamples,
    isolatedExamples,
    coupledNotes,
    isolatedNotes,
    isolatedMeasures: [...isolatedMeasures],
    coupledShare: exampleCount > 0 ? round(coupledExamples / exampleCount) : null,
  }
}

/**
 * Diagnose wrong-onset errors: how many are genuine slot shifts vs coupled to
 * pitch/duration mismatches in the same greedy match, and which signed deltas
 * dominate. Purely descriptive — used to pick rhythm-inference targets.
 */
export function analyzeOnsetErrorCoupling(report = {}) {
  const wrongOnsets = report.debug?.wrongOnsets ?? []
  let pitchOrDurationCoupled = 0
  let strictIndependent = 0
  const signedDeltaHistogram = {}
  const absDeltaHistogram = {}

  for (const entry of wrongOnsets) {
    const pitchDelta = Math.abs(Number(entry.pitchDeltaSemitones) || 0)
    const durationDelta = Math.abs(Number(entry.durationDiffQuarters) || 0)
    const truthOnset = Number(entry.truth?.onsetQuarters)
    const generatedOnset = Number(entry.generated?.onsetQuarters)
    const signed =
      Number.isFinite(truthOnset) && Number.isFinite(generatedOnset)
        ? round(generatedOnset - truthOnset, 2)
        : round(Number(entry.onsetDiffQuarters) || 0, 2)
    const signedKey = signed.toFixed(2)
    const absKey = Math.abs(signed).toFixed(2)
    signedDeltaHistogram[signedKey] = (signedDeltaHistogram[signedKey] ?? 0) + 1
    absDeltaHistogram[absKey] = (absDeltaHistogram[absKey] ?? 0) + 1

    if (pitchDelta <= 0.01 && durationDelta <= 0.05) {
      strictIndependent += 1
    } else {
      pitchOrDurationCoupled += 1
    }
  }

  const exampleCount = wrongOnsets.length
  return {
    exampleCount,
    pitchOrDurationCoupled,
    strictIndependent,
    coupledShare: exampleCount > 0 ? round(pitchOrDurationCoupled / exampleCount) : null,
    strictIndependentShare:
      exampleCount > 0 ? round(strictIndependent / exampleCount) : null,
    signedDeltaHistogram,
    absDeltaHistogram,
    dominantSignedDeltas: topHistogramEntries(signedDeltaHistogram, 5),
    dominantAbsDeltas: topHistogramEntries(absDeltaHistogram, 3),
  }
}

/**
 * Rank proven accuracy root causes vs downstream symptoms for one fixture report.
 * Chord counts are demoted when onset-coupled; onset/rhythm is promoted as primary.
 */
export function rankRhythmRootCauses(report = {}) {
  const totals = report.totals ?? {}
  const named = summarizeNamedErrorBuckets(report)
  const chordCoupling = analyzeChordMismatchCoupling(report)
  const onset = analyzeOnsetErrorCoupling(report)
  const durationHist = summarizeDurationErrors(report.debug?.wrongDurations ?? [])
  const independentDuration =
    (durationHist['too-short'] ?? 0) +
    (durationHist['too-long'] ?? 0) +
    (durationHist['beamed-subdivision'] ?? 0)
  const onsetCoupledDuration = durationHist['onset-coupled'] ?? 0

  const rhythmBuckets = [
    {
      bucket: 'onset/rhythm',
      count: toCount(totals.wrongOnsetCount),
      strictIndependentOnsets: onset.strictIndependent,
    },
    {
      bucket: 'duration/rhythm-independent',
      count: independentDuration,
    },
    {
      bucket: 'duration/rhythm-onset-coupled',
      count: onsetCoupledDuration,
    },
    {
      bucket: 'ties',
      count: named.buckets[NAMED_ERROR_BUCKET.TIES] ?? 0,
    },
  ]
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)

  const proven = [
    ...rhythmBuckets,
    {
      bucket: 'pitch',
      count: toCount(totals.wrongPitchCount),
    },
    {
      bucket: 'extra/missing-notes',
      count: toCount(totals.missingNoteCount) + toCount(totals.extraNoteCount),
    },
  ]
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)

  const symptoms = []
  const chordCount = toCount(totals.chordMismatchCount)
  if (chordCount > 0) {
    symptoms.push({
      bucket: 'chord',
      count: chordCount,
      coupledShare: chordCoupling.coupledShare,
      note: 'downstream of onset/detection when coupledShare is high',
    })
  }

  return {
    primaryRhythmRootCause: rhythmBuckets[0] ?? null,
    primaryRootCause: rhythmBuckets[0] ?? proven[0] ?? null,
    rhythmBuckets,
    proven,
    symptoms,
    onset,
    durationOnsetCoupled: onsetCoupledDuration,
  }
}

/**
 * Group pitch, duration, detection, and source-score signals for one accuracy report.
 */
export function groupAccuracyReportErrors(report = {}) {
  const wrongPitches = report.debug?.wrongPitches ?? []
  const wrongDurations = report.debug?.wrongDurations ?? []
  const pitch = summarizePitchErrors(wrongPitches)
  const durationHistogram = summarizeDurationErrors(wrongDurations)
  const detection = summarizeDetectionErrors(report.totals ?? {})
  const primary = report.summary?.primaryErrorSource ?? null
  const sourceScores = primary?.scores ?? {}

  const rankedSources = Object.entries(sourceScores)
    .filter(([, score]) => Number(score) > 0.08)
    .sort((left, right) => right[1] - left[1])
    .map(([source, score]) => ({
      source,
      score: round(score),
    }))

  const namedBuckets = summarizeNamedErrorBuckets(report)
  const semanticDefectClasses = summarizeSemanticDefectClasses({
    namedBuckets,
    durationErrorHistogram: durationHistogram,
    articulationGap: articulationGapFromDiagnostics(report.generatedOmrDiagnostics),
  })

  return {
    primarySource: primary?.source ?? OMR_ACCURACY_SOURCE.NONE,
    primaryLabel: primary?.label ?? null,
    primaryConfidence: round(primary?.confidence),
    rankedSources,
    namedBuckets,
    semanticDefectClasses,
    pitch: {
      total: pitch.total,
      histogram: pitch.histogram,
      top: topHistogramEntries(pitch.histogram),
      truncated: report.debug?.truncated?.wrongPitches ?? 0,
    },
    duration: {
      total: wrongDurations.length,
      histogram: durationHistogram,
      top: topHistogramEntries(durationHistogram),
      truncated: report.debug?.truncated?.wrongDurations ?? 0,
    },
    detection,
    matchedErrors: {
      wrongPitch: report.totals?.wrongPitchCount ?? 0,
      wrongDuration: report.totals?.wrongDurationCount ?? 0,
      wrongOnset: report.totals?.wrongOnsetCount ?? 0,
      wrongTime: report.totals?.wrongTimeCount ?? 0,
    },
  }
}

export function summarizeTierBreakdown(records = []) {
  const tiers = {}
  for (const record of records) {
    const tier = record.tier ?? 'unspecified'
    if (!tiers[tier]) {
      tiers[tier] = {
        tier,
        fixtureCount: 0,
        statusCounts: {},
        failing: [],
      }
    }
    const bucket = tiers[tier]
    bucket.fixtureCount += 1
    bucket.statusCounts[record.status] = (bucket.statusCounts[record.status] ?? 0) + 1
    if (record.status !== 'pass' && record.status !== 'skipped') {
      bucket.failing.push(record.id ?? record.label)
    }
  }
  return Object.values(tiers).sort((left, right) => left.tier.localeCompare(right.tier))
}

/**
 * Cluster fixtures that share the same dominant error signature.
 */
export function clusterFixtureFailures(records = []) {
  const clusters = new Map()

  for (const record of records) {
    if (record.status === 'pass' || record.status === 'skipped') {
      continue
    }
    const source = record.metrics?.topErrorCategory?.source ?? record.status
    const durationCategory = record.metrics?.topDurationErrorCategory?.category ?? 'n/a'
    const pitchCategory = record.metrics?.topPitchErrorCategory?.category ?? 'n/a'
    const key = `${record.status}|${source}|${durationCategory}|${pitchCategory}`
    const existing = clusters.get(key) ?? {
      key,
      status: record.status,
      errorSource: source,
      durationCategory,
      pitchCategory,
      fixtures: [],
      reasons: [],
    }
    existing.fixtures.push(record.id ?? record.label)
    if (record.failureReasons?.length) {
      existing.reasons.push(...record.failureReasons)
    }
    clusters.set(key, existing)
  }

  return [...clusters.values()]
    .map((cluster) => ({
      ...cluster,
      reasons: [...new Set(cluster.reasons)].slice(0, 8),
    }))
    .sort(
      (left, right) =>
        right.fixtures.length - left.fixtures.length ||
        left.errorSource.localeCompare(right.errorSource),
    )
}

export function formatErrorGroupingMarkdown(grouping, { title = 'Error grouping', includeHeading = true } = {}) {
  if (!grouping) {
    return ''
  }
  const lines = includeHeading ? [`## ${title}`, ''] : []
  if (grouping.primaryLabel) {
    lines.push(
      `- Primary: ${grouping.primaryLabel} (${grouping.primarySource}, confidence ${grouping.primaryConfidence ?? 'n/a'})`,
    )
  }
  if (grouping.rankedSources?.length) {
    lines.push(
      `- Source scores: ${grouping.rankedSources.map((entry) => `${entry.source}=${entry.score}`).join(', ')}`,
    )
  }
  if (grouping.pitch?.top?.length) {
    lines.push(
      `- Pitch errors (${grouping.pitch.total}): ${grouping.pitch.top.map((entry) => `${entry.category}=${entry.count}`).join(', ')}`,
    )
  }
  if (grouping.duration?.top?.length) {
    lines.push(
      `- Duration errors (${grouping.duration.total}): ${grouping.duration.top.map((entry) => `${entry.category}=${entry.count}`).join(', ')}`,
    )
  }
  if (grouping.detection?.top?.length) {
    lines.push(
      `- Detection: ${grouping.detection.top.map((entry) => `${entry.category}=${entry.count}`).join(', ')}`,
    )
  }
  if (grouping.namedBuckets?.ranked?.length) {
    lines.push(
      `- Error buckets: ${grouping.namedBuckets.ranked
        .map((entry) => `${entry.bucket}=${entry.count}`)
        .join(', ')}`,
    )
    const largest = grouping.namedBuckets.largestBucket
    if (largest) {
      const share = largest.share != null ? ` (${Math.round(largest.share * 100)}%)` : ''
      lines.push(`- Largest remaining error bucket: ${largest.bucket} = ${largest.count}${share}`)
    }
  }
  if (grouping.semanticDefectClasses?.ranked?.length) {
    lines.push(
      `- Semantic defect classes: ${grouping.semanticDefectClasses.ranked
        .map((entry) => `${entry.label}=${entry.count}`)
        .join(', ')}`,
    )
    lines.push(`- ${grouping.semanticDefectClasses.priorityGuidance}`)
    const largestClass = grouping.semanticDefectClasses.largestClass
    if (largestClass) {
      const share =
        largestClass.share != null ? ` (${Math.round(largestClass.share * 100)}%)` : ''
      lines.push(
        `- Largest semantic class: ${largestClass.label} = ${largestClass.count}${share} (priority ${largestClass.priority})`,
      )
    }
  }
  lines.push('')
  return `${lines.join('\n')}`
}
