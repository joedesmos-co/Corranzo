/**
 * OMR Engine V2 Phase 4 — tie & sustain constraint diagnostics.
 *
 * Uses the Phase 3 written-vs-sounding duration split to classify tie/sustain
 * failures *without* changing the runtime tie detector or MusicXML output.
 * Everything here is observation only: it reads benchmark report signals
 * (wrong durations, missing/extra notes, applied tie pairs) and ScoreGraph IR
 * measures, and never mutates the events it inspects.
 *
 * @see docs/OMR_ENGINE_V2_PLAN.md
 */

import { SCORE_GRAPH_NODE } from './scoreGraph.js'
import { RELEASE_SOURCE, TIE_SUSTAIN_SOURCE } from './scoreGraphDurationObservation.js'

export const TIE_SUSTAIN_CONSTRAINT = {
  /** Same pitch across a bar line where truth expects a tie but generated has none. */
  EXPECTED_CROSS_MEASURE_TIE: 'expected-cross-measure-tie',
  /** A tie-start glyph with no matching continuation note. */
  TIE_START_WITHOUT_CONTINUATION: 'tie-start-without-continuation',
  /** A tie-stop / continuation note with no matching tie-start. */
  CONTINUATION_WITHOUT_TIE_START: 'continuation-without-tie-start',
  /** Sounding release ended earlier than the truth sustain expects. */
  SOUNDING_RELEASE_TOO_SHORT: 'sounding-release-too-short',
  /** Written duration matches truth but the sustain (release) is wrong. */
  WRITTEN_CORRECT_SUSTAIN_WRONG: 'written-correct-sustain-wrong',
  /** An arc glyph rejected as a tie because the linked pitches differ (slur-like). */
  SLUR_LIKE_ARC_PITCH_DIFFERS: 'slur-like-arc-pitch-differs',
}

/** Fixtures whose tie chains we trace from ScoreGraph IR (Gymnopédie). */
export const TIE_CHAIN_TRACE_FIXTURES = new Set(['clean'])
/** Fixtures whose false-tie guards we assert stay clean (Twinkle). */
export const FALSE_TIE_GUARD_FIXTURES = new Set(['simple'])

function constraintHistogramTemplate() {
  return Object.fromEntries(
    Object.values(TIE_SUSTAIN_CONSTRAINT).map((bucket) => [bucket, 0]),
  )
}

function num(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function noteRef(entry = {}) {
  return {
    measureNumber: entry.measureNumber ?? null,
    midi: entry.midi ?? null,
    label: entry.label ?? null,
    onsetQuarters: entry.onsetQuarters ?? null,
    durationQuarters: entry.durationQuarters ?? null,
    voice: entry.voice ?? null,
    partId: entry.partId ?? 'P1',
  }
}

/**
 * Detect same-pitch notes that end one measure and re-onset at the start of the
 * next measure — the shape of an expected cross-measure tie. Uses the wrong
 * duration rows (truth wants a longer sounding release than generated has).
 *
 * Observation only: this never emits a tie, it flags candidates for a future
 * solver constraint.
 */
export function classifyExpectedCrossMeasureTies(wrongDurations = [], appliedTiePairs = []) {
  const appliedKeys = new Set(
    (appliedTiePairs ?? []).map(
      (pair) => `${pair.fromMeasure}->${pair.toMeasure}|${pair.midi}`,
    ),
  )
  const candidates = []
  for (const entry of wrongDurations) {
    const truth = entry.truth ?? {}
    const generated = entry.generated ?? {}
    const pitchDelta = Math.abs(num(entry.pitchDeltaSemitones))
    // Same pitch, truth sounds longer, generated cut short: sustain candidate.
    if (pitchDelta > 0) {
      continue
    }
    const truthDuration = num(truth.durationQuarters)
    const genDuration = num(generated.durationQuarters)
    if (truthDuration <= genDuration) {
      continue
    }
    const truthEnd = num(truth.onsetQuarters) + truthDuration
    // Heuristic: sounding release should reach at least the next bar boundary.
    const spansBar = truthEnd - num(truth.onsetQuarters) >= 1 && truthDuration - genDuration >= 0.5
    if (!spansBar) {
      continue
    }
    const applied = appliedKeys.has(
      `${truth.measureNumber}->${(truth.measureNumber ?? 0) + 1}|${truth.midi}`,
    )
    candidates.push({
      ...noteRef(truth),
      generatedDurationQuarters: genDuration,
      sustainDeficitQuarters: Math.round((truthDuration - genDuration) * 1000) / 1000,
      alreadyTied: applied,
    })
  }
  return candidates
}

/**
 * Split a report's applied vs detected tie glyphs into orphan constraint
 * classes. `detectedTieCount` counts arcs the detector saw; `appliedTieCount`
 * counts arcs promoted to ties. The gap is uncertain/rejected arcs.
 */
export function classifyTieGlyphOrphans(tieDiagnostics = {}) {
  const detected = num(tieDiagnostics.detectedTieCount)
  const applied = num(tieDiagnostics.appliedTieCount)
  const uncertainSlur = num(tieDiagnostics.uncertainSlurCount)
  const rejectedGap = Math.max(0, detected - applied)
  return {
    detectedTieCount: detected,
    appliedTieCount: applied,
    // Rejected arcs are slur-like (different pitch) or unresolved continuation.
    slurLikeArcPitchDiffers: Math.min(rejectedGap, uncertainSlur || rejectedGap),
    unresolvedArcCount: Math.max(0, rejectedGap - uncertainSlur),
  }
}

/**
 * From missing/extra notes, find same-pitch pairs that look like a broken tie:
 * a truth note is missing while an extra generated note re-states the same pitch
 * — i.e. a continuation without a tie-start, or a tie-start without continuation.
 */
export function classifyBrokenTieContinuations(missingNotes = [], extraNotes = []) {
  const startWithoutContinuation = []
  const continuationWithoutStart = []

  const extraByPitch = new Map()
  for (const extra of extraNotes) {
    const key = `${extra.midi}|${extra.partId ?? 'P1'}`
    if (!extraByPitch.has(key)) {
      extraByPitch.set(key, [])
    }
    extraByPitch.get(key).push(extra)
  }

  for (const missing of missingNotes) {
    const key = `${missing.midi}|${missing.partId ?? 'P1'}`
    const extras = extraByPitch.get(key) ?? []
    const nearby = extras.find(
      (extra) =>
        Math.abs(num(extra.measureNumber) - num(missing.measureNumber)) <= 1 &&
        extra.midi === missing.midi,
    )
    if (!nearby) {
      continue
    }
    if (num(nearby.measureNumber) > num(missing.measureNumber)) {
      // Missing earlier segment, extra later: continuation exists without a start.
      continuationWithoutStart.push({
        ...noteRef(nearby),
        missingStart: noteRef(missing),
      })
    } else {
      // Missing later segment, extra earlier: start exists without continuation.
      startWithoutContinuation.push({
        ...noteRef(nearby),
        missingContinuation: noteRef(missing),
      })
    }
  }

  return { startWithoutContinuation, continuationWithoutStart }
}

/**
 * Written-correct-but-sustain-wrong: rows where the written duration bucket is
 * the same size class but the sounding release differs (tie/sustain territory).
 */
export function classifyWrittenCorrectSustainWrong(wrongDurations = []) {
  const rows = []
  for (const entry of wrongDurations) {
    const truth = entry.truth ?? {}
    const generated = entry.generated ?? {}
    if (Math.abs(num(entry.pitchDeltaSemitones)) > 0) {
      continue
    }
    if (Math.abs(num(entry.onsetDiffQuarters)) > 0.05) {
      continue
    }
    const durationDiff = Math.abs(num(entry.durationDiffQuarters))
    if (durationDiff < 0.25) {
      continue
    }
    // Written onset matches; only the release/sustain span diverges.
    rows.push({
      ...noteRef(truth),
      truthDurationQuarters: num(truth.durationQuarters),
      generatedDurationQuarters: num(generated.durationQuarters),
      sustainDiffQuarters: Math.round(durationDiff * 1000) / 1000,
    })
  }
  return rows
}

/**
 * Trace tie chains from ScoreGraph IR (Phase 3 fields), classifying each chain
 * link against the constraint taxonomy. Observation only — reads node fields.
 */
export function traceScoreGraphTieChains(measureGraph = {}) {
  const chains = []
  const byPitchVoice = new Map()
  for (const node of measureGraph.nodes ?? []) {
    if (node.kind !== SCORE_GRAPH_NODE.NOTEHEAD) {
      continue
    }
    if (!node.tieStart && !node.tieStop && !node.tieSustainSource) {
      continue
    }
    const key = `${node.midi}|${node.voice ?? node.clef ?? 'treble'}`
    if (!byPitchVoice.has(key)) {
      byPitchVoice.set(key, [])
    }
    byPitchVoice.get(key).push(node)
  }

  for (const [key, nodes] of byPitchVoice) {
    nodes.sort((left, right) => (left.onsetDivision ?? 0) - (right.onsetDivision ?? 0))
    const links = nodes.map((node) => ({
      onsetDivision: node.onsetDivision ?? 0,
      writtenDurationDivisions: node.writtenDurationDivisions ?? null,
      soundingReleaseDivision: node.soundingReleaseDivision ?? null,
      releaseSource: node.releaseSource ?? null,
      tieSustainSource: node.tieSustainSource ?? TIE_SUSTAIN_SOURCE.NONE,
      sustainExtendsBeyondWritten:
        node.soundingReleaseDivision != null &&
        node.writtenDurationDivisions != null &&
        node.soundingReleaseDivision >
          (node.onsetDivision ?? 0) + node.writtenDurationDivisions,
    }))
    const hasStart = links.some((link) => link.tieSustainSource === TIE_SUSTAIN_SOURCE.TIE_START || link.tieSustainSource === TIE_SUSTAIN_SOURCE.TIE_MIDDLE)
    const hasStop = links.some((link) => link.tieSustainSource === TIE_SUSTAIN_SOURCE.TIE_STOP || link.tieSustainSource === TIE_SUSTAIN_SOURCE.TIE_MIDDLE)
    chains.push({
      pitchKey: key,
      linkCount: links.length,
      hasStart,
      hasStop,
      // Well-formed = starts and stops present, or a single tie-into-next-measure start.
      wellFormed: (hasStart && hasStop) || (links.length === 1 && hasStart),
      sustainViaTie: links.some((link) => link.releaseSource === RELEASE_SOURCE.TIE_SUSTAIN),
      links,
    })
  }

  return chains.sort((left, right) => (left.links[0]?.onsetDivision ?? 0) - (right.links[0]?.onsetDivision ?? 0))
}

function buildTieChainTraces(scoreGraphMeasures = [], { fixtureId = null } = {}) {
  if (!TIE_CHAIN_TRACE_FIXTURES.has(fixtureId)) {
    return null
  }
  const perMeasure = []
  let malformed = 0
  for (const measure of scoreGraphMeasures) {
    const chains = traceScoreGraphTieChains(measure)
    if (!chains.length) {
      continue
    }
    malformed += chains.filter((chain) => !chain.wellFormed).length
    perMeasure.push({
      measureNumber: measure.measureNumber,
      chainCount: chains.length,
      chains: chains.slice(0, 6),
    })
  }
  if (!perMeasure.length) {
    return null
  }
  return {
    fixtureId,
    measureCount: perMeasure.length,
    totalChains: perMeasure.reduce((sum, entry) => sum + entry.chainCount, 0),
    malformedChains: malformed,
    perMeasure: perMeasure.slice(0, 24),
  }
}

/**
 * Build the full Phase 4 tie/sustain constraint diagnostics bundle for one
 * fixture report. Diagnostic only; no runtime OMR changes.
 */
export function buildTieSustainConstraintDiagnostics(
  report = {},
  { fixtureId = null, scoreGraphMeasures = null } = {},
) {
  const wrongDurations = report.debug?.wrongDurations ?? []
  const missingNotes = report.debug?.missingNotes ?? []
  const extraNotes = report.debug?.extraNotes ?? []
  const tieDiagnostics = report.generatedOmrDiagnostics?.ties ?? {}
  const appliedTiePairs = tieDiagnostics.appliedTiePairs ?? []

  const expectedCrossMeasureTies = classifyExpectedCrossMeasureTies(
    wrongDurations,
    appliedTiePairs,
  )
  const glyphOrphans = classifyTieGlyphOrphans(tieDiagnostics)
  const brokenContinuations = classifyBrokenTieContinuations(missingNotes, extraNotes)
  const writtenCorrectSustainWrong = classifyWrittenCorrectSustainWrong(wrongDurations)

  const histogram = constraintHistogramTemplate()
  histogram[TIE_SUSTAIN_CONSTRAINT.EXPECTED_CROSS_MEASURE_TIE] =
    expectedCrossMeasureTies.filter((entry) => !entry.alreadyTied).length
  histogram[TIE_SUSTAIN_CONSTRAINT.TIE_START_WITHOUT_CONTINUATION] =
    brokenContinuations.startWithoutContinuation.length
  histogram[TIE_SUSTAIN_CONSTRAINT.CONTINUATION_WITHOUT_TIE_START] =
    brokenContinuations.continuationWithoutStart.length
  histogram[TIE_SUSTAIN_CONSTRAINT.SOUNDING_RELEASE_TOO_SHORT] =
    expectedCrossMeasureTies.length
  histogram[TIE_SUSTAIN_CONSTRAINT.WRITTEN_CORRECT_SUSTAIN_WRONG] =
    writtenCorrectSustainWrong.length
  histogram[TIE_SUSTAIN_CONSTRAINT.SLUR_LIKE_ARC_PITCH_DIFFERS] =
    glyphOrphans.slurLikeArcPitchDiffers

  const dominant = Object.entries(histogram).sort((left, right) => right[1] - left[1])[0]

  const falseTieGuard = FALSE_TIE_GUARD_FIXTURES.has(fixtureId)
    ? {
        fixtureId,
        // Twinkle has no legitimate ties: any applied tie is a false positive.
        appliedTieCount: glyphOrphans.appliedTieCount,
        falseTiesApplied: glyphOrphans.appliedTieCount,
        clean: glyphOrphans.appliedTieCount === 0,
      }
    : null

  return {
    fixtureId,
    phase: 4,
    constraintHistogram: histogram,
    dominantConstraint: dominant?.[1] > 0 ? { bucket: dominant[0], count: dominant[1] } : null,
    tieGlyphOrphans: glyphOrphans,
    expectedCrossMeasureTies: expectedCrossMeasureTies.slice(0, 12),
    brokenContinuations: {
      startWithoutContinuation: brokenContinuations.startWithoutContinuation.slice(0, 12),
      continuationWithoutStart: brokenContinuations.continuationWithoutStart.slice(0, 12),
    },
    writtenCorrectSustainWrong: writtenCorrectSustainWrong.slice(0, 12),
    tieChainTraces: scoreGraphMeasures
      ? buildTieChainTraces(scoreGraphMeasures, { fixtureId })
      : null,
    falseTieGuard,
  }
}

export function formatTieSustainConstraintMarkdown(diagnostics, { indent = '' } = {}) {
  if (!diagnostics?.constraintHistogram) {
    return ''
  }
  const lines = [`${indent}Tie/sustain constraints (V2 Phase 4):`]
  const entries = Object.entries(diagnostics.constraintHistogram).filter(([, count]) => count > 0)
  if (!entries.length) {
    lines.push(`${indent}- (no tie/sustain constraint candidates in report sample)`)
  } else {
    for (const [bucket, count] of entries.sort((left, right) => right[1] - left[1])) {
      lines.push(`${indent}- ${bucket}: ${count}`)
    }
  }
  if (diagnostics.dominantConstraint) {
    lines.push(
      `${indent}- Dominant: ${diagnostics.dominantConstraint.bucket} (${diagnostics.dominantConstraint.count})`,
    )
  }
  const orphans = diagnostics.tieGlyphOrphans
  if (orphans) {
    lines.push(
      `${indent}- Tie glyphs: detected ${orphans.detectedTieCount}, applied ${orphans.appliedTieCount}, slur-like rejected ${orphans.slurLikeArcPitchDiffers}, unresolved ${orphans.unresolvedArcCount}`,
    )
  }
  if (diagnostics.tieChainTraces?.perMeasure?.length) {
    const traces = diagnostics.tieChainTraces
    lines.push(
      `${indent}- Tie chains (${traces.fixtureId}): ${traces.totalChains} chain(s) in ${traces.measureCount} measure(s), ${traces.malformedChains} malformed`,
    )
  }
  if (diagnostics.falseTieGuard) {
    const guard = diagnostics.falseTieGuard
    lines.push(
      `${indent}- False-tie guard (${guard.fixtureId}): ${guard.falseTiesApplied} applied ${guard.clean ? '(clean)' : '(REGRESSION)'}`,
    )
  }
  return `${lines.join('\n')}\n`
}
