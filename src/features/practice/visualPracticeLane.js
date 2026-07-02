import { buildNoteCheckpoints } from './waitForYouCheckpoints.js'
import { getTimeline } from '../musicxml/timeline.js'
import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'

/**
 * Visual Practice lane model.
 *
 * Pure selectors that turn the existing timing map / Wait For You note
 * checkpoints into a beginner-friendly "note lane": time-ordered groups
 * (chords stacked), a current target, and a keyboard highlight strip.
 *
 * No new timing math — groups reuse buildNoteCheckpoints() so Visual mode
 * and Wait For You always agree on what counts as "one thing to play"
 * (same ids, same chord grouping, same loop-region filtering).
 */

export const VISUAL_LANE_DEFAULTS = {
  /** Seconds of already-played notes kept visible behind the now line. */
  lookBehindSeconds: 3,
  /** Seconds of upcoming notes rendered ahead of the now line. Generous so
      wide/short lanes (scaled-down staves) never pop notes in at the edge. */
  lookAheadSeconds: 12,
  /** Horizontal scale: seconds → staff units. Beginner pacing — roughly a
      few measures visible at typical staff zoom. */
  pixelsPerSecond: 110,
  /** Now-line position as a fraction of the lane width. */
  nowLineFraction: 0.22,
}

export const VISUAL_GROUP_STATUS = {
  PAST: 'past',
  CURRENT: 'current',
  UPCOMING: 'upcoming',
}

/** Grace window: a group stays "current" this long after its onset. */
const TARGET_EPSILON_SECONDS = 0.12

/**
 * Build lane groups from the score timing map.
 * Each group = one Wait For You note checkpoint (chord notes stacked,
 * sorted high pitch first so stacking reads top-down like a staff).
 */
export function buildVisualLaneGroups(timingMap, loopRegion = null) {
  const checkpoints = buildNoteCheckpoints(timingMap, loopRegion)

  return checkpoints.map((checkpoint) => {
    const notes = [...(checkpoint.notes ?? [])]
      .filter((note) => note.midi != null)
      .sort((a, b) => b.midi - a.midi)
      .map((note) => ({
        midi: note.midi,
        label: note.label ?? midiToNoteLabel(note.midi),
        staff: note.staff ?? null,
        durationSeconds: note.durationSeconds ?? null,
      }))

    return {
      id: checkpoint.id,
      checkpointIndex: checkpoint.index,
      timeSeconds: checkpoint.timeSeconds,
      measureNumber: checkpoint.measureNumber,
      beat: checkpoint.beat,
      isChord: checkpoint.isChord,
      label: checkpoint.label,
      midis: checkpoint.expectedMidis ?? [],
      notes,
    }
  })
}

/**
 * Index of the group the player should play now: the first group at or
 * after `currentTime` (with a small grace window so a group does not flip
 * to "past" the instant playback crosses its onset). Returns -1 when empty.
 */
export function findVisualTargetIndex(groups, currentTime, epsilon = TARGET_EPSILON_SECONDS) {
  if (!groups?.length) {
    return -1
  }
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i].timeSeconds >= currentTime - epsilon) {
      return i
    }
  }
  return groups.length - 1
}

/**
 * Resolve the target group. Prefers the live Wait For You checkpoint id
 * (guaranteed to match because groups are built from the same checkpoints);
 * falls back to time-based lookup for normal playback or beat-mode WFY.
 */
export function resolveVisualTarget(groups, { currentTime = 0, waitForYouCheckpoint = null } = {}) {
  if (!groups?.length) {
    return { index: -1, group: null }
  }
  if (waitForYouCheckpoint?.id != null) {
    const index = groups.findIndex((group) => group.id === waitForYouCheckpoint.id)
    if (index >= 0) {
      return { index, group: groups[index] }
    }
    if (waitForYouCheckpoint.timeSeconds != null) {
      const timeIndex = findVisualTargetIndex(groups, waitForYouCheckpoint.timeSeconds)
      return { index: timeIndex, group: groups[timeIndex] ?? null }
    }
  }
  const index = findVisualTargetIndex(groups, currentTime)
  return { index, group: groups[index] ?? null }
}

/**
 * Slice the lane to the visible window around `currentTime` and tag each
 * group past/current/upcoming. Keeps DOM small on long pieces.
 */
export function selectVisualWindow(groups, currentTime, targetIndex, options = {}) {
  const {
    lookBehindSeconds = VISUAL_LANE_DEFAULTS.lookBehindSeconds,
    lookAheadSeconds = VISUAL_LANE_DEFAULTS.lookAheadSeconds,
  } = options

  if (!groups?.length) {
    return []
  }

  const windowStart = currentTime - lookBehindSeconds
  const windowEnd = currentTime + lookAheadSeconds
  const visible = []

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]
    const inWindow = group.timeSeconds >= windowStart && group.timeSeconds <= windowEnd
    // Always include the target so "Play this" never scrolls out of view.
    if (!inWindow && i !== targetIndex) {
      continue
    }
    let status = VISUAL_GROUP_STATUS.UPCOMING
    if (i === targetIndex) {
      status = VISUAL_GROUP_STATUS.CURRENT
    } else if (i < targetIndex || group.timeSeconds < currentTime) {
      status = VISUAL_GROUP_STATUS.PAST
    }
    visible.push({ ...group, status })
  }

  return visible
}

/**
 * Pitch range for vertical placement, padded and widened to a minimum
 * span so short pieces don't stretch across the whole lane height.
 *
 * Uses 1st/99th-percentile bounds instead of raw min/max so a handful of
 * extreme notes can't compress the rest of the piece into an unreadable
 * band (laneYForMidi clamps those outliers to the lane edges).
 */
export function computeLanePitchRange(groups, { minSpan = 16, pad = 2 } = {}) {
  const midis = []
  for (const group of groups ?? []) {
    for (const note of group.notes ?? []) {
      if (note.midi != null) {
        midis.push(note.midi)
      }
    }
  }

  if (!midis.length) {
    // Middle-C-centred default range.
    return { minMidi: 48, maxMidi: 72 }
  }

  midis.sort((a, b) => a - b)
  const percentile = (p) => midis[Math.min(midis.length - 1, Math.floor(p * (midis.length - 1)))]
  let minMidi = percentile(0.01) - pad
  let maxMidi = percentile(0.99) + pad

  const span = maxMidi - minMidi
  if (span < minSpan) {
    const grow = Math.ceil((minSpan - span) / 2)
    minMidi -= grow
    maxMidi += grow
  }

  return { minMidi, maxMidi }
}

/**
 * Vertical position for a pitch: 0 = top of lane (high notes),
 * 1 = bottom (low notes), clamped to the range.
 */
export function laneYForMidi(midi, range) {
  const { minMidi, maxMidi } = range
  const span = maxMidi - minMidi
  if (!Number.isFinite(midi) || span <= 0) {
    return 0.5
  }
  const clamped = Math.max(minMidi, Math.min(maxMidi, midi))
  return (maxMidi - clamped) / span
}

/**
 * Barline times for the lane, on performed time (repeat-aware): one per
 * performed measure window start, straight from the existing timeline API.
 */
export function buildBarlineTimes(timingMap) {
  const entries = getTimeline(timingMap).entries ?? []
  const times = entries.map((entry) => entry.startTimeSeconds)
  if (!times.length && timingMap?.measures?.length) {
    return timingMap.measures.map((measure) => measure.startTimeSeconds)
  }
  return times
}

/**
 * Keyboard strip range: centered on the piece's median pitch and capped to a
 * few octaves so keys stay large and readable. C-aligned on both ends.
 */
export function computeKeyboardRange(groups, { maxOctaves = 4, minOctaves = 2 } = {}) {
  const midis = []
  for (const group of groups ?? []) {
    for (const note of group.notes ?? []) {
      if (note.midi != null) {
        midis.push(note.midi)
      }
    }
  }
  if (!midis.length) {
    return { minMidi: 48, maxMidi: 83 } // C3–B5
  }

  midis.sort((a, b) => a - b)
  const percentile = (p) => midis[Math.min(midis.length - 1, Math.floor(p * (midis.length - 1)))]
  const lowOctave = Math.floor(percentile(0.05) / 12)
  const highOctave = Math.floor(percentile(0.95) / 12)
  const medianOctave = Math.floor(percentile(0.5) / 12)

  const neededOctaves = highOctave - lowOctave + 1
  const octaves = Math.max(minOctaves, Math.min(maxOctaves, neededOctaves))

  let startOctave
  if (neededOctaves <= octaves) {
    // Common range fits: cover it, padding extra octaves around the median.
    startOctave = lowOctave - Math.floor((octaves - neededOctaves) / 2)
  } else {
    // Capped: center the window on the median octave, clamped to the range.
    startOctave = Math.max(
      lowOctave,
      Math.min(medianOctave - Math.floor(octaves / 2), highOctave - octaves + 1),
    )
  }

  return { minMidi: startOctave * 12, maxMidi: (startOctave + octaves) * 12 - 1 }
}

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

export function isBlackKey(midi) {
  return BLACK_KEY_PITCH_CLASSES.has(((midi % 12) + 12) % 12)
}

/**
 * Keys for the highlight strip under the lane: piece range expanded to
 * full octaves (C to B) so the strip always looks like a real keyboard
 * segment. Not interactive — display only.
 */
export function buildKeyboardKeys(range, targetMidis = []) {
  const targets = new Set(targetMidis ?? [])
  const startMidi = Math.floor(range.minMidi / 12) * 12 // round down to a C
  const endMidi = Math.ceil((range.maxMidi + 1) / 12) * 12 - 1 // up to a B

  const keys = []
  for (let midi = startMidi; midi <= endMidi; midi += 1) {
    const black = isBlackKey(midi)
    keys.push({
      midi,
      black,
      isTarget: targets.has(midi),
      // Label targeted keys plus every C for orientation.
      label: targets.has(midi)
        ? midiToNoteLabel(midi)
        : !black && midi % 12 === 0
          ? midiToNoteLabel(midi)
          : null,
    })
  }
  return keys
}
