import { getTimeline } from '../musicxml/timeline.js'
import { getMeasureLayoutExtents } from '../practice/noteTargetContext.js'
import {
  getMeasurePlaybackWindow,
  getPerformedBeats,
  usesPerformedTimeline,
} from '../musicxml/performedTimeline.js'
import { clamp, lerp } from './scoreFollowEasing.js'

/** Continuous interpolation — cursor reaches note x exactly at onset time (no early snap). */
export const ONSET_SNAP_SECONDS = 0

const CHORD_GROUP_SECONDS = 0.012

/** Notes longer than this keep the cursor parked at the notehead until release. */
export const HELD_NOTE_THRESHOLD_SECONDS = 0.55

/** Fraction of written duration spent gliding toward the next onset after a hold plateau. */
const HELD_GLIDE_TAIL_FRACTION = 0.22

function beatWeightedProgress(timingMap, practiceTime, t0, t1) {
  if (t1 <= t0) {
    return { progress: 0, xRatio: 0 }
  }

  const beats = (usesPerformedTimeline(timingMap) ? getPerformedBeats(timingMap) : timingMap.beats).filter(
    (beat) => beat.timeSeconds >= t0 - 0.001 && beat.timeSeconds <= t1 + 0.001,
  )

  if (beats.length < 2) {
    const progress = clamp((practiceTime - t0) / (t1 - t0), 0, 1)
    return { progress, xRatio: progress }
  }

  for (let index = 0; index < beats.length - 1; index += 1) {
    const beatStart = beats[index].timeSeconds
    const beatEnd = beats[index + 1].timeSeconds
    if (practiceTime >= beatStart && practiceTime < beatEnd) {
      const segmentProgress =
        beatEnd > beatStart ? (practiceTime - beatStart) / (beatEnd - beatStart) : 0
      const progress = clamp((index + segmentProgress) / (beats.length - 1), 0, 1)
      return { progress, xRatio: progress }
    }
  }

  return { progress: 1, xRatio: 1 }
}

function noteXInMeasureSpan(note, layoutExtents, xStart, xEnd) {
  if (layoutExtents.hasDefaultX && note.defaultX != null) {
    const minX = layoutExtents.minDefaultX ?? 0
    const maxX = layoutExtents.maxDefaultX ?? minX
    const range = maxX - minX
    const ratio = range > 0.5 ? clamp((note.defaultX - minX) / range, 0, 1) : 0.12
    return lerp(xStart, xEnd, ratio)
  }
  return null
}

/**
 * Build time→x knots for a measure: measure start, each note/chord onset,
 * and optionally a terminal knot at the measure window end.
 */
export function buildMeasureMusicalEvents(
  timingMap,
  measureNumber,
  window,
  xStart,
  xEnd,
  { includeMeasureEnd = true } = {},
) {
  if (!window || xEnd <= xStart) {
    return []
  }

  const timeline = getTimeline(timingMap)
  const layoutExtents = getMeasureLayoutExtents(timingMap, measureNumber)
  const performedNotes = timeline
    .performedNotes()
    .filter(
      (note) =>
        note.measureNumber === measureNumber &&
        !note.isRest &&
        note.performedSeconds >= window.startTimeSeconds - 0.001 &&
        note.performedSeconds <= window.endTimeSeconds + 0.001,
    )

  const events = [
    { timeSeconds: window.startTimeSeconds, x: xStart, kind: 'measure-start' },
  ]

  if (performedNotes.length > 0) {
    const groups = new Map()
    for (const note of performedNotes) {
      const bucket = Math.round(note.performedSeconds / CHORD_GROUP_SECONDS)
      const key = String(bucket)
      if (!groups.has(key)) {
        groups.set(key, { timeSeconds: note.performedSeconds, notes: [] })
      }
      groups.get(key).notes.push(note)
    }

    for (const group of [...groups.values()].sort((a, b) => a.timeSeconds - b.timeSeconds)) {
      const representative = group.notes.reduce((best, note) => {
        if (note.defaultX == null) {
          return best
        }
        if (!best || best.defaultX == null || note.defaultX < best.defaultX) {
          return note
        }
        return best
      }, group.notes[0])

      let x = noteXInMeasureSpan(representative, layoutExtents, xStart, xEnd)
      if (x == null) {
        const local =
          window.endTimeSeconds > window.startTimeSeconds
            ? (group.timeSeconds - window.startTimeSeconds) /
              (window.endTimeSeconds - window.startTimeSeconds)
            : 0
        x = lerp(xStart, xEnd, clamp(local, 0, 1))
      }
      events.push({
        timeSeconds: group.timeSeconds,
        x: clamp(x, xStart, xEnd),
        kind: group.notes.length > 1 ? 'chord' : 'note',
        durationSeconds: Math.max(
          ...group.notes.map((note) => note.durationSeconds ?? 0),
          0,
        ),
      })
    }
  }

  if (includeMeasureEnd) {
    events.push({ timeSeconds: window.endTimeSeconds, x: xEnd, kind: 'measure-end' })
  }

  events.sort((a, b) => a.timeSeconds - b.timeSeconds || a.x - b.x)

  const deduped = []
  for (const event of events) {
    const prev = deduped[deduped.length - 1]
    if (prev && Math.abs(prev.timeSeconds - event.timeSeconds) < 0.004) {
      if (event.kind === 'note' || event.kind === 'chord') {
        deduped[deduped.length - 1] = event
      }
      continue
    }
    deduped.push(event)
  }

  for (let index = 1; index < deduped.length; index += 1) {
    if (deduped[index].x < deduped[index - 1].x) {
      deduped[index] = { ...deduped[index], x: deduped[index - 1].x }
    }
  }

  return insertHoldPlateaus(deduped, window)
}

function insertHoldPlateaus(events, window) {
  const withHolds = []
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    withHolds.push(event)
    if (event.kind !== 'note' && event.kind !== 'chord') {
      continue
    }
    const duration = event.durationSeconds ?? 0
    if (duration <= HELD_NOTE_THRESHOLD_SECONDS) {
      continue
    }
    const next = events[index + 1]
    const nextTime = next?.timeSeconds ?? window.endTimeSeconds
    const holdEnd = Math.min(
      event.timeSeconds + duration * (1 - HELD_GLIDE_TAIL_FRACTION),
      nextTime - 0.001,
    )
    if (holdEnd > event.timeSeconds + 0.02) {
      withHolds.push({
        timeSeconds: holdEnd,
        x: event.x,
        kind: 'hold-end',
      })
    }
  }

  withHolds.sort((a, b) => a.timeSeconds - b.timeSeconds || a.x - b.x)

  const merged = []
  for (const event of withHolds) {
    const prev = merged[merged.length - 1]
    if (prev && Math.abs(prev.timeSeconds - event.timeSeconds) < 0.004) {
      if (event.kind === 'hold-end' || event.kind === 'note' || event.kind === 'chord') {
        merged[merged.length - 1] = event
      }
      continue
    }
    merged.push(event)
  }

  for (let index = 1; index < merged.length; index += 1) {
    if (merged[index].x < merged[index - 1].x) {
      merged[index] = { ...merged[index], x: merged[index - 1].x }
    }
  }

  return merged
}

function firstMusicalEventInMeasure(timingMap, measureNumber, window, xStart, xEnd) {
  const events = buildMeasureMusicalEvents(timingMap, measureNumber, window, xStart, xEnd, {
    includeMeasureEnd: false,
  })
  return (
    events.find((event) => event.kind === 'note' || event.kind === 'chord') ??
    events.find((event) => event.kind === 'measure-start') ??
    null
  )
}

function segmentVelocity(before, after) {
  const dt = after.timeSeconds - before.timeSeconds
  if (dt <= 0) {
    return 0
  }
  return (after.x - before.x) / dt
}

/** Tail segments slower than this fraction of the prior note velocity feel like a stall. */
const TAIL_STALL_RATIO = 0.45

/**
 * Bounded segment interpolation: onset-locked linear glide that cannot pass the
 * next target early or move backward within a forward span.
 */
function interpolateSegment(before, after, prior, practiceTime) {
  const span = after.timeSeconds - before.timeSeconds
  if (span <= 0) {
    return after.x
  }
  const local = clamp((practiceTime - before.timeSeconds) / span, 0, 1)
  const linearX = lerp(before.x, after.x, local)

  const isTail = after.kind === 'bridge-next' || after.kind === 'measure-end'
  let x =
    isTail && prior
      ? interpolateWithVelocityContinuity(before, after, prior, practiceTime)
      : linearX

  const flatTail = isTail && Math.abs(after.x - before.x) < 0.001
  if (after.x >= before.x) {
    if (flatTail) {
      const creepCap = after.x + Math.min(Math.abs(segmentVelocity(prior ?? before, before)) * span * 0.5, 0.04)
      x = Math.max(before.x, Math.min(x, creepCap))
    } else {
      x = Math.max(before.x, Math.min(x, linearX))
    }
  } else {
    x = linearX
  }

  return x
}

/**
 * Velocity-continuous tail: keep moving through the barline when default-x / anchor
 * geometry leaves almost no horizontal delta in the linear segment.
 * Still lands exactly on `after.x` at `after.timeSeconds` for onset lock.
 */
function interpolateWithVelocityContinuity(before, after, prior, practiceTime) {
  const span = after.timeSeconds - before.timeSeconds
  if (span <= 0) {
    return after.x
  }
  const local = clamp((practiceTime - before.timeSeconds) / span, 0, 1)
  const linearX = lerp(before.x, after.x, local)

  const isTail = after.kind === 'bridge-next' || after.kind === 'measure-end'
  if (!isTail || !prior) {
    return linearX
  }

  const priorSpan = before.timeSeconds - prior.timeSeconds
  if (priorSpan <= 0) {
    return linearX
  }

  const priorVel = segmentVelocity(prior, before)
  const tailVel = segmentVelocity(before, after)
  const stallRatio =
    Math.abs(priorVel) > 1e-6 ? Math.abs(tailVel / priorVel) : 1
  const flatTail = Math.abs(after.x - before.x) < 0.001

  if (flatTail && Math.abs(priorVel) > 1e-6) {
    if (practiceTime >= after.timeSeconds - 0.001) {
      return after.x
    }
    const creepMax = Math.min(Math.abs(priorVel) * span * 0.45, 0.035)
    return before.x + creepMax * local
  }

  if (stallRatio >= TAIL_STALL_RATIO) {
    return linearX
  }

  const extrapX = before.x + priorVel * (practiceTime - before.timeSeconds)
  const blend = local * local * (3 - 2 * local)
  return lerp(extrapX, linearX, blend)
}

function appendMeasureBridge(events, bridgeTarget) {
  if (!bridgeTarget || bridgeTarget.timeSeconds <= events[0]?.timeSeconds) {
    return events
  }
  const last = events[events.length - 1]
  if (last && bridgeTarget.timeSeconds - last.timeSeconds < 0.001) {
    if (bridgeTarget.x > last.x) {
      events[events.length - 1] = { ...last, x: bridgeTarget.x, kind: 'bridge-next' }
    }
    return events
  }
  const x = Math.max(last?.x ?? bridgeTarget.x, bridgeTarget.x)
  events.push({
    timeSeconds: bridgeTarget.timeSeconds,
    x,
    kind: 'bridge-next',
  })
  return events
}

/**
 * Map playback time to horizontal position inside a measure using note/chord onsets.
 * When `measureBridge` is set, the tail of the measure continues into the next
 * measure's first onset instead of clamping at playableEndX until the barline.
 */
export function resolveMusicalXInMeasure({
  timingMap,
  practiceTime,
  measureNumber,
  xStart,
  xEnd,
  measureBridge = null,
}) {
  const window = getMeasurePlaybackWindow(timingMap, measureNumber, practiceTime)
  if (!window) {
    return null
  }

  let events = buildMeasureMusicalEvents(timingMap, measureNumber, window, xStart, xEnd, {
    includeMeasureEnd: !measureBridge,
  })

  if (measureBridge) {
    const bridgeLookupTime = Math.max(
      practiceTime,
      window.endTimeSeconds - 0.001,
    )
    const nextWindow = getMeasurePlaybackWindow(
      timingMap,
      measureBridge.measureNumber,
      bridgeLookupTime,
    )
    if (nextWindow) {
      const firstNext = firstMusicalEventInMeasure(
        timingMap,
        measureBridge.measureNumber,
        nextWindow,
        measureBridge.xStart,
        measureBridge.xEnd,
      )
      if (firstNext) {
        events = appendMeasureBridge(events, firstNext)
      } else {
        events = appendMeasureBridge(events, {
          timeSeconds: nextWindow.startTimeSeconds,
          x: measureBridge.xStart,
          kind: 'measure-start',
        })
      }
    } else {
      events.push({ timeSeconds: window.endTimeSeconds, x: xEnd, kind: 'measure-end' })
    }
  }
  if (events.length < 2) {
    const fallback = beatWeightedProgress(
      timingMap,
      practiceTime,
      window.startTimeSeconds,
      window.endTimeSeconds,
    )
    return {
      x: lerp(xStart, xEnd, fallback.xRatio),
      progress: fallback.progress,
      mode: 'beat-linear',
      atOnset: false,
      events,
    }
  }

  for (const event of events) {
    if (ONSET_SNAP_SECONDS > 0 && Math.abs(practiceTime - event.timeSeconds) <= ONSET_SNAP_SECONDS) {
      return {
        x: event.x,
        progress: clamp(
          (event.x - xStart) / Math.max(0.001, xEnd - xStart),
          0,
          1,
        ),
        mode: event.kind === 'chord' ? 'chord-snap' : event.kind === 'note' ? 'note-snap' : 'event-snap',
        atOnset: true,
        events,
        nearestEvent: event,
      }
    }
  }

  let before = events[0]
  let after = events[events.length - 1]
  let beforeIndex = 0
  for (let index = 0; index < events.length - 1; index += 1) {
    if (
      practiceTime >= events[index].timeSeconds &&
      practiceTime < events[index + 1].timeSeconds
    ) {
      beforeIndex = index
      before = events[index]
      after = events[index + 1]
      break
    }
  }
  const prior = beforeIndex > 0 ? events[beforeIndex - 1] : null

  const span = after.timeSeconds - before.timeSeconds
  const local = span > 0 ? clamp((practiceTime - before.timeSeconds) / span, 0, 1) : 0
  const x = interpolateSegment(before, after, prior, practiceTime)
  const progress = clamp((x - xStart) / Math.max(0.001, xEnd - xStart), 0, 1)
  const atNoteOnset =
    (before.kind === 'note' || before.kind === 'chord') &&
    Math.abs(practiceTime - before.timeSeconds) < 0.002
  const atNextOnset =
    (after.kind === 'note' || after.kind === 'chord') &&
    Math.abs(practiceTime - after.timeSeconds) < 0.002

  return {
    x,
    progress,
    mode: resolveSegmentMode(events, before, after, prior),
    atOnset: atNoteOnset || atNextOnset,
    events,
    nearestEvent: local < 0.5 ? before : after,
  }
}

function resolveSegmentMode(events, before, after, prior) {
  if (before.kind === 'hold-end' || after.kind === 'hold-end') {
    return 'held-note'
  }
  if (
    prior != null &&
    (after.kind === 'bridge-next' || after.kind === 'measure-end') &&
    (Math.abs(after.x - before.x) < 0.001 ||
      segmentVelocity(before, after) < segmentVelocity(prior, before) * TAIL_STALL_RATIO)
  ) {
    return 'velocity-bridge'
  }
  if (events.some((event) => event.kind === 'note' || event.kind === 'chord')) {
    return 'note-interpolate'
  }
  if (events.some((event) => event.kind === 'bridge-next')) {
    return 'measure-bridge'
  }
  return 'beat-interpolate'
}
