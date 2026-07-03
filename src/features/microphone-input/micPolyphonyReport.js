import { midiMatchesExpected } from './micAccuracyReport.js'

function mean(values) {
  if (!values.length) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function uniqueMatchedMidis(stableDetections, expectedMidis, centsTolerance) {
  const matched = new Set()
  for (const expected of expectedMidis) {
    const hasMatch = stableDetections.some((detection) =>
      midiMatchesExpected(detection.midi, expected, centsTolerance),
    )
    if (hasMatch) {
      matched.add(expected)
    }
  }
  return matched
}

function falsePositiveMidis(stableDetections, expectedMidis, centsTolerance) {
  const extras = []
  for (const detection of stableDetections) {
    const matchesExpected = expectedMidis.some((expected) =>
      midiMatchesExpected(detection.midi, expected, centsTolerance),
    )
    if (!matchesExpected && detection.midi != null) {
      extras.push(detection.midi)
    }
  }
  return extras
}

function bestDetectionPerExpected(stableDetections, expectedMidis, centsTolerance) {
  const map = new Map()
  for (const expected of expectedMidis) {
    const matching = stableDetections.filter((detection) =>
      midiMatchesExpected(detection.midi, expected, centsTolerance),
    )
    if (matching.length > 0) {
      map.set(
        expected,
        matching.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0))[0],
      )
    }
  }
  return map
}

/**
 * Score one labeled polyphony clip against offline replay (V1 monophonic pipeline baseline).
 */
export function evaluatePolyphonyClip(clip, replayResult, options = {}) {
  if (clip.missingFile) {
    return {
      clipId: clip.id,
      label: clip.label,
      expectedMidis: clip.expectedMidis ?? [],
      instrument: clip.instrument ?? null,
      micDevice: clip.micDevice ?? null,
      noiseCondition: clip.noiseCondition ?? null,
      chordType: clip.chordType ?? null,
      source: clip.source ?? null,
      outcome: 'skipped',
      skipped: true,
      chordHit: false,
      partialChord: false,
      perNoteHitRate: null,
      matchedMidis: [],
      missedMidis: [],
      falsePositiveMidis: [],
      falsePositive: false,
      meanConfidence: null,
      meanLatencyMs: null,
      detectionCount: 0,
      missingFile: true,
    }
  }

  const centsTolerance = clip.centsTolerance ?? options.centsTolerance ?? 35
  const stableDetections = replayResult?.stableDetections ?? []
  const expectedMidis = clip.expectedMidis ?? []

  if (clip.label === 'silence' || clip.label === 'noise') {
    const extras = stableDetections.map((detection) => detection.midi).filter((midi) => midi != null)
    return {
      clipId: clip.id,
      label: clip.label,
      expectedMidis: [],
      instrument: clip.instrument ?? null,
      micDevice: clip.micDevice ?? null,
      noiseCondition: clip.noiseCondition ?? null,
      chordType: clip.chordType ?? null,
      source: clip.source ?? null,
      outcome: extras.length > 0 ? 'false-positive' : 'correct-reject',
      skipped: false,
      chordHit: false,
      partialChord: false,
      perNoteHitRate: null,
      matchedMidis: [],
      missedMidis: [],
      falsePositiveMidis: extras,
      falsePositive: extras.length > 0,
      meanConfidence: mean(
        stableDetections.map((d) => d.clarity ?? d.confidence).filter(Number.isFinite),
      ),
      meanLatencyMs: null,
      detectionCount: stableDetections.length,
      missingFile: false,
    }
  }

  const matchedSet = uniqueMatchedMidis(stableDetections, expectedMidis, centsTolerance)
  const matchedMidis = [...matchedSet]
  const missedMidis = expectedMidis.filter((midi) => !matchedSet.has(midi))
  const extraMidis = falsePositiveMidis(stableDetections, expectedMidis, centsTolerance)
  const perNoteHitRate = expectedMidis.length ? matchedMidis.length / expectedMidis.length : null
  const chordHit = expectedMidis.length > 0 && missedMidis.length === 0
  const partialChord = matchedMidis.length > 0 && !chordHit

  const perExpected = bestDetectionPerExpected(stableDetections, expectedMidis, centsTolerance)
  const clarityValues = [...perExpected.values()]
    .map((d) => d.clarity ?? d.confidence)
    .filter(Number.isFinite)
  const latencyValues = [...perExpected.values()]
    .map((detection) => {
      if (clip.expectedOnsetMs != null) {
        return detection.timeMs - clip.expectedOnsetMs
      }
      return detection.timeMs
    })
    .filter(Number.isFinite)

  let outcome = 'miss'
  if (chordHit) {
    outcome = 'chord-hit'
  } else if (partialChord) {
    outcome = 'partial'
  }

  const bassMissedMidis = missedMidis.filter((midi) => midi < 60)

  return {
    clipId: clip.id,
    label: clip.label,
    expectedMidis,
    instrument: clip.instrument ?? null,
    micDevice: clip.micDevice ?? null,
    noiseCondition: clip.noiseCondition ?? null,
    chordType: clip.chordType ?? null,
    source: clip.source ?? null,
    chordShape: classifyChordShape({ ...clip, expectedMidis }),
    outcome,
    skipped: false,
    chordHit,
    partialChord,
    perNoteHitRate,
    matchedMidis,
    missedMidis,
    bassMissedMidis,
    falsePositiveMidis: extraMidis,
    falsePositive: extraMidis.length > 0,
    meanConfidence: mean(clarityValues),
    meanLatencyMs: mean(latencyValues),
    detectionCount: stableDetections.length,
    missingFile: false,
  }
}

function summarizeBucket(entries) {
  if (!entries.length) {
    return {
      count: 0,
      chordHitRate: null,
      perNoteHitRate: null,
      falsePositiveRate: null,
      meanConfidence: null,
      meanLatencyMs: null,
    }
  }
  const chordClips = entries.filter((entry) => entry.label === 'chord' && !entry.skipped)
  const rejectClips = entries.filter(
    (entry) => (entry.label === 'silence' || entry.label === 'noise') && !entry.skipped,
  )
  const expectedNoteCount = chordClips.reduce(
    (sum, entry) => sum + (entry.expectedMidis?.length ?? 0),
    0,
  )
  const matchedNoteCount = chordClips.reduce(
    (sum, entry) => sum + (entry.matchedMidis?.length ?? 0),
    0,
  )
  return {
    count: entries.length,
    chordHitRate: chordClips.length
      ? chordClips.filter((entry) => entry.chordHit).length / chordClips.length
      : null,
    perNoteHitRate: expectedNoteCount ? matchedNoteCount / expectedNoteCount : null,
    falsePositiveRate: rejectClips.length
      ? rejectClips.filter((entry) => entry.falsePositive).length / rejectClips.length
      : null,
    meanConfidence: mean(entries.map((entry) => entry.meanConfidence).filter((v) => v != null)),
    meanLatencyMs: mean(entries.map((entry) => entry.meanLatencyMs).filter((v) => v != null)),
  }
}

function groupEvaluations(evaluations, keyFn) {
  const groups = new Map()
  for (const entry of evaluations) {
    const key = keyFn(entry)
    if (!key) {
      continue
    }
    const bucket = groups.get(key) ?? []
    bucket.push(entry)
    groups.set(key, bucket)
  }
  return Object.fromEntries(
    [...groups.entries()].map(([key, entries]) => [key, summarizeBucket(entries)]),
  )
}

export function classifyChordShape(entry = {}) {
  if (entry.chordType === 'rolled') {
    return 'rolled'
  }
  const count = entry.expectedMidis?.length ?? 0
  if (count === 2) {
    return 'dyad'
  }
  if (count === 3) {
    return 'triad'
  }
  if (count >= 4) {
    return 'simultaneous-4plus'
  }
  if (entry.chordType === 'simultaneous') {
    return 'simultaneous'
  }
  return null
}

function summarizeBassWeakness(evaluations) {
  const chordClips = evaluations.filter((entry) => entry.label === 'chord' && !entry.skipped)
  const bassExpected = chordClips.reduce(
    (sum, entry) => sum + (entry.expectedMidis?.filter((midi) => midi < 60).length ?? 0),
    0,
  )
  const bassMatched = chordClips.reduce(
    (sum, entry) => sum + (entry.matchedMidis?.filter((midi) => midi < 60).length ?? 0),
    0,
  )
  const bassMissed = chordClips.reduce(
    (sum, entry) => sum + (entry.bassMissedMidis?.length ?? 0),
    0,
  )
  return {
    bassExpectedNotes: bassExpected,
    bassMatchedNotes: bassMatched,
    bassMissedNotes: bassMissed,
    bassHitRate: bassExpected ? bassMatched / bassExpected : null,
  }
}

export function summarizeMicPolyphony(evaluations, { engine = 'v1-monophonic-baseline', scorerVersion = null } = {}) {
  const measured = evaluations.filter((entry) => !entry.skipped)
  const chordClips = measured.filter((entry) => entry.label === 'chord')
  const rejectClips = measured.filter(
    (entry) => entry.label === 'silence' || entry.label === 'noise',
  )

  const expectedNoteCount = chordClips.reduce(
    (sum, entry) => sum + (entry.expectedMidis?.length ?? 0),
    0,
  )
  const matchedNoteCount = chordClips.reduce(
    (sum, entry) => sum + (entry.matchedMidis?.length ?? 0),
    0,
  )
  const missedNoteCount = chordClips.reduce(
    (sum, entry) => sum + (entry.missedMidis?.length ?? 0),
    0,
  )
  const falsePositiveNotes = chordClips.reduce(
    (sum, entry) => sum + (entry.falsePositiveMidis?.length ?? 0),
    0,
  )

  return {
    clipCount: evaluations.length,
    measuredClipCount: measured.length,
    skippedClipCount: evaluations.filter((entry) => entry.skipped).length,
    chordClipCount: chordClips.length,
    rejectClipCount: rejectClips.length,
    chordHits: chordClips.filter((entry) => entry.chordHit).length,
    partialChords: chordClips.filter((entry) => entry.partialChord).length,
    chordMisses: chordClips.filter((entry) => !entry.chordHit && !entry.partialChord).length,
    chordHitRate: chordClips.length
      ? chordClips.filter((entry) => entry.chordHit).length / chordClips.length
      : null,
    perNoteHitRate: expectedNoteCount ? matchedNoteCount / expectedNoteCount : null,
    missedNoteCount,
    falsePositiveNotes,
    falsePositiveRate: rejectClips.length
      ? rejectClips.filter((entry) => entry.falsePositive).length / rejectClips.length
      : null,
    meanConfidence: mean(measured.map((entry) => entry.meanConfidence).filter((v) => v != null)),
    meanLatencyMs: mean(measured.map((entry) => entry.meanLatencyMs).filter((v) => v != null)),
    engine,
    scorerVersion,
    tuningRecommendation:
      engine.includes('v2')
        ? 'V2 score-informed prototype — offline only; do not promote to live mic until browser QA and WFY adapter land.'
        : 'Polyphony replay uses the V1 monophonic pipeline as a baseline — do not tune constants from chord metrics until Mic Engine V2 is integrated.',
    byChordType: groupEvaluations(measured, (entry) => entry.chordType),
    byChordShape: groupEvaluations(measured, (entry) => entry.chordShape ?? classifyChordShape(entry)),
    byInstrument: groupEvaluations(measured, (entry) => entry.instrument),
    byNoiseCondition: groupEvaluations(measured, (entry) => entry.noiseCondition),
    bySource: groupEvaluations(measured, (entry) => entry.source),
    bassWeakness: summarizeBassWeakness(evaluations),
    perClip: evaluations,
  }
}

function pct(value) {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`
}

function num(value, digits = 1) {
  return value == null ? '—' : value.toFixed(digits)
}

function formatBreakdown(title, breakdown) {
  const lines = [`### ${title}`]
  const keys = Object.keys(breakdown ?? {}).sort()
  if (!keys.length) {
    lines.push('- (no data)')
    return lines
  }
  for (const key of keys) {
    const bucket = breakdown[key]
    lines.push(
      `- **${key}** (${bucket.count} clips): chord hit ${pct(bucket.chordHitRate)}, per-note ${pct(bucket.perNoteHitRate)}, false positive ${pct(bucket.falsePositiveRate)}, confidence ${num(bucket.meanConfidence, 3)}, latency ${num(bucket.meanLatencyMs, 0)} ms`,
    )
  }
  return lines
}

export function formatMicPolyphonyReportMarkdown(summary) {
  const lines = [
    '# Microphone polyphony replay report',
    '',
    `Engine: **${summary.engine}** (baseline — not Mic Engine V2)`,
    `Clips: ${summary.measuredClipCount} measured · ${summary.skippedClipCount} skipped`,
    '',
    '## Chord detection rates',
    `- Chord hit rate: ${pct(summary.chordHitRate)} (${summary.chordHits}/${summary.chordClipCount} chord clips)`,
    `- Per-note hit rate: ${pct(summary.perNoteHitRate)} (${summary.chordClipCount ? summary.chordHits : 0} full chords; ${summary.missedNoteCount} missed notes total)`,
    `- Partial chords: ${summary.partialChords}`,
    `- False positive rate (silence/noise): ${pct(summary.falsePositiveRate)}`,
    `- False positive notes (on chord clips): ${summary.falsePositiveNotes}`,
    '',
    '## Quality',
    `- Mean confidence (matched): ${num(summary.meanConfidence, 3)}`,
    `- Mean latency: ${num(summary.meanLatencyMs, 0)} ms`,
    '',
    '## Tuning guidance',
    `- ${summary.tuningRecommendation}`,
    '',
    '## Breakdowns',
    ...formatBreakdown('By chord shape', summary.byChordShape),
    ...formatBreakdown('By chord type', summary.byChordType),
    ...formatBreakdown('By instrument', summary.byInstrument),
    ...formatBreakdown('By noise condition', summary.byNoiseCondition),
    ...formatBreakdown('By source', summary.bySource),
    '',
    '## Bass register',
    `- Bass notes expected: ${summary.bassWeakness?.bassExpectedNotes ?? 0}`,
    `- Bass notes matched: ${summary.bassWeakness?.bassMatchedNotes ?? 0}`,
    `- Bass notes missed: ${summary.bassWeakness?.bassMissedNotes ?? 0}`,
    `- Bass hit rate: ${pct(summary.bassWeakness?.bassHitRate)}`,
    '',
    '## Per clip',
  ]

  for (const clip of summary.perClip) {
    const parts = [
      `- **${clip.clipId}** (${clip.label}) → ${clip.outcome}`,
      clip.skipped ? 'skipped (missing file)' : null,
      clip.expectedMidis?.length ? `expected [${clip.expectedMidis.join(', ')}]` : null,
      clip.matchedMidis?.length ? `matched [${clip.matchedMidis.join(', ')}]` : null,
      clip.missedMidis?.length ? `missed [${clip.missedMidis.join(', ')}]` : null,
      clip.falsePositiveMidis?.length ? `extra [${clip.falsePositiveMidis.join(', ')}]` : null,
      clip.meanConfidence != null ? `confidence ${clip.meanConfidence.toFixed(3)}` : null,
      clip.meanLatencyMs != null ? `latency ${clip.meanLatencyMs.toFixed(0)} ms` : null,
    ].filter(Boolean)
    lines.push(parts.join(' · '))
  }

  return `${lines.join('\n')}\n`
}

export const PHASE2_V2_BASELINE = {
  chordHitRate: 0.5,
  perNoteHitRate: 0.706,
  falsePositiveRate: 0,
  missedNoteCount: 5,
  engine: 'v2-score-informed-prototype',
}

/**
 * Compare current V2 run against frozen Phase 2 baseline metrics.
 */
export function compareV2Phase2Baseline(v2Summary, baseline = PHASE2_V2_BASELINE) {
  return {
    baseline,
    current: {
      chordHitRate: v2Summary.chordHitRate,
      perNoteHitRate: v2Summary.perNoteHitRate,
      falsePositiveRate: v2Summary.falsePositiveRate,
      missedNoteCount: v2Summary.missedNoteCount,
      engine: v2Summary.engine,
      scorerVersion: v2Summary.scorerVersion ?? null,
    },
    delta: {
      chordHitRate: deltaRate(v2Summary.chordHitRate, baseline.chordHitRate),
      perNoteHitRate: deltaRate(v2Summary.perNoteHitRate, baseline.perNoteHitRate),
      falsePositiveRate: deltaRate(v2Summary.falsePositiveRate, baseline.falsePositiveRate),
      missedNoteCount: (v2Summary.missedNoteCount ?? 0) - (baseline.missedNoteCount ?? 0),
    },
    improved:
      (v2Summary.chordHitRate ?? 0) >= (baseline.chordHitRate ?? 0) &&
      (v2Summary.perNoteHitRate ?? 0) >= (baseline.perNoteHitRate ?? 0) &&
      (v2Summary.falsePositiveRate ?? 0) <= (baseline.falsePositiveRate ?? 0),
  }
}

export function formatV2Phase2bComparisonMarkdown(phase2bComparison) {
  const { baseline, current, delta, improved } = phase2bComparison
  return [
    '## V2 Phase 2 → Phase 2B',
    '',
    `**Improved:** ${improved ? 'yes' : 'no'}`,
    '',
    '| Metric | Phase 2 | Phase 2B | Δ |',
    '|--------|--------:|---------:|--:|',
    `| Chord hit rate | ${pct(baseline.chordHitRate)} | ${pct(current.chordHitRate)} | ${delta.chordHitRate == null ? '—' : `${(delta.chordHitRate * 100).toFixed(1)} pp`} |`,
    `| Per-note hit rate | ${pct(baseline.perNoteHitRate)} | ${pct(current.perNoteHitRate)} | ${delta.perNoteHitRate == null ? '—' : `${(delta.perNoteHitRate * 100).toFixed(1)} pp`} |`,
    `| False positive rate | ${pct(baseline.falsePositiveRate)} | ${pct(current.falsePositiveRate)} | ${delta.falsePositiveRate == null ? '—' : `${(delta.falsePositiveRate * 100).toFixed(1)} pp`} |`,
    `| Missed notes | ${baseline.missedNoteCount} | ${current.missedNoteCount ?? '—'} | ${delta.missedNoteCount ?? '—'} |`,
    '',
  ].join('\n')
}

function deltaRate(v2, v1) {
  if (v1 == null || v2 == null) {
    return null
  }
  return v2 - v1
}

/**
 * Compare V1 monophonic baseline vs V2 score-informed prototype summaries.
 */
export function compareMicPolyphonyEngines(v1Summary, v2Summary) {
  const chordHitDelta = deltaRate(v2Summary.chordHitRate, v1Summary.chordHitRate)
  const perNoteDelta = deltaRate(v2Summary.perNoteHitRate, v1Summary.perNoteHitRate)
  const falsePositiveDelta = deltaRate(v2Summary.falsePositiveRate, v1Summary.falsePositiveRate)

  let verdict = 'inconclusive'
  let diagnosis = null

  if (chordHitDelta != null && chordHitDelta > 0.05) {
    verdict = 'v2-improves'
    diagnosis = 'Score-informed harmonic scoring improves chord detection on offline fixtures.'
  } else if (chordHitDelta != null && chordHitDelta <= 0 && perNoteDelta != null && perNoteDelta <= 0) {
    verdict = 'v2-insufficient'
    diagnosis =
      'Simple Goertzel harmonic scoring does not beat V1 on chord fixtures — likely needs CQT resolution, onset tracking, or ML for overlapping partials on real mic captures.'
  } else if (perNoteDelta != null && perNoteDelta > 0.05) {
    verdict = 'v2-partial-improvement'
    diagnosis =
      'V2 improves per-note recall but not full chord hits — rolled chords, weak bass, or register split may need temporal aggregation and finer frequency resolution.'
  } else {
    diagnosis =
      'V2 prototype is comparable to V1 on current fixtures; collect more real simultaneous-chord WAVs before drawing production conclusions.'
  }

  return {
    v1Engine: v1Summary.engine,
    v2Engine: v2Summary.engine,
    chordHitRate: { v1: v1Summary.chordHitRate, v2: v2Summary.chordHitRate, delta: chordHitDelta },
    perNoteHitRate: { v1: v1Summary.perNoteHitRate, v2: v2Summary.perNoteHitRate, delta: perNoteDelta },
    falsePositiveRate: {
      v1: v1Summary.falsePositiveRate,
      v2: v2Summary.falsePositiveRate,
      delta: falsePositiveDelta,
    },
    missedNoteCount: { v1: v1Summary.missedNoteCount, v2: v2Summary.missedNoteCount },
    falsePositiveNotes: { v1: v1Summary.falsePositiveNotes, v2: v2Summary.falsePositiveNotes },
    meanConfidence: { v1: v1Summary.meanConfidence, v2: v2Summary.meanConfidence },
    verdict,
    diagnosis,
  }
}

export function formatMicPolyphonyComparisonMarkdown(comparison, v1Summary, v2Summary, phase2bComparison = null) {
  const lines = [
    '# Microphone polyphony — V1 vs V2 comparison',
    '',
    `**Verdict:** ${comparison.verdict}`,
    '',
    comparison.diagnosis ?? '',
    '',
    '## Headline metrics',
    '',
    '| Metric | V1 monophonic | V2 score-informed | Δ |',
    '|--------|--------------:|------------------:|--:|',
    `| Chord hit rate | ${pct(comparison.chordHitRate.v1)} | ${pct(comparison.chordHitRate.v2)} | ${comparison.chordHitRate.delta == null ? '—' : `${(comparison.chordHitRate.delta * 100).toFixed(1)} pp`} |`,
    `| Per-note hit rate | ${pct(comparison.perNoteHitRate.v1)} | ${pct(comparison.perNoteHitRate.v2)} | ${comparison.perNoteHitRate.delta == null ? '—' : `${(comparison.perNoteHitRate.delta * 100).toFixed(1)} pp`} |`,
    `| False positive rate | ${pct(comparison.falsePositiveRate.v1)} | ${pct(comparison.falsePositiveRate.v2)} | ${comparison.falsePositiveRate.delta == null ? '—' : `${(comparison.falsePositiveRate.delta * 100).toFixed(1)} pp`} |`,
    `| Missed notes | ${comparison.missedNoteCount.v1 ?? '—'} | ${comparison.missedNoteCount.v2 ?? '—'} | — |`,
    `| False positive notes | ${comparison.falsePositiveNotes.v1 ?? '—'} | ${comparison.falsePositiveNotes.v2 ?? '—'} | — |`,
    `| Mean confidence | ${num(comparison.meanConfidence.v1, 3)} | ${num(comparison.meanConfidence.v2, 3)} | — |`,
    '',
  ]
  if (phase2bComparison) {
    lines.push(formatV2Phase2bComparisonMarkdown(phase2bComparison))
  }
  lines.push(
    '## V1 baseline',
    '',
    formatMicPolyphonyReportMarkdown(v1Summary).trim(),
    '',
    '## V2 score-informed prototype',
    '',
    formatMicPolyphonyReportMarkdown(v2Summary).trim(),
  )
  return `${lines.join('\n')}\n`
}
