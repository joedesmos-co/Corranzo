/**
 * ScoreGraph joint per-measure solver — Phase 3A: SKELETON, shadow only.
 *
 * `solveMeasureGraph` is a pure function that, for now, reproduces the current
 * runtime event interpretation EXACTLY (identity baseline). It additionally
 * assembles the data structures a real joint solve will need — voice / onset /
 * duration candidates, hard-constraint validation, soft-feature scores, a
 * confidence/margin, and candidate-family detection — but never alters events.
 *
 * Nothing here is wired into runtime output or playback. It exists to make the
 * solver's inputs observable and to prove the identity path is byte-identical to
 * runtime before any real solving is attempted.
 */

import { SCORE_GRAPH_NODE, SCORE_GRAPH_EDGE, buildScoreGraph } from './scoreGraph.js'
import {
  reconstructMeasureEvents,
  compareRuntimeVsShadow,
  evaluateShadowAgreement,
} from './scoreGraphEmit.js'
import { buildOmrMusicXml } from './buildOmrMusicXml.js'

const DURATION_LADDER = [1, 2, 3, 4, 6, 8, 12, 16]
const LADDER_SET = new Set(DURATION_LADDER)
const DOTTED_DIVISIONS = new Set([3, 6, 12])

export const SOLVER_FALLBACK = {
  IDENTITY_BASELINE: 'identity-baseline',
  AMBIGUOUS_CULPRIT: 'ambiguous-culprit',
  CLIP_UNRESOLVED: 'clip-unresolved',
}

export const SOLVER_DECISION = {
  IDENTITY: 'identity',
  CLIP: 'hard-constraint-clip',
}

function voiceForClef(clef) {
  return clef === 'bass' ? 2 : 1
}

function eventVoice(event) {
  if (event.type === 'rest') {
    return voiceForClef(event.clef)
  }
  return voiceForClef(event.notes?.[0]?.clef)
}

/**
 * Hard-constraint validation over a measure's events. In 3A this is diagnostic
 * only — it never changes events — but it flags the measures whose runtime
 * interpretation is structurally inconsistent (the future solver's targets).
 */
export function validateHardConstraints(events = [], totalDivisions = 16) {
  const violations = []
  const perVoice = new Map()

  for (const event of events) {
    const voice = eventVoice(event)
    const start = event.startDivision ?? 0
    const duration = event.durationDivisions ?? 0
    if (start + duration > totalDivisions) {
      violations.push({ type: 'overflow', voice, start, duration })
    }
    if (!perVoice.has(voice)) {
      perVoice.set(voice, [])
    }
    perVoice.get(voice).push({ start, end: start + duration })
  }

  const perVoiceFill = {}
  for (const [voice, spans] of perVoice) {
    spans.sort((a, b) => a.start - b.start)
    let fill = 0
    let hasOverlap = false
    let hasGap = false
    for (let index = 0; index < spans.length; index += 1) {
      fill += spans[index].end - spans[index].start
      if (index > 0) {
        if (spans[index].start < spans[index - 1].end) {
          hasOverlap = true
        } else if (spans[index].start > spans[index - 1].end) {
          hasGap = true
        }
      }
    }
    if (hasOverlap) {
      violations.push({ type: 'voice-overlap', voice })
    }
    perVoiceFill[voice] = {
      fill,
      hasOverlap,
      hasGap,
      coversBudget: fill === totalDivisions,
    }
  }

  return {
    // Overflow / same-voice overlap are unambiguous violations; gaps/underfill
    // are reported but not treated as hard failures (rests may be implicit).
    pass: violations.length === 0,
    violations,
    perVoiceFill,
  }
}

/**
 * Soft-feature scores for the measure. Stub scoring in 3A: computed and reported,
 * never used to change events. These become the weighted objective terms later.
 */
export function scoreSoftFeatures(measureGraph = {}, events = []) {
  const nodes = measureGraph.nodes ?? []
  const beamNodes = nodes.filter((node) => node.kind === SCORE_GRAPH_NODE.BEAM).length
  const voices = new Set(events.map((event) => eventVoice(event)))
  const noteEvents = events.filter((event) => event.type === 'note')
  const onGrid = noteEvents.filter((event) => (event.startDivision ?? 0) % 2 === 0).length

  const features = {
    beamNodes,
    voiceCount: voices.size,
    noteEventCount: noteEvents.length,
    onsetGridRegularity: noteEvents.length ? onGrid / noteEvents.length : 1,
  }
  // Placeholder aggregate; real weights are calibrated against the benchmark later.
  const total = features.onsetGridRegularity
  return { total, features }
}

// Map each event-notehead node id to whether a beam reaches it, by traversing
// beam_links_stem -> stem_owns_head -> (geometry bridge target) edges.
function noteheadsWithBeamEvidence(measureGraph) {
  const edges = measureGraph.edges ?? []
  const beamedStems = new Set()
  for (const edge of edges) {
    if (edge.kind === SCORE_GRAPH_EDGE.BEAM_LINKS_STEM) {
      beamedStems.add(edge.to)
    }
  }
  const beamedHeads = new Set()
  for (const edge of edges) {
    if (edge.kind === SCORE_GRAPH_EDGE.STEM_OWNS_HEAD && beamedStems.has(edge.from)) {
      beamedHeads.add(edge.to)
    }
  }
  return beamedHeads
}

/**
 * Detect measures in the first solver candidate family: mixed beam/stem
 * ownership (a beamed subset shares an onset with an un-beamed / sustained note)
 * or a hard-constraint violation. Does not alter events.
 */
export function detectCandidateFamily(measureGraph = {}, { events = [], hardConstraints = null } = {}) {
  const reasons = []
  const beamedHeads = noteheadsWithBeamEvidence(measureGraph)

  if (beamedHeads.size > 0) {
    const noteheads = (measureGraph.nodes ?? []).filter(
      (node) => node.kind === SCORE_GRAPH_NODE.NOTEHEAD,
    )
    const byOnset = new Map()
    for (const head of noteheads) {
      const key = head.onsetDivision ?? 0
      if (!byOnset.has(key)) {
        byOnset.set(key, [])
      }
      byOnset.get(key).push(head)
    }
    for (const [, heads] of byOnset) {
      const beamed = heads.filter((head) => beamedHeads.has(head.id))
      const unbeamed = heads.filter((head) => !beamedHeads.has(head.id))
      if (beamed.length > 0 && unbeamed.length > 0) {
        const beamedDur = new Set(beamed.map((h) => h.durationDivisions))
        const unbeamedDur = new Set(unbeamed.map((h) => h.durationDivisions))
        const differs = [...unbeamedDur].some((d) => !beamedDur.has(d))
        if (differs) {
          reasons.push('mixed-beam-ownership-column')
          break
        }
      }
    }
  }

  const hc = hardConstraints ?? validateHardConstraints(events, measureGraph.totalDivisions ?? 16)
  if (!hc.pass) {
    reasons.push('hard-constraint-violation')
  }

  return { isCandidate: reasons.length > 0, reasons }
}

/**
 * Enumerate the candidate structures a real solve would search over. In 3A these
 * are produced for observability only; nothing consumes them to change events.
 */
export function enumerateSolverCandidates(measureGraph = {}, events = [], totalDivisions = 16) {
  const voices = new Set(events.map((event) => eventVoice(event)))
  return {
    onsetColumns: measureGraph.onsetColumns ?? [],
    voices: [...voices].sort(),
    voiceCount: voices.size,
    durationLadder: DURATION_LADDER.filter((value) => value <= totalDivisions),
    // The current clef-based assignment, expressed as the single candidate. Future
    // phases add alternatives here for the beam search to rank.
    voiceAssignmentCandidates: [{ source: 'clef-baseline', voices: [...voices].sort() }],
  }
}

function clipMeta(divisions) {
  // Snap is trivial here because clip targets are validated against the ladder.
  return { durationDivisions: divisions, durationType: undefined, dotted: DOTTED_DIVISIONS.has(divisions) }
}

/**
 * The first real solver decision (Phase 3B): resolve same-voice overlap and
 * measure overflow by clipping the over-extended note to the next same-voice
 * onset (or the measure budget). Only clips when the culprit is unambiguous and
 * the clip target is a clean note value; otherwise reports ambiguity so the
 * caller falls back to identity. Works on a copy — never mutates the input.
 */
export function clipHardConstraintViolations(events = [], totalDivisions = 16) {
  const cloned = events.map((event) => ({
    ...event,
    notes: event.notes ? event.notes.map((note) => ({ ...note })) : undefined,
  }))
  const decisions = []
  let ambiguous = false

  const voices = new Map()
  cloned.forEach((event, index) => {
    const voice = eventVoice(event)
    if (!voices.has(voice)) {
      voices.set(voice, [])
    }
    voices.get(voice).push(index)
  })

  for (const [voice, indices] of voices) {
    const starts = indices.map((index) => cloned[index].startDivision ?? 0)
    for (const index of indices) {
      const event = cloned[index]
      if (event.type !== 'note') {
        continue
      }
      const start = event.startDivision ?? 0
      const end = start + (event.durationDivisions ?? 0)
      const laterStarts = starts.filter((value) => value > start)
      const nextBoundary = laterStarts.length ? Math.min(...laterStarts) : totalDivisions
      if (end <= nextBoundary) {
        continue // this note does not over-extend
      }
      const gap = nextBoundary - start
      if (gap <= 0 || !LADDER_SET.has(gap)) {
        // Ambiguous: cannot clip to a clean note value (onset grid is off, or the
        // note starts on/after the boundary). Leave the whole measure to identity.
        ambiguous = true
        continue
      }
      decisions.push({
        voice,
        startDivision: start,
        violation: laterStarts.length ? 'same-voice-overlap' : 'overflow',
        before: event.durationDivisions ?? 0,
        after: gap,
      })
      Object.assign(event, clipMeta(gap))
    }
  }

  return { events: cloned, decisions, ambiguous }
}

/**
 * Solve one measure. Identity everywhere except cleanly-resolvable hard-constraint
 * violations, where the clip decision above is applied — SHADOW ONLY.
 */
export function solveMeasureGraph(measureGraph = {}) {
  const totalDivisions = measureGraph.totalDivisions ?? 16
  const baseline = reconstructMeasureEvents(measureGraph)
  const baselineConstraints = validateHardConstraints(baseline, totalDivisions)
  const softScore = scoreSoftFeatures(measureGraph, baseline)
  const candidateFamily = detectCandidateFamily(measureGraph, {
    events: baseline,
    hardConstraints: baselineConstraints,
  })
  const candidates = enumerateSolverCandidates(measureGraph, baseline, totalDivisions)

  let events = baseline
  let decision = SOLVER_DECISION.IDENTITY
  let decisions = []
  let confidence = 1
  let margin = 0
  let fallbackReason = SOLVER_FALLBACK.IDENTITY_BASELINE

  if (!baselineConstraints.pass) {
    const clip = clipHardConstraintViolations(baseline, totalDivisions)
    const clippedConstraints = validateHardConstraints(clip.events, totalDivisions)
    if (!clip.ambiguous && clip.decisions.length > 0 && clippedConstraints.pass) {
      events = clip.events
      decision = SOLVER_DECISION.CLIP
      decisions = clip.decisions
      const corrected = clip.decisions.reduce((sum, entry) => sum + (entry.before - entry.after), 0)
      margin = Math.round((corrected / Math.max(1, totalDivisions)) * 10000) / 10000
      confidence = 0.9
      fallbackReason = null
    } else {
      // A violation we cannot safely fix — keep runtime interpretation.
      confidence = 0.3
      fallbackReason = clip.ambiguous
        ? SOLVER_FALLBACK.AMBIGUOUS_CULPRIT
        : SOLVER_FALLBACK.CLIP_UNRESOLVED
    }
  }

  const applied = decision === SOLVER_DECISION.CLIP

  return {
    measureNumber: measureGraph.measureNumber,
    page: measureGraph.page,
    systemIndex: measureGraph.systemIndex,
    totalDivisions,
    events, // clipped only for cleanly-resolvable violations; identity otherwise
    applied,
    decision,
    decisions,
    candidateFamily,
    hardConstraints: applied ? validateHardConstraints(events, totalDivisions) : baselineConstraints,
    baselineHardConstraints: baselineConstraints,
    softScore,
    candidates,
    confidence,
    margin,
    fallbackReason,
  }
}

/**
 * Solve every measure of a ScoreGraph (identity) and summarize the diagnostics.
 */
export function solveScoreGraph(scoreGraph = { measures: [] }, options = {}) {
  const measures = (scoreGraph.measures ?? []).map((measureGraph) =>
    solveMeasureGraph(measureGraph, options),
  )
  return { measures, summary: summarizeSolverDiagnostics(measures) }
}

export function summarizeSolverDiagnostics(solverMeasures = []) {
  let candidateMeasures = 0
  let hardConstraintFailures = 0
  let changedMeasures = 0
  let clipDecisions = 0
  const candidateReasons = {}
  const fallbackReasons = {}
  const violationTypes = {}
  const changedMeasureLog = []
  for (const measure of solverMeasures) {
    if (measure.candidateFamily?.isCandidate) {
      candidateMeasures += 1
      for (const reason of measure.candidateFamily.reasons) {
        candidateReasons[reason] = (candidateReasons[reason] ?? 0) + 1
      }
    }
    if (measure.baselineHardConstraints && !measure.baselineHardConstraints.pass) {
      hardConstraintFailures += 1
    }
    const fallback = measure.fallbackReason ?? 'none'
    fallbackReasons[fallback] = (fallbackReasons[fallback] ?? 0) + 1
    if (measure.applied) {
      changedMeasures += 1
      clipDecisions += measure.decisions?.length ?? 0
      for (const decision of measure.decisions ?? []) {
        violationTypes[decision.violation] = (violationTypes[decision.violation] ?? 0) + 1
      }
      changedMeasureLog.push({
        measureNumber: measure.measureNumber,
        confidence: measure.confidence,
        margin: measure.margin,
        decisions: measure.decisions,
      })
    }
  }
  return {
    measureCount: solverMeasures.length,
    candidateMeasures,
    hardConstraintFailures,
    changedMeasures,
    clipDecisions,
    violationTypes,
    candidateReasons,
    fallbackReasons,
    candidateMeasureNumbers: solverMeasures
      .filter((measure) => measure.candidateFamily?.isCandidate)
      .map((measure) => measure.measureNumber),
    changedMeasureNumbers: changedMeasureLog.map((entry) => entry.measureNumber),
    changedMeasureLog,
  }
}

/**
 * Emit shadow MusicXML from the solver's per-measure events, reusing the runtime
 * serializer. In 3A this equals the runtime output (identity).
 */
export function emitMusicXmlFromSolver(scoreGraph, { musical = {}, title = 'ScoreGraph solver shadow' } = {}) {
  const solved = solveScoreGraph(scoreGraph)
  const measures = solved.measures.map((measure) => ({
    measureNumber: measure.measureNumber,
    page: measure.page,
    systemIndex: measure.systemIndex,
    events: measure.events,
  }))
  return buildOmrMusicXml({ title, measures, musical, includeDisclaimer: true })
}

/**
 * Three-way shadow report: runtime XML vs ScoreGraph-emit XML vs solver XML,
 * plus the solver's candidate-family / hard-constraint diagnostics.
 */
export function buildSolverShadowReport({
  id = 'fixture',
  runtimeXml,
  scoreGraph,
  musical = {},
  truthXml = null,
} = {}) {
  const solved = solveScoreGraph(scoreGraph)
  const solverXml = emitMusicXmlFromSolver(scoreGraph, { musical, title: id })

  const vsRuntime = compareRuntimeVsShadow(runtimeXml, solverXml)
  const agreement = evaluateShadowAgreement(solverXml, runtimeXml)

  // Evaluator delta vs truth: did the clip decisions improve or hold duration /
  // onset without regressing pitch / chord? Positive delta = solver beats runtime.
  let vsTruth = null
  if (truthXml) {
    const runtimeVsTruth = evaluateShadowAgreement(runtimeXml, truthXml)
    const solverVsTruth = evaluateShadowAgreement(solverXml, truthXml)
    const delta = {}
    for (const key of Object.keys(runtimeVsTruth)) {
      const a = solverVsTruth[key]
      const b = runtimeVsTruth[key]
      delta[key] = a != null && b != null ? Math.round((a - b) * 10000) / 10000 : null
    }
    vsTruth = { runtime: runtimeVsTruth, solver: solverVsTruth, delta }
  }

  return {
    id,
    diagnostics: solved.summary,
    solverVsRuntime: {
      noteCountDiff: vsRuntime.noteCountDiff,
      measureCountDiff: vsRuntime.measureCountDiff,
      identicalBytes: vsRuntime.identicalBytes,
      agreement,
    },
    vsTruth,
    candidateMeasures: solved.summary.candidateMeasureNumbers,
    changedMeasures: solved.summary.changedMeasureNumbers,
  }
}

/**
 * PROMOTION (Phase 3C) — gated, default-off. Surgically apply high-confidence
 * clip decisions to the ORIGINAL runtime measure records: only the clipped note's
 * duration fields change; every other note keeps its exact object, so the promoted
 * measure serializes byte-identically to runtime apart from the clipped duration.
 * Pure — returns new records, never mutates the inputs.
 */
export function promoteClipDecisions(measures = [], solverMeasures = [], { minConfidence = 0.9 } = {}) {
  const solverByMeasure = new Map(
    solverMeasures.map((measure) => [measure.measureNumber, measure]),
  )
  const promotedLog = []
  const skipped = []

  const next = measures.map((measure) => {
    const solver = solverByMeasure.get(measure.measureNumber)
    if (!solver || !solver.applied || (solver.confidence ?? 0) < minConfidence) {
      return measure // identity / low-confidence / not in family → unchanged reference
    }

    const events = measure.events ?? []
    const nextEvents = events.slice() // same references; only clipped events replaced
    const appliedDecisions = []

    for (const decision of solver.decisions ?? []) {
      const matches = []
      nextEvents.forEach((event, index) => {
        if (
          event?.type === 'note' &&
          (event.startDivision ?? 0) === decision.startDivision &&
          eventVoice(event) === decision.voice
        ) {
          matches.push(index)
        }
      })
      if (matches.length !== 1) {
        skipped.push({ measureNumber: measure.measureNumber, reason: 'ambiguous-event-match', decision })
        continue
      }
      const index = matches[0]
      const before = nextEvents[index].durationDivisions ?? null
      nextEvents[index] = { ...nextEvents[index], ...clipMeta(decision.after) }
      appliedDecisions.push({
        voice: decision.voice,
        startDivision: decision.startDivision,
        violation: decision.violation,
        before,
        after: decision.after,
      })
    }

    if (!appliedDecisions.length) {
      return measure
    }
    promotedLog.push({
      measureNumber: measure.measureNumber,
      confidence: solver.confidence,
      margin: solver.margin,
      decisions: appliedDecisions,
    })
    return { ...measure, events: nextEvents }
  })

  return {
    measures: next,
    promotedMeasureNumbers: promotedLog.map((entry) => entry.measureNumber),
    promotedLog,
    skipped,
    summary: {
      promotedMeasureCount: promotedLog.length,
      promotedDecisions: promotedLog.reduce((sum, entry) => sum + entry.decisions.length, 0),
      skippedCount: skipped.length,
      minConfidence,
    },
  }
}

/**
 * Convenience: build the ScoreGraph from runtime measure records, solve, and
 * promote — used by the gated pipeline path and the benchmark dev flag.
 */
export function promoteMeasureRhythmsWithClips(measureRhythms = [], { totalDivisions = null, minConfidence = 0.9 } = {}) {
  const pages = [
    {
      page: measureRhythms[0]?.page ?? 1,
      systems: [{ systemIndex: 0, measures: measureRhythms }],
    },
  ]
  const scoreGraph = buildScoreGraph(pages, totalDivisions != null ? { totalDivisions } : {})
  const solved = solveScoreGraph(scoreGraph)
  return promoteClipDecisions(measureRhythms, solved.measures, { minConfidence })
}

function pct(value) {
  return value == null ? 'n/a' : `${Math.round(value * 100)}%`
}

function signed(value) {
  if (value == null) {
    return 'n/a'
  }
  const rounded = Math.round(value * 10000) / 100
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}

export function formatSolverShadowMarkdown(reports = []) {
  const lines = ['# ScoreGraph solver (shadow) — hard-constraint clip', '', `Fixtures: ${reports.length}`, '']
  for (const report of reports) {
    const d = report.diagnostics
    const s = report.solverVsRuntime
    lines.push(`## ${report.id}`)
    lines.push(
      `- solver vs runtime: notesΔ ${s.noteCountDiff}, measuresΔ ${s.measureCountDiff}, identical-bytes ${s.identicalBytes}`,
    )
    lines.push(
      `- changed shadow measures: ${d.changedMeasures}/${d.measureCount} (${d.clipDecisions} clip decisions)`,
    )
    lines.push(
      `- solver↔runtime agreement (whole score): pitch ${pct(s.agreement.pitch)}, duration ${pct(s.agreement.duration)}, onset ${pct(s.agreement.onset)}, chord ${pct(s.agreement.chord)}`,
    )
    const vTypes = Object.entries(d.violationTypes)
      .map(([type, count]) => `${type}:${count}`)
      .join(', ')
    if (vTypes) {
      lines.push(`- clip violation types: ${vTypes}`)
    }
    lines.push(
      `- candidate-family measures: ${d.candidateMeasures}/${d.measureCount} (hard-constraint failures ${d.hardConstraintFailures})`,
    )
    const fallbacks = Object.entries(d.fallbackReasons)
      .filter(([reason]) => reason !== 'null' && reason !== 'none')
      .map(([reason, count]) => `${reason}:${count}`)
      .join(', ')
    if (fallbacks) {
      lines.push(`- fallbacks: ${fallbacks}`)
    }
    if (report.vsTruth) {
      const delta = report.vsTruth.delta
      lines.push(
        `- shadow − runtime vs truth: duration ${signed(delta.duration)}, onset ${signed(delta.onset)}, pitch ${signed(delta.pitch)}, chord ${signed(delta.chord)}, F1 ${signed(delta.f1)}`,
      )
    }
    const changed = d.changedMeasureNumbers.slice(0, 20)
    if (changed.length) {
      lines.push(`- changed measure numbers (first 20): ${changed.join(', ')}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}
