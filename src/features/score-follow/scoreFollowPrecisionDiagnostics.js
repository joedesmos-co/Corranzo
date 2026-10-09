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
import { resolveDisplayCursorAtTime } from './scoreFollowDisplayPosition.js'
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
 * Sweep note onsets and compare the DISPLAYED cursor X (motion timeline when
 * provided — i.e. what the user actually sees) to the musical ideal at each
 * onset. resolveDisplayCursorAtTime is the same choke the painted bar uses,
 * so this measures the shipped path, not a parallel estimate.
 */
export function measureCursorOnsetAlignment({
  timingMap,
  trustedAnchors,
  trust = { showCursor: true, needsSetup: false },
  sampleEvery = 1,
  motionTimeline = null,
}) {
  const timeline = getTimeline(timingMap)
  const notes = timeline
    .performedNotes()
    .filter((note) => !note.isRest && note.midi != null && !note.isTabMirror)

  const errors = []
  let maxError = 0
  let sumError = 0
  let jumpCount = 0
  let explainedJumps = 0
  let teleportCount = 0
  const teleportSamples = []
  let prevX = null
  let prevPage = null
  let prevSystem = null
  let prevMeasure = null
  let prevTime = null
  let wrongSystemOrPage = 0

  for (let index = 0; index < notes.length; index += sampleEvery) {
    const note = notes[index]
    const t = note.performedSeconds
    const cursor = resolveDisplayCursorAtTime({
      timingMap,
      practiceTime: t,
      trustedAnchors,
      trust,
      motionTimeline,
    })
    if (!cursor?.visible) {
      continue
    }
    // Hard failure: the bar left the note's page, or moved to a *lower*
    // measure number while playback moved forward (backward jump across a
    // barline/system; repeats are handled by the performed timeline, so a
    // backward written-measure step outside a jump window is a bug).
    const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, note.measureNumber)
    if (anchor && cursor.page !== anchor.page) {
      wrongSystemOrPage += 1
    }

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
      // Legitimate jumps: page turn, system/line change, or a repeat jump
      // (performed time went backward or skipped forward). Fast runs cover
      // ground quickly but continuously, so a mid-system step is a teleport
      // only when its velocity is physically implausible for a follow bar.
      const pageChanged = prevPage != null && cursor.page !== prevPage
      const systemChanged =
        prevSystem != null &&
        cursor.systemIndex != null &&
        cursor.systemIndex !== prevSystem
      const timeSkipped =
        prevTime != null &&
        (t < prevTime - 0.02 || t > prevTime + 8)
      const dt = prevTime != null ? Math.max(1e-6, t - prevTime) : null
      const velocity = dt != null && dt > 0 ? Math.abs(cursor.x - prevX) / dt : 0
      // Section jump (volta skip, D.C./D.S.): performed order skipped
      // measures. Same-system volta skips are the classic false teleport.
      const measureSkipped =
        prevMeasure != null &&
        Number.isFinite(Number(note.measureNumber)) &&
        Math.abs(Number(note.measureNumber) - Number(prevMeasure)) > 1
      if (pageChanged || systemChanged || timeSkipped || measureSkipped || velocity <= 3) {
        explainedJumps += 1
      } else {
        teleportCount += 1
        teleportSamples.push({
          timeSeconds: t,
          measureNumber: note.measureNumber,
          fromX: prevX,
          toX: cursor.x,
          page: cursor.page,
        })
      }
    }
    prevX = cursor.x
    prevPage = cursor.page
    prevSystem = cursor.systemIndex ?? null
    prevMeasure = note.measureNumber
    prevTime = t

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
      progressMode: cursor.progressMode ?? cursor.segmentType ?? null,
      precision: cursor.precision ?? null,
      geometry: cursor.geometry ?? cursor.geometryMode ?? null,
    })
  }

  const count = errors.length
  const precisionCounts = {}
  for (const sample of errors) {
    const key = sample.precision ?? 'unknown'
    precisionCounts[key] = (precisionCounts[key] ?? 0) + 1
  }
  return {
    sampleCount: count,
    averageErrorX: count > 0 ? sumError / count : 0,
    maxErrorX: maxError,
    visibleJumps: jumpCount,
    explainedJumps,
    midSystemTeleports: teleportCount,
    teleportSamples: teleportSamples.slice(0, 20),
    wrongPagePlacements: wrongSystemOrPage,
    precisionCounts,
    samples: errors,
  }
}

/**
 * Cursor-vs-highlight agreement: the two INDEPENDENT visual paths for one
 * musical event must coincide on the page.
 *
 * - cursor: resolveDisplayCursorAtTime at the checkpoint onset (the painted bar)
 * - highlight: resolveNoteTargetPosition highlight center (the blue box)
 *
 * Unlike measureCursorOnsetAlignment (which compares the resolver against its
 * own musical ideal), these disagree exactly when the user sees the bar in
 * one place and the required note box in another — the reported "follow is
 * TERRIBLE" symptom. Errors normalize by staff spacing when the caller
 * supplies it, else by raw page units.
 *
 * resolveTarget(checkpoint) is injected so this module stays free of the
 * practice layer (no import cycle): tests and scripts pass
 * resolveNoteTargetPosition bound to timing/anchors.
 */
export function measureCursorHighlightAgreement({
  checkpoints = [],
  resolveCursorAt,
  resolveTarget,
  staffSpacing = null,
  sampleEvery = 1,
}) {
  const errors = []
  let sumError = 0
  let maxError = 0
  let wrongPage = 0
  let wrongSystem = 0
  let skipped = 0

  for (let index = 0; index < checkpoints.length; index += sampleEvery) {
    const checkpoint = checkpoints[index]
    const time = Number(checkpoint?.timeSeconds)
    if (!Number.isFinite(time)) {
      skipped += 1
      continue
    }
    const cursor = resolveCursorAt?.(time)
    const target = resolveTarget?.(checkpoint)
    if (!cursor?.visible || !target?.visible) {
      skipped += 1
      continue
    }
    const box = target.highlight
    // Multi-box highlights (per-tone source boxes, cross-measure events):
    // the bar must sit on A required box, not on the centroid between them.
    const boxes = Array.isArray(box?.noteBoxes) && box.noteBoxes.length > 1
      ? box.noteBoxes
      : box && Number.isFinite(box.x0) && Number.isFinite(box.x1)
        ? [box]
        : []
    let errorX
    let highlightX
    if (boxes.length > 0) {
      let best = Infinity
      let bestCenter = null
      for (const candidate of boxes) {
        if (!Number.isFinite(candidate.x0) || !Number.isFinite(candidate.x1)) {
          continue
        }
        const center = (candidate.x0 + candidate.x1) / 2
        const distance =
          cursor.x < candidate.x0
            ? candidate.x0 - cursor.x
            : cursor.x > candidate.x1
              ? cursor.x - candidate.x1
              : 0
        if (distance < best) {
          best = distance
          bestCenter = center
        }
      }
      if (bestCenter == null) {
        skipped += 1
        continue
      }
      errorX = best
      highlightX = bestCenter
    } else if (Number.isFinite(target.x)) {
      highlightX = target.x
      errorX = Math.abs(cursor.x - target.x)
    } else {
      skipped += 1
      continue
    }
    if (!Number.isFinite(cursor.x)) {
      skipped += 1
      continue
    }
    if (cursor.page !== target.page) {
      wrongPage += 1
    }
    if (
      cursor.systemIndex != null &&
      target.systemIndex != null &&
      cursor.systemIndex !== target.systemIndex
    ) {
      wrongSystem += 1
    }
    // Split-brain overflow: the sounding notes are written in a different
    // measure than the performed window they sound in (overfull measures).
    // Cursor follows time, highlight follows notation — neither is a
    // misplacement. Flagged, not averaged away. A measure label that
    // differs only because ms-quantized checkpoint time landed within the
    // boundary epsilon of the next phrase is dust, not overflow.
    const boundaryDust =
      Number.isFinite(Number(cursor.phraseStartTime)) &&
      Math.abs(time - cursor.phraseStartTime) <= 0.011
    const measureMismatch =
      !boundaryDust &&
      Number.isFinite(Number(checkpoint.measureNumber)) &&
      Number.isFinite(Number(cursor.measureNumber)) &&
      Number(checkpoint.measureNumber) !== Number(cursor.measureNumber)
    sumError += errorX
    maxError = Math.max(maxError, errorX)
    errors.push({
      timeSeconds: time,
      measureNumber: checkpoint.measureNumber ?? cursor.measureNumber ?? null,
      cursorMeasureNumber: cursor.measureNumber ?? null,
      measureMismatch,
      cursorX: cursor.x,
      highlightX,
      errorX,
      errorStaffSpacings: staffSpacing ? errorX / staffSpacing : null,
      cursorPage: cursor.page,
      targetPage: target.page,
      cursorPrecision: cursor.precision ?? null,
      targetSource: target.source ?? null,
      targetApproximate: Boolean(target.approximate),
    })
  }

  const count = errors.length
  const inMeasure = errors.filter((sample) => !sample.measureMismatch)
  const overflow = errors.filter((sample) => sample.measureMismatch)
  const inMeasureMax = inMeasure.reduce((max, sample) => Math.max(max, sample.errorX), 0)
  const inMeasureSum = inMeasure.reduce((sum, sample) => sum + sample.errorX, 0)
  return {
    sampleCount: count,
    skipped,
    averageErrorX: count > 0 ? sumError / count : 0,
    maxErrorX: maxError,
    inMeasureSampleCount: inMeasure.length,
    inMeasureAverageErrorX: inMeasure.length > 0 ? inMeasureSum / inMeasure.length : 0,
    inMeasureMaxErrorX: inMeasureMax,
    overflowSampleCount: overflow.length,
    overflowMaxErrorX: overflow.reduce((max, sample) => Math.max(max, sample.errorX), 0),
    averageErrorStaffSpacings:
      staffSpacing && count > 0 ? sumError / count / staffSpacing : null,
    maxErrorStaffSpacings: staffSpacing ? maxError / staffSpacing : null,
    wrongPagePlacements: wrongPage,
    wrongSystemPlacements: wrongSystem,
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
    .filter((note) => !note.isRest && note.midi != null && !note.isTabMirror)

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
