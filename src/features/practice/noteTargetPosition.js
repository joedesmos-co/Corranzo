import { noteHasLayout } from '../musicxml/readNoteLayout.js'
import { clamp, lerp } from '../score-follow/scoreFollowEasing.js'
import { resolveDisplayCursorAtTime } from '../score-follow/scoreFollowDisplayPosition.js'
import { isPlayableCheckpointKind } from './waitForYouCheckpoints.js'
import { resolveNotePracticeHand } from './practiceScope.js'
import {
  getSourceVisualAnchorIndex,
  resolveSourceVisualAnchorGeometry,
  SOURCE_VISUAL_COORDINATE_SPACE,
} from '../omr/omrSourceVisualMap.js'
import {
  buildMeasureAnchorGeometry,
  getMeasureLayoutExtents,
  getMeasureTimingWindow,
} from './noteTargetContext.js'

export const NOTE_TARGET_MARKER_OFFSET_Y = 0.036

export const NOTE_TARGET_SOURCE = {
  DIRECT_GEOMETRY: 'direct-geometry',
  SOURCE_NOTEHEAD: 'source-notehead',
  MUSICXML_LAYOUT: 'musicxml-layout',
  MEASURE_BEAT: 'measure-beat',
  SYSTEM_HEURISTIC: 'system-heuristic',
  ANCHOR_ONLY: 'anchor-only',
}

const CONFIDENCE_BY_SOURCE = {
  [NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD]: 0.96,
  [NOTE_TARGET_SOURCE.DIRECT_GEOMETRY]: 0.9,
  [NOTE_TARGET_SOURCE.MUSICXML_LAYOUT]: 0.66,
  [NOTE_TARGET_SOURCE.MEASURE_BEAT]: 0.62,
  [NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC]: 0.52,
  [NOTE_TARGET_SOURCE.ANCHOR_ONLY]: 0.35,
}

export const NOTE_TARGET_STATUS_LABELS = {
  [NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD]: 'Using the printed source notehead',
  [NOTE_TARGET_SOURCE.DIRECT_GEOMETRY]: 'Using detected notehead geometry',
  [NOTE_TARGET_SOURCE.MUSICXML_LAYOUT]: 'Approximate — MusicXML onset in mapped measure',
  [NOTE_TARGET_SOURCE.MEASURE_BEAT]: 'Approximate — beat position in measure',
  [NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC]: 'Approximate — staff or pitch on system',
  [NOTE_TARGET_SOURCE.ANCHOR_ONLY]: 'Rough guide — anchor only',
}

const HIGHLIGHT_SOURCES = new Set([
  NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD,
  NOTE_TARGET_SOURCE.DIRECT_GEOMETRY,
  NOTE_TARGET_SOURCE.MUSICXML_LAYOUT,
])

export const PRECISE_SOURCE_MIN_CONFIDENCE = 0.7

function shouldPreserveGrandStaffBand(notes, timingMap) {
  if ((timingMap?.stavesPerSystem ?? 1) < 2) {
    return false
  }
  return notes.some((note) => resolveNotePracticeHand(note, timingMap) != null)
}

function finite(value) {
  return Number.isFinite(value)
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

  if (layoutExtents.hasDefaultX && note.defaultX != null) {
    // MusicXML default-x is tenths from the left of the measure. Map against the
    // engraved measure width (or a modest estimate from the rightmost note) —
    // never min/max-stretch the note cluster across the full PDF measure span,
    // which parked early notes halfway across empty bars.
    const engravedWidth = layoutExtents.engravedWidth
    const maxX = layoutExtents.maxDefaultX ?? note.defaultX
    const widthTenths =
      Number.isFinite(engravedWidth) && engravedWidth > 0
        ? engravedWidth
        : Math.max(maxX + Math.max(40, maxX * 0.15), 80)
    const ratio = clamp(note.defaultX / widthTenths, 0, 1)
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
  if (finite(note.xNorm) && finite(note.yNorm)) {
    return NOTE_TARGET_SOURCE.DIRECT_GEOMETRY
  }
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

function resolveOwnedSourcePlacement(note, sourceAnchorIndex, preferredRepresentation) {
  const ownedSourceAnchor = resolveSourceVisualAnchorGeometry(
    sourceAnchorIndex?.get(note.sourceNoteheadId),
    preferredRepresentation,
  )
  // An explicit notation/TAB choice is an event-level contract. If even one
  // semantic note lacks that representation, reject its source placement so
  // the whole event takes the conservative fallback path instead of painting
  // exact boxes across both printed representations at once.
  const matchesPreferredRepresentation =
    preferredRepresentation == null ||
    ownedSourceAnchor?.representation === preferredRepresentation
  const ownershipMatchesSemanticNote =
    ownedSourceAnchor &&
    matchesPreferredRepresentation &&
    (ownedSourceAnchor.measureNumber == null ||
      note.measureNumber == null ||
      Number(ownedSourceAnchor.measureNumber) === Number(note.measureNumber)) &&
    (ownedSourceAnchor.midi == null ||
      note.midi == null ||
      Number(ownedSourceAnchor.midi) === Number(note.midi))
  if (
    ownershipMatchesSemanticNote &&
    ownedSourceAnchor?.sourceCenter &&
    ownedSourceAnchor?.sourceBBox
  ) {
    return {
      x: ownedSourceAnchor.sourceCenter.x,
      y: ownedSourceAnchor.sourceCenter.y,
      page: ownedSourceAnchor.page,
      midi: note.midi ?? ownedSourceAnchor.midi ?? null,
      source: NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD,
      confidence: ownedSourceAnchor.confidence,
      coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
      sourceBBox: ownedSourceAnchor.sourceBBox,
      sourceNoteheadId: ownedSourceAnchor.sourceNoteheadId,
      sourceEventId: ownedSourceAnchor.sourceEventId,
      sourceEventIds: ownedSourceAnchor.sourceEventIds ?? [],
      representation: ownedSourceAnchor.representation,
      systemIndex: ownedSourceAnchor.systemIndex,
      staffIndex: ownedSourceAnchor.staffIndex,
      geometrySource: ownedSourceAnchor.geometrySource,
      staffGap: ownedSourceAnchor.staffGap,
    }
  }

  return null
}

function resolveSingleNotePosition({
  note,
  geometry,
  timingWindow,
  layoutExtents,
  checkpointTime,
  sourceAnchorIndex,
  preferredRepresentation,
}) {
  const sourcePlacement = resolveOwnedSourcePlacement(
    note,
    sourceAnchorIndex,
    preferredRepresentation,
  )
  if (sourcePlacement) return sourcePlacement

  if (finite(note.xNorm) && finite(note.yNorm)) {
    return {
      x: clamp(note.xNorm, 0.03, 0.97),
      y: clamp(note.yNorm, 0.06, 0.94),
      midi: note.midi ?? null,
      source: NOTE_TARGET_SOURCE.DIRECT_GEOMETRY,
      confidence: CONFIDENCE_BY_SOURCE[NOTE_TARGET_SOURCE.DIRECT_GEOMETRY],
      coordinateSpace: 'pdf-analysis-normalized',
    }
  }

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
    midi: note.midi ?? null,
    source: classifySource(note, layoutExtents, timingWindow, geometry),
    coordinateSpace: 'pdf-analysis-normalized',
  }
}

function pickStrongestSource(sources) {
  const order = [
    NOTE_TARGET_SOURCE.ANCHOR_ONLY,
    NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC,
    NOTE_TARGET_SOURCE.MEASURE_BEAT,
    NOTE_TARGET_SOURCE.MUSICXML_LAYOUT,
    NOTE_TARGET_SOURCE.DIRECT_GEOMETRY,
    NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD,
  ]
  return sources.reduce(
    (best, source) => (order.indexOf(source) > order.indexOf(best) ? source : best),
    sources[0],
  )
}

function noteBoxForPlacement(placement, geometry) {
  if (placement.sourceBBox) {
    return {
      ...placement.sourceBBox,
      midi: placement.midi ?? null,
      sourceNoteheadId: placement.sourceNoteheadId ?? null,
    }
  }
  const measureWidth = Math.max(0.03, geometry.xMeasureEnd - geometry.xMeasureStart)
  const corridorHeight = Math.max(0.055, geometry.yBottom - geometry.yTop)
  const halfWidth = clamp(measureWidth * 0.08, 0.008, 0.02)
  const halfHeight = clamp(corridorHeight * 0.18, 0.006, 0.018)

  return {
    x0: clamp(placement.x - halfWidth, 0, 1),
    y0: clamp(placement.y - halfHeight, 0, 1),
    x1: clamp(placement.x + halfWidth, 0, 1),
    y1: clamp(placement.y + halfHeight, 0, 1),
    midi: placement.midi ?? null,
    sourceNoteheadId: placement.sourceNoteheadId ?? null,
  }
}

function expandRect(rect, paddingX, paddingY) {
  return {
    x0: clamp(rect.x0 - paddingX, 0, 1),
    y0: clamp(rect.y0 - paddingY, 0, 1),
    x1: clamp(rect.x1 + paddingX, 0, 1),
    y1: clamp(rect.y1 + paddingY, 0, 1),
  }
}

function buildTargetHighlight({ placements, geometry, isChord, source, confidence }) {
  if (!placements.length || !placements.every((placement) => HIGHLIGHT_SOURCES.has(placement.source))) {
    return null
  }

  const boxes = placements.map((placement) => noteBoxForPlacement(placement, geometry))
  const coordinateSpaces = new Set(
    placements.map((placement) => placement.coordinateSpace ?? 'pdf-analysis-normalized'),
  )
  if (coordinateSpaces.size !== 1) {
    return null
  }
  const coordinateSpace = [...coordinateSpaces][0]
  const preciseSource = placements.every(
    (placement) => placement.source === NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD,
  )
  const rect = boxes.reduce(
    (bounds, box) => ({
      x0: Math.min(bounds.x0, box.x0),
      y0: Math.min(bounds.y0, box.y0),
      x1: Math.max(bounds.x1, box.x1),
      y1: Math.max(bounds.y1, box.y1),
    }),
    { x0: Infinity, y0: Infinity, x1: 0, y1: 0 },
  )

  const padded = preciseSource
    ? expandRect(rect, 0.0025, 0.0025)
    : expandRect(
        rect,
        isChord ? 0.012 : 0.01,
        isChord ? 0.01 : 0.008,
      )
  const minWidth = isChord ? 0.036 : 0.028
  const minHeight = isChord ? 0.028 : 0.022
  const measureWidth = Math.max(0.03, geometry.xMeasureEnd - geometry.xMeasureStart)
  // Cap the amber score highlight so a bad layout spread cannot paint half a
  // measure. Simultaneous chord noteheads stay near one column.
  const maxWidth = Math.max(minWidth, measureWidth * (isChord ? 0.28 : 0.2))
  let width = padded.x1 - padded.x0
  const height = padded.y1 - padded.y0
  let centerX = (padded.x0 + padded.x1) / 2
  const centerY = (padded.y0 + padded.y1) / 2
  if (!preciseSource && width > maxWidth) {
    const xs = placements.map((placement) => placement.x).sort((a, b) => a - b)
    centerX = xs[Math.floor(xs.length / 2)]
    width = maxWidth
  }
  const halfWidth = Math.max(width, minWidth) / 2
  const halfHeight = Math.max(height, minHeight) / 2

  return {
    x0: clamp(centerX - halfWidth, 0, 1),
    y0: clamp(centerY - halfHeight, 0, 1),
    x1: clamp(centerX + halfWidth, 0, 1),
    y1: clamp(centerY + halfHeight, 0, 1),
    source,
    confidence,
    noteCount: placements.length,
    noteBoxes: boxes,
    sourceNoteheadIds: placements.map((placement) => placement.sourceNoteheadId).filter(Boolean),
    sourceEventIds: [
      ...new Set(
        placements.flatMap((placement) =>
          placement.sourceEventIds?.length
            ? placement.sourceEventIds
            : placement.sourceEventId
              ? [placement.sourceEventId]
              : [],
        ),
      ),
    ],
    coordinateSpace,
    renderMode: preciseSource ? 'individual-source-boxes' : 'union',
    representation: preciseSource ? placements[0]?.representation ?? null : null,
    preciseSource,
    isChord,
    approximate: confidence < 0.7,
  }
}

function sourceAnchorSummaries(placements) {
  return placements.map((placement) => ({
    sourceNoteheadId: placement.sourceNoteheadId,
    sourceEventId: placement.sourceEventId,
    sourceEventIds: placement.sourceEventIds ?? [],
    page: placement.page,
    systemIndex: placement.systemIndex,
    staffIndex: placement.staffIndex,
    representation: placement.representation,
    confidence: placement.confidence,
    geometrySource: placement.geometrySource,
    staffGap: placement.staffGap,
  }))
}

function buildExactSourceTarget({ checkpoint, notes, placements, mode }) {
  const uniquePlacements = [
    ...new Map(
      placements.map((placement) => [placement.sourceNoteheadId, placement]),
    ).values(),
  ]
  // Same cross-measure rule as the fallback path: the marker column sits
  // with the checkpoint's own measure; every owned box still renders.
  const measureNumber = checkpoint.measureNumber
  const inMeasure =
    notes.length === placements.length
      ? uniquePlacements.filter((_, index) => notes[index]?.measureNumber === measureNumber)
      : []
  const xPlacements = inMeasure.length > 0 ? inMeasure : uniquePlacements
  const crossMeasure = new Set(notes.map((note) => note.measureNumber)).size > 1
  const xs = xPlacements.map((placement) => placement.x)
  const ys = uniquePlacements.map((placement) => placement.y)
  const x = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const y = ys.reduce((sum, value) => sum + value, 0) / ys.length
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const confidence = Math.min(
    ...uniquePlacements.map((placement) => placement.confidence),
  )
  const highlight = buildTargetHighlight({
    placements: uniquePlacements,
    geometry: { xMeasureStart: 0, xMeasureEnd: 1 },
    isChord: checkpoint.isChord,
    source: NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD,
    confidence,
  })
  const checkpointTime = checkpoint.timeSeconds

  return {
    visible: true,
    targetKey:
      checkpoint.id ??
      `${measureNumber}:${checkpointTime}:${notes.map((note) => note.midi).join(',')}`,
    page: uniquePlacements[0].page,
    crossMeasure,
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    noteAnchorY: clamp(y, 0, 1),
    markerOffsetY: 0,
    highlight,
    coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
    sourceAnchors: sourceAnchorSummaries(uniquePlacements),
    displayMode: 'highlight',
    mode,
    approximate: false,
    confidence,
    source: NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD,
    reason: NOTE_TARGET_STATUS_LABELS[NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD],
    isChord: checkpoint.isChord,
    isWideChord: checkpoint.isChord && yMax - yMin > 0.04,
    chordSpread: yMax - yMin,
    hasLayoutData: notes.some((note) => noteHasLayout(note)),
    measureNumber,
    placement: 'source-ownership',
  }
}

/**
 * Resolve normalized PDF position for the current Wait For You note checkpoint.
 */
export function resolveNoteTargetPosition({
  checkpoint,
  timingMap,
  anchors,
  sourceVisualMap = null,
  preferredRepresentation = null,
  mode = 'wait-for-you',
  motionTimeline = null,
}) {
  if (!checkpoint || !isPlayableCheckpointKind(checkpoint.kind)) {
    return { visible: false, reason: 'not-note-checkpoint' }
  }

  const notes = checkpoint.notes?.filter((note) => !note.isRest && note.midi != null) ?? []
  if (!notes.length) {
    return { visible: false, reason: 'no-notes' }
  }

  const measureNumber = checkpoint.measureNumber
  const checkpointTime = checkpoint.timeSeconds
  const sourceAnchorIndex = getSourceVisualAnchorIndex(sourceVisualMap)
  const sourcePlacements = notes
    .map((note) =>
      resolveOwnedSourcePlacement(note, sourceAnchorIndex, preferredRepresentation),
    )
    .filter(Boolean)
  const ownsEveryNote = sourcePlacements.length === notes.length
  const sourcePages = new Set(sourcePlacements.map((placement) => placement.page))

  if (sourcePages.size > 1) {
    return { visible: false, reason: 'cross-page-source-event' }
  }

  const preciseSourceConfidence = ownsEveryNote
    ? Math.min(...sourcePlacements.map((placement) => placement.confidence))
    : null
  if (
    ownsEveryNote &&
    sourcePages.size === 1 &&
    preciseSourceConfidence >= PRECISE_SOURCE_MIN_CONFIDENCE
  ) {
    return buildExactSourceTarget({
      checkpoint,
      notes,
      placements: sourcePlacements,
      mode,
    })
  }

  if (!anchors?.length || !timingMap?.measures?.length) {
    return {
      visible: false,
      reason:
        ownsEveryNote && preciseSourceConfidence < PRECISE_SOURCE_MIN_CONFIDENCE
          ? 'low-confidence-source-anchor'
          : 'no-anchors',
    }
  }

  // Same display resolver the painted bar uses (motion timeline when the
  // caller threads it, legacy fallback otherwise) — page/y here must agree
  // with the bar, never a parallel estimate.
  const sharedCursor = {
    cursor: resolveDisplayCursorAtTime({
      timingMap,
      practiceTime: checkpointTime,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
      motionTimeline,
    }),
  }
  sharedCursor.confidence = sharedCursor.cursor?.confidence ?? null

  const geometry = buildMeasureAnchorGeometry(anchors, timingMap, measureNumber, checkpointTime)
  if (!geometry) {
    return { visible: false, reason: 'no-geometry' }
  }

  const preserveGrandStaffBand = shouldPreserveGrandStaffBand(notes, timingMap)
  if (sharedCursor.cursor?.visible) {
    geometry.page = sharedCursor.cursor.page
    if (!preserveGrandStaffBand) {
      geometry.yCenter = sharedCursor.cursor.y
      geometry.yTop = clamp(sharedCursor.cursor.y - 0.04, 0.06, 0.94)
      geometry.yBottom = clamp(sharedCursor.cursor.y + 0.04, 0.06, 0.94)
      geometry.staffSplitY = sharedCursor.cursor.y
    }
    if (sharedCursor.confidence === 'exact') {
      geometry.placement = 'exact-anchor'
    }
  }

  const timingWindow = getMeasureTimingWindow(timingMap, measureNumber, checkpointTime)
  const layoutExtents = getMeasureLayoutExtents(timingMap, measureNumber)
  // Exact rendering is all-or-nothing for a semantic event. If ownership is
  // partial or below the precision threshold, resolve every member through the
  // conservative measure/layout hierarchy so coordinate spaces never mix.
  const placements = notes.map((note) =>
    resolveSingleNotePosition({
      note,
      geometry,
      timingWindow,
      layoutExtents,
      checkpointTime,
      sourceAnchorIndex: new Map(),
      preferredRepresentation,
    }),
  )

  // Cross-measure checkpoints (simultaneous notes notated in two measures,
  // e.g. tremolo across a barline): the marker column and the WFY bar lock
  // must sit with the checkpoint's own measure — the one the timeline cursor
  // is in — never at an average stranded between measures. All boxes still
  // render (every required note stays visible).
  const inMeasure = notes
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => note.measureNumber === measureNumber)
  const xPool = (inMeasure.length > 0 ? inMeasure : notes.map((note, index) => ({ note, index })))
    .map(({ index }) => placements[index].x)
  const crossMeasure =
    new Set(notes.map((note) => note.measureNumber)).size > 1
  const xs = placements.map((placement) => placement.x)
  const ys = placements.map((placement) => placement.y)
  const x = xPool.reduce((sum, value) => sum + value, 0) / xPool.length
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const y = checkpoint.isChord && yMax - yMin > 0.025 ? (yMin + yMax) / 2 : ys.reduce((a, b) => a + b, 0) / ys.length

  const source = pickStrongestSource(placements.map((placement) => placement.source))
  const confidence = Math.min(
    ...placements.map(
      (placement) => placement.confidence ?? CONFIDENCE_BY_SOURCE[placement.source] ?? 0.4,
    ),
  )
  const hasLayoutData = notes.some((note) => noteHasLayout(note))
  const chordSpread = yMax - yMin
  const highlight = buildTargetHighlight({
    placements,
    geometry,
    isChord: checkpoint.isChord,
    source,
    confidence,
  })
  const displayMode = highlight ? 'highlight' : 'dot-fallback'

  let reason = NOTE_TARGET_STATUS_LABELS[source] ?? 'Approximate position'
  if (source === NOTE_TARGET_SOURCE.SYSTEM_HEURISTIC && notes.some((note) => note.staff != null)) {
    reason = 'Approximate — MusicXML staff on system'
  } else if (hasLayoutData && source !== NOTE_TARGET_SOURCE.MUSICXML_LAYOUT) {
    reason = `${reason} (layout data partial)`
  }

  const noteAnchorY = clamp(y, 0.06, 0.94)
  const markerY = clamp(
    Math.min(noteAnchorY, geometry.yTop + 0.008) - NOTE_TARGET_MARKER_OFFSET_Y,
    0.04,
    0.9,
  )

  return {
    visible: true,
    targetKey: checkpoint.id ?? `${measureNumber}:${checkpointTime}:${notes.map((note) => note.midi).join(',')}`,
    page: geometry.page,
    x: clamp(x, 0.03, 0.97),
    y: markerY,
    noteAnchorY,
    markerOffsetY: NOTE_TARGET_MARKER_OFFSET_Y,
    highlight,
    coordinateSpace: highlight?.coordinateSpace ?? 'pdf-analysis-normalized',
    sourceAnchors: [],
    displayMode,
    mode,
    approximate: !highlight || confidence < 0.7,
    confidence,
    source,
    reason,
    isChord: checkpoint.isChord,
    isWideChord: checkpoint.isChord && chordSpread > 0.04,
    chordSpread,
    hasLayoutData,
    measureNumber,
    crossMeasure,
    placement: geometry.placement,
  }
}
