import { RECOGNITION_OUTCOME } from './micRecognitionIr.js'
import { PERFORMANCE_MODE, buildPerformanceExpectation } from './performanceExpectation.js'
import {
  createGuitarRecognitionState,
  evaluateGuitarRecognition,
} from './guitarRecognition.js'
import {
  createPianoRecognitionState,
  evaluatePianoRecognition,
} from './pianoRecognition.js'
import {
  applyRecognitionTiming,
  createMusicalTimingState,
  updateMusicalTiming,
} from './musicalTiming.js'

function mean(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}

function rate(entries, predicate) {
  return entries.length ? entries.filter(predicate).length / entries.length : null
}

function unique(values = []) {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right)
}

function clipCategory(clip) {
  const count = clip.expectedMidis?.length ?? 0
  if (clip.instrument === 'guitar' && count === 2) return 'double-stop'
  if (count === 2) return 'dyad'
  if (count === 3) return 'triad'
  if (count >= 4) return 'large-chord'
  return count === 1 ? 'single-note' : 'control'
}

function isQuietClip(clip) {
  return clip.dynamic === 'pp' || clip.quiet === true
}

function toneClass(clip) {
  const tone = String(clip.tone ?? '').toLowerCase()
  if (tone.includes('electric')) return 'electric'
  if (tone.includes('acoustic')) return 'acoustic'
  return null
}

function performanceOnset(clip) {
  const onset = Number(clip.performanceOnsetMs)
  return Number.isFinite(onset) && onset >= 0 ? onset : null
}

function checkpointForClip(clip) {
  const isChord = (clip.expectedMidis?.length ?? 0) > 1
  return {
    id: `replay-${clip.id}`,
    expectedMidis: clip.expectedMidis ?? [],
    expectedStringFrets: clip.expectedStringFrets ?? [],
    minimumRequiredTones: clip.minimumRequiredTones ?? null,
    rollingWindowMs: clip.rollMs ?? (isChord ? (clip.instrument === 'guitar' ? 900 : 720) : 0),
    isChord,
    timeSeconds: 0,
    measureNumber: 1,
    beat: 1,
  }
}

function frameForRecognition(frame, sequence, analysisWindowMs = 0) {
  const detectedMidis = unique(frame.detectedMidis ?? [])
  const musical = detectedMidis.length > 0
  return {
    sequence,
    // Offline frames are timestamped at the start of the FFT window. A live
    // decision cannot exist until that window has been captured.
    timeMs: (frame.timeMs ?? 0) + analysisWindowMs,
    gateOpen: musical,
    musical,
    noiseFloor: frame.noiseFloor ?? null,
    v2Notes: (frame.notes ?? []).map((note) => ({
      midi: note.midi,
      confidence: note.confidence ?? 0,
      detected: Boolean(note.detected),
      ratio: note.ratio ?? null,
      bassBoosted: Boolean(note.bassBoosted),
    })),
  }
}

function controlEvaluation(clip, replay) {
  const detections = unique((replay.stableDetections ?? []).map((entry) => entry.midi))
  const falseAdvance = detections.length > 0
  return {
    clipId: clip.id,
    label: clip.label,
    instrument: clip.instrument ?? null,
    tone: clip.tone ?? null,
    dynamic: clip.dynamic ?? null,
    category: 'control',
    expectedMidis: [],
    matchedMidis: [],
    missingMidis: [],
    unexpectedMidis: detections,
    accepted: false,
    correctReject: !falseAdvance,
    falseAdvance,
    falseReject: false,
    firstAttemptSuccess: false,
    confirmationAtMs: null,
    confirmationLatencyMs: null,
    chordCompletionLatencyMs: null,
    latencyAnnotationValid: true,
    attemptCount: 0,
    quiet: false,
    toneClass: toneClass(clip),
    ringingTransition: false,
    fixtureClass: clip.provenance?.fixtureClass ?? clip.fixtureClass ?? null,
    naturalPerformance: Boolean(clip.provenance?.naturalPerformance ?? clip.naturalPerformance),
    finalReason: falseAdvance ? 'control-produced-stable-pitch' : 'control-correct-reject',
  }
}

/**
 * Replay V2 spectral frames through the same V3 expectation, timing, and
 * instrument decision layers used by the live practice hook.
 */
export function evaluateMicV3PerformanceClip(clip, replay) {
  if (clip.label === 'silence' || clip.label === 'noise') {
    return controlEvaluation(clip, replay)
  }
  const checkpoint = checkpointForClip(clip)
  const expectation = buildPerformanceExpectation({
    checkpoint,
    checkpointIndex: 0,
    checkpoints: [checkpoint],
    instrument: clip.instrument,
    mode: PERFORMANCE_MODE.WAIT_FOR_YOU,
  })
  let timingState = createMusicalTimingState(expectation)
  let recognitionState = expectation.instrument === 'guitar'
    ? createGuitarRecognitionState(expectation)
    : createPianoRecognitionState(expectation)
  let acceptedDecision = null
  let lastDecision = null
  let bestDecision = null
  let attemptCount = 0
  let rejectedAttemptCount = 0
  const analysisWindowMs = replay.fftSize && replay.sampleRate
    ? (replay.fftSize / replay.sampleRate) * 1000
    : 0

  for (const [sequence, sourceFrame] of (replay.frames ?? []).entries()) {
    const frame = frameForRecognition(sourceFrame, sequence, analysisWindowMs)
    const timing = updateMusicalTiming({
      expectation,
      frame,
      state: timingState,
      timeMs: frame.timeMs,
      musical: frame.musical,
    })
    timingState = timing.state
    const previousAttemptStartMs = recognitionState.attemptStartMs
    const args = {
      expectation,
      frame,
      state: recognitionState,
      timeMs: frame.timeMs,
      musical: frame.musical,
      attack: timing.attack
        ? {
            id: timing.attack.id,
            fresh: timing.fresh,
            confidence: timing.attack.confidence.overall,
          }
        : { fresh: false },
    }
    const recognition = expectation.instrument === 'guitar'
      ? evaluateGuitarRecognition(args)
      : evaluatePianoRecognition(args)
    recognitionState = recognition.state
    if (
      timing.fresh &&
      recognition.state.attemptStartMs !== previousAttemptStartMs
    ) {
      attemptCount += 1
    }
    lastDecision = applyRecognitionTiming(recognition.decision, timing)
    if (
      !bestDecision ||
      lastDecision.matchedMidis.length > bestDecision.matchedMidis.length ||
      lastDecision.unexpectedMidis.length > bestDecision.unexpectedMidis.length
    ) {
      bestDecision = lastDecision
    }
    if (
      lastDecision.outcome === RECOGNITION_OUTCOME.REJECTED &&
      lastDecision.reason !== 'non-musical-input'
    ) {
      rejectedAttemptCount += 1
    }
    if (lastDecision.advance && lastDecision.outcome === RECOGNITION_OUTCOME.ACCEPTED) {
      acceptedDecision = lastDecision
      break
    }
  }

  const finalDecision = acceptedDecision ?? bestDecision ?? lastDecision
  const matchedMidis = unique(
    finalDecision?.matchedMidis ??
      recognitionState.matchedNotes?.map((note) => note.midi) ?? [],
  )
  const expectedMidis = unique(clip.expectedMidis ?? [])
  const missingMidis = expectedMidis.filter((midi) => !matchedMidis.includes(midi))
  const unexpectedMidis = unique(finalDecision?.unexpectedMidis ?? [])
  const accepted = Boolean(acceptedDecision)
  const onsetMs = performanceOnset(clip)
  const confirmationAtMs = acceptedDecision?.timeMs ?? null
  const firstMatchedAtMs = mean(
    (recognitionState.matchedNotes ?? []).map((note) => note.firstSeenMs),
  )
  const confirmationLatencyMs = accepted && onsetMs != null
    ? confirmationAtMs - onsetMs
    : null
  const chordCompletionLatencyMs = accepted && firstMatchedAtMs != null
    ? confirmationAtMs - Math.min(
        ...(recognitionState.matchedNotes ?? []).map((note) => note.firstSeenMs),
      )
    : null
  const latencyAnnotationValid = confirmationLatencyMs == null || confirmationLatencyMs >= 0
  const falseAdvance = accepted && unexpectedMidis.length > 0

  return {
    clipId: clip.id,
    label: clip.label,
    instrument: clip.instrument ?? null,
    tone: clip.tone ?? null,
    dynamic: clip.dynamic ?? null,
    category: clipCategory(clip),
    expectedMidis,
    matchedMidis,
    missingMidis,
    unexpectedMidis,
    requiredToneCount: expectation.event.requiredToneCount,
    accepted,
    correctReject: false,
    falseAdvance,
    falseReject: !accepted,
    firstAttemptSuccess: accepted && attemptCount === 1 && rejectedAttemptCount === 0,
    confirmationAtMs,
    performanceOnsetMs: onsetMs,
    confirmationLatencyMs,
    chordCompletionLatencyMs,
    latencyAnnotationValid,
    attemptCount,
    rejectedAttemptCount,
    quiet: isQuietClip(clip),
    toneClass: toneClass(clip),
    ringingTransition: Boolean(clip.ringingTransition || clip.id.includes('ringing')),
    fixtureClass: clip.provenance?.fixtureClass ?? clip.fixtureClass ?? null,
    naturalPerformance: Boolean(clip.provenance?.naturalPerformance ?? clip.naturalPerformance),
    finalReason: finalDecision?.reason ?? 'no-recognition-frames',
    confidence: finalDecision?.confidence ?? null,
  }
}

function successBucket(entries) {
  return {
    count: entries.length,
    successes: entries.filter((entry) => entry.accepted).length,
    successRate: rate(entries, (entry) => entry.accepted),
  }
}

export function summarizeMicV3PerformanceMetrics(evaluations) {
  const performance = evaluations.filter((entry) => entry.label === 'chord')
  const controls = evaluations.filter((entry) => entry.category === 'control')
  const validLatency = performance.filter(
    (entry) => entry.accepted && entry.latencyAnnotationValid,
  )
  const invalidLatencyAnnotations = performance.filter(
    (entry) => !entry.latencyAnnotationValid,
  )
  const byCategory = Object.fromEntries(
    ['double-stop', 'dyad', 'triad', 'large-chord'].map((category) => [
      category,
      successBucket(performance.filter((entry) => entry.category === category)),
    ]),
  )
  return {
    engine: 'v3-performance-expectation',
    clipCount: evaluations.length,
    performanceClipCount: performance.length,
    controlClipCount: controls.length,
    acceptedCount: performance.filter((entry) => entry.accepted).length,
    eventHitRate: rate(performance, (entry) => entry.accepted),
    firstAttemptSuccessRate: rate(performance, (entry) => entry.firstAttemptSuccess),
    averageConfirmationLatencyMs: mean(validLatency.map((entry) => entry.confirmationLatencyMs)),
    averageChordCompletionLatencyMs: mean(
      performance.map((entry) => entry.chordCompletionLatencyMs),
    ),
    invalidLatencyAnnotationCount: invalidLatencyAnnotations.length,
    falseAdvanceCount: evaluations.filter((entry) => entry.falseAdvance).length,
    falseAdvanceRate: rate(evaluations, (entry) => entry.falseAdvance),
    falseRejectCount: performance.filter((entry) => entry.falseReject).length,
    falseRejectRate: rate(performance, (entry) => entry.falseReject),
    quietNoteSuccess: successBucket(performance.filter((entry) => entry.quiet)),
    electricSuccess: successBucket(performance.filter((entry) => entry.toneClass === 'electric')),
    acousticSuccess: successBucket(performance.filter((entry) => entry.toneClass === 'acoustic')),
    doubleStopAccuracy: byCategory['double-stop'],
    dyadAccuracy: byCategory.dyad,
    triadAccuracy: byCategory.triad,
    largeChordAccuracy: byCategory['large-chord'],
    ringingTransitionSuccess: successBucket(
      performance.filter((entry) => entry.ringingTransition),
    ),
    byCategory,
    byInstrument: Object.fromEntries(
      ['piano', 'guitar'].map((instrument) => [
        instrument,
        successBucket(performance.filter((entry) => entry.instrument === instrument)),
      ]),
    ),
    provenance: {
      naturalPerformanceClips: evaluations.filter((entry) => entry.naturalPerformance).length,
      proxyOrSyntheticClips: evaluations.filter((entry) => !entry.naturalPerformance).length,
    },
    perClip: evaluations,
  }
}

function percent(value) {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`
}

function milliseconds(value) {
  return value == null ? '—' : `${value.toFixed(0)} ms`
}

function bucketLine(label, bucket) {
  return `- ${label}: ${percent(bucket.successRate)} (${bucket.successes}/${bucket.count})`
}

export function formatMicV3PerformanceMetricsMarkdown(summary) {
  const lines = [
    '# Mic Engine V3 performance replay',
    '',
    `Engine: **${summary.engine}**`,
    `Coverage: ${summary.performanceClipCount} musical events · ${summary.controlClipCount} controls`,
    '',
    '## Event metrics',
    `- Event hit rate: ${percent(summary.eventHitRate)} (${summary.acceptedCount}/${summary.performanceClipCount})`,
    `- First-attempt success: ${percent(summary.firstAttemptSuccessRate)}`,
    `- Average confirmation latency: ${milliseconds(summary.averageConfirmationLatencyMs)}`,
    `- Average chord completion latency: ${milliseconds(summary.averageChordCompletionLatencyMs)}`,
    `- False advances: ${summary.falseAdvanceCount} (${percent(summary.falseAdvanceRate)})`,
    `- False rejects: ${summary.falseRejectCount} (${percent(summary.falseRejectRate)})`,
    `- Invalid latency annotations excluded: ${summary.invalidLatencyAnnotationCount}`,
    '',
    '## Reliability slices',
    bucketLine('Quiet playing', summary.quietNoteSuccess),
    bucketLine('Electric guitar', summary.electricSuccess),
    bucketLine('Acoustic timbre', summary.acousticSuccess),
    bucketLine('Guitar double-stops', summary.doubleStopAccuracy),
    bucketLine('Piano dyads', summary.dyadAccuracy),
    bucketLine('Triads', summary.triadAccuracy),
    bucketLine('Large chords', summary.largeChordAccuracy),
    bucketLine('Ringing fixtures', summary.ringingTransitionSuccess),
    '',
    '## Provenance warning',
    `- Natural performance recordings: ${summary.provenance.naturalPerformanceClips}`,
    `- Synthetic or isolated-sample proxies: ${summary.provenance.proxyOrSyntheticClips}`,
    '- Proxy results are not described as live-instrument validation.',
    '',
    '## Per clip',
  ]
  for (const clip of summary.perClip) {
    lines.push(
      `- **${clip.clipId}** → ${clip.accepted ? 'accepted' : clip.correctReject ? 'correct reject' : 'rejected'} · ` +
      `${clip.matchedMidis.length}/${clip.expectedMidis.length} tones · ` +
      `confirm ${milliseconds(clip.confirmationLatencyMs)} · complete ${milliseconds(clip.chordCompletionLatencyMs)} · ${clip.finalReason}`,
    )
  }
  return `${lines.join('\n')}\n`
}
