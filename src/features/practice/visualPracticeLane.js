import { buildNoteCheckpoints } from './waitForYouCheckpoints.js'
import { getTimeline } from '../musicxml/timeline.js'
import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import { enrichWfyChordCheckpoint } from './pianoChordCheckpoint.js'
import { buildVisualNoteMarkings } from './visualNotationMarkings.js'
import { VISUAL_LANE_DEFAULTS, WFY_VISUAL_MOVE_MS } from './visualLaneConstants.js'
import { isFiniteMidi, sanitizeVisualDurationSeconds } from './visualNoteSanitize.js'

export { VISUAL_LANE_DEFAULTS, WFY_VISUAL_MOVE_MS } from './visualLaneConstants.js'

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
export function buildVisualLaneGroups(timingMap, loopRegion = null, options = {}) {
  const checkpoints = buildNoteCheckpoints(timingMap, loopRegion, {
    practiceScope: options.practiceScope,
  }).map((checkpoint) =>
    enrichWfyChordCheckpoint(checkpoint, {
      instrumentId: options.instrumentId ?? null,
      tabPositions: options.tabPositions ?? null,
    }),
  )

  return checkpoints.map((checkpoint) => {
    const notes = [...(checkpoint.notes ?? [])]
      .filter((note) => isFiniteMidi(note.midi))
      .sort((a, b) => b.midi - a.midi)
      .map((note, noteIndex) => {
        const visualNote = {
          id: note.id ?? null,
          visualNoteId: `${checkpoint.id}-n${noteIndex}`,
          sourceNoteId: note.id ?? null,
          partId: note.partId ?? null,
          voice: note.voice ?? null,
          midi: note.midi,
          label: note.label ?? midiToNoteLabel(note.midi),
          staff: note.staff ?? null,
          measureNumber: note.measureNumber ?? checkpoint.measureNumber,
          quarterTime: note.quarterTime ?? checkpoint.quarterTime ?? null,
          timeSeconds: note.timeSeconds ?? checkpoint.timeSeconds,
          durationSeconds: sanitizeVisualDurationSeconds(note.durationSeconds, null),
          tieStart: Boolean(note.tieStart),
          tieStop: Boolean(note.tieStop),
          staccato: Boolean(note.staccato),
          accent: Boolean(note.accent),
          tenuto: Boolean(note.tenuto),
          slurs: note.slurs ?? [],
          guitarTechniques: note.guitarTechniques ?? [],
          // Fretted-instrument position when the score provides one; derived
          // positions come from getTabPositionsForTimingMap via the note id.
          string: note.string ?? null,
          fret: note.fret ?? null,
        }
        return {
          ...visualNote,
          markings: buildVisualNoteMarkings(visualNote, { groupId: checkpoint.id }),
        }
      })

    return {
      id: checkpoint.id,
      checkpointIndex: checkpoint.index,
      timeSeconds: checkpoint.timeSeconds,
      measureNumber: checkpoint.measureNumber,
      beat: checkpoint.beat,
      kind: checkpoint.kind,
      isChord: checkpoint.isChord,
      isGuitarChordShape: Boolean(checkpoint.isGuitarChordShape),
      isRollingChordMic: Boolean(checkpoint.isRollingChordMic),
      isPianoChordMic: Boolean(checkpoint.isPianoChordMic),
      chordSymbol: checkpoint.chordSymbol ?? null,
      displayLabel: checkpoint.displayLabel ?? null,
      detailsLabel: checkpoint.detailsLabel ?? null,
      guitarChordShape: checkpoint.guitarChordShape ?? null,
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
 * Visual-only clock for lane windowing and scroll position.
 *
 * During Wait For You the engine may be paused while the active checkpoint is
 * already known. Prefer that checkpoint time so Score view target anchors and
 * Visual lane playhead stay on the same note; normal playback still uses the
 * existing practice/playback clock.
 */
export function resolveVisualFrameTime({
  currentTime = 0,
  waitForYouWaiting = false,
  waitForYouCheckpoint = null,
} = {}) {
  const checkpointTime = Number(waitForYouCheckpoint?.timeSeconds)
  if (waitForYouWaiting && Number.isFinite(checkpointTime)) {
    return checkpointTime
  }
  const normalizedCurrentTime = Number(currentTime)
  return Number.isFinite(normalizedCurrentTime) ? normalizedCurrentTime : 0
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

export function easeVisualPracticeMotion(progress) {
  const t = clamp01(Number(progress))
  return t * t * (3 - 2 * t)
}

export function resolveWfyDisplayFrameTime({
  fromTime = 0,
  toTime = 0,
  elapsedMs = 0,
  durationMs = WFY_VISUAL_MOVE_MS,
} = {}) {
  const from = Number(fromTime)
  const to = Number(toTime)
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return Number.isFinite(to) ? to : 0
  }
  const duration = Number(durationMs)
  if (!Number.isFinite(duration) || duration <= 0) {
    return to
  }
  const elapsed = Math.max(0, Number(elapsedMs) || 0)
  const progress = easeVisualPracticeMotion(elapsed / duration)
  return from + (to - from) * progress
}

/**
 * Moving Now-bar position for Visual Practice.
 *
 * The lane still uses absolute score seconds for note x-positions. Each frame
 * the renderer translates notes by `playheadX - frameTime * pxPerSecond`, so a
 * note at `frameTime` always sits exactly under the moving bar.
 */
export function resolveVisualPlayheadX({
  frameTime = 0,
  viewWidth = 0,
  durationSeconds = null,
  loopRegion = null,
  startFraction = VISUAL_LANE_DEFAULTS.nowLineFraction,
  endFraction = VISUAL_LANE_DEFAULTS.nowLineEndFraction,
} = {}) {
  const width = Number(viewWidth)
  if (!Number.isFinite(width) || width <= 0) {
    return 0
  }

  const startX = width * startFraction
  const endX = width * Math.max(startFraction, endFraction)
  const startTime = Number(loopRegion?.startTimeSeconds ?? 0)
  const explicitEnd = Number(loopRegion?.endTimeSeconds)
  const fallbackEnd = Number(durationSeconds)
  const endTime = Number.isFinite(explicitEnd) ? explicitEnd : fallbackEnd
  const spanSeconds = endTime - startTime

  if (!Number.isFinite(spanSeconds) || spanSeconds <= 0) {
    return startX
  }

  const time = Number(frameTime)
  const progress = clamp01(((Number.isFinite(time) ? time : 0) - startTime) / spanSeconds)
  return startX + (endX - startX) * progress
}

export function resolveVisualLaneTransform({
  frameTime = 0,
  viewWidth = 0,
  durationSeconds = null,
  loopRegion = null,
  pixelsPerSecond = VISUAL_LANE_DEFAULTS.pixelsPerSecond,
} = {}) {
  const time = Number(frameTime)
  const normalizedTime = Number.isFinite(time) ? time : 0
  const playheadX = resolveVisualPlayheadX({
    frameTime: normalizedTime,
    viewWidth,
    durationSeconds,
    loopRegion,
  })
  return {
    playheadX,
    scrollX: playheadX - normalizedTime * pixelsPerSecond,
  }
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
