/**
 * CORRANZO V1 — Practice attempt identity (B03/B06).
 *
 * A practice *session* (score open) may contain many *attempts*.
 * An attempt is one traversable pass with stable outcome attribution:
 * - id: `att-<base36 time>-<rand>` — unique per attempt.
 * - iterationIndex: loop iteration within the attempt (0 = first pass).
 * - iterationId: `${attemptId}:it<iterationIndex>` for per-loop attribution.
 * - mode, loopBoundsKey, scoreRevisionKey: what the attempt traverses.
 * - startedAtWallMs, startScoreSeconds.
 *
 * Lifecycle (deliberate, no hidden stale state):
 * - start (mode enter, score load, manual restart): new attempt, outcomes cleared.
 * - pause: SAME attempt preserved (outcomes frozen, never wiped).
 * - resume: SAME attempt, timing windows re-anchored to the frozen
 *   authoritative score time (no shift of historical timestamps).
 * - seek: SAME attempt, new sub-traversal — outcomes AFTER the seek position
 *   are pruned (no stale future misses); outcomes BEFORE are kept.
 * - loop restart: SAME attempt, iterationIndex+1 — current-iteration outcomes
 *   reset (no inherited misses/hits); prior iterations remain attributable
 *   via iterationId if the ledger retains them.
 * - mode change / score restart / score replacement: NEW attempt.
 * - completion: attempt preserved (results survive; never cleared on stop).
 *
 * Do not conflate session with attempt.
 */

let attemptCounter = 0

export function createPracticeAttemptId() {
  attemptCounter += 1
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 7)
  return `att-${time}-${attemptCounter.toString(36)}${rand}`
}

export function createPracticeAttempt({ mode = null, scoreRevisionKey = null, loopBoundsKey = null, startScoreSeconds = 0 } = {}) {
  const id = createPracticeAttemptId()
  return {
    id,
    iterationIndex: 0,
    iterationId: `${id}:it0`,
    mode,
    scoreRevisionKey,
    loopBoundsKey,
    startScoreSeconds,
    startedAtWallMs: Date.now(),
    subAttemptIndex: 0,
  }
}

export function nextLoopIteration(attempt) {
  if (!attempt) return createPracticeAttempt({})
  const iterationIndex = (attempt.iterationIndex ?? 0) + 1
  return {
    ...attempt,
    iterationIndex,
    iterationId: `${attempt.id}:it${iterationIndex}`,
  }
}

export function nextSubAttempt(attempt, { seekScoreSeconds = null } = {}) {
  if (!attempt) return createPracticeAttempt({})
  return {
    ...attempt,
    subAttemptIndex: (attempt.subAttemptIndex ?? 0) + 1,
    lastSeekScoreSeconds: seekScoreSeconds,
  }
}

/** Operations that must start a brand-new attempt (fresh id, cleared outcomes). */
export function operationStartsNewAttempt(operation) {
  return (
    operation === 'mode-change' ||
    operation === 'score-load' ||
    operation === 'score-replace' ||
    operation === 'manual-restart' ||
    operation === 'wfy-restart'
  )
}

/**
 * Prune group outcomes that belong to the previous timeline traversal:
 * drop every outcome whose group onset is AFTER the seek position.
 * Past outcomes (<= seek time) are kept — they already happened.
 */
export function pruneOutcomesAfterSeek(outcomesMap, groupsById, seekTimeSeconds) {
  if (!outcomesMap || outcomesMap.size === 0) return new Map(outcomesMap ?? [])
  const seekTime = Number(seekTimeSeconds)
  if (!Number.isFinite(seekTime)) return new Map(outcomesMap)
  const pruned = new Map()
  for (const [groupId, outcome] of outcomesMap) {
    const groupTime = groupsById?.get?.(groupId)
    if (groupTime != null && Number.isFinite(Number(groupTime)) && Number(groupTime) > seekTime + 1e-6) {
      continue
    }
    pruned.set(groupId, outcome)
  }
  return pruned
}

/** Build a groupId → onset map for seek pruning. */
export function indexGroupsById(groups) {
  const map = new Map()
  for (const group of groups ?? []) {
    if (group?.id != null) map.set(group.id, Number(group.timeSeconds))
  }
  return map
}

export function describeAttemptLifecycle() {
  return {
    sessionVsAttempt: 'a session may contain many attempts; outcomes belong to (attemptId, iterationId, eventId)',
    pause: 'preserve same attempt; freeze authoritative score time',
    resume: 'same attempt; re-anchor windows to frozen time; never duplicate or re-award',
    seek: 'same attempt, sub-attempt+1; prune outcomes after seek time',
    loopRestart: 'same attempt, iteration+1; reset current-iteration outcomes',
    modeChangeScoreRestart: 'new attempt id; clear outcomes',
    completion: 'preserve attempt results; never clear on stop',
  }
}
