import { midiRegisterBucket } from './micAccuracyManifest.js'

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
