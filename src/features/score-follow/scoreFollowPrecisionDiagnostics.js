import { getBeatAtTime } from '../musicxml/timingQuery.js'
import {
  getMeasurePlaybackWindow,
  getPerformedBeats,
  usesPerformedTimeline,
} from '../musicxml/performedTimeline.js'
import { getTimeline } from '../musicxml/timeline.js'
import { clamp, lerp } from './scoreFollowEasing.js'
import { resolveMusicalXInMeasure } from './cursorMusicalProgress.js'
import { resolveScoreFollowCursor } from './resolveScoreFollowCursor.js'
import { resolveTrustedAnchorForMeasure } from './trustedAnchors.js'

const LEGACY_START_LOCK_SECONDS = 0.15

function legacyBeatProgress(timingMap, practiceTime, t0, t1) {
  if (t1 <= t0) {
    return 0
  }
  const beats = (usesPerformedTimeline(timingMap) ? getPerformedBeats(timingMap) : timingMap.beats).filter(
    (beat) => beat.timeSeconds >= t0 - 0.001 && beat.timeSeconds <= t1 + 0.001,
  )
  if (beats.length < 2) {
    return clamp((practiceTime - t0) / (t1 - t0), 0, 1)
  }
  for (let index = 0; index < beats.length - 1; index += 1) {
    const beatStart = beats[index].timeSeconds
    const beatEnd = beats[index + 1].timeSeconds
    if (practiceTime >= beatStart && practiceTime < beatEnd) {
      const segmentProgress =
        beatEnd > beatStart ? (practiceTime - beatStart) / (beatEnd - beatStart) : 0
      return clamp((index + segmentProgress) / (beats.length - 1), 0, 1)
    }
  }
  return 1
}

function legacyCursorXAtTime({ timingMap, trustedAnchors, t, trust }) {
  if (t <= LEGACY_START_LOCK_SECONDS) {
    const start = resolveTrustedAnchorForMeasure(trustedAnchors, 1)
    return start?.x ?? 0
  }

  const { cursor } = resolveScoreFollowCursor({
    timingMap,
    practiceTime: t,
    trustedAnchors,
    trust,
  })
  if (!cursor?.visible) {
    return null
  }

  const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, cursor.measureNumber)
  if (!anchor) {
    return cursor.x
  }

  const glideTargetX =
    typeof anchor.meta?.playableEndX === 'number' && anchor.meta.playableEndX > anchor.x
      ? anchor.meta.playableEndX
      : anchor.x + 0.08
  const window = getMeasurePlaybackWindow(timingMap, cursor.measureNumber, t)
  if (!window) {
    return cursor.x
  }

  const progress = legacyBeatProgress(
    timingMap,
    t,
    window.startTimeSeconds,
    window.endTimeSeconds,
  )
  return lerp(anchor.x, glideTargetX, progress)
}

/**
 * Dev/report payload comparing audio clock, resolver target, and rendered cursor.
 */
export function buildScoreFollowPrecisionReport({
  timingMap,
  practiceTime,
  targetCursor,
  displayCursor = null,
  audioTime = null,
}) {
  if (!timingMap?.measures?.length || !targetCursor?.visible) {
    return {
      active: false,
      practiceTime,
      audioTime,
    }
  }

  const clockTime = Number.isFinite(audioTime) ? audioTime : practiceTime
  const measureNumber = targetCursor.measureNumber
  const beat = getBeatAtTime(timingMap, clockTime)
  const window = measureNumber
    ? getMeasurePlaybackWindow(timingMap, measureNumber, clockTime)
    : null

  const xStart =
    typeof targetCursor.anchorBeat1X === 'number' ? targetCursor.anchorBeat1X : targetCursor.x
  const xEnd =
    typeof targetCursor.playableEndX === 'number'
      ? targetCursor.playableEndX
      : typeof targetCursor.meta?.playableEndX === 'number'
        ? targetCursor.meta.playableEndX
        : targetCursor.x + 0.08

  const musical =
    measureNumber != null
      ? resolveMusicalXInMeasure({
          timingMap,
          practiceTime: clockTime,
          measureNumber,
          xStart,
          xEnd,
        })
      : null

  const targetX = targetCursor.x
  const targetY = targetCursor.y
  const renderedX = displayCursor?.x ?? targetX
  const renderedY = displayCursor?.y ?? targetY

  const xError = renderedX - targetX
  const yError = renderedY - targetY
  const audioLagSeconds = practiceTime - clockTime
  const musicalXError =
    musical != null && Number.isFinite(musical.x) ? targetX - musical.x : null

  let motion = 'hold'
  if (targetCursor.lockExact) {
    motion = 'locked'
  } else if (targetCursor.atOnset) {
    motion = 'onset-snap'
  } else if (targetCursor.interpolated) {
    motion = targetCursor.progressMode ?? 'glide'
  }

  return {
    active: true,
    practiceTime,
    audioTime: clockTime,
    audioLagMs: Math.round(audioLagSeconds * 1000),
    measureNumber,
    beat: beat ? { measure: beat.measureNumber, beat: beat.beat } : null,
    measureWindow: window
      ? {
          start: window.startTimeSeconds,
          end: window.endTimeSeconds,
        }
      : null,
    target: {
      page: targetCursor.page,
      x: targetX,
      y: targetY,
      progress: targetCursor.progress ?? null,
      motion,
      progressMode: targetCursor.progressMode ?? null,
    },
    rendered: displayCursor?.visible
      ? {
          page: displayCursor.page,
          x: renderedX,
          y: renderedY,
          smoothed: Boolean(displayCursor.smoothed),
        }
      : null,
    error: {
      xNormalized: xError,
      yNormalized: yError,
      xPixelsAt1000w: Math.round(xError * 1000),
      musicalXNormalized: musicalXError,
    },
    musical: musical
      ? {
          idealX: musical.x,
          mode: musical.mode,
          atOnset: musical.atOnset,
          eventCount: musical.events?.length ?? 0,
          nearestEvent: musical.nearestEvent ?? null,
        }
      : null,
  }
}

/**
 * Sweep note onsets and compare resolver cursor X to the musical ideal at each onset.
 */
export function measureCursorOnsetAlignment({
  timingMap,
  trustedAnchors,
  trust = { showCursor: true, needsSetup: false },
  sampleEvery = 1,
}) {
  const timeline = getTimeline(timingMap)
  const notes = timeline
    .performedNotes()
    .filter((note) => !note.isRest && note.midi != null)

  const errors = []
  let maxError = 0
  let sumError = 0
  let jumpCount = 0
  let prevX = null

  for (let index = 0; index < notes.length; index += sampleEvery) {
    const note = notes[index]
    const t = note.performedSeconds
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors,
      trust,
    })
    if (!cursor?.visible) {
      continue
    }

    const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, note.measureNumber)
    const xStart = anchor?.x ?? cursor.x
    const xEnd =
      typeof anchor?.meta?.playableEndX === 'number'
        ? anchor.meta.playableEndX
        : typeof cursor.playableEndX === 'number'
          ? cursor.playableEndX
          : cursor.x + 0.08
    const musical = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: t,
      measureNumber: note.measureNumber,
      xStart,
      xEnd,
    })

    const idealX = musical?.x ?? cursor.x
    const errorX = Math.abs(cursor.x - idealX)
    sumError += errorX
    maxError = Math.max(maxError, errorX)

    if (prevX != null && Math.abs(cursor.x - prevX) > 0.12) {
      jumpCount += 1
    }
    prevX = cursor.x

    const window = getMeasurePlaybackWindow(timingMap, note.measureNumber, t)
    const measureSpanSeconds =
      window && window.endTimeSeconds > window.startTimeSeconds
        ? window.endTimeSeconds - window.startTimeSeconds
        : 2
    const measureSpanX = Math.max(0.04, xEnd - xStart)
    const errorMs = measureSpanSeconds > 0 ? (errorX / measureSpanX) * measureSpanSeconds * 1000 : 0

    errors.push({
      timeSeconds: t,
      measureNumber: note.measureNumber,
      cursorX: cursor.x,
      idealX,
      errorX,
      errorMs,
      atOnset: Boolean(cursor.atOnset),
      progressMode: cursor.progressMode ?? null,
    })
  }

  const count = errors.length
  return {
    sampleCount: count,
    averageErrorX: count > 0 ? sumError / count : 0,
    maxErrorX: maxError,
    visibleJumps: jumpCount,
    samples: errors,
  }
}

/**
 * Pre-v2 model: linear beat sweep across each measure (no note-onset snap).
 */
export function measureLegacyCursorOnsetAlignment({
  timingMap,
  trustedAnchors,
  trust = { showCursor: true, needsSetup: false },
  sampleEvery = 1,
}) {
  const timeline = getTimeline(timingMap)
  const notes = timeline
    .performedNotes()
    .filter((note) => !note.isRest && note.midi != null)

  const errors = []
  let maxError = 0
  let sumError = 0

  for (let index = 0; index < notes.length; index += sampleEvery) {
    const note = notes[index]
    const t = note.performedSeconds
    const legacyX = legacyCursorXAtTime({ timingMap, trustedAnchors, t, trust })
    if (legacyX == null) {
      continue
    }

    const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, note.measureNumber)
    const xStart = anchor?.x ?? legacyX
    const xEnd =
      typeof anchor?.meta?.playableEndX === 'number'
        ? anchor.meta.playableEndX
        : legacyX + 0.08
    const musical = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: t,
      measureNumber: note.measureNumber,
      xStart,
      xEnd,
    })
    const idealX = musical?.x ?? legacyX
    const errorX = Math.abs(legacyX - idealX)
    sumError += errorX
    maxError = Math.max(maxError, errorX)

    const window = getMeasurePlaybackWindow(timingMap, note.measureNumber, t)
    const measureSpanSeconds =
      window && window.endTimeSeconds > window.startTimeSeconds
        ? window.endTimeSeconds - window.startTimeSeconds
        : 2
    const measureSpanX = Math.max(0.04, xEnd - xStart)
    const errorMs = measureSpanSeconds > 0 ? (errorX / measureSpanX) * measureSpanSeconds * 1000 : 0

    errors.push({ timeSeconds: t, measureNumber: note.measureNumber, errorX, errorMs })
  }

  const count = errors.length
  return {
    sampleCount: count,
    averageErrorX: count > 0 ? sumError / count : 0,
    maxErrorX: maxError,
    samples: errors,
  }
}
