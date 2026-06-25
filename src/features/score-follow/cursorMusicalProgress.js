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

    const ordered = [...groups.values()].sort((a, b) => a.timeSeconds - b.timeSeconds)

    // For each onset group resolve both an engraved (default-x) position and a
    // time-proportional fallback. Sparse/slow piano exports (e.g. Gymnopédie,
    // grand-staff voices) often have non-increasing or missing default-x, which
    // — once clamped monotonic — collapses onsets onto the same x and makes the
    // cursor freeze or jump backward. When the engraved positions are not
    // strictly forward we use the time-proportional positions for the whole
    // measure: they are monotonic and still land on each onset at its sounding
    // time (so the cursor stays smooth and never early).
    const built = ordered.map((group) => {
      const representative = group.notes.reduce((best, note) => {
        if (note.defaultX == null) {
          return best
        }
        if (!best || best.defaultX == null || note.defaultX < best.defaultX) {
          return note
        }
        return best
      }, group.notes[0])
      const geomX = noteXInMeasureSpan(representative, layoutExtents, xStart, xEnd)
      const local =
        window.endTimeSeconds > window.startTimeSeconds
          ? (group.timeSeconds - window.startTimeSeconds) /
            (window.endTimeSeconds - window.startTimeSeconds)
          : 0
      const timeX = lerp(xStart, xEnd, clamp(local, 0, 1))
      return { group, geomX, timeX }
    })

    let geometryIsForward = true
    let lastGeomX = -Infinity
    for (const entry of built) {
      if (entry.geomX == null || entry.geomX < lastGeomX - 1e-4) {
        geometryIsForward = false
        break
      }
      lastGeomX = entry.geomX
    }

    for (const entry of built) {
      const x = geometryIsForward && entry.geomX != null ? entry.geomX : entry.timeX
      events.push({
        timeSeconds: entry.group.timeSeconds,
        x: clamp(x, xStart, xEnd),
        kind: entry.group.notes.length > 1 ? 'chord' : 'note',
        durationSeconds: Math.max(
          ...entry.group.notes.map((note) => note.durationSeconds ?? 0),
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

/**
 * Strict onset-locked interpolation: a linear glide that reaches the next onset's
 * x exactly at its onset time and never moves ahead of it. No predictive creep,
 * velocity extrapolation, or look-ahead through flat spans — those made the cursor
 * arrive at noteheads before the note actually sounded, rush held notes, then
 * freeze. Held notes glide slowly and continuously toward the next target. Visual
 * smoothing/anticipation is the display layer's job (cursorVisualMotion), not the
 * musical target's. Forward-only within the segment; capped at the system/bridge
 * edge.
 */
function interpolateSegment(before, after, practiceTime, segmentMaxX) {
  const span = after.timeSeconds - before.timeSeconds
  if (span <= 0) {
    return capSegmentX(after.x, segmentMaxX, before.x)
  }
  const local = clamp((practiceTime - before.timeSeconds) / span, 0, 1)
  const target = Math.max(before.x, after.x)
  const x = clamp(lerp(before.x, after.x, local), before.x, target)
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
  let x = interpolateSegment(before, after, practiceTime, segmentMaxX)
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
