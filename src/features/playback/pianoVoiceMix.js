/**
 * Tracks overlapping piano voices and gently reduces velocity when many notes
 * sound together — prevents harsh clipping without abrupt cutouts.
 */

const CHORD_TIME_EPSILON = 0.004

/** High but finite simultaneous voice budget (sampler has no built-in cap). */
export const MAX_SIMULTANEOUS_VOICES = 48

/** Start gentle velocity ducking above this many overlapping voices. */
const DENSITY_DUCK_THRESHOLD = 5

/** Extra global-load ducking when sustained tails stack up. */
const GLOBAL_LOAD_DUCK_THRESHOLD = 12

export function createVoiceMixState() {
  return {
    active: [],
    maxSimultaneous: 0,
    totalTriggers: 0,
    densityReduced: 0,
    voicesStolen: 0,
    duplicatesSkipped: 0,
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

function countAllOverlapping(state, time) {
  let count = 0
  for (const voice of state.active) {
    if (voice.end > time) {
      count += 1
    }
  }
  return count
}

function countChordBucketOverlapping(state, time) {
  const bucket = chordBucket(time)
  let count = 0
  for (const voice of state.active) {
    if (voice.end > time && Math.abs(voice.bucket - bucket) <= CHORD_TIME_EPSILON) {
      count += 1
    }
  }
  return count
}

function findVoicesToSteal(state, time, incoming = 1) {
  const active = state.active.filter((voice) => voice.end > time)
  const overflow = active.length + incoming - MAX_SIMULTANEOUS_VOICES
  if (overflow <= 0) {
    return []
  }

  return [...active]
    .sort((left, right) => {
      const remainLeft = left.end - time
      const remainRight = right.end - time
      if (Math.abs(remainLeft - remainRight) > 0.02) {
        return remainLeft - remainRight
      }
      if (left.velocity !== right.velocity) {
        return left.velocity - right.velocity
      }
      return left.start - right.start
    })
    .slice(0, overflow)
}

/**
 * @returns {{
 *   velocity: number,
 *   density: number,
 *   reduced: boolean,
 *   skipped?: boolean,
 *   release?: Array<{ note: string, time: number }>,
 * }}
 */
export function planNoteTrigger(state, { time, velocity, duration, note = null }) {
  pruneVoices(state, time - 0.05)

  const bucket = chordBucket(time)
  if (note) {
    const duplicate = state.active.some(
      (voice) =>
        voice.note === note &&
        voice.bucket === bucket &&
        voice.end > time + 0.001,
    )
    if (duplicate) {
      state.duplicatesSkipped += 1
      const density = Math.max(countAllOverlapping(state, time), countChordBucketOverlapping(state, time)) + 1
      return { velocity: 0, density, reduced: false, skipped: true, release: [] }
    }
  }

  const globalOverlapping = countAllOverlapping(state, time)
  const chordOverlapping = countChordBucketOverlapping(state, time)
  const density = Math.max(globalOverlapping, chordOverlapping) + 1

  let adjusted = typeof velocity === 'number' ? velocity : 0.82
  let reduced = false

  if (density > DENSITY_DUCK_THRESHOLD) {
    adjusted *= (DENSITY_DUCK_THRESHOLD / density) ** 0.4
    reduced = true
    state.densityReduced += 1
  }

  if (density > GLOBAL_LOAD_DUCK_THRESHOLD) {
    adjusted *= (GLOBAL_LOAD_DUCK_THRESHOLD / density) ** 0.25
    reduced = true
  }

  adjusted = Math.min(0.92, Math.max(0.32, adjusted))

  const victims = note ? findVoicesToSteal(state, time, 1) : []
  if (victims.length > 0) {
    state.voicesStolen += victims.length
    const victimKeys = new Set(victims)
    state.active = state.active.filter((voice) => !victimKeys.has(voice))
  }

  state.active.push({
    note,
    bucket,
    start: time,
    end: time + Math.max(duration, 0.03),
    velocity: adjusted,
  })
  state.maxSimultaneous = Math.max(state.maxSimultaneous, density)
  state.totalTriggers += 1
  state.lastTriggerAt = time

  return {
    velocity: adjusted,
    density,
    reduced,
    skipped: false,
    release: victims
      .filter((voice) => voice.note)
      .map((voice) => ({ note: voice.note, time })),
  }
}

export function getVoiceMixDiagnostics(state) {
  if (!state) {
    return {
      activeVoices: 0,
      maxSimultaneous: 0,
      totalTriggers: 0,
      densityReduced: 0,
      voicesStolen: 0,
      duplicatesSkipped: 0,
    }
  }
  return {
    activeVoices: state.active.length,
    maxSimultaneous: state.maxSimultaneous,
    totalTriggers: state.totalTriggers,
    densityReduced: state.densityReduced,
    voicesStolen: state.voicesStolen,
    duplicatesSkipped: state.duplicatesSkipped,
  }
}

/**
 * Snap simultaneous chord onsets to the same score-time grid (2ms).
 */
export function alignChordScoreTime(scoreTimeSeconds) {
  const grid = 0.002
  return Math.round(scoreTimeSeconds / grid) * grid
}
