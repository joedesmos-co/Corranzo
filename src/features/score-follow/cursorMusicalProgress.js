import { getTimeline } from '../musicxml/timeline.js'
import { getMeasureLayoutExtents } from '../practice/noteTargetContext.js'
import {
  getMeasurePlaybackWindow,
  getPerformedBeats,
  usesPerformedTimeline,
} from '../musicxml/performedTimeline.js'
import { getTempoAtTime } from '../musicxml/timingMath.js'
import { clamp, lerp } from './scoreFollowEasing.js'

/** Continuous interpolation — cursor reaches note x exactly at onset time (no early snap). */
export const ONSET_SNAP_SECONDS = 0

const CHORD_GROUP_SECONDS = 0.012

/** Notes longer than this may use a hold plateau before gliding to the next onset. */
export const HELD_NOTE_THRESHOLD_SECONDS = 0.55

/** Fast-tempo held notes park at the notehead for this fraction before gliding. */
export const FAST_TEMPO_GLIDE_FRACTION = 0.22

/** Tempos at or above this keep the fast-tempo plateau profile. */
export const FAST_TEMPO_BPM = 100

/** Tempos at or below this use the slow-tempo glide profile. */
export const SLOW_TEMPO_BPM = 72

/** Slow tempos cap how long the cursor can stay frozen at a notehead. */
export const SLOW_MAX_PLATEAU_SECONDS = 0.28

/** Brief onset lock so the cursor is on the notehead when the note sounds. */
export const HELD_ONSET_LOCK_SECONDS = 0.04

/** When glide dominates, skip the hold-end knot and use bounded linear motion. */
export const CONTINUOUS_GLIDE_FRACTION = 0.65

/**
 * Tempo-aware hold profile for a sustained note through the next onset.
 */
export function resolveHeldNoteGlideProfile(
  timingMap,
  onsetTimeSeconds,
  durationSeconds,
  nextTimeSeconds,
) {
  const tempoBpm = getTempoAtTime(timingMap, onsetTimeSeconds)
  const gapSeconds = Math.max(nextTimeSeconds - onsetTimeSeconds, 0.001)
  const writtenSpan = Math.min(durationSeconds, gapSeconds)

  if (tempoBpm < FAST_TEMPO_BPM && writtenSpan > HELD_NOTE_THRESHOLD_SECONDS) {
    const plateauSeconds = Math.min(HELD_ONSET_LOCK_SECONDS, writtenSpan - 0.03)
    const glideSeconds = Math.max(writtenSpan - plateauSeconds, 0.001)
    return {
      tempoBpm,
      plateauSeconds,
      glideSeconds,
      plateauFraction: plateauSeconds / writtenSpan,
      glideFraction: glideSeconds / writtenSpan,
      writtenSpan,
      useContinuousGlide: true,
    }
  }

  const slowFactor = clamp(
    (FAST_TEMPO_BPM - tempoBpm) / (FAST_TEMPO_BPM - SLOW_TEMPO_BPM),
    0,
    1,
  )

  const fastPlateauSeconds = writtenSpan * (1 - FAST_TEMPO_GLIDE_FRACTION)
  const slowPlateauCap = Math.min(
    SLOW_MAX_PLATEAU_SECONDS,
    writtenSpan * 0.14,
  )
  let plateauSeconds = lerp(fastPlateauSeconds, slowPlateauCap, slowFactor)
  plateauSeconds = Math.max(plateauSeconds, HELD_ONSET_LOCK_SECONDS)
  plateauSeconds = Math.min(plateauSeconds, writtenSpan - 0.03)

  const glideSeconds = Math.max(writtenSpan - plateauSeconds, 0.001)
  const plateauFraction = plateauSeconds / writtenSpan
  const glideFraction = glideSeconds / writtenSpan

  return {
    tempoBpm,
    plateauSeconds,
    glideSeconds,
    plateauFraction,
    glideFraction,
    writtenSpan,
    useContinuousGlide: glideFraction >= CONTINUOUS_GLIDE_FRACTION,
  }
}

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

  return deduped
}

function findNextForwardEvent(events, fromIndex, minX) {
  for (let index = fromIndex + 1; index < events.length; index += 1) {
    if (events[index].x > minX + 1e-5) {
      return events[index]
    }
  }
  return null
}

function isFlatForwardSpan(before, after) {
  return after.x <= before.x + 1e-5 && after.timeSeconds - before.timeSeconds > 0.02
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

/** Minimum tail velocity as a fraction of the prior note segment. */
const TAIL_VELOCITY_FLOOR_RATIO = 0.72

/**
 * Bounded segment interpolation: onset-locked glide that cannot pass the next
 * target early, with look-ahead creep through flat same-x spans.
 */
function interpolateSegment(before, after, prior, practiceTime, events, beforeIndex, segmentMaxX) {
  const span = after.timeSeconds - before.timeSeconds
  if (span <= 0) {
    return after.x
  }
  const local = clamp((practiceTime - before.timeSeconds) / span, 0, 1)
  const linearX = lerp(before.x, after.x, local)
  const flatSpan = isFlatForwardSpan(before, after)
  const ahead = flatSpan ? findNextForwardEvent(events, beforeIndex, before.x) : null

  if (flatSpan && ahead) {
    const creepSpan = ahead.timeSeconds - before.timeSeconds
    const creepLocal = clamp((practiceTime - before.timeSeconds) / creepSpan, 0, 1)
    const x = lerp(before.x, ahead.x, creepLocal)
    return capSegmentX(x, segmentMaxX, before.x)
  }

  const isTail = after.kind === 'bridge-next' || after.kind === 'measure-end'
  let x =
    isTail && prior
      ? interpolateWithVelocityContinuity(before, after, prior, practiceTime, segmentMaxX)
      : linearX

  if (prior && after.x >= before.x && !isTail) {
    const priorVel = segmentVelocity(prior, before)
    const tailVel = segmentVelocity(before, after)
    if (
      Math.abs(priorVel) > 1e-6 &&
      Math.abs(tailVel) < Math.abs(priorVel) * TAIL_STALL_RATIO
    ) {
      const floorX =
        before.x +
        Math.abs(priorVel) * TAIL_VELOCITY_FLOOR_RATIO * (practiceTime - before.timeSeconds)
      x = Math.max(x, Math.min(floorX, linearX))
    }
  }

  const flatTail = isTail && Math.abs(after.x - before.x) < 0.001
  if (after.x >= before.x) {
    if (flatTail) {
      const priorVel = prior ? segmentVelocity(prior, before) : segmentVelocity(before, after)
      const creepCap = Math.min(
        after.x > before.x ? lerp(before.x, after.x, local) : after.x,
        segmentMaxX ?? after.x,
      )
      x = Math.max(before.x, Math.min(x, creepCap))
    } else {
      x = Math.max(before.x, Math.min(x, linearX))
    }
  } else {
    x = linearX
  }

  return capSegmentX(x, segmentMaxX, before.x)
}

function capSegmentX(x, segmentMaxX, minX) {
  let capped = x
  if (segmentMaxX != null) {
    capped = Math.min(capped, segmentMaxX)
  }
  if (minX != null) {
    capped = Math.max(minX, capped)
  }
  return capped
}

/**
 * Velocity-continuous tail: keep moving through the barline when default-x / anchor
 * geometry leaves almost no horizontal delta in the linear segment.
 * Still lands exactly on `after.x` at `after.timeSeconds` for onset lock.
 */
function interpolateWithVelocityContinuity(before, after, prior, practiceTime, segmentMaxX) {
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
    const smooth = local * local * (3 - 2 * local)
    const smoothX = lerp(before.x, after.x, smooth)
    const floorX =
      before.x + Math.abs(priorVel) * TAIL_VELOCITY_FLOOR_RATIO * (practiceTime - before.timeSeconds)
    const creepCap = Math.min(
      after.x > before.x ? lerp(before.x, after.x, local) : after.x,
      segmentMaxX ?? after.x,
    )
    return capSegmentX(Math.max(smoothX, Math.min(floorX, creepCap)), segmentMaxX, before.x)
  }

  if (stallRatio >= TAIL_STALL_RATIO) {
    return capSegmentX(linearX, segmentMaxX, before.x)
  }

  const extrapX = before.x + priorVel * (practiceTime - before.timeSeconds)
  const blend = local * local * (3 - 2 * local)
  return capSegmentX(lerp(extrapX, linearX, blend), segmentMaxX, before.x)
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
    // Look the next measure's window up at a time just PAST this measure's end so
    // it lands inside the next window. The performed timeline (repeats) matches
    // `time >= start` with no tolerance, so `window.endTimeSeconds - 0.001` falls
    // 1ms short of the next window and silently drops the bridge — which froze the
    // cursor at xEnd (the measure-end stall). Look up just past the barline.
    const bridgeLookupTime = window.endTimeSeconds + 0.0005
    const nextWindow = getMeasurePlaybackWindow(
      timingMap,
      measureBridge.measureNumber,
      bridgeLookupTime,
    )
    // Only bridge across a CONTIGUOUS barline (the next window begins where this
    // one ends). A non-contiguous jump (e.g. a repeat) is a hard section edge, not
    // a bridge — settle at the measure end as before.
    const contiguous =
      nextWindow != null &&
      Math.abs(nextWindow.startTimeSeconds - window.endTimeSeconds) < 0.01
    if (contiguous) {
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
  // A same-system bridge target (next measure's first onset) lives BEYOND the
  // current measure's playableEndX (xEnd). Motion toward it must not be clamped
  // at xEnd or the cursor stalls at the barline. The hard cap stays at xEnd only
  // when there is no bridge — i.e. a measure-end / cross-system boundary.
  const bridgeEvent = events.find((event) => event.kind === 'bridge-next')
  const motionMaxX = bridgeEvent ? Math.max(xEnd, bridgeEvent.x) : xEnd
  const segmentMaxX =
    after.kind === 'bridge-next'
      ? Math.max(xEnd, after.x)
      : after.kind === 'measure-end'
        ? Math.min(after.x, xEnd)
        : xEnd
  let x = interpolateSegment(before, after, prior, practiceTime, events, beforeIndex, segmentMaxX)
  x = Math.min(x, motionMaxX)
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
  const isTail = after.kind === 'bridge-next' || after.kind === 'measure-end'
  if (isFlatForwardSpan(before, after) && !isTail) {
    return 'lookahead-glide'
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
