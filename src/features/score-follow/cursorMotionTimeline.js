import { clamp } from './scoreFollowEasing.js'
import { dedupeTrustedAnchorsByMeasure } from './trustedAnchors.js'
import {
  getPlaybackDurationSeconds,
  usesPerformedTimeline,
} from '../musicxml/performedTimeline.js'
import { buildMeasureMusicalEvents } from './cursorMusicalProgress.js'

/**
 * Score-follow Motion Engine v2 — precomputed cursor motion timeline.
 *
 * Instead of per-frame predictive smoothing hacks, the cursor's path is built
 * once as a set of motion curves (one per system) that pass exactly through each
 * note/chord onset at its score time. Position at audio time T is then a pure
 * lookup + interpolation — no accumulated state, so seek/pause/loop are exact.
 *
 * Within a system the curve is a MONOTONE cubic Hermite spline through the onset
 * knots. This guarantees, by construction:
 *   - onset lock: the curve passes through (onsetTime, onsetX) exactly, so when
 *     the cursor reaches a notehead the note is sounding;
 *   - smoothness: C1-continuous velocity (no kinks/stalls at onsets or barlines);
 *   - no early / no backward: between two knots the value stays within their x
 *     range, so the cursor never reaches the next note early nor steps back.
 *
 * Systems are independent curves (a page/line break is a hard reset): the engine
 * never blends an old-system x with a new-system x, and never predicts across a
 * boundary. Each system finishes at its systemEndX (settle) and the next system
 * starts fresh.
 */

/** Two measures share a system when same page and y within this tolerance. */
const SYSTEM_Y_TOLERANCE = 0.02

/** A note/chord whose glide to the next onset lasts longer than this is "held". */
const HELD_GLIDE_SECONDS = 0.6

function anchorPlayableEndX(anchor) {
  const pe = anchor?.meta?.playableEndX
  return typeof pe === 'number' && pe > anchor.x ? pe : anchor.x + 0.08
}

function anchorSystemEndX(anchor) {
  const se = anchor?.meta?.systemEndX
  if (typeof se === 'number' && Number.isFinite(se)) {
    return se
  }
  return anchorPlayableEndX(anchor)
}

function enumeratePerformedMeasures(timingMap) {
  if (usesPerformedTimeline(timingMap)) {
    const entries = timingMap?.performedMeasureTimeline?.entries ?? []
    return entries.map((entry) => ({
      measureNumber: entry.writtenMeasureNumber,
      startTime: entry.startTimeSeconds,
      endTime: entry.endTimeSeconds,
    }))
  }
  const measures = timingMap?.measures ?? []
  return measures.map((measure) => ({
    measureNumber: measure.number,
    startTime: measure.startTimeSeconds,
    endTime: measure.endTimeSeconds,
  }))
}

/** Strictly-increasing time, monotonic non-decreasing x. Keeps note kinds on ties. */
function sanitizeKnots(knots) {
  const sorted = [...knots].sort((a, b) => a.t - b.t)
  const out = []
  for (const knot of sorted) {
    const prev = out[out.length - 1]
    if (prev && knot.t - prev.t < 0.004) {
      // Same instant (chord / measure-start coincident with first note): keep the
      // rightmost x and prefer an actual note/chord knot for onset lock.
      const keepNote = knot.kind === 'note' || knot.kind === 'chord'
      out[out.length - 1] = {
        ...(keepNote ? knot : prev),
        t: prev.t,
        x: Math.max(prev.x, knot.x),
      }
      continue
    }
    out.push({ ...knot, x: prev ? Math.max(prev.x, knot.x) : knot.x })
  }
  return out
}

/** Fritsch–Carlson monotone cubic Hermite: smooth AND never overshoots a knot. */
function buildMonotoneSpline(ts, xs) {
  const n = ts.length
  if (n <= 1) {
    return { ts, xs, ms: n === 1 ? [0] : [] }
  }
  const slope = new Array(n - 1)
  const dt = new Array(n - 1)
  for (let i = 0; i < n - 1; i += 1) {
    dt[i] = ts[i + 1] - ts[i]
    slope[i] = dt[i] > 0 ? (xs[i + 1] - xs[i]) / dt[i] : 0
  }
  const m = new Array(n)
  m[0] = slope[0]
  m[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i += 1) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const sumSq = a * a + b * b
    if (sumSq > 9) {
      const tau = 3 / Math.sqrt(sumSq)
      m[i] = tau * a * slope[i]
      m[i + 1] = tau * b * slope[i]
    }
  }
  return { ts, xs, ms: m }
}

function evalSplineIndex(spline, t) {
  const { ts } = spline
  let lo = 0
  let hi = ts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ts[mid] <= t) lo = mid
    else hi = mid
  }
  return lo
}

function evalSpline(spline, t) {
  const { ts, xs, ms } = spline
  const n = ts.length
  if (n === 0) return 0
  if (n === 1 || t <= ts[0]) return xs[0]
  if (t >= ts[n - 1]) return xs[n - 1]
  const i = evalSplineIndex(spline, t)
  const h = ts[i + 1] - ts[i]
  if (h <= 0) return xs[i]
  const s = (t - ts[i]) / h
  const s2 = s * s
  const s3 = s2 * s
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2
  return h00 * xs[i] + h10 * h * ms[i] + h01 * xs[i + 1] + h11 * h * ms[i + 1]
}

function classifySegment(a, b) {
  if (b.kind === 'system-end') return 'system-end-settle'
  if (a.measureNumber != null && b.measureNumber != null && a.measureNumber !== b.measureNumber) {
    return 'measure-boundary-bridge'
  }
  if ((a.kind === 'note' || a.kind === 'chord') && b.t - a.t >= HELD_GLIDE_SECONDS) {
    return 'held-note-glide'
  }
  return 'note-to-note-glide'
}

function finalizeSystem(system) {
  // Settle to the true right edge of the line so the system finishes at systemEndX.
  const lastKnot = system.knots[system.knots.length - 1]
  if (lastKnot && system.systemEndX > lastKnot.x + 1e-4 && system.endTime > lastKnot.t + 1e-4) {
    system.knots.push({
      t: system.endTime,
      x: system.systemEndX,
      measureNumber: lastKnot.measureNumber,
      kind: 'system-end',
    })
  }
  const knots = sanitizeKnots(system.knots)
  system.knots = knots
  system.spline = buildMonotoneSpline(
    knots.map((k) => k.t),
    knots.map((k) => k.x),
  )
  system.startTime = knots[0]?.t ?? system.startTime
  system.startX = knots[0]?.x ?? 0
  system.endX = knots[knots.length - 1]?.x ?? system.startX
  // Diagnostic motion segments.
  system.segments = []
  for (let i = 0; i < knots.length - 1; i += 1) {
    const a = knots[i]
    const b = knots[i + 1]
    const span = b.t - a.t
    system.segments.push({
      type: classifySegment(a, b),
      startTime: a.t,
      endTime: b.t,
      startX: a.x,
      endX: b.x,
      measureNumber: a.measureNumber,
      onsetLock: b.kind === 'note' || b.kind === 'chord',
      velocity: span > 0 ? (b.x - a.x) / span : 0,
    })
  }
  return system
}

/**
 * Build the precomputed cursor motion timeline from the score timing + anchors.
 */
export function buildCursorMotionTimeline({ timingMap, trustedAnchors }) {
  const deduped = dedupeTrustedAnchorsByMeasure(trustedAnchors ?? [])
  if (!timingMap?.measures?.length || deduped.length === 0) {
    return { systems: [], duration: getPlaybackDurationSeconds(timingMap) || 0, empty: true }
  }
  const anchorByMeasure = new Map(deduped.map((a) => [a.measureNumber, a]))
  const performed = enumeratePerformedMeasures(timingMap)

  const systems = []
  let current = null

  const closeCurrent = () => {
    if (current && current.knots.length > 0) {
      systems.push(finalizeSystem(current))
    }
    current = null
  }

  for (const pm of performed) {
    const anchor = anchorByMeasure.get(pm.measureNumber)
    if (!anchor) {
      // No geometry for this measure — end the current system rather than guess
      // a position across the gap (resolver falls back outside the timeline).
      closeCurrent()
      continue
    }
    const key = `${anchor.page ?? 1}:${Math.round((anchor.y ?? 0) / SYSTEM_Y_TOLERANCE)}`
    if (!current || current.key !== key) {
      closeCurrent()
      current = {
        key,
        index: systems.length,
        page: anchor.page ?? 1,
        y: anchor.y ?? 0,
        systemEndX: anchorSystemEndX(anchor),
        startTime: pm.startTime,
        endTime: pm.endTime,
        knots: [],
      }
    }
    const window = { startTimeSeconds: pm.startTime, endTimeSeconds: pm.endTime }
    const events = buildMeasureMusicalEvents(
      timingMap,
      pm.measureNumber,
      window,
      anchor.x,
      anchorPlayableEndX(anchor),
      { includeMeasureEnd: false },
    )
    for (const ev of events) {
      if (ev.kind === 'measure-start' || ev.kind === 'note' || ev.kind === 'chord') {
        current.knots.push({
          t: ev.timeSeconds,
          x: ev.x,
          measureNumber: pm.measureNumber,
          kind: ev.kind,
        })
      }
    }
    current.endTime = pm.endTime
    current.systemEndX = anchorSystemEndX(anchor)
  }
  closeCurrent()

  return {
    systems,
    duration: getPlaybackDurationSeconds(timingMap) || (systems.at(-1)?.endTime ?? 0),
    empty: systems.length === 0,
  }
}

function findSystemIndex(systems, scoreTime) {
  if (scoreTime <= systems[0].startTime) return 0
  let idx = 0
  let lo = 0
  let hi = systems.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (systems[mid].startTime <= scoreTime) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return idx
}

function measureNumberAt(system, scoreTime) {
  let measure = system.knots[0]?.measureNumber ?? null
  for (const knot of system.knots) {
    if (knot.t <= scoreTime + 1e-9 && knot.kind !== 'system-end') measure = knot.measureNumber
    else if (knot.t > scoreTime) break
  }
  return measure
}

function segmentTypeAt(system, scoreTime) {
  for (const seg of system.segments) {
    if (scoreTime >= seg.startTime && scoreTime < seg.endTime) return seg.type
  }
  return system.segments.at(-1)?.type ?? 'note-to-note-glide'
}

/**
 * Resolve the cursor position at an audio score time. Pure function of T:
 * stateless, so seek/pause/loop are exact. Returns null when the time is not
 * covered by the timeline (caller may fall back to the legacy resolver).
 */
export function resolveCursorMotion(timeline, scoreTime) {
  if (!timeline?.systems?.length) {
    return null
  }
  const systems = timeline.systems
  const index = findSystemIndex(systems, scoreTime)
  const system = systems[index]
  // Before the very first system begins there is nothing to show yet.
  if (scoreTime < systems[0].startTime - 1e-6) {
    return null
  }
  // A page/line break is a hard reset: clamp to THIS system's own bounds only,
  // never comparing against another system's x.
  const x = clamp(evalSpline(system.spline, scoreTime), system.startX, system.endX)
  return {
    visible: true,
    x,
    y: system.y,
    page: system.page,
    measureNumber: measureNumberAt(system, scoreTime),
    systemIndex: system.index,
    segmentType: segmentTypeAt(system, scoreTime),
    confidence: 'exact',
  }
}

/** Dev diagnostics: per-system segments, velocities, onset error, clamp usage. */
export function buildCursorMotionDiagnostics(timeline) {
  if (!timeline?.systems?.length) {
    return { active: false, reason: 'empty-timeline' }
  }
  let maxOnsetErrorX = 0
  let maxOnsetErrorAtT = null
  let clampHits = 0
  const systems = timeline.systems.map((system) => {
    for (const knot of system.knots) {
      if (knot.kind === 'note' || knot.kind === 'chord') {
        const got = clamp(evalSpline(system.spline, knot.t), system.startX, system.endX)
        const err = Math.abs(got - knot.x)
        if (err > maxOnsetErrorX) {
          maxOnsetErrorX = err
          maxOnsetErrorAtT = knot.t
        }
        if (got !== evalSpline(system.spline, knot.t)) clampHits += 1
      }
    }
    return {
      index: system.index,
      page: system.page,
      y: system.y,
      startTime: system.startTime,
      endTime: system.endTime,
      startX: system.startX,
      endX: system.endX,
      systemEndX: system.systemEndX,
      knotCount: system.knots.length,
      segments: system.segments,
    }
  })
  return {
    active: true,
    systemCount: systems.length,
    maxOnsetErrorX,
    maxOnsetErrorAtT,
    clampHits,
    systems,
  }
}
