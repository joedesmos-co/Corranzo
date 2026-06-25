import { clamp } from './scoreFollowEasing.js'
import { dedupeTrustedAnchorsByMeasure } from './trustedAnchors.js'
import {
  getPlaybackDurationSeconds,
  usesPerformedTimeline,
} from '../musicxml/performedTimeline.js'
import { getTimeline } from '../musicxml/timeline.js'

/**
 * Score-follow Motion Engine v3 — precomputed, PLAYBACK-ORDERED motion timeline.
 *
 * The playback timeline is the single source of truth. The cursor path is built
 * once as a sequence of PHRASES, in the order playback actually visits measures
 * (so repeats / D.C. / D.S. / Coda jumps are followed, never engraving order).
 *
 * A phrase = a run of consecutive performed measures that stay on one system and
 * flow forward in written order. Within a phrase the cursor is a single monotone
 * cubic through the note onsets, so:
 *   - onset lock: the curve passes through (onsetTime, noteheadX) exactly;
 *   - smoothness: C1 velocity, and ordinary barlines are NOT knots/breaks — a
 *     measure boundary inside a phrase contributes no artificial velocity change;
 *   - no early / no backward: monotone between knots.
 *
 * Note x is derived by mapping each note's engraved default-x across the measure's
 * ESTIMATED FULL width (start-of-measure → barline, the barline extrapolated from
 * the last note's spacing and remaining duration). This is the key v3 fix: it
 * stops the old engine from cramming the last note onto playableEndX, which made
 * the barline gap tiny and the cursor visibly brake every measure. If default-x
 * is missing/non-monotonic the measure falls back to time-proportional spacing.
 *
 * A phrase ends for one of three reasons, each a distinct segment:
 *   - true system/page break (next measure is the natural continuation on a new
 *     line) → settle to systemEndX, then the next phrase starts the new line;
 *   - playback jump (repeat / D.C. / D.S. / Coda — next played measure is not the
 *     written successor) → settle to THIS measure's own barline (playableEndX) and
 *     the next phrase begins immediately at the jump target (cursor jumps, never
 *     continues into music that will not be played);
 *   - end of piece → hold.
 *
 * resolveCursorMotion(timeline, T) is a pure lookup, so seek/pause/loop are exact.
 */

const SYSTEM_Y_TOLERANCE = 0.02
const CHORD_GROUP_SECONDS = 0.012
/** A note whose glide to the next onset lasts longer than this reads as "held". */
const HELD_GLIDE_SECONDS = 0.6

function anchorPlayableEndX(anchor) {
  const pe = anchor?.meta?.playableEndX
  return typeof pe === 'number' && pe > anchor.x ? pe : anchor.x + 0.08
}
function anchorSystemEndX(anchor) {
  const se = anchor?.meta?.systemEndX
  return typeof se === 'number' && Number.isFinite(se) ? se : anchorPlayableEndX(anchor)
}

function enumeratePerformedMeasures(timingMap) {
  if (usesPerformedTimeline(timingMap)) {
    const entries = timingMap?.performedMeasureTimeline?.entries ?? []
    return entries.map((e) => ({
      measureNumber: e.writtenMeasureNumber,
      startTime: e.startTimeSeconds,
      endTime: e.endTimeSeconds,
    }))
  }
  return (timingMap?.measures ?? []).map((m) => ({
    measureNumber: m.number,
    startTime: m.startTimeSeconds,
    endTime: m.endTimeSeconds,
  }))
}

/** Chord-grouped note onsets for a performed measure window: {time, defaultX}. */
function getMeasureOnsets(timingMap, measureNumber, window) {
  const notes = getTimeline(timingMap)
    .performedNotes()
    .filter(
      (n) =>
        n.measureNumber === measureNumber &&
        !n.isRest &&
        n.performedSeconds >= window.startTimeSeconds - 0.001 &&
        n.performedSeconds <= window.endTimeSeconds + 0.001,
    )
  const groups = new Map()
  for (const n of notes) {
    const bucket = Math.round(n.performedSeconds / CHORD_GROUP_SECONDS)
    const existing = groups.get(bucket)
    if (!existing) {
      groups.set(bucket, { time: n.performedSeconds, defaultX: n.defaultX ?? null })
    } else if (n.defaultX != null && (existing.defaultX == null || n.defaultX < existing.defaultX)) {
      existing.defaultX = n.defaultX
    }
  }
  return [...groups.values()].sort((a, b) => a.time - b.time)
}

/**
 * Knots (time → x) for one measure, mapped into [startX, endX]. Uses engraved
 * default-x across the measure's estimated full width (barline extrapolated) so
 * the last note is NOT crammed to the edge; falls back to time spacing for
 * missing/non-monotonic geometry.
 */
function buildMeasureKnots(onsets, mStart, mEnd, startX, endX, measureNumber) {
  const span = Math.max(endX - startX, 0)
  if (onsets.length === 0) {
    return [{ t: mStart, x: startX, measureNumber, kind: 'measure-start' }]
  }

  let monotonic = onsets.every((o) => o.defaultX != null)
  for (let i = 1; monotonic && i < onsets.length; i += 1) {
    if (onsets[i].defaultX < onsets[i - 1].defaultX - 1e-6) monotonic = false
  }

  let xs
  if (monotonic) {
    const d0 = onsets[0].defaultX
    const dLast = onsets[onsets.length - 1].defaultX
    let width
    if (onsets.length >= 2 && onsets[onsets.length - 1].time - onsets[0].time > 1e-6) {
      // Extrapolate the barline's default-x from the engraved velocity and the
      // last note's remaining duration, so the measure's full width is used.
      const vel = (dLast - d0) / (onsets[onsets.length - 1].time - onsets[0].time)
      const barlineDX = dLast + Math.max(vel, 0) * Math.max(mEnd - onsets[onsets.length - 1].time, 0)
      width = barlineDX - d0
    } else {
      width = Math.max(dLast - d0, 1)
    }
    if (!(width > 1e-6)) width = 1
    xs = onsets.map((o) => startX + ((o.defaultX - d0) / width) * span)
  } else {
    const dur = Math.max(mEnd - mStart, 1e-6)
    xs = onsets.map((o) => startX + clamp((o.time - mStart) / dur, 0, 1) * span)
  }

  const knots = []
  if (onsets[0].time > mStart + 0.02) {
    knots.push({ t: mStart, x: startX, measureNumber, kind: 'measure-start' })
  }
  for (let i = 0; i < onsets.length; i += 1) {
    knots.push({
      t: onsets[i].time,
      x: clamp(xs[i], startX, Math.max(startX, endX)),
      measureNumber,
      kind: onsets[i].chord ? 'chord' : 'note',
    })
  }
  return knots
}

function sanitizeKnots(knots) {
  const sorted = [...knots].sort((a, b) => a.t - b.t)
  const out = []
  for (const knot of sorted) {
    const prev = out[out.length - 1]
    if (prev && knot.t - prev.t < 0.004) {
      out[out.length - 1] = { ...knot, t: prev.t, x: Math.max(prev.x, knot.x) }
      continue
    }
    out.push({ ...knot, x: prev ? Math.max(prev.x, knot.x) : knot.x })
  }
  return out
}

/** Fritsch–Carlson monotone cubic Hermite: smooth and never overshoots a knot. */
function buildMonotoneSpline(ts, xs) {
  const n = ts.length
  if (n <= 1) return { ts, xs, ms: n === 1 ? [0] : [] }
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

function evalSpline(spline, t) {
  const { ts, xs, ms } = spline
  const n = ts.length
  if (n === 0) return 0
  if (n === 1 || t <= ts[0]) return xs[0]
  if (t >= ts[n - 1]) return xs[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ts[mid] <= t) lo = mid
    else hi = mid
  }
  const h = ts[lo + 1] - ts[lo]
  if (h <= 0) return xs[lo]
  const s = (t - ts[lo]) / h
  const s2 = s * s
  const s3 = s2 * s
  return (
    (2 * s3 - 3 * s2 + 1) * xs[lo] +
    (s3 - 2 * s2 + s) * h * ms[lo] +
    (-2 * s3 + 3 * s2) * xs[lo + 1] +
    (s3 - s2) * h * ms[lo + 1]
  )
}

function classifySegment(a, b) {
  if (b.kind === 'system-end') return 'system-end-settle'
  if (b.kind === 'phrase-end') return 'phrase-end-settle'
  if (a.measureNumber != null && b.measureNumber != null && a.measureNumber !== b.measureNumber) {
    return 'measure-bridge'
  }
  if ((a.kind === 'note' || a.kind === 'chord') && b.t - a.t >= HELD_GLIDE_SECONDS) {
    return 'held-note-glide'
  }
  return 'note-to-note-glide'
}

function finalizePhrase(phrase) {
  const knots = sanitizeKnots(phrase.knots)
  phrase.knots = knots
  phrase.spline = buildMonotoneSpline(knots.map((k) => k.t), knots.map((k) => k.x))
  phrase.startTime = knots[0]?.t ?? phrase.startTime
  phrase.startX = knots[0]?.x ?? 0
  phrase.endX = knots[knots.length - 1]?.x ?? phrase.startX
  phrase.minX = phrase.startX
  phrase.maxX = phrase.endX
  phrase.segments = []
  for (let i = 0; i < knots.length - 1; i += 1) {
    const a = knots[i]
    const b = knots[i + 1]
    const dt = b.t - a.t
    phrase.segments.push({
      type: classifySegment(a, b),
      startTime: a.t,
      endTime: b.t,
      startX: a.x,
      endX: b.x,
      measureNumber: a.measureNumber,
      onsetLock: b.kind === 'note' || b.kind === 'chord',
      velocity: dt > 0 ? (b.x - a.x) / dt : 0,
    })
  }
  return phrase
}

/** Build the playback-ordered cursor motion timeline. */
export function buildCursorMotionTimeline({ timingMap, trustedAnchors }) {
  const deduped = dedupeTrustedAnchorsByMeasure(trustedAnchors ?? [])
  if (!timingMap?.measures?.length || deduped.length === 0) {
    return { phrases: [], duration: getPlaybackDurationSeconds(timingMap) || 0, empty: true }
  }
  const anchorByMeasure = new Map(deduped.map((a) => [a.measureNumber, a]))
  const performed = enumeratePerformedMeasures(timingMap)
  const phrases = []
  let current = null

  const close = (breakType) => {
    if (current && current.knots.length > 0) {
      current.breakType = breakType
      phrases.push(finalizePhrase(current))
    }
    current = null
  }

  for (let i = 0; i < performed.length; i += 1) {
    const pm = performed[i]
    const anchor = anchorByMeasure.get(pm.measureNumber)
    if (!anchor) {
      close('gap')
      continue
    }
    if (!current) {
      current = {
        index: phrases.length,
        page: anchor.page ?? 1,
        y: anchor.y ?? 0,
        startTime: pm.startTime,
        endTime: pm.endTime,
        knots: [],
      }
    }

    const next = performed[i + 1]
    const nextAnchor = next ? anchorByMeasure.get(next.measureNumber) : null
    const sameLineNext =
      nextAnchor &&
      nextAnchor.page === anchor.page &&
      Math.abs((nextAnchor.y ?? 0) - (anchor.y ?? 0)) < SYSTEM_Y_TOLERANCE
    const contiguousNext = next && next.measureNumber === pm.measureNumber + 1

    // Where this measure's motion ends:
    //   continuing in-phrase → the NEXT measure's beat-1 x (so the barline is just
    //   a point the cursor flows through — no artificial slowdown);
    //   line break → systemEndX (finish the visual line);
    //   jump / end → this measure's own barline (playableEndX).
    let endX
    let phraseEnds
    let breakType = null
    if (sameLineNext && contiguousNext) {
      endX = nextAnchor.x
      phraseEnds = false
    } else if (contiguousNext && !sameLineNext) {
      endX = anchorSystemEndX(anchor)
      phraseEnds = true
      breakType = 'line'
    } else if (next) {
      endX = anchorPlayableEndX(anchor)
      phraseEnds = true
      breakType = 'jump'
    } else {
      endX = anchorPlayableEndX(anchor)
      phraseEnds = true
      breakType = 'end'
    }

    const window = { startTimeSeconds: pm.startTime, endTimeSeconds: pm.endTime }
    const onsets = getMeasureOnsets(timingMap, pm.measureNumber, window)
    const knots = buildMeasureKnots(onsets, pm.startTime, pm.endTime, anchor.x, endX, pm.measureNumber)
    current.knots.push(...knots)
    current.endTime = pm.endTime

    if (phraseEnds) {
      // Settle knot to the phrase's terminal x (line edge or this barline).
      const last = current.knots[current.knots.length - 1]
      if (endX > last.x + 1e-4 && pm.endTime > last.t + 1e-4) {
        current.knots.push({
          t: pm.endTime,
          x: endX,
          measureNumber: pm.measureNumber,
          kind: breakType === 'line' ? 'system-end' : 'phrase-end',
        })
      }
      close(breakType)
    }
  }
  close('end')

  return {
    phrases,
    duration: getPlaybackDurationSeconds(timingMap) || (phrases.at(-1)?.endTime ?? 0),
    empty: phrases.length === 0,
  }
}

function findPhraseIndex(phrases, t) {
  if (t <= phrases[0].startTime) return 0
  let idx = 0
  let lo = 0
  let hi = phrases.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (phrases[mid].startTime <= t) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return idx
}

function measureNumberAt(phrase, t) {
  let measure = phrase.knots[0]?.measureNumber ?? null
  for (const k of phrase.knots) {
    if (k.t <= t + 1e-9 && k.kind !== 'system-end' && k.kind !== 'phrase-end') measure = k.measureNumber
    else if (k.t > t) break
  }
  return measure
}

function segmentTypeAt(phrase, t) {
  for (const s of phrase.segments) {
    if (t >= s.startTime && t < s.endTime) return s.type
  }
  return phrase.segments.at(-1)?.type ?? 'note-to-note-glide'
}

/**
 * Resolve cursor position at an audio score time. Pure function of T (stateless):
 * seek/pause/loop are exact. A phrase boundary is a hard reset — at a repeat/jump
 * or line break the next phrase simply takes over, so the cursor jumps with
 * playback and never blends one phrase's x with another's.
 */
export function resolveCursorMotion(timeline, scoreTime) {
  const phrases = timeline?.phrases
  if (!phrases?.length) return null
  if (scoreTime < phrases[0].startTime - 1e-6) return null
  const phrase = phrases[findPhraseIndex(phrases, scoreTime)]
  const x = clamp(evalSpline(phrase.spline, scoreTime), phrase.minX, phrase.maxX)
  return {
    visible: true,
    x,
    y: phrase.y,
    page: phrase.page,
    measureNumber: measureNumberAt(phrase, scoreTime),
    systemIndex: phrase.index,
    segmentType: segmentTypeAt(phrase, scoreTime),
    confidence: 'exact',
  }
}

/** Dev diagnostics: phrase segments, velocities, onset error, barline velocity. */
export function buildCursorMotionDiagnostics(timeline) {
  const phrases = timeline?.phrases
  if (!phrases?.length) return { active: false, reason: 'empty-timeline' }
  let maxOnsetErrorX = 0
  let maxOnsetErrorAtT = null
  for (const phrase of phrases) {
    for (const k of phrase.knots) {
      if (k.kind === 'note' || k.kind === 'chord') {
        const got = clamp(evalSpline(phrase.spline, k.t), phrase.minX, phrase.maxX)
        const err = Math.abs(got - k.x)
        if (err > maxOnsetErrorX) {
          maxOnsetErrorX = err
          maxOnsetErrorAtT = k.t
        }
      }
    }
  }
  return {
    active: true,
    phraseCount: phrases.length,
    maxOnsetErrorX,
    maxOnsetErrorAtT,
    phrases: phrases.map((p) => ({
      index: p.index,
      page: p.page,
      y: p.y,
      startTime: p.startTime,
      endTime: p.endTime,
      startX: p.startX,
      endX: p.endX,
      breakType: p.breakType,
      knotCount: p.knots.length,
      segments: p.segments,
    })),
  }
}
