/**
 * OMR Engine V2 Phase 6 — shadow voice-aware serialization solver.
 *
 * Targets grand-staff accompaniment-lane phase errors with per-lane (not clef-wide)
 * onset corrections. Reuses Phase 2C preservation + chord coalescing + truth gate.
 *
 * @see docs/OMR_V2_ROLLOUT_GATE.md
 */

import { SCORE_GRAPH_NODE } from './scoreGraph.js'
import { reconstructMeasureEvents } from './scoreGraphEmit.js'
import {
  buildMeasureStaffLaneDiagnostics,
  classifyStaffLaneForNote,
  measureClefContext,
  STAFF_LANE,
} from './scoreGraphStaffLaneDiagnostics.js'
import {
  detectCandidateFamily,
  scoreSoftFeatures,
  validateHardConstraints,
} from './scoreGraphSolver.js'
import { validateRhythmShadowPreservation, validateDurationCoupledPreservation } from './scoreGraphRhythmShadowConstraints.js'
import { coalesceSameVoiceChordEvents } from './scoreGraphRhythmShadowCoalesce.js'
import {
  coupleOverlappingDurations,
  summarizeDurationCoupling,
} from './scoreGraphDurationCoupling.js'

export const VOICE_SERIALIZATION_DECISION = {
  IDENTITY: 'identity',
  LANE_PHASE_SHIFT: 'lane-phase-shift',
  DURATION_COUPLED_LANE_SHIFT: 'duration-coupled-lane-shift',
}

export const VOICE_SERIALIZATION_REJECT = {
  NOT_IN_FAMILY: 'not-in-family',
  NO_VALID_VARIANT: 'no-valid-variant',
  NO_IMPROVEMENT: 'no-improvement',
  CONSTRAINTS_FAILED: 'constraints-failed',
  PRESERVATION_FAILED: 'preservation-failed',
}

const LANE_TARGET = {
  ACCOMPANIMENT: 'accompaniment',
  GRAND_STAFF_LATE: 'grand-staff-late',
}

const VARIANT_SPECS = [
  {
    id: 'accompaniment-adaptive-phase',
    label: 'accompaniment adaptive phase',
    target: LANE_TARGET.ACCOMPANIMENT,
    mode: 'adaptive',
  },
  {
    id: 'accompaniment-minus-2',
    label: 'accompaniment -0.5q',
    target: LANE_TARGET.ACCOMPANIMENT,
    mode: 'uniform',
    delta: -2,
  },
  {
    id: 'accompaniment-minus-3',
    label: 'accompaniment -0.75q',
    target: LANE_TARGET.ACCOMPANIMENT,
    mode: 'uniform',
    delta: -3,
  },
  {
    id: 'grand-staff-late-adaptive',
    label: 'grand-staff late adaptive',
    target: LANE_TARGET.GRAND_STAFF_LATE,
    mode: 'adaptive',
  },
  {
    id: 'grand-staff-late-minus-2',
    label: 'grand-staff late -0.5q',
    target: LANE_TARGET.GRAND_STAFF_LATE,
    mode: 'uniform',
    delta: -2,
  },
  {
    id: 'grand-staff-late-minus-3',
    label: 'grand-staff late -0.75q',
    target: LANE_TARGET.GRAND_STAFF_LATE,
    mode: 'uniform',
    delta: -3,
  },
]

const DURATION_COUPLED_SUFFIX = '-coupled'

function withDurationCoupledSpecs(specs = []) {
  return specs.flatMap((spec) => [
    spec,
    {
      ...spec,
      id: `${spec.id}${DURATION_COUPLED_SUFFIX}`,
      label: `${spec.label} + duration couple`,
      durationCoupled: true,
    },
  ])
}

const VARIANT_SPECS_ALL = withDurationCoupledSpecs(VARIANT_SPECS)

function cloneBeamMetadata(beams) {
  if (Array.isArray(beams)) {
    return beams.map((beam) => (beam && typeof beam === 'object' ? { ...beam } : beam))
  }
  if (beams && typeof beams === 'object') {
    return { ...beams }
  }
  return beams ?? undefined
}

function cloneEvents(events = []) {
  return events.map((event) => ({
    ...event,
    notes: event.notes ? event.notes.map((note) => ({ ...note })) : undefined,
    beams: cloneBeamMetadata(event.beams),
  }))
}

function noteKey(note, onset) {
  return `${note.midi}|${note.clef ?? 'treble'}|${onset ?? 0}`
}

function adaptivePhaseDelta(onsetDivision) {
  const mod = onsetDivision % 4
  if (mod === 0 || mod === 2) {
    return -2
  }
  if (mod === 1 || mod === 3) {
    return -3
  }
  return 0
}

function shouldShiftNote(note, event, laneInfo, target) {
  if (target === LANE_TARGET.ACCOMPANIMENT) {
    return laneInfo.staffLane === STAFF_LANE.ACCOMPANIMENT
  }
  if (target === LANE_TARGET.GRAND_STAFF_LATE) {
    return (
      laneInfo.staffLane === STAFF_LANE.ACCOMPANIMENT ||
      (laneInfo.staffLane === STAFF_LANE.MELODY && laneInfo.latePhaseEligible)
    )
  }
  return false
}

function deltaForNote(onset, mode, uniformDelta) {
  if (mode === 'uniform') {
    return uniformDelta ?? 0
  }
  return adaptivePhaseDelta(onset)
}

/**
 * Apply lane-targeted phase shift; may split mixed-lane chord events.
 */
export function applyLanePhaseShift(
  events,
  { target, mode, uniformDelta, totalDivisions, measureContext, allowDurationTrim = false },
) {
  const cloned = cloneEvents(events)
  const output = []

  for (const event of cloned) {
    if (event.type !== 'note') {
      output.push(event)
      continue
    }

    const onset = event.startDivision ?? 0
    const shiftGroups = new Map()

    for (const note of event.notes ?? []) {
      const laneInfo = classifyStaffLaneForNote(note, event, measureContext)
      const shift = shouldShiftNote(note, event, laneInfo, target)
        ? deltaForNote(onset, mode, uniformDelta)
        : 0
      const nextOnset = onset + shift

      if (shift !== 0 && nextOnset < 0) {
        return null
      }
      if (
        !allowDurationTrim &&
        shift !== 0 &&
        nextOnset + (event.durationDivisions ?? 0) > totalDivisions
      ) {
        return null
      }

      const groupKey = shift === 0 ? `keep:${onset}` : `shift:${nextOnset}`
      if (!shiftGroups.has(groupKey)) {
        shiftGroups.set(groupKey, {
          startDivision: shift === 0 ? onset : nextOnset,
          durationDivisions: event.durationDivisions,
          dotted: event.dotted,
          notes: [],
          beams: event.beams,
          tieStart: event.tieStart,
          tieStop: event.tieStop,
        })
      }
      shiftGroups.get(groupKey).notes.push({ ...note })
    }

    for (const group of shiftGroups.values()) {
      output.push({
        type: 'note',
        startDivision: group.startDivision,
        durationDivisions: group.durationDivisions,
        dotted: group.dotted,
        notes: group.notes,
        beams: group.beams,
        tieStart: group.tieStart,
        tieStop: group.tieStop,
      })
    }
  }

  output.sort((left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0))
  return output
}

/**
 * Lane shift followed by Phase 7 duration coupling and chord coalescing.
 */
export function applyDurationCoupledLaneVariant(
  events,
  { target, mode, uniformDelta, totalDivisions, measureContext, measureGraph },
) {
  const shifted = applyLanePhaseShift(events, {
    target,
    mode,
    uniformDelta,
    totalDivisions,
    measureContext,
    allowDurationTrim: true,
  })
  if (!shifted) {
    return null
  }
  const coupled = coupleOverlappingDurations(shifted, totalDivisions, { measureGraph })
  if (!coupled) {
    return null
  }
  const coalesced = coalesceSameVoiceChordEvents(coupled)
  return {
    events: coalesced.events,
    coalescedChords: coalesced.coalescedChords,
    coalescedCount: coalesced.coalescedCount,
    durationCoupling: summarizeDurationCoupling(events, coalesced.events),
  }
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
 * Family detector for voice-aware serialization — no measure numbers.
 */
export function detectVoiceSerializationCandidate(measureGraph = {}, events = []) {
  const laneDiag =
    measureGraph.staffLaneDiagnostics ?? buildMeasureStaffLaneDiagnostics(events)
  const reasons = []

  if (laneDiag.isGrandStaff) {
    reasons.push('grand-staff')
  }
  if (laneDiag.accompanimentCount >= 1) {
    reasons.push('accompaniment-lane')
  }
  if (laneDiag.latePhaseCount >= 1) {
    reasons.push('late-phase-figures')
  }
  if (laneDiag.crossStaffPairHints?.length) {
    reasons.push('cross-staff-pairing')
  }

  const beamFamily = detectCandidateFamily(measureGraph, { events })
  if (beamFamily.isCandidate && laneDiag.accompanimentCount >= 1) {
    reasons.push('beam-mixed-ownership')
  }

  return {
    isCandidate: laneDiag.isGrandStaff && laneDiag.accompanimentCount >= 1 && reasons.length >= 2,
    reasons: [...new Set(reasons)],
    laneDiagnostics: laneDiag,
  }
}

function rankVariant(
  measureGraph,
  events,
  totalDivisions,
  baselineEvents = null,
  { durationCoupled = false } = {},
) {
  const constraints = validateHardConstraints(events, totalDivisions)
  const soft = scoreSoftFeatures(measureGraph, events)
  const preservation = baselineEvents
    ? durationCoupled
      ? validateDurationCoupledPreservation(baselineEvents, events, { totalDivisions })
      : validateRhythmShadowPreservation(baselineEvents, events, { totalDivisions })
    : { pass: true, violations: [] }
  return {
    events,
    constraints,
    preservation,
    softScore: soft.total + beatGridScore(events) * 0.25,
    beatGridScore: beatGridScore(events),
    pass: constraints.pass && preservation.pass,
    rejectReason: !constraints.pass
      ? VOICE_SERIALIZATION_REJECT.CONSTRAINTS_FAILED
      : !preservation.pass
        ? VOICE_SERIALIZATION_REJECT.PRESERVATION_FAILED
        : null,
    preservationViolations: preservation.violations ?? [],
  }
}

/**
 * Shadow-only per-measure voice-aware serialization solve. Never mutates inputs.
 */
export function solveMeasureGraphVoiceSerializationShadow(measureGraph = {}) {
  const totalDivisions = measureGraph.totalDivisions ?? 16
  const baseline = reconstructMeasureEvents(measureGraph)
  const measureContext = measureClefContext(baseline)
  const family = detectVoiceSerializationCandidate(measureGraph, baseline)
  const baselineRank = rankVariant(measureGraph, baseline, totalDivisions)

  if (!family.isCandidate) {
    return {
      measureNumber: measureGraph.measureNumber,
      page: measureGraph.page,
      systemIndex: measureGraph.systemIndex,
      totalDivisions,
      events: baseline,
      applied: false,
      decision: VOICE_SERIALIZATION_DECISION.IDENTITY,
      variantId: null,
      rejected: true,
      rejectReason: VOICE_SERIALIZATION_REJECT.NOT_IN_FAMILY,
      family,
      baselineBeatGrid: baselineRank.beatGridScore,
      shadowBeatGrid: baselineRank.beatGridScore,
    }
  }

  const variants = [{ id: 'identity', events: baseline, label: 'identity' }]
  for (const spec of VARIANT_SPECS_ALL) {
    let built = null
    if (spec.durationCoupled) {
      built = applyDurationCoupledLaneVariant(baseline, {
        target: spec.target,
        mode: spec.mode,
        uniformDelta: spec.delta,
        totalDivisions,
        measureContext,
        measureGraph,
      })
      if (!built) {
        continue
      }
      variants.push({
        id: spec.id,
        events: built.events,
        label: spec.label,
        coalescedChords: built.coalescedChords,
        coalescedCount: built.coalescedCount,
        target: spec.target,
        mode: spec.mode,
        durationCoupled: true,
        durationCoupling: built.durationCoupling,
      })
      continue
    }

    const shifted = applyLanePhaseShift(baseline, {
      target: spec.target,
      mode: spec.mode,
      uniformDelta: spec.delta,
      totalDivisions,
      measureContext,
    })
    if (!shifted) {
      continue
    }
    const coalesced = coalesceSameVoiceChordEvents(shifted)
    variants.push({
      id: spec.id,
      events: coalesced.events,
      label: spec.label,
      coalescedChords: coalesced.coalescedChords,
      coalescedCount: coalesced.coalescedCount,
      target: spec.target,
      mode: spec.mode,
      durationCoupled: false,
    })
  }

  const ranked = []
  const rejectedVariants = []
  for (const variant of variants) {
    const rankedVariant = {
      ...variant,
      ...rankVariant(measureGraph, variant.events, totalDivisions, baseline, {
        durationCoupled: Boolean(variant.durationCoupled),
      }),
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
      target: variant.target ?? null,
      durationCoupled: Boolean(variant.durationCoupled),
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
      decision: VOICE_SERIALIZATION_DECISION.IDENTITY,
      variantId: null,
      rejected: true,
      rejectReason: VOICE_SERIALIZATION_REJECT.CONSTRAINTS_FAILED,
      family,
      baselineBeatGrid: baselineRank.beatGridScore,
      shadowBeatGrid: baselineRank.beatGridScore,
      rejectedVariants,
    }
  }

  const passing = ranked.filter((variant) => variant.pass)
  passing.sort(
    (left, right) =>
      right.softScore - left.softScore || right.beatGridScore - left.beatGridScore,
  )
  const best = passing[0]
  const identity = passing.find((variant) => variant.id === 'identity') ?? baselineRank

  const improved =
    best.id !== 'identity' &&
    (best.softScore > identity.softScore + 0.001 || best.beatGridScore > identity.beatGridScore + 0.05)

  if (!improved) {
    return {
      measureNumber: measureGraph.measureNumber,
      page: measureGraph.page,
      systemIndex: measureGraph.systemIndex,
      totalDivisions,
      events: baseline,
      applied: false,
      decision: VOICE_SERIALIZATION_DECISION.IDENTITY,
      variantId: null,
      rejected: true,
      rejectReason: VOICE_SERIALIZATION_REJECT.NO_IMPROVEMENT,
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
    decision: best.durationCoupled
      ? VOICE_SERIALIZATION_DECISION.DURATION_COUPLED_LANE_SHIFT
      : VOICE_SERIALIZATION_DECISION.LANE_PHASE_SHIFT,
    variantId: best.id,
    variantLabel: best.label,
    durationCoupled: Boolean(best.durationCoupled),
    durationCoupling: best.durationCoupling ?? null,
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
      target: best.target ?? null,
    },
  }
}

export function solveScoreGraphVoiceSerializationShadow(scoreGraph = { measures: [] }) {
  const measures = (scoreGraph.measures ?? []).map((measureGraph) =>
    solveMeasureGraphVoiceSerializationShadow(measureGraph),
  )
  return { measures, summary: summarizeVoiceSerializationShadowDiagnostics(measures) }
}

export function summarizeVoiceSerializationShadowDiagnostics(solverMeasures = []) {
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
  let durationCoupledAppliedCount = 0

  for (const measure of solverMeasures) {
    if (measure.family?.isCandidate) {
      candidateMeasures += 1
    }
    if (measure.applied) {
      changedMeasures += 1
      if (measure.durationCoupled) {
        durationCoupledAppliedCount += 1
      }
      variantCounts[measure.variantId] = (variantCounts[measure.variantId] ?? 0) + 1
      changedMeasureLog.push({
        measureNumber: measure.measureNumber,
        variantId: measure.variantId,
        variantLabel: measure.variantLabel,
        softScoreDelta: measure.softScoreDelta,
        durationCoupled: Boolean(measure.durationCoupled),
      })
      acceptedCandidateMeasures.push({
        measureNumber: measure.measureNumber,
        variantId: measure.variantId,
        variantLabel: measure.variantLabel,
        softScoreDelta: measure.softScoreDelta,
        familyReasons: measure.family?.reasons ?? [],
        coalescedCount: measure.coalescedCount ?? 0,
        target: measure.acceptedVariant?.target ?? null,
        durationCoupled: Boolean(measure.durationCoupled),
        durationCoupling: measure.durationCoupling ?? null,
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
    durationCoupledAppliedCount,
    constraintVersion: 'phase-7-duration-coupled',
  }
}
