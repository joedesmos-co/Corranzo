import { noteHasLayout } from '../musicxml/readNoteLayout.js'
import { clamp, lerp } from '../score-follow/scoreFollowEasing.js'
import { CHECKPOINT_KIND } from './waitForYouCheckpoints.js'
import {
  buildMeasureAnchorGeometry,
  getMeasureLayoutExtents,
  getMeasureTimingWindow,
} from './noteTargetContext.js'

export const NOTE_TARGET_SOURCE = {
  MUSICXML_LAYOUT: 'musicxml-layout',
  MEASURE_BEAT: 'measure-beat',
  SYSTEM_HEURISTIC: 'system-heuristic',
  ANCHOR_ONLY: 'anchor-only',
}

const CONFIDENCE_BY_SOURCE = {
  [NOTE_TARGET_SOURCE.MUSICXML_LAYOUT]: 0.82,
  [NOTE_TARGET_SOURCE.MEASURE_BEAT]: 0.62,
  [NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC]: 0.52,
  [NOTE_TARGET_SOURCE.ANCHOR_ONLY]: 0.35,
}

export const NOTE_TARGET_STATUS_LABELS = {
  [NOTE_TARGET_SOURCE.MUSICXML_LAYOUT]: 'Using MusicXML horizontal note position',
  [NOTE_TARGET_SOURCE.MEASURE_BEAT]: 'Approximate — beat position in measure',
  [NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC]: 'Approximate — staff or pitch on system',
  [NOTE_TARGET_SOURCE.ANCHOR_ONLY]: 'Rough guide — anchor only',
}

function staffBandY(geometry, staff, midi, partId) {
  const { yTop, yBottom, staffSplitY } = geometry

  if (staff === 1) {
    return lerp(yTop, staffSplitY, 0.45)
  }
  if (staff === 2) {
    return lerp(staffSplitY, yBottom, 0.45)
  }

  if (midi != null) {
    const lowerPart = partId && /P2|2|bass|left|LH/i.test(String(partId))
    if (lowerPart) {
      return lerp(staffSplitY, yBottom, 0.42)
    }
    if (midi >= 60) {
      return lerp(yTop, staffSplitY, 0.42)
    }
    return lerp(staffSplitY, yBottom, 0.42)
  }

  return staffSplitY
}

/** MusicXML default-y: positive = below staff line (down on page). */
function layoutYOffsetTenths(defaultY, span) {
  if (defaultY == null) {
    return 0
  }
  const normalized = clamp(defaultY / 80, -1.2, 1.2)
  return normalized * span * 0.2
}

function resolveNoteX({
  note,
  geometry,
  timingWindow,
  layoutExtents,
  checkpointTime,
}) {
  const { xMeasureStart, xMeasureEnd } = geometry
  const bandWidth = Math.max(0.025, xMeasureEnd - xMeasureStart)

  if (layoutExtents.hasDefaultX && note.defaultX != null) {
    const minX = layoutExtents.minDefaultX ?? 0
    const maxX = layoutExtents.maxDefaultX ?? minX
    const range = maxX - minX
    const ratio = range > 0.5 ? clamp((note.defaultX - minX) / range, 0, 1) : 0.15
    return lerp(xMeasureStart, xMeasureEnd, ratio)
  }

  if (timingWindow) {
    const local =
      (checkpointTime - timingWindow.startTimeSeconds) / timingWindow.durationSeconds
    return lerp(xMeasureStart, xMeasureEnd, clamp(local, 0, 1))
  }

  if (geometry.placement === 'exact-anchor') {
    return lerp(xMeasureStart, xMeasureEnd, 0.35)
  }

  return lerp(xMeasureStart, xMeasureEnd, 0.4)
}

function classifySource(note, layoutExtents, timingWindow, geometry) {
  if (layoutExtents.hasDefaultX && note.defaultX != null) {
    return NOTE_TARGET_SOURCE.MUSICXML_LAYOUT
  }
  if (timingWindow && geometry.placement !== 'exact-anchor') {
    return NOTE_TARGET_SOURCE.MEASURE_BEAT
  }
  if (note.staff != null || note.midi != null) {
    return NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC
  }
  return NOTE_TARGET_SOURCE.ANCHOR_ONLY
}

function resolveSingleNotePosition({
  note,
  geometry,
  timingWindow,
  layoutExtents,
  checkpointTime,
}) {
  const x = resolveNoteX({
    note,
    geometry,
    timingWindow,
    layoutExtents,
    checkpointTime,
  })

  const span = geometry.yBottom - geometry.yTop
  let y = staffBandY(geometry, note.staff, note.midi, note.partId)
  y += layoutYOffsetTenths(note.defaultY, span)
  if (note.relativeY != null) {
    y += layoutYOffsetTenths(note.relativeY, span)
  }

  y = clamp(y, geometry.yTop, geometry.yBottom)

  return {
    x: clamp(x, 0.03, 0.97),
    y,
    source: classifySource(note, layoutExtents, timingWindow, geometry),
  }
}

function pickStrongestSource(sources) {
  const order = [
    NOTE_TARGET_SOURCE.ANCHOR_ONLY,
    NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC,
    NOTE_TARGET_SOURCE.MEASURE_BEAT,
    NOTE_TARGET_SOURCE.MUSICXML_LAYOUT,
  ]
  return sources.reduce(
    (best, source) => (order.indexOf(source) > order.indexOf(best) ? source : best),
    sources[0],
  )
}

/**
 * Resolve normalized PDF position for the current Wait For You note checkpoint.
 */
export function resolveNoteTargetPosition({
  checkpoint,
  timingMap,
  anchors,
}) {
  if (!checkpoint || checkpoint.kind !== CHECKPOINT_KIND.NOTE) {
    return { visible: false, reason: 'not-note-checkpoint' }
  }

  const notes = checkpoint.notes?.filter((note) => !note.isRest && note.midi != null) ?? []
  if (!notes.length) {
    return { visible: false, reason: 'no-notes' }
  }

  if (!anchors?.length || !timingMap?.measures?.length) {
    return { visible: false, reason: 'no-anchors' }
  }

  const measureNumber = checkpoint.measureNumber
  const geometry = buildMeasureAnchorGeometry(anchors, timingMap, measureNumber)
  if (!geometry) {
    return { visible: false, reason: 'no-geometry' }
  }

  const timingWindow = getMeasureTimingWindow(timingMap, measureNumber)
  const layoutExtents = getMeasureLayoutExtents(timingMap, measureNumber)
  const checkpointTime = checkpoint.timeSeconds

  const placements = notes.map((note) =>
    resolveSingleNotePosition({
      note,
      geometry,
      timingWindow,
      layoutExtents,
      checkpointTime,
    }),
  )

  const xs = placements.map((placement) => placement.x)
  const ys = placements.map((placement) => placement.y)
  const x = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const y = checkpoint.isChord && yMax - yMin > 0.025 ? (yMin + yMax) / 2 : ys.reduce((a, b) => a + b, 0) / ys.length

  const source = pickStrongestSource(placements.map((placement) => placement.source))
  const confidence = CONFIDENCE_BY_SOURCE[source] ?? 0.4
  const hasLayoutData = notes.some((note) => noteHasLayout(note))
  const chordSpread = yMax - yMin

  let reason = NOTE_TARGET_STATUS_LABELS[source] ?? 'Approximate position'
  if (source === NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC && notes.some((note) => note.staff != null)) {
    reason = 'Approximate — MusicXML staff on system'
  } else if (hasLayoutData && source !== NOTE_TARGET_SOURCE.MUSICXML_LAYOUT) {
    reason = `${reason} (layout data partial)`
  }

  return {
    visible: true,
    page: geometry.page,
    x: clamp(x, 0.03, 0.97),
    y: clamp(y, 0.06, 0.94),
    confidence,
    source,
    reason,
    isChord: checkpoint.isChord,
    isWideChord: checkpoint.isChord && chordSpread > 0.04,
    chordSpread,
    hasLayoutData,
    measureNumber,
    placement: geometry.placement,
  }
}
