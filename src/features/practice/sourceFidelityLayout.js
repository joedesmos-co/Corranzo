import {
  SOURCE_VISUAL_COORDINATE_SPACE,
  resolveSourceVisualAnchorGeometry,
} from '../omr/omrSourceVisualMap.js'

export const VISUAL_LAYOUT_SOURCE = {
  SOURCE_VISUAL_MAP: 'source-visual-map',
  MUSICXML: 'musicxml-layout',
  SEMANTIC_FALLBACK: 'semantic-fallback',
}

export const SOURCE_LAYOUT_MIN_CONFIDENCE = 0.7
export const SOURCE_FIDELITY_SYSTEM_WIDTH = 560
export const SOURCE_FIDELITY_SYSTEM_GAP = 72

function finite(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value))
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value)))
}

function normalizeSourceBounds(sourceBBox) {
  if (
    !finite(sourceBBox?.x0) ||
    !finite(sourceBBox?.y0) ||
    !finite(sourceBBox?.x1) ||
    !finite(sourceBBox?.y1)
  ) {
    return null
  }
  const x0 = clamp01(Math.min(sourceBBox.x0, sourceBBox.x1))
  const x1 = clamp01(Math.max(sourceBBox.x0, sourceBBox.x1))
  const y0 = clamp01(Math.min(sourceBBox.y0, sourceBBox.y1))
  const y1 = clamp01(Math.max(sourceBBox.y0, sourceBBox.y1))
  return { x0, y0, x1, y1 }
}

/**
 * Written-score page/system/measure identity from MusicXML print structure.
 * This remains useful even when a score has no per-note coordinates.
 */
export function buildVisualMeasureLayoutIndex(timingMap) {
  const index = new Map()
  let page = 1
  let systemIndex = 0
  let pageSystemIndex = 0

  for (let measureIndex = 0; measureIndex < (timingMap?.measures?.length ?? 0); measureIndex += 1) {
    const measure = timingMap.measures[measureIndex]
    if (measureIndex > 0 && measure.pageBreakBefore) {
      page += 1
      systemIndex += 1
      pageSystemIndex = 0
    } else if (measureIndex > 0 && measure.systemBreakBefore) {
      systemIndex += 1
      pageSystemIndex += 1
    }
    const engravedWidth = Number(measure.engravedWidth)
    index.set(measure.number, {
      page,
      systemIndex,
      pageSystemIndex,
      measureIndex,
      measureNumber: measure.number,
      systemBreakBefore: Boolean(measure.systemBreakBefore || measure.pageBreakBefore),
      pageBreakBefore: Boolean(measure.pageBreakBefore),
      engravedWidth:
        Number.isFinite(engravedWidth) && engravedWidth > 0 ? engravedWidth : null,
      startTimeSeconds: finite(measure.startTimeSeconds)
        ? Number(measure.startTimeSeconds)
        : null,
      endTimeSeconds: finite(measure.endTimeSeconds)
        ? Number(measure.endTimeSeconds)
        : null,
      startQuarters: finite(measure.startQuarters) ? Number(measure.startQuarters) : null,
      endQuarters: finite(measure.endQuarters) ? Number(measure.endQuarters) : null,
      beats: finite(measure.beats) ? Number(measure.beats) : null,
      beatType: finite(measure.beatType) ? Number(measure.beatType) : null,
    })
  }

  return index
}

function sourceMapLayout(
  note,
  sourceOwnership,
  sourceAnchorIndex,
  preferredRepresentation,
) {
  if (
    sourceOwnership?.provenanceStatus !== 'matched' ||
    !note?.sourceNoteheadId
  ) {
    return null
  }
  const representation =
    sourceOwnership.selectedRepresentation ?? preferredRepresentation ?? null
  const anchor = resolveSourceVisualAnchorGeometry(
    sourceAnchorIndex?.get(note.sourceNoteheadId),
    representation,
  )
  const confidence = Number(anchor?.confidence)
  if (
    !anchor ||
    anchor.representation !== representation ||
    !finite(anchor.sourceCenter?.x) ||
    !finite(anchor.sourceCenter?.y) ||
    !Number.isFinite(confidence) ||
    confidence < SOURCE_LAYOUT_MIN_CONFIDENCE
  ) {
    return null
  }

  return {
    source: VISUAL_LAYOUT_SOURCE.SOURCE_VISUAL_MAP,
    coordinateSpace:
      anchor.sourceCenter.coordinateSpace ?? SOURCE_VISUAL_COORDINATE_SPACE,
    page: sourceOwnership.page ?? anchor.page ?? null,
    systemIndex: sourceOwnership.systemIndex ?? anchor.systemIndex ?? null,
    staffIndex: sourceOwnership.staffIndex ?? anchor.staffIndex ?? null,
    measureIndex: sourceOwnership.measureIndex ?? anchor.measureIndex ?? null,
    measureNumber: sourceOwnership.measureNumber ?? note.measureNumber ?? null,
    representation: anchor.representation,
    x: clamp01(anchor.sourceCenter.x),
    y: clamp01(anchor.sourceCenter.y),
    bounds: normalizeSourceBounds(anchor.sourceBBox),
    staffGap: finite(anchor.staffGap) ? Number(anchor.staffGap) : null,
    confidence,
  }
}

function musicXmlLayout(note, measureLayout) {
  const hasX = finite(note?.defaultX)
  const hasY = finite(note?.defaultY)
  if (!hasX && !hasY) {
    return null
  }
  const measureWidth = measureLayout?.engravedWidth ?? null
  return {
    source: VISUAL_LAYOUT_SOURCE.MUSICXML,
    coordinateSpace: 'musicxml-tenths',
    page: measureLayout?.page ?? null,
    systemIndex: measureLayout?.systemIndex ?? null,
    staffIndex: finite(note?.staff) ? Math.max(0, Number(note.staff) - 1) : null,
    measureIndex: measureLayout?.measureIndex ?? null,
    measureNumber: note?.measureNumber ?? measureLayout?.measureNumber ?? null,
    defaultX: hasX ? Number(note.defaultX) : null,
    defaultY: hasY ? Number(note.defaultY) : null,
    relativeX: finite(note?.relativeX) ? Number(note.relativeX) : null,
    relativeY: finite(note?.relativeY) ? Number(note.relativeY) : null,
    measureWidth,
    xInMeasure:
      hasX && measureWidth > 0 ? clamp01(Number(note.defaultX) / measureWidth) : null,
    confidence: hasX && measureWidth > 0 ? 0.72 : 0.6,
  }
}

/**
 * Renderer-safe layout evidence. Source-map coordinates win only when the
 * semantic owner agrees and confidence is high; MusicXML engraving values are
 * the fallback, followed by measure identity with no invented coordinates.
 */
export function buildVisualObjectLayout({
  note,
  measureLayout = null,
  sourceOwnership = null,
  sourceAnchorIndex = null,
  preferredRepresentation = null,
}) {
  return (
    sourceMapLayout(
      note,
      sourceOwnership,
      sourceAnchorIndex,
      preferredRepresentation,
    ) ??
    musicXmlLayout(note, measureLayout) ?? {
      source: VISUAL_LAYOUT_SOURCE.SEMANTIC_FALLBACK,
      coordinateSpace: null,
      page: measureLayout?.page ?? null,
      systemIndex: measureLayout?.systemIndex ?? null,
      staffIndex: finite(note?.staff) ? Math.max(0, Number(note.staff) - 1) : null,
      measureIndex: measureLayout?.measureIndex ?? null,
      measureNumber: note?.measureNumber ?? measureLayout?.measureNumber ?? null,
      confidence: 0,
    }
  )
}

function median(values) {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2
}

export function buildVisualEventLayout(objects, measureLayout = null) {
  const layouts = (objects ?? []).map((object) => object?.sourceLayout).filter(Boolean)
  const sourceMapped = layouts.filter(
    (layout) =>
      layout.source === VISUAL_LAYOUT_SOURCE.SOURCE_VISUAL_MAP && finite(layout.x),
  )
  const musicXml = layouts.filter(
    (layout) => layout.source === VISUAL_LAYOUT_SOURCE.MUSICXML && finite(layout.xInMeasure),
  )
  const selected = sourceMapped.length ? sourceMapped : musicXml
  const eventSource = sourceMapped.length
    ? VISUAL_LAYOUT_SOURCE.SOURCE_VISUAL_MAP
    : musicXml.length
      ? VISUAL_LAYOUT_SOURCE.MUSICXML
      : VISUAL_LAYOUT_SOURCE.SEMANTIC_FALLBACK

  return {
    source: eventSource,
    page: selected[0]?.page ?? measureLayout?.page ?? null,
    systemIndex: selected[0]?.systemIndex ?? measureLayout?.systemIndex ?? null,
    measureIndex: selected[0]?.measureIndex ?? measureLayout?.measureIndex ?? null,
    measureNumber: selected[0]?.measureNumber ?? measureLayout?.measureNumber ?? null,
    x: median(sourceMapped.map((layout) => layout.x).filter(finite)),
    xInMeasure: median(musicXml.map((layout) => layout.xInMeasure).filter(finite)),
    confidence: selected.length
      ? Math.min(...selected.map((layout) => Number(layout.confidence) || 0))
      : 0,
    measure: measureLayout,
  }
}

function timeKey(value) {
  return Number(value ?? 0).toFixed(6)
}

function measureOccurrenceKey(group) {
  return `${group.measureNumber ?? 'unknown'}:${group.repeatPass ?? 1}`
}

function systemOccurrenceKey(group) {
  const layout = group.sourceLayout
  return `${layout?.page ?? 1}:${layout?.systemIndex ?? 0}:${group.repeatPass ?? 1}`
}

function measureQuarterProgress(group, measureLayout) {
  const quarterTime = Number(group.notes?.[0]?.quarterTime ?? group.rests?.[0]?.quarterTime)
  const start = Number(measureLayout?.startQuarters)
  const end = Number(measureLayout?.endQuarters)
  if (!Number.isFinite(quarterTime) || !Number.isFinite(start) || !(end > start)) {
    return null
  }
  return clamp01((quarterTime - start) / (end - start))
}

function measureWeight(measureLayout) {
  const engravedWidth = Number(measureLayout?.engravedWidth)
  if (engravedWidth > 0) return engravedWidth
  const start = Number(measureLayout?.startQuarters)
  const end = Number(measureLayout?.endQuarters)
  if (end > start) return end - start
  const startSeconds = Number(measureLayout?.startTimeSeconds)
  const endSeconds = Number(measureLayout?.endTimeSeconds)
  if (endSeconds > startSeconds) return endSeconds - startSeconds
  return 1
}

function usesSourceFidelityLayout(groups) {
  const systemKeys = new Set()
  let hasPositionEvidence = false
  let hasEngravedWidth = false
  for (const group of groups ?? []) {
    systemKeys.add(`${group.sourceLayout?.page ?? 1}:${group.sourceLayout?.systemIndex ?? 0}`)
    if (
      group.sourceLayout?.source === VISUAL_LAYOUT_SOURCE.SOURCE_VISUAL_MAP ||
      group.sourceLayout?.source === VISUAL_LAYOUT_SOURCE.MUSICXML
    ) {
      hasPositionEvidence = true
    }
    if (group.sourceLayout?.measure?.engravedWidth > 0) {
      hasEngravedWidth = true
    }
  }
  return hasPositionEvidence || hasEngravedWidth || systemKeys.size > 1
}

/**
 * Flatten written source systems into a monotonic practice lane while keeping
 * their internal measure widths and event spacing. The systems remain
 * reconstructed SVG notation; the gap is a structural break, never a PDF crop.
 */
export function buildSourceFidelityLaneLayout(
  groups,
  {
    barlineTimes = [],
    pixelsPerSecond = 120,
    systemWidth = SOURCE_FIDELITY_SYSTEM_WIDTH,
    systemGap = SOURCE_FIDELITY_SYSTEM_GAP,
  } = {},
) {
  const orderedGroups = [...(groups ?? [])].sort(
    (left, right) => left.timeSeconds - right.timeSeconds,
  )
  if (!orderedGroups.length || !usesSourceFidelityLayout(orderedGroups)) {
    return {
      mode: 'temporal-fallback',
      pixelsPerSecond,
      groupXById: new Map(),
      objectXById: new Map(),
      barlineXByTime: new Map(),
      timeAnchors: [],
      systems: [],
      measures: [],
    }
  }

  const segments = []
  for (const group of orderedGroups) {
    const key = systemOccurrenceKey(group)
    const current = segments[segments.length - 1]
    if (!current || current.key !== key) {
      segments.push({ key, groups: [group] })
    } else {
      current.groups.push(group)
    }
  }

  const groupXById = new Map()
  const objectXById = new Map()
  const timeAnchors = []
  const systems = []
  const orderedMeasures = []
  let cursorX = 0

  for (let systemOccurrence = 0; systemOccurrence < segments.length; systemOccurrence += 1) {
    const segment = segments[systemOccurrence]
    const first = segment.groups[0]
    const last = segment.groups[segment.groups.length - 1]
    const firstKeySignature = segment.groups
      .flatMap((group) => group.notes ?? [])
      .find((note) => note.keySignature)?.keySignature ?? null
    const measureEntries = []
    const measureByKey = new Map()
    for (const group of segment.groups) {
      const key = measureOccurrenceKey(group)
      let entry = measureByKey.get(key)
      if (!entry) {
        entry = {
          key,
          groups: [],
          layout: group.sourceLayout?.measure ?? null,
          measureNumber: group.measureNumber ?? null,
          repeatPass: group.repeatPass ?? 1,
        }
        measureByKey.set(key, entry)
        measureEntries.push(entry)
      }
      entry.groups.push(group)
    }

    const totalWeight = measureEntries.reduce(
      (sum, entry) => sum + measureWeight(entry.layout),
      0,
    )
    const widthScale = systemWidth / Math.max(totalWeight, 0.001)
    let measureCursorX = cursorX
    for (const entry of measureEntries) {
      const width = measureWeight(entry.layout) * widthScale
      entry.systemOccurrence = systemOccurrence
      entry.xStart = measureCursorX
      entry.xEnd = measureCursorX + width
      measureCursorX = entry.xEnd
      orderedMeasures.push(entry)
    }

    let lastGroupX = cursorX
    for (const group of segment.groups) {
      const measureEntry = measureByKey.get(measureOccurrenceKey(group))
      const sourceX = finite(group.sourceLayout?.x)
        ? Number(group.sourceLayout.x)
        : NaN
      const xInMeasure = finite(group.sourceLayout?.xInMeasure)
        ? Number(group.sourceLayout.xInMeasure)
        : NaN
      const quarterProgress = measureQuarterProgress(group, measureEntry?.layout)
      let x
      if (
        group.sourceLayout?.source === VISUAL_LAYOUT_SOURCE.SOURCE_VISUAL_MAP &&
        Number.isFinite(sourceX)
      ) {
        x = cursorX + clamp01(sourceX) * systemWidth
      } else if (Number.isFinite(xInMeasure)) {
        x = measureEntry.xStart + clamp01(xInMeasure) * (measureEntry.xEnd - measureEntry.xStart)
      } else if (quarterProgress != null) {
        x = measureEntry.xStart + quarterProgress * (measureEntry.xEnd - measureEntry.xStart)
      } else {
        const localTime = Number(group.timeSeconds) - Number(segment.groups[0].timeSeconds)
        x = cursorX + Math.max(0, localTime) * pixelsPerSecond
      }
      // Engraved positions should progress left-to-right inside one written
      // system. Abstain from reverse cursor motion when malformed layout data
      // violates that invariant.
      x = Math.max(lastGroupX, x)
      lastGroupX = x
      groupXById.set(group.id, x)
      for (const object of [...(group.notes ?? []), ...(group.rests ?? [])]) {
        const objectSourceX = finite(object.sourceLayout?.x)
          ? Number(object.sourceLayout.x)
          : NaN
        const objectXInMeasure = finite(object.sourceLayout?.xInMeasure)
          ? Number(object.sourceLayout.xInMeasure)
          : NaN
        let objectX = x
        if (
          object.sourceLayout?.source === VISUAL_LAYOUT_SOURCE.SOURCE_VISUAL_MAP &&
          Number.isFinite(objectSourceX)
        ) {
          objectX = cursorX + clamp01(objectSourceX) * systemWidth
        } else if (Number.isFinite(objectXInMeasure)) {
          objectX =
            measureEntry.xStart +
            clamp01(objectXInMeasure) * (measureEntry.xEnd - measureEntry.xStart)
        }
        const objectId = object.visualNoteId ?? object.visualRestId ?? object.id
        if (objectId) objectXById.set(objectId, objectX)
      }
      timeAnchors.push({ timeSeconds: Number(group.timeSeconds), x, groupId: group.id })
    }

    systems.push({
      occurrence: systemOccurrence,
      page: first.sourceLayout?.page ?? 1,
      systemIndex: first.sourceLayout?.systemIndex ?? 0,
      repeatPass: first.repeatPass ?? 1,
      firstTimeSeconds: Number(first.timeSeconds ?? 0),
      lastTimeSeconds: Number(last.timeSeconds ?? first.timeSeconds ?? 0),
      xStart: cursorX,
      xEnd: cursorX + systemWidth,
      measureNumbers: measureEntries.map((entry) => entry.measureNumber),
      keySignature: firstKeySignature
        ? { ...firstKeySignature, cancelFifths: null }
        : null,
      timeSignature:
        measureEntries[0]?.layout?.beats && measureEntries[0]?.layout?.beatType
          ? {
              beats: measureEntries[0].layout.beats,
              beatType: measureEntries[0].layout.beatType,
            }
          : null,
    })
    cursorX += systemWidth + systemGap
  }

  const barlineXByTime = new Map()
  const count = Math.min(barlineTimes.length, orderedMeasures.length)
  for (let index = 0; index < count; index += 1) {
    const time = Number(barlineTimes[index])
    const x = orderedMeasures[index].xStart
    if (Number.isFinite(time) && Number.isFinite(x)) {
      barlineXByTime.set(timeKey(time), x)
    }
  }
  timeAnchors.sort(
    (left, right) => left.timeSeconds - right.timeSeconds || left.x - right.x,
  )

  return {
    mode: 'source-fidelity',
    pixelsPerSecond,
    groupXById,
    objectXById,
    barlineXByTime,
    timeAnchors,
    systems,
    measures: orderedMeasures.map((entry) => ({
      measureNumber: entry.measureNumber,
      repeatPass: entry.repeatPass,
      systemOccurrence: entry.systemOccurrence,
      xStart: entry.xStart,
      xEnd: entry.xEnd,
      layout: entry.layout,
    })),
    systemWidth,
    systemGap,
  }
}

export function resolveSourceFidelityGroupX(layout, group, timeSeconds = null) {
  const owned = layout?.groupXById?.get(group?.id)
  if (Number.isFinite(owned)) return owned
  return resolveSourceFidelityLaneX(
    layout,
    timeSeconds ?? group?.timeSeconds ?? 0,
  )
}

export function resolveSourceFidelityObjectX(
  layout,
  object,
  group,
  timeSeconds = null,
) {
  const objectId = object?.visualNoteId ?? object?.visualRestId ?? object?.id
  const owned = objectId ? layout?.objectXById?.get(objectId) : null
  if (Number.isFinite(owned)) return owned
  return resolveSourceFidelityGroupX(layout, group, timeSeconds)
}

export function resolveSourceFidelityBarlineX(layout, timeSeconds) {
  const owned = layout?.barlineXByTime?.get(timeKey(timeSeconds))
  if (Number.isFinite(owned)) return owned
  return resolveSourceFidelityLaneX(layout, timeSeconds)
}

export function resolveSourceFidelityLaneX(layout, timeSeconds) {
  const time = Number(timeSeconds ?? 0)
  if (layout?.mode !== 'source-fidelity' || !layout.timeAnchors?.length) {
    return time * (layout?.pixelsPerSecond ?? 120)
  }
  const anchors = layout.timeAnchors
  if (time <= anchors[0].timeSeconds) return anchors[0].x
  if (time >= anchors[anchors.length - 1].timeSeconds) {
    const last = anchors[anchors.length - 1]
    return last.x + Math.max(0, time - last.timeSeconds) * layout.pixelsPerSecond
  }
  let low = 0
  let high = anchors.length - 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (anchors[middle].timeSeconds <= time) low = middle
    else high = middle
  }
  const left = anchors[low]
  const right = anchors[high]
  if (!(right.timeSeconds > left.timeSeconds)) return Math.max(left.x, right.x)
  const progress = (time - left.timeSeconds) / (right.timeSeconds - left.timeSeconds)
  return left.x + (right.x - left.x) * progress
}
