/**
 * OMR Engine V2 Phase 2 — shadow rhythm/voice serialization solver prototype.
 *
 * Attempts family-detected onset phase corrections (e.g. bass accompaniment
 * shifted +0.5/+0.75q late) without touching runtime output or promotion.
 *
 * @see docs/OMR_ENGINE_V2_PLAN.md Phase 2
 */

import { SCORE_GRAPH_NODE } from './scoreGraph.js'
import { reconstructMeasureEvents } from './scoreGraphEmit.js'
import {
  detectCandidateFamily,
  scoreSoftFeatures,
  validateHardConstraints,
} from './scoreGraphSolver.js'
import { validateRhythmShadowPreservation } from './scoreGraphRhythmShadowConstraints.js'
import { coalesceSameVoiceChordEvents } from './scoreGraphRhythmShadowCoalesce.js'

export const RHYTHM_SOLVER_DECISION = {
  IDENTITY: 'identity',
  PHASE_SHIFT: 'phase-shift',
}

export const RHYTHM_SOLVER_REJECT = {
  NOT_IN_FAMILY: 'not-in-family',
  NO_VALID_VARIANT: 'no-valid-variant',
  NO_IMPROVEMENT: 'no-improvement',
  CONSTRAINTS_FAILED: 'constraints-failed',
  NOTE_COUNT_CHANGED: 'note-count-changed',
  DURATION_CHANGED: 'duration-changed',
  CHORD_SPLIT: 'chord-split',
  SAME_START_COLLISION: 'same-start-collision',
  ONSET_GROUP_REGRESSION: 'onset-group-regression',
  PRESERVATION_FAILED: 'preservation-failed',
}

const PHASE_SHIFT_VARIANTS = [
  { id: 'bass-minus-2', clef: 'bass', delta: -2, label: '-0.5q bass' },
  { id: 'bass-minus-3', clef: 'bass', delta: -3, label: '-0.75q bass' },
  { id: 'treble-minus-2', clef: 'treble', delta: -2, label: '-0.5q treble' },
]

function cloneEvents(events = []) {
  return events.map((event) => ({
    ...event,
    notes: event.notes ? event.notes.map((note) => ({ ...note })) : undefined,
  }))
}

function eventClef(event) {
  if (event.type === 'rest') {
    return event.clef ?? 'treble'
  }
  return event.notes?.[0]?.clef ?? 'treble'
}

function shiftClefOnsets(events, { clef, delta, totalDivisions }) {
  const cloned = cloneEvents(events)
  for (const event of cloned) {
    if (event.type !== 'note') {
      continue
    }
    if (eventClef(event) !== clef) {
      continue
    }
    const start = event.startDivision ?? 0
    const nextStart = start + delta
    if (nextStart < 0) {
      return null
    }
    if (nextStart + (event.durationDivisions ?? 0) > totalDivisions) {
      return null
    }
    event.startDivision = nextStart
  }
  cloned.sort((left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0))
  return cloned
}

function eventsEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a.type !== b.type || (a.startDivision ?? 0) !== (b.startDivision ?? 0)) {
      return false
    }
    if ((a.durationDivisions ?? 0) !== (b.durationDivisions ?? 0)) {
      return false
    }
  }
  return true
}

function beatGridScore(events = []) {
  const notes = events.filter((event) => event.type === 'note')
  if (!notes.length) {
    return 0
  }
  const onBeat = notes.filter((event) => (event.startDivision ?? 0) % 4 === 0).length
  return onBeat / notes.length
}

/**
 * Family detector for rhythm/voice serialization hotspots — no measure numbers.
 */
export function detectRhythmVoiceSerializationCandidate(measureGraph = {}, events = []) {
  const reasons = []
  const noteEvents = events.filter((event) => event.type === 'note')
  const hasTreble = noteEvents.some((event) => eventClef(event) === 'treble')
  const hasBass = noteEvents.some((event) => eventClef(event) === 'bass')

  if (hasTreble && hasBass) {
    reasons.push('grand-staff')
  }

  const bassStarts = noteEvents
    .filter((event) => eventClef(event) === 'bass')
    .map((event) => event.startDivision ?? 0)
  if (bassStarts.length >= 2) {
    const latePhase = bassStarts.filter((start) => start % 4 === 2 || start % 4 === 3).length
    if (latePhase / bassStarts.length >= 0.35) {
      reasons.push('bass-late-sixteenth-phase')
    }
  }

  const beamFamily = detectCandidateFamily(measureGraph, { events })
  if (beamFamily.isCandidate) {
    reasons.push(...beamFamily.reasons)
  }

  const onsetColumns = measureGraph.onsetColumns ?? []
  if (onsetColumns.length >= 4 && noteEvents.length >= 6) {
    reasons.push('dense-multi-column')
  }

  return {
    isCandidate: reasons.length > 0,
    reasons: [...new Set(reasons)],
  }
}

function rankVariant(measureGraph, events, totalDivisions, baselineEvents = null) {
  const constraints = validateHardConstraints(events, totalDivisions)
  const soft = scoreSoftFeatures(measureGraph, events)
  const preservation = baselineEvents
    ? validateRhythmShadowPreservation(baselineEvents, events, { totalDivisions })
    : { pass: true, violations: [] }
  return {
    events,
    constraints,
    preservation,
    softScore: soft.total + beatGridScore(events) * 0.25,
    beatGridScore: beatGridScore(events),
    pass: constraints.pass && preservation.pass,
    rejectReason: !constraints.pass
      ? RHYTHM_SOLVER_REJECT.CONSTRAINTS_FAILED
      : !preservation.pass
        ? RHYTHM_SOLVER_REJECT.PRESERVATION_FAILED
        : null,
    preservationViolations: preservation.violations ?? [],
  }
}

/**
 * Shadow-only per-measure rhythm solve. Never mutates inputs.
 */
export function solveMeasureGraphRhythmShadow(measureGraph = {}, options = {}) {
  const totalDivisions = measureGraph.totalDivisions ?? 16
  const baseline = reconstructMeasureEvents(measureGraph)
  const family = detectRhythmVoiceSerializationCandidate(measureGraph, baseline)
  const baselineRank = rankVariant(measureGraph, baseline, totalDivisions)

  if (!family.isCandidate) {
    return {
      measureNumber: measureGraph.measureNumber,
      page: measureGraph.page,
      systemIndex: measureGraph.systemIndex,
      totalDivisions,
      events: baseline,
      applied: false,
      decision: RHYTHM_SOLVER_DECISION.IDENTITY,
      variantId: null,
      rejected: true,
      rejectReason: RHYTHM_SOLVER_REJECT.NOT_IN_FAMILY,
      family,
      baselineBeatGrid: baselineRank.beatGridScore,
      shadowBeatGrid: baselineRank.beatGridScore,
    }
  }

  const variants = [{ id: 'identity', events: baseline, label: 'identity' }]
  for (const spec of PHASE_SHIFT_VARIANTS) {
    const shifted = shiftClefOnsets(baseline, {
      clef: spec.clef,
      delta: spec.delta,
      totalDivisions,
    })
    if (shifted) {
      const coalesced = coalesceSameVoiceChordEvents(shifted)
      variants.push({
        id: spec.id,
        events: coalesced.events,
        label: spec.label,
        coalescedChords: coalesced.coalescedChords,
        coalescedCount: coalesced.coalescedCount,
      })
    }
  }

  const ranked = []
  const rejectedVariants = []
  for (const variant of variants) {
    const rankedVariant = {
      ...variant,
      ...rankVariant(measureGraph, variant.events, totalDivisions, baseline),
    }
    if (rankedVariant.pass) {
      ranked.push(rankedVariant)
      continue
    }
    if (variant.id === 'identity') {
      ranked.push(rankedVariant)
      continue
    }
    rejectedVariants.push({
      variantId: variant.id,
      variantLabel: variant.label,
      rejectReason: rankedVariant.rejectReason,
      violations: rankedVariant.preservationViolations,
      coalescedCount: variant.coalescedCount ?? 0,
    })
  }

  if (!ranked.some((variant) => variant.pass)) {
    return {
      measureNumber: measureGraph.measureNumber,
      page: measureGraph.page,
      systemIndex: measureGraph.systemIndex,
      totalDivisions,
      events: baseline,
      applied: false,
      decision: RHYTHM_SOLVER_DECISION.IDENTITY,
      variantId: null,
      rejected: true,
      rejectReason: RHYTHM_SOLVER_REJECT.CONSTRAINTS_FAILED,
      family,
      baselineBeatGrid: baselineRank.beatGridScore,
      shadowBeatGrid: baselineRank.beatGridScore,
      rejectedVariants,
    }
  }

  const passing = ranked.filter((variant) => variant.pass)
  passing.sort(
    (left, right) =>
      right.softScore - left.softScore ||
      right.beatGridScore - left.beatGridScore,
  )
  const best = passing[0]
  const identity = passing.find((variant) => variant.id === 'identity') ?? baselineRank

  const improved =
    best.id !== 'identity' &&
    (best.softScore > identity.softScore + 0.001 ||
      best.beatGridScore > identity.beatGridScore + 0.05)

  if (!improved) {
    return {
      measureNumber: measureGraph.measureNumber,
      page: measureGraph.page,
      systemIndex: measureGraph.systemIndex,
      totalDivisions,
      events: baseline,
      applied: false,
      decision: RHYTHM_SOLVER_DECISION.IDENTITY,
      variantId: null,
      rejected: true,
      rejectReason: RHYTHM_SOLVER_REJECT.NO_IMPROVEMENT,
      family,
      baselineBeatGrid: baselineRank.beatGridScore,
      shadowBeatGrid: best.beatGridScore,
      bestVariantId: best.id,
      rejectedVariants,
    }
  }

  return {
    measureNumber: measureGraph.measureNumber,
    page: measureGraph.page,
    systemIndex: measureGraph.systemIndex,
    totalDivisions,
    events: best.events,
    applied: true,
    decision: RHYTHM_SOLVER_DECISION.PHASE_SHIFT,
    variantId: best.id,
    variantLabel: best.label,
    rejected: false,
    rejectReason: null,
    family,
    baselineBeatGrid: baselineRank.beatGridScore,
    shadowBeatGrid: best.beatGridScore,
    softScoreDelta: Math.round((best.softScore - identity.softScore) * 10000) / 10000,
    rejectedVariants,
    coalescedChords: best.coalescedChords ?? [],
    coalescedCount: best.coalescedCount ?? 0,
    acceptedVariant: {
      variantId: best.id,
      variantLabel: best.label,
      softScoreDelta: Math.round((best.softScore - identity.softScore) * 10000) / 10000,
      coalescedCount: best.coalescedCount ?? 0,
    },
  }
}

export function solveScoreGraphRhythmShadow(scoreGraph = { measures: [] }) {
  const measures = (scoreGraph.measures ?? []).map((measureGraph) =>
    solveMeasureGraphRhythmShadow(measureGraph),
  )
  return { measures, summary: summarizeRhythmShadowDiagnostics(measures) }
}

export function summarizeRhythmShadowDiagnostics(solverMeasures = []) {
  let candidateMeasures = 0
  let changedMeasures = 0
  let rejectedMeasures = 0
  const rejectReasons = {}
  const variantCounts = {}
  const changedMeasureLog = []
  const acceptedCandidateMeasures = []
  const rejectedCandidateMeasures = []

  let coalescedChordCount = 0
  const coalescedChordLog = []

  for (const measure of solverMeasures) {
    if (measure.family?.isCandidate) {
      candidateMeasures += 1
    }
    if (measure.applied) {
      changedMeasures += 1
      variantCounts[measure.variantId] = (variantCounts[measure.variantId] ?? 0) + 1
      changedMeasureLog.push({
        measureNumber: measure.measureNumber,
        variantId: measure.variantId,
        variantLabel: measure.variantLabel,
        softScoreDelta: measure.softScoreDelta,
      })
      acceptedCandidateMeasures.push({
        measureNumber: measure.measureNumber,
        variantId: measure.variantId,
        variantLabel: measure.variantLabel,
        softScoreDelta: measure.softScoreDelta,
        familyReasons: measure.family?.reasons ?? [],
        coalescedCount: measure.coalescedCount ?? 0,
      })
      coalescedChordCount += measure.coalescedCount ?? 0
      if (measure.coalescedChords?.length) {
        coalescedChordLog.push({
          measureNumber: measure.measureNumber,
          coalescedChords: measure.coalescedChords,
        })
      }
    }
    if (measure.rejected) {
      rejectedMeasures += 1
      const reason = measure.rejectReason ?? 'unknown'
      rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1
    }
    if (measure.family?.isCandidate && !measure.applied) {
      rejectedCandidateMeasures.push({
        measureNumber: measure.measureNumber,
        rejectReason: measure.rejectReason ?? null,
        bestVariantId: measure.bestVariantId ?? null,
        familyReasons: measure.family?.reasons ?? [],
        rejectedVariants: measure.rejectedVariants ?? [],
      })
    }
  }

  return {
    measureCount: solverMeasures.length,
    candidateMeasures,
    changedMeasures,
    rejectedMeasures,
    rejectReasons,
    variantCounts,
    changedMeasureNumbers: changedMeasureLog.map((entry) => entry.measureNumber),
    rejectedMeasureNumbers: solverMeasures
      .filter((measure) => measure.rejected && measure.family?.isCandidate)
      .map((measure) => measure.measureNumber),
    changedMeasureLog,
    acceptedCandidateMeasures,
    rejectedCandidateMeasures,
    coalescedChordCount,
    coalescedChordLog,
    constraintVersion: 'phase-2c',
  }
}
