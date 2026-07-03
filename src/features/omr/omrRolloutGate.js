/**
 * OMR Engine V2 Phase 5 — rollout gate and next-target selection.
 *
 * Aggregates Phase 1–4 diagnostics into a single corpus report, ranks solver
 * targets by impact / risk / IR readiness / regression likelihood, and emits a
 * recommended Phase 6 implementation prompt. Diagnostic/planning only.
 *
 * @see docs/OMR_ENGINE_V2_PLAN.md
 * @see docs/OMR_V2_ROLLOUT_GATE.md
 */

import { RHYTHM_ERROR_ATTRIBUTION } from './omrRhythmErrorAttribution.js'
import { WRITTEN_SOUNDING_DURATION_CLASS } from './omrWrittenSoundingDurationDiagnostics.js'
import { TIE_SUSTAIN_CONSTRAINT } from './omrTieSustainConstraintDiagnostics.js'

export const SOLVER_TARGET = {
  VOICE_AWARE_SERIALIZATION: 'voice-aware-serialization',
  WRITTEN_SOUNDING_DURATION: 'written-sounding-duration-solver',
  TIE_SUSTAIN_CONSTRAINT: 'tie-sustain-constraint-solver',
  ONSET_GRID_REFINEMENT: 'onset-grid-refinement',
  MEASURE_LEVEL_SOLVER: 'measure-level-solver-variant',
}

export const TARGET_STATUS = {
  RECOMMENDED: 'recommended',
  ELIGIBLE_PREP: 'eligible-prep',
  BLOCKED_PREMATURE: 'blocked-premature',
  BLOCKED_EXHAUSTED: 'blocked-exhausted',
}

/** Frozen baseline metrics (2026-07-03 dashboard). */
export const FROZEN_BASELINE = {
  clean: { wrongOnset: 0, wrongDuration: 0, chordMismatch: 0, wrongPitch: 0 },
  dense: { wrongOnset: 94, wrongDuration: 77, chordMismatch: 172, wrongPitch: 147 },
  simple: { wrongOnset: 6, wrongDuration: 3, chordMismatch: 0, wrongPitch: 0 },
}

function sumBuckets(buckets = {}) {
  return Object.values(buckets).reduce((sum, count) => sum + (Number(count) || 0), 0)
}

function denseRecord(records = []) {
  return records.find((record) => record.id === 'dense') ?? null
}

function simpleRecord(records = []) {
  return records.find((record) => record.id === 'simple') ?? null
}

function cleanRecord(records = []) {
  return records.find((record) => record.id === 'clean') ?? null
}

/**
 * Collect Phase 1–4 evidence from dashboard fixture records.
 */
export function collectV2DiagnosticEvidence(records = []) {
  const dense = denseRecord(records)
  const simple = simpleRecord(records)
  const clean = cleanRecord(records)

  const phase1 = dense?.metrics?.rhythmErrorAttribution ?? null
  const phase1Buckets = phase1?.buckets ?? {}

  const phase2 = dense?.rhythmShadow ?? null
  const phase2Changed = phase2?.solverDiagnostics?.changedMeasures ?? 0
  const phase2Accepted = phase2?.solverDiagnostics?.acceptedCandidateMeasures?.length ?? 0
  const phase2Rejected = phase2?.solverDiagnostics?.rejectedMeasures ?? 125

  const phase3 = dense?.writtenSoundingDuration ?? null
  const phase3Hist = phase3?.writtenSoundingHistogram ?? {}

  const phase4 = dense?.tieSustainConstraints ?? null
  const phase4Hist = phase4?.constraintHistogram ?? {}

  const simpleFalseTieGuard = simple?.tieSustainConstraints?.falseTieGuard ?? null

  return {
    phase1: {
      buckets: phase1Buckets,
      primaryBucket: phase1?.primaryBucket ?? null,
      voiceSerializationShift:
        phase1Buckets[RHYTHM_ERROR_ATTRIBUTION.VOICE_SERIALIZATION_SHIFT] ?? 0,
      onsetPhaseShift: phase1Buckets[RHYTHM_ERROR_ATTRIBUTION.ONSET_PHASE_SHIFT] ?? 0,
      onsetCoupledDuration: phase1Buckets[RHYTHM_ERROR_ATTRIBUTION.ONSET_COUPLED_DURATION] ?? 0,
      chordGroupingSymptom: phase1Buckets[RHYTHM_ERROR_ATTRIBUTION.CHORD_GROUPING_SYMPTOM] ?? 0,
      pitchGroupingSymptom: phase1Buckets[RHYTHM_ERROR_ATTRIBUTION.PITCH_GROUPING_SYMPTOM] ?? 0,
    },
    phase2: {
      status: phase2?.status ?? 'unavailable',
      changedMeasures: phase2Changed,
      acceptedCandidates: phase2Accepted,
      rejectedMeasures: phase2Rejected,
      globalDelta: phase2?.globalDelta ?? null,
      promoted: Boolean(phase2?.promoted),
      constraintVersion: phase2?.constraintVersion ?? null,
      exhausted: phase2Changed === 0 && phase2Accepted === 0,
    },
    phase3: {
      histogram: phase3Hist,
      onsetCoupledDuration: phase3Hist[WRITTEN_SOUNDING_DURATION_CLASS.ONSET_COUPLED_DURATION] ?? 0,
      writtenDurationWrong: phase3Hist[WRITTEN_SOUNDING_DURATION_CLASS.WRITTEN_DURATION_WRONG] ?? 0,
      soundingReleaseWrong:
        phase3Hist[WRITTEN_SOUNDING_DURATION_CLASS.SOUNDING_RELEASE_WRONG] ?? 0,
      tieSustainRelated: phase3Hist[WRITTEN_SOUNDING_DURATION_CLASS.TIE_SUSTAIN_RELATED] ?? 0,
      dominantClass: phase3?.dominantClass ?? null,
    },
    phase4: {
      histogram: phase4Hist,
      expectedCrossMeasureTie: phase4Hist[TIE_SUSTAIN_CONSTRAINT.EXPECTED_CROSS_MEASURE_TIE] ?? 0,
      writtenCorrectSustainWrong:
        phase4Hist[TIE_SUSTAIN_CONSTRAINT.WRITTEN_CORRECT_SUSTAIN_WRONG] ?? 0,
      slurLikeRejected: phase4Hist[TIE_SUSTAIN_CONSTRAINT.SLUR_LIKE_ARC_PITCH_DIFFERS] ?? 0,
      dominantConstraint: phase4?.dominantConstraint ?? null,
    },
    canaries: {
      twinkleFalseTieGuard: simpleFalseTieGuard,
      twinkleWrongOnset: simple?.metrics?.wrongOnset ?? null,
      twinkleHotspotM10: simple?.writtenSoundingDuration?.hotspotTraces?.find(
        (entry) => entry.measureNumber === 10,
      ) ?? null,
      gymopedieMetrics: clean?.metrics
        ? {
            pitchAccuracy: clean.metrics.pitchAccuracy,
            durationAccuracy: clean.metrics.durationAccuracy,
            onsetAccuracy: clean.metrics.onsetAccuracy,
            chordGroupingAccuracy: clean.metrics.chordGroupingAccuracy,
          }
        : null,
      denseHotspots: phase3?.hotspotMeasures ?? [7, 9, 121],
    },
    frozenBaseline: FROZEN_BASELINE,
  }
}

function scoreTarget(targetId, evidence) {
  const p1 = evidence.phase1
  const p2 = evidence.phase2
  const p3 = evidence.phase3
  const p4 = evidence.phase4

  const profiles = {
    [SOLVER_TARGET.VOICE_AWARE_SERIALIZATION]: {
      impact: 5,
      safety: 2,
      irReadiness: 3,
      antiRegression: 2,
      rationale: [
        `Highest root-cause impact: ${p1.voiceSerializationShift} voice-serialization-shift onsets, ${p1.chordGroupingSymptom} chord-grouping symptoms on dense.`,
        'Twinkle m10 is 100% accompaniment-lane phase error — the narrowest canary for this family.',
        'Clef-only phase shifts (Phase 2) are exhausted; voice-lane assignment is the missing variable.',
      ],
      blockers: [
        'High regression risk on Twinkle and dense chord grouping.',
        'ScoreGraph IR has clef/voice export labels but no stable staff-lane voiceId yet.',
      ],
      status: TARGET_STATUS.RECOMMENDED,
    },
    [SOLVER_TARGET.WRITTEN_SOUNDING_DURATION]: {
      impact: 4,
      safety: 3,
      irReadiness: 5,
      antiRegression: 2,
      rationale: [
        `Phase 3 IR fields populated; ${p3.onsetCoupledDuration} onset-coupled + ${p3.writtenDurationWrong} written-duration-wrong errors on dense.`,
        'Written vs sounding split is observation-ready for solver constraints.',
      ],
      blockers: [
        `${p3.onsetCoupledDuration} onset-coupled duration errors cannot be fixed until onsets/voices are stable.`,
        'Fixing duration without voice serialization will trade onset gains for chord regressions (Phase 2B lesson).',
      ],
      status: TARGET_STATUS.BLOCKED_PREMATURE,
    },
    [SOLVER_TARGET.TIE_SUSTAIN_CONSTRAINT]: {
      impact: 3,
      safety: 3,
      irReadiness: 4,
      antiRegression: 3,
      rationale: [
        `Phase 4 classifies ${p4.expectedCrossMeasureTie} expected cross-measure ties and ${p4.writtenCorrectSustainWrong} written-correct/sustain-wrong rows.`,
        'Tie hard constraints are designed in OMR_ENGINE_V2_PLAN.md §3.4.',
      ],
      blockers: [
        'Most sustain deficits are downstream of wrong onsets/voices, not missing tie glyphs.',
        `Gymnopédie tie recall still incomplete; Twinkle false-tie guard must stay at 0.`,
      ],
      status: TARGET_STATUS.BLOCKED_PREMATURE,
    },
    [SOLVER_TARGET.ONSET_GRID_REFINEMENT]: {
      impact: 3,
      safety: 5,
      irReadiness: 2,
      antiRegression: 5,
      rationale: [
        'Lowest regression risk: observation-first onsetColumns[] on MeasureGraph.',
        'Enables future solver column assignment without touching runtime bytes.',
      ],
      blockers: [
        'Alone it does not fix accompaniment-lane serialization (35 voice-shift onsets).',
        'onsetColumns[] not yet complete on every dense measure.',
      ],
      status: TARGET_STATUS.ELIGIBLE_PREP,
    },
    [SOLVER_TARGET.MEASURE_LEVEL_SOLVER]: {
      impact: 4,
      safety: 1,
      irReadiness: 3,
      antiRegression: 1,
      rationale: [
        'Phase 2/2B/2C shadow prototype exists with truth gates and chord coalescing.',
      ],
      blockers: [
        `Clef-only phase-shift family exhausted: ${p2.changedMeasures} changed, ${p2.acceptedCandidates} truth-approved on dense.`,
        'Broadening constraints caused chord regressions (+70 chordMismatch in Phase 2).',
        'Same family cannot progress without a new variable (voice lanes).',
      ],
      status: TARGET_STATUS.BLOCKED_EXHAUSTED,
    },
  }

  const profile = profiles[targetId]
  const composite =
    profile.impact * 0.15 +
    profile.safety * 0.35 +
    profile.irReadiness * 0.2 +
    profile.antiRegression * 0.3

  return {
    target: targetId,
    status: profile.status,
    scores: {
      impact: profile.impact,
      safety: profile.safety,
      irReadiness: profile.irReadiness,
      antiRegression: profile.antiRegression,
      composite: Math.round(composite * 100) / 100,
    },
    rationale: profile.rationale,
    blockers: profile.blockers,
  }
}

/**
 * Rank solver targets for Phase 6 selection.
 */
export function rankSolverTargets(evidence) {
  const ranked = Object.values(SOLVER_TARGET)
    .map((targetId) => scoreTarget(targetId, evidence))
    .sort((left, right) => right.scores.composite - left.scores.composite)

  const recommended = ranked.find((entry) => entry.status === TARGET_STATUS.RECOMMENDED) ?? ranked[0]
  const prep = ranked.find((entry) => entry.status === TARGET_STATUS.ELIGIBLE_PREP) ?? null
  const blocked = ranked.filter(
    (entry) =>
      entry.status === TARGET_STATUS.BLOCKED_EXHAUSTED ||
      entry.status === TARGET_STATUS.BLOCKED_PREMATURE,
  )

  return { ranked, recommended, prep, blocked }
}

/**
 * Build a copy-paste Phase 6 implementation prompt.
 */
export function buildPhase6Prompt({ recommendation, evidence, ranking }) {
  const rec = recommendation ?? ranking?.recommended
  const prep = ranking?.prep
  const dense = evidence.frozenBaseline.dense
  const canaries = evidence.canaries

  return `Corranzo OMR V2 Phase 6 — ${rec?.target ?? 'voice-aware-serialization'} (shadow-only).

Feature freeze is active. Do not change runtime OMR output.

Goal:
Implement a shadow-only ${rec?.target ?? 'voice-aware-serialization'} solver family using ScoreGraph IR, targeting the root cause identified in Phase 5 rollout gate.

Current evidence (frozen baseline):
- Dense: wrongOnset ${dense.wrongOnset}, wrongDuration ${dense.wrongDuration}, chordMismatch ${dense.chordMismatch}, wrongPitch ${dense.wrongPitch}
- Phase 1: ${evidence.phase1.voiceSerializationShift} voice-serialization-shift, ${evidence.phase1.onsetPhaseShift} onset-phase-shift
- Phase 2/2B/2C: ${evidence.phase2.changedMeasures} changed measures, ${evidence.phase2.acceptedCandidates} truth-approved (clef-only phase shifts exhausted)
- Phase 3: ${evidence.phase3.onsetCoupledDuration} onset-coupled-duration, ${evidence.phase3.writtenDurationWrong} written-duration-wrong
- Phase 4: ${evidence.phase4.expectedCrossMeasureTie} expected-cross-measure-tie candidates
- Twinkle false-tie guard: ${canaries.twinkleFalseTieGuard?.clean ? 'clean (0 applied)' : 'CHECK'}
- Gymnopédie: must stay 100% on all axes

Rules:
- Shadow/diagnostic only — no runtime MusicXML promotion.
- No threshold changes.
- No UI/playback/Wait For You changes.
- Per-measure truth gate: improve onset/duration on measure; no chord/pitch/duration regression.
- Twinkle m10 canary must reach 0 wrong onsets before any dense promotion.
- Gymnopédie byte-identical gate on every change.

Tasks:
1. Add staff-lane voiceId assignment to ScoreGraph IR (observation + shadow solver variable).
2. Implement shadow voice-lane solver: grand-staff accompaniment template (truth v5 vs gen v2 pattern).
3. Decouple MusicXML voice numbering from rhythm inference in shadow emit path only.
4. Reuse Phase 2C truth gate + chord coalescing; reject variants that split chords or change note count.
5. Target canary measures first: Twinkle m10, dense m7/m9/m121.
${prep ? `6. (Parallel prep) Extend onsetColumns[] on MeasureGraph — ${prep.target} — observation only.\n7. Add tests proving shadow solver does not mutate runtime events.\n8. Dashboard section: voice-lane shadow report alongside rhythm-shadow-report.json.` : `6. Add tests proving shadow solver does not mutate runtime events.\n7. Dashboard section: voice-lane shadow report alongside rhythm-shadow-report.json.`}

Verification:
npm test
npm run build
npm run omr:benchmark-dashboard

Acceptance:
- Runtime OMR unchanged (dense metrics frozen).
- Shadow shows ≥1 truth-approved measure on Twinkle m10 OR dense m7–m9 with Δ wrongOnset < 0 and no chord regression.
- Gymnopédie 100%; Twinkle false ties 0.
- No promotion to runtime.`
}

/**
 * Aggregate all V2 diagnostics into one rollout gate report.
 */
export function buildRolloutGateReport(records = []) {
  const evidence = collectV2DiagnosticEvidence(records)
  const ranking = rankSolverTargets(evidence)
  const phase6Prompt = buildPhase6Prompt({
    recommendation: ranking.recommended,
    evidence,
    ranking,
  })

  const denseMetrics = denseRecord(records)?.metrics
  const baselineMatch = denseMetrics
    ? {
        wrongOnset: denseMetrics.wrongOnset === FROZEN_BASELINE.dense.wrongOnset,
        wrongDuration: denseMetrics.wrongDuration === FROZEN_BASELINE.dense.wrongDuration,
        chordMismatch: denseMetrics.chordMismatch === FROZEN_BASELINE.dense.chordMismatch,
        wrongPitch: denseMetrics.wrongPitch === FROZEN_BASELINE.dense.wrongPitch,
      }
    : null

  return {
    phase: 5,
    generatedAt: new Date().toISOString(),
    evidence,
    ranking,
    recommendation: {
      target: ranking.recommended.target,
      status: ranking.recommended.status,
      compositeScore: ranking.recommended.scores.composite,
      parallelPrep: ranking.prep?.target ?? null,
      summary:
        'Clef-only phase-shift solver is exhausted. Voice-aware serialization (shadow-only, canary-gated) is the safest path to measurable progress before duration or tie solvers.',
    },
    blockedTargets: ranking.blocked.map((entry) => ({
      target: entry.target,
      status: entry.status,
      primaryBlocker: entry.blockers[0] ?? null,
    })),
    baselineFrozen: baselineMatch,
    phase6Prompt,
  }
}

export function formatRolloutGateMarkdown(gate, { indent = '' } = {}) {
  if (!gate?.ranking?.ranked?.length) {
    return ''
  }
  const lines = [
    `${indent}V2 rollout gate (Phase 5):`,
    `${indent}- Recommended: **${gate.recommendation.target}** (composite ${gate.recommendation.compositeScore})`,
  ]
  if (gate.recommendation.parallelPrep) {
    lines.push(`${indent}- Parallel prep: ${gate.recommendation.parallelPrep}`)
  }
  lines.push(`${indent}- Target ranking:`)
  for (const entry of gate.ranking.ranked) {
    lines.push(
      `${indent}  - ${entry.target}: composite=${entry.scores.composite}, status=${entry.status}`,
    )
  }
  if (gate.blockedTargets?.length) {
    lines.push(`${indent}- Blocked:`)
    for (const entry of gate.blockedTargets) {
      lines.push(`${indent}  - ${entry.target} (${entry.status}): ${entry.primaryBlocker}`)
    }
  }
  if (gate.baselineFrozen) {
    const ok = Object.values(gate.baselineFrozen).every(Boolean)
    lines.push(`${indent}- Frozen baseline: ${ok ? 'MATCH' : 'DRIFT DETECTED'}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Full markdown document for docs/OMR_V2_ROLLOUT_GATE.md content generation.
 */
export function formatRolloutGateDocument(gate) {
  const e = gate.evidence
  const lines = [
    '# OMR Engine V2 — Rollout Gate (Phase 5)',
    '',
    `**Generated:** ${gate.generatedAt}`,
    '**Status:** Diagnostic/planning only — no runtime OMR changes.',
    '',
    '## Executive decision',
    '',
    `**Recommended Phase 6 target:** \`${gate.recommendation.target}\` (shadow-only)`,
    '',
    gate.recommendation.summary,
    '',
    gate.recommendation.parallelPrep
      ? `**Parallel low-risk prep:** \`${gate.recommendation.parallelPrep}\``
      : '',
    '',
    '## Frozen baseline verification',
    '',
    '| Fixture | wrongOnset | wrongDuration | chordMismatch | wrongPitch |',
    '|---------|----------:|--------------:|--------------:|-----------:|',
    `| Gymnopédie (clean) | ${FROZEN_BASELINE.clean.wrongOnset} | ${FROZEN_BASELINE.clean.wrongDuration} | ${FROZEN_BASELINE.clean.chordMismatch} | ${FROZEN_BASELINE.clean.wrongPitch} |`,
    `| Cruel Angel (dense) | **${FROZEN_BASELINE.dense.wrongOnset}** | **${FROZEN_BASELINE.dense.wrongDuration}** | **${FROZEN_BASELINE.dense.chordMismatch}** | **${FROZEN_BASELINE.dense.wrongPitch}** |`,
    `| Twinkle (simple) | ${FROZEN_BASELINE.simple.wrongOnset} | ${FROZEN_BASELINE.simple.wrongDuration} | ${FROZEN_BASELINE.simple.chordMismatch} | ${FROZEN_BASELINE.simple.wrongPitch} |`,
    '',
    gate.baselineFrozen
      ? `Current dashboard dense baseline match: ${Object.values(gate.baselineFrozen).every(Boolean) ? '✅ MATCH' : '❌ DRIFT'}`
      : '',
    '',
    '## Phase 1 — Rhythm attribution (dense)',
    '',
    '| Bucket | Count |',
    '|--------|------:|',
    ...Object.entries(e.phase1.buckets)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([bucket, count]) => `| ${bucket} | ${count} |`),
    '',
    '## Phase 2/2B/2C — Shadow solver (dense)',
    '',
    `- Status: \`${e.phase2.status}\``,
    `- Changed measures: **${e.phase2.changedMeasures}**`,
    `- Truth-approved: **${e.phase2.acceptedCandidates}**`,
    `- Constraint version: ${e.phase2.constraintVersion ?? 'n/a'}`,
    `- **Conclusion:** clef-only phase-shift family is exhausted.`,
    '',
    '## Phase 3 — Written vs sounding duration split (dense)',
    '',
    '| Class | Count |',
    '|-------|------:|',
    ...Object.entries(e.phase3.histogram)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([bucket, count]) => `| ${bucket} | ${count} |`),
    '',
    `- Dominant: ${e.phase3.dominantClass?.bucket ?? 'n/a'} (${e.phase3.dominantClass?.count ?? 0})`,
  ]

  lines.push(
    '',
    '## Phase 4 — Tie/sustain constraints (dense)',
    '',
    '| Constraint | Count |',
    '|------------|------:|',
    ...Object.entries(e.phase4.histogram)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([bucket, count]) => `| ${bucket} | ${count} |`),
    '',
    '## Target ranking',
    '',
    '| Target | Impact | Safety | IR ready | Anti-regression | Composite | Status |',
    '|--------|-------:|-------:|---------:|----------------:|----------:|--------|',
    ...gate.ranking.ranked.map(
      (entry) =>
        `| ${entry.target} | ${entry.scores.impact} | ${entry.scores.safety} | ${entry.scores.irReadiness} | ${entry.scores.antiRegression} | ${entry.scores.composite} | ${entry.status} |`,
    ),
    '',
    '### Rationale by target',
    '',
  )

  for (const entry of gate.ranking.ranked) {
    lines.push(`#### ${entry.target} (\`${entry.status}\`)`)
    for (const reason of entry.rationale) {
      lines.push(`- ${reason}`)
    }
    if (entry.blockers.length) {
      lines.push('- **Blockers:**')
      for (const blocker of entry.blockers) {
        lines.push(`  - ${blocker}`)
      }
    }
    lines.push('')
  }

  lines.push(
    '## Why voice-aware serialization wins',
    '',
    '1. **Root cause:** 35/94 wrong onsets are `serialization-voice-shift`; Twinkle m10 is 100% accompaniment-lane late by one eighth.',
    '2. **Exhausted alternative:** Phase 2 clef-only phase shifts produced 0 truth-approved measures on dense.',
    '3. **Downstream block:** 44 onset-coupled duration errors and 42 expected cross-measure tie candidates cannot be solved until onsets/voices stabilize.',
    '4. **IR gap is narrow:** ScoreGraph has clef, voice export, tie fields — needs `voiceId` staff-lane variable for solver.',
    '5. **Safety path:** shadow-only + per-measure truth gate + Twinkle m10 canary before any dense promotion.',
    '',
    '## Blocked targets',
    '',
    ...gate.blockedTargets.map(
      (entry) => `- **${entry.target}** (\`${entry.status}\`): ${entry.primaryBlocker}`,
    ),
    '',
    '## Canary gates (unchanged)',
    '',
    '- **Gymnopédie:** byte-identical / 100% all axes.',
    '- **Twinkle m10:** 0 wrong onsets; false-tie guard = 0.',
    '- **Dense m7/m9/m121:** hotspot traces must improve without chord regression.',
    '',
    '## Recommended Phase 6 prompt',
    '',
    '```',
    gate.phase6Prompt,
    '```',
    '',
    '---',
    '',
    'See also: [`OMR_ENGINE_V2_PLAN.md`](./OMR_ENGINE_V2_PLAN.md)',
  )

  return `${lines.filter((line) => line !== undefined).join('\n')}\n`
}
