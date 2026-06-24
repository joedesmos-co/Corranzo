/**
 * Tracks overlapping piano voices and gently reduces velocity when many notes
 * sound together — prevents harsh clipping without voice-stealing.
 */

const CHORD_TIME_EPSILON = 0.004

export function createVoiceMixState() {
  return {
    active: [],
    maxSimultaneous: 0,
    totalTriggers: 0,
    densityReduced: 0,
    lastTriggerAt: null,
  }
}

export function resetVoiceMix(state) {
  state.active = []
  state.lastTriggerAt = null
}

export function pruneVoices(state, beforeTime) {
  if (!state?.active?.length) {
    return
  }
  state.active = state.active.filter((voice) => voice.end > beforeTime)
}

function chordBucket(time) {
  return Math.round(time / CHORD_TIME_EPSILON) * CHORD_TIME_EPSILON
}

function countOverlapping(state, time) {
  const bucket = chordBucket(time)
  let count = 0
  for (const voice of state.active) {
    if (voice.end > time && Math.abs(voice.bucket - bucket) <= CHORD_TIME_EPSILON) {
      count += 1
    }
  }
  return count
}

/**
 * @returns {{ velocity: number, density: number, reduced: boolean }}
 */
export function planNoteTrigger(state, { time, velocity, duration }) {
  pruneVoices(state, time - 0.05)
  const overlapping = countOverlapping(state, time)
  const density = overlapping + 1
  let adjusted = typeof velocity === 'number' ? velocity : 0.82

  let reduced = false
  if (density > 3) {
    adjusted *= Math.sqrt(3 / density)
    reduced = true
    state.densityReduced += 1
  }

  adjusted = Math.min(0.9, Math.max(0.22, adjusted))

  state.active.push({
    bucket: chordBucket(time),
    start: time,
    end: time + Math.max(duration, 0.03),
    velocity: adjusted,
  })
  state.maxSimultaneous = Math.max(state.maxSimultaneous, density)
  state.totalTriggers += 1
  state.lastTriggerAt = time

  return { velocity: adjusted, density, reduced }
}

export function getVoiceMixDiagnostics(state) {
  if (!state) {
    return {
      activeVoices: 0,
      maxSimultaneous: 0,
      totalTriggers: 0,
      densityReduced: 0,
    }
  }
  return {
    activeVoices: state.active.length,
    maxSimultaneous: state.maxSimultaneous,
    totalTriggers: state.totalTriggers,
    densityReduced: state.densityReduced,
  }
}

/**
 * Snap simultaneous chord onsets to the same score-time grid (2ms).
 */
export function alignChordScoreTime(scoreTimeSeconds) {
  const grid = 0.002
  return Math.round(scoreTimeSeconds / grid) * grid
}
