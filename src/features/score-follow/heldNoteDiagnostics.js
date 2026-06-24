import { getMeasurePlaybackWindow } from '../musicxml/performedTimeline.js'
import { getTempoAtTime } from '../musicxml/timingMath.js'
import {
  buildMeasureMusicalEvents,
  HELD_NOTE_THRESHOLD_SECONDS,
  resolveHeldNoteGlideProfile,
  resolveMusicalXInMeasure,
  SLOW_TEMPO_BPM,
} from './cursorMusicalProgress.js'
import { resolveTrustedAnchorForMeasure } from './trustedAnchors.js'

function findActiveSegment(events, practiceTime) {
  for (let index = 0; index < events.length - 1; index += 1) {
    const before = events[index]
    const after = events[index + 1]
    if (practiceTime >= before.timeSeconds && practiceTime < after.timeSeconds) {
      return { before, after, prior: index > 0 ? events[index - 1] : null }
    }
  }
  return null
}

function anchorExtents(anchor) {
  const xStart = anchor.x
  const xEnd =
    typeof anchor.meta?.playableEndX === 'number' && anchor.meta.playableEndX > anchor.x
      ? anchor.meta.playableEndX
      : anchor.x + 0.08
  return { xStart, xEnd }
}

function segmentVelocity(before, after) {
  const dt = after.timeSeconds - before.timeSeconds
  if (dt <= 0) {
    return 0
  }
  return (after.x - before.x) / dt
}

function buildHoldProfiles(events, timingMap, window) {
  const profiles = []
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.kind !== 'note' && event.kind !== 'chord') {
      continue
    }
    const duration = event.durationSeconds ?? 0
    if (duration <= HELD_NOTE_THRESHOLD_SECONDS) {
      continue
    }
    const next = events.find(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        (candidate.kind === 'note' ||
          candidate.kind === 'chord' ||
          candidate.kind === 'measure-end' ||
          candidate.kind === 'bridge-next'),
    )
    const nextTime = next?.timeSeconds ?? window.endTimeSeconds
    const profile = resolveHeldNoteGlideProfile(
      timingMap,
      event.timeSeconds,
      duration,
      nextTime,
    )
    profiles.push({
      onsetTimeSeconds: event.timeSeconds,
      onsetX: event.x,
      durationSeconds: duration,
      nextOnsetTimeSeconds: nextTime,
      nextOnsetX: next?.x ?? null,
      tempoBpm: profile.tempoBpm,
      plateauSeconds: profile.plateauSeconds,
      glideSeconds: profile.glideSeconds,
      plateauFraction: profile.plateauFraction,
      glideFraction: profile.glideFraction,
      useContinuousGlide: profile.useContinuousGlide,
    })
  }
  return profiles
}

/**
 * Dev diagnostic for held-note / slow-tempo cursor behavior inside one measure.
 */
export function buildHeldNoteDiagnostic({
  timingMap,
  trustedAnchors,
  measureNumber,
  sampleStepSeconds = 0.04,
}) {
  const anchor = resolveTrustedAnchorForMeasure(trustedAnchors, measureNumber)
  if (!anchor || !timingMap) {
    return { active: false, reason: 'missing-anchor' }
  }

  const window = getMeasurePlaybackWindow(timingMap, measureNumber, windowMidTime(timingMap, measureNumber))
  if (!window) {
    return { active: false, reason: 'missing-window' }
  }

  const { xStart, xEnd } = anchorExtents(anchor)
  const events = buildMeasureMusicalEvents(timingMap, measureNumber, window, xStart, xEnd)
  const holdProfiles = buildHoldProfiles(events, timingMap, window)
  const measureTempoBpm = getTempoAtTime(timingMap, windowMidTime(timingMap, measureNumber))
  const isSlowMeasure = measureTempoBpm <= SLOW_TEMPO_BPM

  if (!holdProfiles.length && !isSlowMeasure) {
    return { active: false, reason: 'no-held-notes', measureNumber, events, measureTempoBpm }
  }

  const samples = []
  let maxOvershoot = 0
  let maxBacktrack = 0
  let maxPlateauStallSeconds = 0
  let prevX = null
  let prevTime = null
  let stallStart = null

  for (
    let t = window.startTimeSeconds + 0.02;
    t < window.endTimeSeconds - 0.001;
    t += sampleStepSeconds
  ) {
    const musical = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: t,
      measureNumber,
      xStart,
      xEnd,
    })
    const segment = findActiveSegment(events, t)
    const nextOnset =
      segment?.after?.kind === 'note' || segment?.after?.kind === 'chord'
        ? segment.after
        : null
    let overshoot = 0
    if (nextOnset && t < nextOnset.timeSeconds - 0.001 && musical.x > nextOnset.x + 0.0001) {
      overshoot = musical.x - nextOnset.x
      maxOvershoot = Math.max(maxOvershoot, overshoot)
    }
    let backtrack = 0
    if (prevX != null && musical.x < prevX - 0.0001) {
      backtrack = prevX - musical.x
      maxBacktrack = Math.max(maxBacktrack, backtrack)
    }

    const velocity =
      prevX != null && prevTime != null && t > prevTime
        ? (musical.x - prevX) / (t - prevTime)
        : 0
    const isPlateau =
      segment?.before?.kind === 'note' ||
      segment?.before?.kind === 'chord' ||
      segment?.before?.kind === 'hold-end'
        ? segment.before.x === musical.x && segment.after.x > segment.before.x
        : false
    if (isPlateau && Math.abs(velocity) < 1e-5) {
      stallStart = stallStart ?? t
    } else if (stallStart != null) {
      maxPlateauStallSeconds = Math.max(maxPlateauStallSeconds, t - stallStart)
      stallStart = null
    }

    prevX = musical.x
    prevTime = t

    samples.push({
      practiceTime: t,
      x: musical.x,
      velocity,
      mode: musical.mode,
      overshoot,
      backtrack,
      segment: segment
        ? {
            beforeKind: segment.before.kind,
            afterKind: segment.after.kind,
            beforeX: segment.before.x,
            afterX: segment.after.x,
            segmentVelocity: segmentVelocity(segment.before, segment.after),
          }
        : null,
    })
  }

  return {
    active: true,
    measureNumber,
    measureTempoBpm,
    isSlowMeasure,
    holdProfiles,
    events,
    maxOvershoot,
    maxBacktrack,
    maxPlateauStallSeconds,
    samples,
  }
}

function windowMidTime(timingMap, measureNumber) {
  const start = getMeasurePlaybackWindow(timingMap, measureNumber, 0)?.startTimeSeconds ?? 0
  const end =
    getMeasurePlaybackWindow(timingMap, measureNumber, timingMap.durationSeconds ?? 999)
      ?.endTimeSeconds ?? start + 2
  return (start + end) / 2
}
