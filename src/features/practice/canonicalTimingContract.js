/**
 * CORRANZO V1 — Canonical timing contract (B06).
 *
 * One coherent timing truth for: playback, score cursor, highlighting,
 * looping, Play Along, Wait For You, and practice-result attribution.
 *
 * Single source of truth: the parsed MusicXML `timingMap` performed timeline
 * (`getTimeline(timingMap)`), which expands repeats/endings into performed
 * time. All playable score events derive from it — never from independent
 * audio-clock interpolations, React-clock approximations, or separately
 * derived timelines that can drift.
 *
 * Canonical event schema (stable across consumers):
 * - eventId: stable checkpoint/group id (`note-m<measure>-t<onset>-<index>`)
 * - measureNumber, repeatPass, beat
 * - onsetScoreSeconds: expected input time in performed score seconds
 * - durationSeconds, quarterTime, durationQuarters
 * - tempoBpmAtOnset: resolved from timingMap tempo map (for diagnostics)
 * - expectedMidis: sorted unique attack pitches for the onset
 * - chordMembership: isChord, chord size, minimumRequiredTones where relevant
 * - voice/part/staff where relevant (from first note)
 * - rest / non-playable status: isRest, isTiedContinuation (sustain, not attack)
 * - occurrence identity: performedIndex / repeatPass distinguishes repeated
 *   written measures (loop/repeat passes are different events).
 *
 * Consumers:
 * - playback: ScorePlaybackEngine schedules from performed notes/beats.
 * - cursor/highlighting: sample authoritative `getScoreTime()` + locate().
 * - loop: bounds are performed-time windows from the same timeline.
 * - Play Along / Wait For You: checkpoints/groups built from the same
 *   performed notes via buildNoteCheckpoints / buildVisualLaneGroups.
 * - stats: attribute results by eventId + attemptId, never by wall time alone.
 *
 * Unsupported source semantics must surface explicitly (see
 * `describeSourceFidelity`): unknown repeats fall back to written order with
 * a warning; approximate TAB rhythm is labeled, never silently treated as
 * faithful.
 */
import { getTimeline } from '../musicxml/timeline.js'
import { getBeatAtTime, getMeasureAtTime } from '../musicxml/timingQuery.js'
import { buildNoteCheckpoints } from './waitForYouCheckpoints.js'
import { buildVisualLaneGroups } from './visualPracticeLane.js'

export const CANONICAL_TIMING_CONTRACT_VERSION = 1

/** Resolve tempo (quarter-BPM) active at a score time, if the map provides it. */
export function tempoAtScoreTime(timingMap, timeSeconds) {
  try {
    const beats = timingMap?.beats ?? []
    // timingMap notes/measures carry tempo via beats; fall back to first tempo.
    const at = Number(timeSeconds)
    if (!Number.isFinite(at)) return null
    // Prefer an explicit tempo map when present.
    const tempoMap = timingMap?.tempoMap ?? timingMap?.tempos ?? null
    if (Array.isArray(tempoMap) && tempoMap.length) {
      let active = tempoMap[0]?.bpm ?? tempoMap[0]?.tempo ?? null
      for (const entry of tempoMap) {
        const t = entry.timeSeconds ?? entry.time ?? 0
        if (t <= at + 1e-6) active = entry.bpm ?? entry.tempo ?? active
        else break
      }
      return active != null ? Number(active) : null
    }
    return timingMap?.defaultTempo ?? null
  } catch {
    return null
  }
}

/**
 * Resolve every playable score event to stable canonical timing info.
 * One row per note-checkpoint onset (chords collapsed to a single event).
 */
export function resolveCanonicalTimingEvents(timingMap, options = {}) {
  if (!timingMap) return []
  const checkpoints = buildNoteCheckpoints(timingMap, options.loopRegion ?? null, {
    practiceScope: options.practiceScope,
  })
  return checkpoints.map((checkpoint, index) => {
    const firstNote = checkpoint.notes?.[0] ?? null
    return {
      eventId: checkpoint.id,
      checkpointIndex: checkpoint.index ?? index,
      measureNumber: checkpoint.measureNumber ?? null,
      repeatPass: checkpoint.repeatPass ?? 1,
      beat: checkpoint.beat ?? null,
      onsetScoreSeconds: checkpoint.timeSeconds,
      quarterTime: checkpoint.quarterTime ?? null,
      durationSeconds: firstNote?.durationSeconds ?? null,
      durationQuarters: firstNote?.durationQuarters ?? null,
      tempoBpmAtOnset: tempoAtScoreTime(timingMap, checkpoint.timeSeconds),
      expectedMidis: [...(checkpoint.expectedMidis ?? [])],
      isChord: Boolean(checkpoint.isChord),
      chordSize: (checkpoint.expectedMidis ?? []).length,
      voice: firstNote?.voice ?? null,
      partId: firstNote?.partId ?? null,
      staff: firstNote?.staff ?? null,
      isRest: false,
      isTiedContinuation: Boolean(checkpoint.isTiedContinuation),
      playable: !Boolean(checkpoint.isTiedContinuation),
      performedIndex: firstNote?.performedIndex ?? null,
    }
  })
}

/** Locate a score time on the canonical performed timeline. */
export function locateCanonicalScoreTime(timingMap, timeSeconds) {
  if (!timingMap) return null
  const timeline = getTimeline(timingMap)
  const located = timeline.locate(timeSeconds)
  const measure = getMeasureAtTime(timingMap, timeSeconds)
  const beat = getBeatAtTime(timingMap, timeSeconds)
  return {
    timeSeconds: located.timeSeconds,
    measureNumber: located.measureNumber ?? measure?.number ?? null,
    beat: located.beat ?? beat?.beat ?? null,
    occurrenceIndex: located.occurrenceIndex,
    repeatPass: located.repeatPass ?? 1,
    measureProgress: located.measureProgress ?? 0,
  }
}

/**
 * Canonical loop bounds: the exact performed-time window shared by audio,
 * cursor, evaluator, and visual lane. Disabled loops yield null (no filter).
 */
export function canonicalLoopBounds(loopRegion, { enabled = false } = {}) {
  if (!enabled || !loopRegion?.isValid) return null
  return {
    startTimeSeconds: loopRegion.startTimeSeconds,
    endTimeSeconds: loopRegion.endTimeSeconds,
    durationSeconds: loopRegion.endTimeSeconds - loopRegion.startTimeSeconds,
    label: loopRegion.label ?? null,
  }
}

/** Visual lane groups derived from the same canonical checkpoints. */
export function canonicalLaneGroups(timingMap, loopRegion, options = {}) {
  return buildVisualLaneGroups(timingMap, loopRegion, options)
}

/**
 * Source-faithfulness envelope: what the timing truthfully represents and
 * what it explicitly does not. Unsupported semantics surface as reasons
 * rather than silent approximations.
 */
export function describeSourceFidelity(timingMap) {
  const diagnostics = timingMap?.diagnostics ?? timingMap?.performedMeasureTimeline?.diagnostics ?? {}
  const unsupported = []
  if (diagnostics.unsupportedNavigation) unsupported.push('unsupported-navigation:written-order-fallback')
  if (timingMap?.hasApproximateTabRhythm) unsupported.push('tab-approximate-even-rhythm')
  if (diagnostics.defaultTempoUsed) unsupported.push('default-tempo-120-used')
  return {
    contractVersion: CANONICAL_TIMING_CONTRACT_VERSION,
    usesPerformedTimeline: Boolean(timingMap?.performedMeasureTimeline),
    durationSeconds: timingMap?.durationSeconds ?? null,
    noteCount: timingMap?.noteCount ?? timingMap?.notes?.length ?? null,
    unsupported,
    diagnostics,
  }
}

export function describeCanonicalTimingContract() {
  return {
    contractVersion: CANONICAL_TIMING_CONTRACT_VERSION,
    truth: 'timingMap performed timeline via getTimeline(timingMap)',
    eventSchema: [
      'eventId', 'measureNumber', 'repeatPass', 'beat',
      'onsetScoreSeconds', 'durationSeconds', 'quarterTime',
      'tempoBpmAtOnset', 'expectedMidis', 'isChord/chordSize',
      'voice/partId/staff', 'isRest/isTiedContinuation/playable',
      'performedIndex',
    ],
    consumers: ['playback', 'cursor', 'highlighting', 'loop', 'play-along', 'wait-for-you', 'stats'],
  }
}
