import { midiRegisterBucket } from './micAccuracyManifest.js'

export const MIC_FALSE_NEGATIVE_CAUSE = {
  GATE_CLOSED: 'gate-closed',
  WRONG_OCTAVE: 'wrong-octave',
  WRONG_PITCH: 'wrong-pitch',
  CONFIDENCE_LOW: 'confidence-too-low',
  CENTS_TOLERANCE_TOO_STRICT: 'cents-tolerance-too-strict',
  STABILIZER_HOLD_TOO_STRICT: 'stabilizer-hold-too-strict',
  ATTACK_SKIPPED_TOO_LONG: 'attack-skipped-too-long',
  EXPECTED_NOTE_MISMATCH: 'expected-note-mismatch',
  V2_CONFIDENCE_THRESHOLD_TOO_STRICT: 'v2-confidence-threshold-too-strict',
  NO_PITCH_DETECTED: 'no-pitch-detected',
}

function mean(values) {
  if (!values.length) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function summarizeBucket(entries, pickRate) {
  if (!entries.length) {
    return { count: 0, hitRate: null, falseNegativeRate: null, falsePositiveRate: null }
  }
  const noteClips = entries.filter((entry) => entry.label === 'note' && !entry.skipped)
  const rejectClips = entries.filter(
    (entry) => (entry.label === 'silence' || entry.label === 'noise') && !entry.skipped,
  )
  const hits = noteClips.filter((entry) => entry.hit).length
  const misses = noteClips.filter((entry) => entry.falseNegative).length
  const falsePositives = rejectClips.filter((entry) => entry.falsePositive).length
  return {
    count: entries.length,
    hitRate: noteClips.length ? hits / noteClips.length : null,
    falseNegativeRate: noteClips.length ? misses / noteClips.length : null,
    falsePositiveRate: rejectClips.length ? falsePositives / rejectClips.length : null,
    meanClarity: mean(entries.map((entry) => entry.meanClarity).filter((value) => value != null)),
    meanAbsCentsError: mean(
      entries.map((entry) => entry.meanAbsCentsError).filter((value) => value != null),
    ),
    meanLatencyMs: mean(entries.map((entry) => entry.latencyMs).filter((value) => value != null)),
    customRate: pickRate ? pickRate(entries) : null,
  }
}

export function midiMatchesExpected(midi, expectedMidi, centsTolerance = 35) {
  if (midi == null || expectedMidi == null) {
    return false
  }
  return Math.abs(midi - expectedMidi) * 100 <= centsTolerance
}

function rawMidiMatchesExpected(frame, expectedMidi, centsTolerance) {
  if (frame?.midiFloat == null || expectedMidi == null) {
    return false
  }
  return Math.abs(frame.midiFloat - expectedMidi) * 100 <= centsTolerance
}

function midiSamePitchClass(midi, expectedMidi) {
  if (midi == null || expectedMidi == null) {
    return false
  }
  return Math.abs(Math.round(midi) - expectedMidi) % 12 === 0
}

function maxConsecutiveExpectedFrames(frames, expectedMidi, centsTolerance) {
  let best = 0
  let current = 0
  for (const frame of frames) {
    if (midiMatchesExpected(frame.midi, expectedMidi, centsTolerance)) {
      current += 1
      best = Math.max(best, current)
    } else {
      current = 0
    }
  }
  return best
}

export function classifyMicFalseNegative(clip, replayResult, options = {}) {
  if (clip.label !== 'note' || clip.expectedMidi == null) {
    return null
  }
  if (clip.expectedMismatch) {
    return MIC_FALSE_NEGATIVE_CAUSE.EXPECTED_NOTE_MISMATCH
  }

  const centsTolerance = clip.centsTolerance ?? options.centsTolerance ?? 35
  const frames = replayResult?.frames ?? []
  const stableDetections = replayResult?.stableDetections ?? []
  if (
    stableDetections.some((detection) =>
      midiMatchesExpected(detection.midi, clip.expectedMidi, centsTolerance),
    )
  ) {
    return null
  }

  const gateOpenFrames = frames.filter((frame) => frame.gateOpen)
  if (!gateOpenFrames.length) {
    return MIC_FALSE_NEGATIVE_CAUSE.GATE_CLOSED
  }

  const pitchFrames = frames.filter(
    (frame) => frame.midi != null || frame.midiFloat != null || frame.frequency != null,
  )
  const v2Frames = frames.filter((frame) => frame.v2MeanConfidence != null)
  if (
    v2Frames.length &&
    v2Frames.some((frame) => Number.isFinite(frame.v2MeanConfidence)) &&
    v2Frames.every((frame) => !(frame.v2DetectedMidis ?? []).includes(clip.expectedMidi))
  ) {
    return MIC_FALSE_NEGATIVE_CAUSE.V2_CONFIDENCE_THRESHOLD_TOO_STRICT
  }
  if (!pitchFrames.length) {
    return MIC_FALSE_NEGATIVE_CAUSE.NO_PITCH_DETECTED
  }

  const exactPitchFrames = pitchFrames.filter((frame) =>
    midiMatchesExpected(frame.midi, clip.expectedMidi, centsTolerance),
  )
  const relaxedPitchFrames = pitchFrames.filter((frame) =>
    rawMidiMatchesExpected(frame, clip.expectedMidi, centsTolerance * 2),
  )

  if (!exactPitchFrames.length) {
    if (relaxedPitchFrames.length) {
      return MIC_FALSE_NEGATIVE_CAUSE.CENTS_TOLERANCE_TOO_STRICT
    }
    if (
      pitchFrames.some((frame) =>
        midiSamePitchClass(frame.midi ?? frame.midiFloat, clip.expectedMidi),
      )
    ) {
      return MIC_FALSE_NEGATIVE_CAUSE.WRONG_OCTAVE
    }
    return MIC_FALSE_NEGATIVE_CAUSE.WRONG_PITCH
  }

  const stabilizer = replayResult?.stabilizer ?? {}
  const holdFrames = stabilizer.holdFrames ?? options.holdFrames ?? 6
  const maxRun = maxConsecutiveExpectedFrames(frames, clip.expectedMidi, centsTolerance)
  if (maxRun >= holdFrames) {
    return MIC_FALSE_NEGATIVE_CAUSE.STABILIZER_HOLD_TOO_STRICT
  }

  const minClarity = stabilizer.minClarity ?? options.minClarity ?? 0.42
  if (exactPitchFrames.every((frame) => (frame.clarity ?? 0) < minClarity)) {
    return MIC_FALSE_NEGATIVE_CAUSE.CONFIDENCE_LOW
  }

  const firstExact = exactPitchFrames[0]
  if (
    clip.expectedOnsetMs != null &&
    firstExact?.timeMs != null &&
    firstExact.timeMs - clip.expectedOnsetMs > 180
  ) {
    return MIC_FALSE_NEGATIVE_CAUSE.ATTACK_SKIPPED_TOO_LONG
  }

  const wrongPitchFrames = pitchFrames.filter(
    (frame) => !midiMatchesExpected(frame.midi, clip.expectedMidi, centsTolerance),
  )
  if (wrongPitchFrames.some((frame) => midiSamePitchClass(frame.midi, clip.expectedMidi))) {
    return MIC_FALSE_NEGATIVE_CAUSE.WRONG_OCTAVE
  }
  if (wrongPitchFrames.length) {
    return MIC_FALSE_NEGATIVE_CAUSE.WRONG_PITCH
  }

  return MIC_FALSE_NEGATIVE_CAUSE.STABILIZER_HOLD_TOO_STRICT
}

/**
 * Score one labeled clip against offline replay output.
 */
export function evaluateLabeledClip(clip, replayResult, options = {}) {
  if (clip.missingFile) {
    return {
      clipId: clip.id,
      label: clip.label,
      expectedMidi: clip.expectedMidi ?? null,
      instrument: clip.instrument ?? null,
      noiseCondition: clip.noiseCondition ?? null,
      source: clip.source ?? null,
      register: midiRegisterBucket(clip.expectedMidi),
      outcome: 'skipped',
      skipped: true,
      hit: false,
      falseNegative: false,
      falsePositive: false,
      detectedMidi: null,
      wrongMidi: null,
      detectionCount: 0,
      pitchFrameCount: 0,
      unstablePitchFrames: 0,
      meanClarity: null,
      maxClarity: null,
      meanAbsCentsError: null,
      latencyMs: null,
      firstPitchMs: null,
      frameCount: 0,
      falseNegativeCause: null,
      missingFile: true,
    }
  }

  const centsTolerance = clip.centsTolerance ?? options.centsTolerance ?? 35
  const stableDetections = replayResult?.stableDetections ?? []
  const frames = replayResult?.frames ?? []

  const matching = stableDetections.filter((detection) =>
    midiMatchesExpected(detection.midi, clip.expectedMidi, centsTolerance),
  )
  const wrongStable = stableDetections.filter(
    (detection) => !midiMatchesExpected(detection.midi, clip.expectedMidi, centsTolerance),
  )

  const pitchFrames = frames.filter((frame) => frame.midi != null)
  const wrongPitchFrames = pitchFrames.filter(
    (frame) => !midiMatchesExpected(frame.midi, clip.expectedMidi, centsTolerance),
  )
  const unstablePitchFrames = pitchFrames.filter(
    (frame) => (frame.clarity ?? 0) > 0 && (frame.clarity ?? 0) < 0.35,
  ).length

  let outcome = 'unknown'
  if (clip.label === 'note') {
    outcome = matching.length > 0 ? 'hit' : 'miss'
  } else if (clip.label === 'silence' || clip.label === 'noise') {
    outcome = stableDetections.length > 0 ? 'false-positive' : 'correct-reject'
  }
  const falseNegativeCause =
    clip.label === 'note' && outcome === 'miss'
      ? classifyMicFalseNegative(clip, replayResult, { centsTolerance })
      : null

  const clarityValues = matching.map((detection) => detection.clarity).filter(Number.isFinite)
  const centsValues = matching.map((detection) => detection.centsOffset).filter(Number.isFinite)
  const allClarity = pitchFrames.map((frame) => frame.clarity).filter(Number.isFinite)

  let latencyMs = null
  const firstPitchFrame = pitchFrames.find(
    (frame) =>
      clip.label !== 'note' ||
      midiMatchesExpected(frame.midi, clip.expectedMidi, centsTolerance),
  )
  if (matching.length > 0) {
    if (clip.expectedOnsetMs != null) {
      latencyMs = matching[0].timeMs - clip.expectedOnsetMs
    } else if (firstPitchFrame) {
      latencyMs = matching[0].timeMs - firstPitchFrame.timeMs
    }
  }

  return {
    clipId: clip.id,
    label: clip.label,
    expectedMidi: clip.expectedMidi ?? null,
    instrument: clip.instrument ?? null,
    micDevice: clip.micDevice ?? null,
    noiseCondition: clip.noiseCondition ?? null,
    source: clip.source ?? null,
    register: midiRegisterBucket(clip.expectedMidi),
    outcome,
    skipped: false,
    hit: outcome === 'hit',
    falseNegative: clip.label === 'note' && outcome === 'miss',
    falsePositive: outcome === 'false-positive',
    detectedMidi: matching[0]?.midi ?? wrongStable[0]?.midi ?? null,
    wrongMidi: wrongStable[0]?.midi ?? wrongPitchFrames[0]?.midi ?? null,
    detectionCount: stableDetections.length,
    pitchFrameCount: pitchFrames.length,
    unstablePitchFrames,
    meanClarity: mean(clarityValues),
    maxClarity: allClarity.length ? Math.max(...allClarity) : null,
    meanAbsCentsError: mean(centsValues.map((value) => Math.abs(value))),
    latencyMs,
    firstPitchMs: firstPitchFrame?.timeMs ?? null,
    frameCount: frames.length,
    falseNegativeCause,
    missingFile: false,
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

export function summarizeMicAccuracy(evaluations) {
  const measured = evaluations.filter((entry) => !entry.skipped)
  const noteClips = measured.filter((entry) => entry.label === 'note')
  const rejectClips = measured.filter(
    (entry) => entry.label === 'silence' || entry.label === 'noise',
  )

  const hits = noteClips.filter((entry) => entry.hit).length
  const misses = noteClips.filter((entry) => entry.falseNegative).length
  const falsePositives = rejectClips.filter((entry) => entry.falsePositive).length
  const falseNegativeCauses = {}
  for (const entry of noteClips) {
    if (!entry.falseNegative || !entry.falseNegativeCause) {
      continue
    }
    falseNegativeCauses[entry.falseNegativeCause] =
      (falseNegativeCauses[entry.falseNegativeCause] ?? 0) + 1
  }

  const realNoteClips = noteClips.filter((entry) => entry.source === 'file')
  const syntheticNoteClips = noteClips.filter((entry) => entry.source === 'synthetic')

  return {
    clipCount: evaluations.length,
    measuredClipCount: measured.length,
    skippedClipCount: evaluations.filter((entry) => entry.skipped).length,
    noteClipCount: noteClips.length,
    rejectClipCount: rejectClips.length,
    hits,
    misses,
    falsePositives,
    falseNegativeCauses,
    hitRate: noteClips.length ? hits / noteClips.length : null,
    falseNegativeRate: noteClips.length ? misses / noteClips.length : null,
    falsePositiveRate: rejectClips.length ? falsePositives / rejectClips.length : null,
    meanClarity: mean(
      measured.map((entry) => entry.meanClarity).filter((value) => value != null),
    ),
    meanAbsCentsError: mean(
      measured.map((entry) => entry.meanAbsCentsError).filter((value) => value != null),
    ),
    meanLatencyMs: mean(
      measured.map((entry) => entry.latencyMs).filter((value) => value != null),
    ),
    meanPitchFramesPerClip: mean(
      measured.map((entry) => entry.pitchFrameCount).filter((value) => Number.isFinite(value)),
    ),
    meanUnstablePitchFrames: mean(
      measured.map((entry) => entry.unstablePitchFrames).filter((value) => Number.isFinite(value)),
    ),
    realFileNoteClipCount: realNoteClips.length,
    syntheticNoteClipCount: syntheticNoteClips.length,
    realFileHitRate: realNoteClips.length
      ? realNoteClips.filter((entry) => entry.hit).length / realNoteClips.length
      : null,
    syntheticHitRate: syntheticNoteClips.length
      ? syntheticNoteClips.filter((entry) => entry.hit).length / syntheticNoteClips.length
      : null,
    byRegister: groupEvaluations(measured, (entry) => entry.register),
    byInstrument: groupEvaluations(measured, (entry) => entry.instrument),
    byNoiseCondition: groupEvaluations(measured, (entry) => entry.noiseCondition),
    bySource: groupEvaluations(measured, (entry) => entry.source),
    tuningRecommendation:
      realNoteClips.length > 0
        ? 'Real WAV fixtures present — compare before/after when tuning constants.'
        : 'No real WAV note fixtures measured — do not tune pitch/stabilizer constants from synthetic clips alone.',
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
      `- **${key}** (${bucket.count} clips): hit ${pct(bucket.hitRate)}, false negative ${pct(bucket.falseNegativeRate)}, false positive ${pct(bucket.falsePositiveRate)}, mean clarity ${num(bucket.meanClarity, 3)}, mean |cents| ${num(bucket.meanAbsCentsError, 1)}, mean latency ${num(bucket.meanLatencyMs, 0)} ms`,
    )
  }
  return lines
}

export function formatMicAccuracyReportMarkdown(summary) {
  const lines = [
    '# Microphone accuracy replay report',
    '',
    `Clips: ${summary.measuredClipCount} measured · ${summary.skippedClipCount} skipped (missing files)`,
    '',
    '## Detection rates',
    `- Hit rate: ${pct(summary.hitRate)} (${summary.hits}/${summary.noteClipCount} note clips)`,
    `- False negative rate: ${pct(summary.falseNegativeRate)} (${summary.misses}/${summary.noteClipCount})`,
    `- False positive rate: ${pct(summary.falsePositiveRate)} (${summary.falsePositives}/${summary.rejectClipCount} silence/noise clips)`,
    '',
    '## Quality (matched note clips)',
    `- Mean clarity: ${num(summary.meanClarity, 3)}`,
    `- Mean |cents error|: ${num(summary.meanAbsCentsError, 1)}`,
    `- Mean stabilizer latency: ${num(summary.meanLatencyMs, 0)} ms`,
    `- Mean pitch frames / clip: ${num(summary.meanPitchFramesPerClip, 1)}`,
    `- Mean unstable pitch frames / clip: ${num(summary.meanUnstablePitchFrames, 1)}`,
    '',
    '## Fixture mix',
    `- Real-file note clips: ${summary.realFileNoteClipCount} (hit rate ${pct(summary.realFileHitRate)})`,
    `- Synthetic note clips: ${summary.syntheticNoteClipCount} (hit rate ${pct(summary.syntheticHitRate)})`,
  ]

  lines.push('', '## Tuning guidance', `- ${summary.tuningRecommendation}`)
  lines.push('', '## False negative causes')
  const causeEntries = Object.entries(summary.falseNegativeCauses ?? {}).sort(
    (left, right) => right[1] - left[1],
  )
  if (causeEntries.length) {
    for (const [cause, count] of causeEntries) {
      lines.push(`- ${cause}: ${count}`)
    }
  } else {
    lines.push('- none')
  }
  lines.push('', '## Breakdowns', ...formatBreakdown('By register', summary.byRegister))
  lines.push(...formatBreakdown('By instrument', summary.byInstrument))
  lines.push(...formatBreakdown('By noise condition', summary.byNoiseCondition))
  lines.push(...formatBreakdown('By source', summary.bySource))
  lines.push('', '## Per clip')

  for (const clip of summary.perClip) {
    const parts = [
      `- **${clip.clipId}** (${clip.label}) → ${clip.outcome}`,
      clip.skipped ? 'skipped (missing file)' : null,
      clip.detectedMidi != null ? `detected ${clip.detectedMidi}` : null,
      clip.wrongMidi != null ? `wrong ${clip.wrongMidi}` : null,
      clip.falseNegativeCause ? `cause ${clip.falseNegativeCause}` : null,
      clip.pitchFrameCount ? `${clip.pitchFrameCount} pitch frames` : null,
      clip.unstablePitchFrames ? `${clip.unstablePitchFrames} unstable frames` : null,
      clip.maxClarity != null ? `max clarity ${clip.maxClarity.toFixed(3)}` : null,
      clip.meanClarity != null ? `clarity ${clip.meanClarity.toFixed(3)}` : null,
      clip.latencyMs != null ? `latency ${clip.latencyMs.toFixed(0)} ms` : null,
      clip.firstPitchMs != null ? `first pitch ${clip.firstPitchMs.toFixed(0)} ms` : null,
    ].filter(Boolean)
    lines.push(parts.join(' · '))
  }

  return `${lines.join('\n')}\n`
}
