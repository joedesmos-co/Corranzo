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

function emptyStructuralMarks() {
  return {
    repeats: [],
    endings: [],
    keySignatures: [],
    timeSignatures: [],
    clefs: [],
    systemClefs: [],
    dynamics: [],
    wedges: [],
    octaveShifts: [],
    pedals: [],
  }
}

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
      staffDistances: measure.staffDistances ?? null,
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
  const sourceMap = sourceMapLayout(
    note,
    sourceOwnership,
    sourceAnchorIndex,
    preferredRepresentation,
  )
  const musicXml = musicXmlLayout(note, measureLayout)
  if (sourceMap) {
    // PDF/source-map ownership is the strongest horizontal evidence, but its
    // page-normalized Y cannot safely be translated without a proven staff
    // origin. MusicXML default-y is independently staff-relative, so retain it
    // alongside the source-map X instead of throwing it away wholesale.
    return {
      ...sourceMap,
      verticalSource:
        musicXml?.defaultY != null ? VISUAL_LAYOUT_SOURCE.MUSICXML : null,
      defaultY: musicXml?.defaultY ?? null,
      relativeY: musicXml?.relativeY ?? null,
      musicXmlDefaultX: musicXml?.defaultX ?? null,
      musicXmlRelativeX: musicXml?.relativeX ?? null,
      musicXmlMeasureWidth: musicXml?.measureWidth ?? null,
    }
  }
  return (
    musicXml ?? {
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
      systemOccurrenceByGroupId: new Map(),
      systemOccurrenceByObjectId: new Map(),
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
  const systemOccurrenceByGroupId = new Map()
  const systemOccurrenceByObjectId = new Map()
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
      systemOccurrenceByGroupId.set(group.id, systemOccurrence)
      const sourceObjects = [
        ...(group.notes ?? []),
        ...(group.rests ?? []),
        ...(group.notes ?? []).flatMap((note) => note.graceNotesBefore ?? []),
      ]
      for (const object of sourceObjects) {
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
        if (objectId) {
          objectXById.set(objectId, objectX)
          systemOccurrenceByObjectId.set(objectId, systemOccurrence)
        }
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
      staffDistances:
        measureEntries.find((entry) => entry.layout?.staffDistances)?.layout
          ?.staffDistances ?? null,
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
    systemOccurrenceByGroupId,
    systemOccurrenceByObjectId,
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

export function resolveSourceFidelitySystem(layout, object = null, group = null) {
  if (layout?.mode !== 'source-fidelity') return null
  const objectId = object?.visualNoteId ?? object?.visualRestId ?? object?.id
  const occurrence =
    (objectId ? layout.systemOccurrenceByObjectId?.get(objectId) : null) ??
    layout.systemOccurrenceByGroupId?.get(group?.id)
  if (!Number.isFinite(occurrence)) return null
  return layout.systems?.find((system) => system.occurrence === occurrence) ?? null
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

/** Translate a MusicXML tenths delta inside the owning reconstructed measure. */
export function resolveSourceFidelityObjectDeltaX(layout, object, deltaTenths) {
  const delta = Number(deltaTenths)
  if (!Number.isFinite(delta)) return null
  if (layout?.mode !== 'source-fidelity') return delta
  const objectId = object?.visualNoteId ?? object?.visualRestId ?? object?.id
  const occurrence = objectId
    ? layout.systemOccurrenceByObjectId?.get(objectId)
    : null
  const measure = (layout.measures ?? []).find(
    (candidate) =>
      (occurrence == null || candidate.systemOccurrence === occurrence) &&
      Number(candidate.measureNumber) === Number(object?.measureNumber),
  )
  const sourceWidth = Number(
    object?.sourceLayout?.measureWidth ??
    object?.sourceLayout?.musicXmlMeasureWidth,
  )
  const renderedWidth = Number(measure?.xEnd) - Number(measure?.xStart)
  if (!(sourceWidth > 0) || !Number.isFinite(renderedWidth)) return null
  return (delta / sourceWidth) * renderedWidth
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

function writtenMeasureNumberForEvent(event, timingMap) {
  if (finite(event?.measureNumber)) return Number(event.measureNumber)
  const quarterTime = Number(event?.quarterTime)
  if (!Number.isFinite(quarterTime)) return null
  const measure = (timingMap?.measures ?? []).find(
    (candidate) =>
      quarterTime >= Number(candidate.startQuarters ?? 0) - 1e-9 &&
      quarterTime < Number(candidate.endQuarters ?? 0) - 1e-9,
  )
  return measure?.number ?? timingMap?.measures?.[0]?.number ?? null
}

function systemForMeasure(layout, measure) {
  return layout?.systems?.find(
    (system) => system.occurrence === measure.systemOccurrence,
  ) ?? null
}

function isSystemStart(layout, measure) {
  const system = systemForMeasure(layout, measure)
  return system && Math.abs(Number(measure.xStart) - Number(system.xStart)) < 1e-6
}

function primaryClefEvents(timingMap) {
  const events = (timingMap?.clefEvents ?? []).filter(
    (event) => event?.printObject !== false,
  )
  if (!events.length) return []
  const primaryPartId = timingMap?.parts?.[0]?.id ?? events[0]?.partId ?? null
  return events
    .filter((event) => primaryPartId == null || event.partId === primaryPartId)
    .sort(
      (left, right) =>
        Number(left.quarterTime ?? 0) - Number(right.quarterTime ?? 0) ||
        Number(left.staff ?? 1) - Number(right.staff ?? 1),
    )
}

function primaryDynamicEvents(timingMap) {
  const events = (timingMap?.dynamicEvents ?? []).filter(
    (event) => event?.printObject !== false && event?.mark,
  )
  if (!events.length) return []
  const primaryPartId = timingMap?.parts?.[0]?.id ?? events[0]?.partId ?? null
  return events
    .filter((event) => primaryPartId == null || event.partId === primaryPartId)
    .sort(
      (left, right) =>
        Number(left.quarterTime ?? 0) - Number(right.quarterTime ?? 0) ||
        Number(left.staff ?? 1) - Number(right.staff ?? 1),
    )
}

function primaryWedgeEvents(timingMap) {
  const events = timingMap?.wedgeEvents ?? []
  if (!events.length) return []
  const primaryPartId = timingMap?.parts?.[0]?.id ?? events[0]?.partId ?? null
  return events
    .filter((event) => primaryPartId == null || event.partId === primaryPartId)
    .sort(
      (left, right) =>
        Number(left.quarterTime ?? 0) - Number(right.quarterTime ?? 0) ||
        Number(left.sourceOrder ?? 0) - Number(right.sourceOrder ?? 0),
    )
}

function primaryOctaveShiftEvents(timingMap) {
  const events = timingMap?.octaveShiftEvents ?? []
  if (!events.length) return []
  const primaryPartId = timingMap?.parts?.[0]?.id ?? events[0]?.partId ?? null
  return events
    .filter((event) => primaryPartId == null || event.partId === primaryPartId)
    .sort(
      (left, right) =>
        Number(left.quarterTime ?? 0) - Number(right.quarterTime ?? 0) ||
        Number(left.sourceOrder ?? 0) - Number(right.sourceOrder ?? 0),
    )
}

function primaryPedalEvents(timingMap) {
  const events = timingMap?.pedalEvents ?? []
  if (!events.length) return []
  const primaryPartId = timingMap?.parts?.[0]?.id ?? events[0]?.partId ?? null
  return events
    .filter((event) => primaryPartId == null || event.partId === primaryPartId)
    .sort(
      (left, right) =>
        Number(left.quarterTime ?? 0) - Number(right.quarterTime ?? 0) ||
        Number(left.sourceOrder ?? 0) - Number(right.sourceOrder ?? 0),
    )
}

function clefXInMeasure(event, written, measure) {
  const width = Number(written?.engravedWidth)
  const defaultX = Number(event?.defaultX)
  const relativeX = Number(event?.relativeX)
  if (width > 0 && finite(event?.defaultX) && Number.isFinite(defaultX)) {
    const sourceX = defaultX + (Number.isFinite(relativeX) ? relativeX : 0)
    return measure.xStart + clamp01(sourceX / width) * (measure.xEnd - measure.xStart)
  }
  const start = Number(written?.startQuarters)
  const end = Number(written?.endQuarters)
  const quarterTime = Number(event?.quarterTime)
  if (Number.isFinite(quarterTime) && Number.isFinite(start) && end > start) {
    return measure.xStart + clamp01((quarterTime - start) / (end - start)) *
      (measure.xEnd - measure.xStart)
  }
  return measure.xStart
}

function directionXInMeasure(event, written, measure) {
  const width = Number(written?.engravedWidth)
  const defaultX = Number(event?.defaultX)
  const relativeX = Number(event?.relativeX)
  let sourceX = null
  if (width > 0 && finite(event?.defaultX) && Number.isFinite(defaultX)) {
    sourceX = defaultX
  } else {
    const start = Number(written?.startQuarters)
    const end = Number(written?.endQuarters)
    const quarterTime = Number(event?.quarterTime)
    if (Number.isFinite(quarterTime) && Number.isFinite(start) && end > start) {
      sourceX = ((quarterTime - start) / (end - start)) * width
    }
  }
  if (sourceX != null && width > 0) {
    if (finite(event?.relativeX) && Number.isFinite(relativeX)) sourceX += relativeX
    return measure.xStart + clamp01(sourceX / width) * (measure.xEnd - measure.xStart)
  }
  return measure.xStart
}

function directionPairKey(event) {
  return [
    event?.partId ?? 'primary',
    event?.staff ?? 'unspecified',
    event?.number ?? '1',
    event?.repeatPass ?? 1,
  ].join('|')
}

function pairNumberedDirectionEvents(events) {
  const openByKey = new Map()
  const spans = []
  for (const event of events) {
    const key = directionPairKey(event)
    if (event?.stage === 'start' && event.type) {
      const stack = openByKey.get(key) ?? []
      stack.push(event)
      openByKey.set(key, stack)
      continue
    }
    if (event?.stage === 'continue') {
      const stack = openByKey.get(key)
      if (stack?.length) {
        const open = stack[stack.length - 1]
        open.continuations = [...(open.continuations ?? []), event]
      }
      continue
    }
    if (event?.stage !== 'stop') continue
    const stack = openByKey.get(key)
    if (!stack?.length) continue
    const start = stack.pop()
    if (!stack.length) openByKey.delete(key)
    spans.push({ start, stop: event, type: start.type })
  }
  return spans
}

function splitProjectedWedgeSpan(span, layout) {
  if (span.start?.printObject === false) return []
  const startSystemIndex = (layout?.systems ?? []).findIndex(
    (system) => system.occurrence === span.start.systemOccurrence,
  )
  const stopSystemIndex = (layout?.systems ?? []).findIndex(
    (system) => system.occurrence === span.stop.systemOccurrence,
  )
  if (startSystemIndex < 0 || stopSystemIndex < startSystemIndex) return []
  const systems = layout.systems.slice(startSystemIndex, stopSystemIndex + 1)
  const pieces = systems
    .map((system, index) => ({
      system,
      xStart: index === 0 ? span.start.x : system.xStart,
      xEnd: index === systems.length - 1 ? span.stop.x : system.xEnd,
    }))
    .filter((piece) => Number(piece.xEnd) >= Number(piece.xStart))
  const totalWidth = pieces.reduce(
    (sum, piece) => sum + Math.max(0, piece.xEnd - piece.xStart),
    0,
  )
  let consumedWidth = 0
  const spanId = [
    `wedge-${span.start.sourceOrder ?? 0}`,
    `pass-${span.start.repeatPass ?? 1}`,
    `system-${span.start.systemOccurrence ?? 'unknown'}`,
  ].join('-')
  return pieces.map((piece, index) => {
    const pieceWidth = Math.max(0, piece.xEnd - piece.xStart)
    const progressStart = totalWidth > 0 ? consumedWidth / totalWidth : 0
    consumedWidth += pieceWidth
    const progressEnd = totalWidth > 0 ? consumedWidth / totalWidth : 1
    const apertureStart = span.type === 'crescendo' ? progressStart : 1 - progressStart
    const apertureEnd = span.type === 'crescendo' ? progressEnd : 1 - progressEnd
    return {
      id: `${spanId}-segment-${index}`,
      spanId,
      type: span.type,
      number: span.start.number ?? '1',
      partId: span.start.partId,
      staff: span.start.staff ?? span.stop.staff,
      placement: span.start.placement ?? span.stop.placement,
      printObject: span.start.printObject,
      niente: Boolean(span.start.niente || span.stop.niente),
      defaultY: span.start.defaultY ?? span.stop.defaultY,
      relativeY: span.start.relativeY ?? span.stop.relativeY,
      spread: span.start.spread ?? span.stop.spread,
      xStart: piece.xStart,
      xEnd: piece.xEnd,
      apertureStart,
      apertureEnd,
      repeatPass: span.start.repeatPass ?? 1,
      systemOccurrence: piece.system.occurrence,
      segmentIndex: index,
      segmentCount: pieces.length,
      sourceXModeStart: span.start.sourceXMode,
      sourceXModeEnd: span.stop.sourceXMode,
    }
  })
}

function buildSourceWedgeSegments(timingMap, layout, wedgeEvents, writtenMeasures) {
  const byMeasure = new Map()
  for (const event of wedgeEvents) {
    const number = writtenMeasureNumberForEvent(event, timingMap)
    if (number == null) continue
    const events = byMeasure.get(Number(number)) ?? []
    events.push(event)
    byMeasure.set(Number(number), events)
  }
  const projected = []
  for (const measure of layout.measures ?? []) {
    const written = writtenMeasures.get(Number(measure.measureNumber))
    for (const event of byMeasure.get(Number(measure.measureNumber)) ?? []) {
      projected.push({
        ...event,
        x: directionXInMeasure(event, written, measure),
        repeatPass: measure.repeatPass,
        systemOccurrence: measure.systemOccurrence,
        sourceXMode:
          finite(event.defaultX) && Number(written?.engravedWidth) > 0
            ? 'musicxml-default-x'
            : finite(event.relativeX) && Number(written?.engravedWidth) > 0
              ? 'semantic-onset-plus-relative-x'
              : 'semantic-onset-fallback',
      })
    }
  }
  return pairNumberedDirectionEvents(projected).flatMap((span) =>
    splitProjectedWedgeSpan(span, layout),
  )
}

function buildTemporalWedgeSegments(wedgeEvents, pixelsPerSecond) {
  const projected = wedgeEvents.map((event) => ({
    ...event,
    x: Number(event.timeSeconds ?? 0) * pixelsPerSecond,
    repeatPass: 1,
    systemOccurrence: null,
    sourceXMode: 'temporal-fallback',
  }))
  return pairNumberedDirectionEvents(projected)
    .filter((span) => span.start?.printObject !== false)
    .map((span, index) => ({
      id: `wedge-${span.start.sourceOrder ?? index}-temporal`,
      spanId: `wedge-${span.start.sourceOrder ?? index}-temporal`,
      type: span.type,
      number: span.start.number ?? '1',
      partId: span.start.partId,
      staff: span.start.staff ?? span.stop.staff,
      placement: span.start.placement ?? span.stop.placement,
      printObject: span.start.printObject,
      niente: Boolean(span.start.niente || span.stop.niente),
      defaultY: span.start.defaultY ?? span.stop.defaultY,
      relativeY: span.start.relativeY ?? span.stop.relativeY,
      spread: span.start.spread ?? span.stop.spread,
      xStart: span.start.x,
      xEnd: span.stop.x,
      apertureStart: span.type === 'crescendo' ? 0 : 1,
      apertureEnd: span.type === 'crescendo' ? 1 : 0,
      repeatPass: 1,
      systemOccurrence: null,
      segmentIndex: 0,
      segmentCount: 1,
      sourceXModeStart: 'temporal-fallback',
      sourceXModeEnd: 'temporal-fallback',
    }))
}

function splitProjectedOctaveShiftSpan(span, layout) {
  if (span.start?.printObject === false) return []
  const startSystemIndex = (layout?.systems ?? []).findIndex(
    (system) => system.occurrence === span.start.systemOccurrence,
  )
  const stopSystemIndex = (layout?.systems ?? []).findIndex(
    (system) => system.occurrence === span.stop.systemOccurrence,
  )
  if (startSystemIndex < 0 || stopSystemIndex < startSystemIndex) return []
  const systems = layout.systems.slice(startSystemIndex, stopSystemIndex + 1)
  const spanId = [
    `octave-shift-${span.start.sourceOrder ?? 0}`,
    `pass-${span.start.repeatPass ?? 1}`,
    `system-${span.start.systemOccurrence ?? 'unknown'}`,
  ].join('-')
  return systems
    .map((system, index) => ({
      id: `${spanId}-segment-${index}`,
      spanId,
      type: span.type,
      number: span.start.number ?? '1',
      size: span.start.size ?? span.stop.size ?? 8,
      partId: span.start.partId,
      staff: span.start.staff ?? span.stop.staff,
      placement: span.start.placement ?? span.stop.placement,
      printObject: span.start.printObject,
      defaultY: span.start.defaultY ?? span.stop.defaultY,
      relativeY: span.start.relativeY ?? span.stop.relativeY,
      dashLength: span.start.dashLength ?? span.stop.dashLength,
      spaceLength: span.start.spaceLength ?? span.stop.spaceLength,
      xStart: index === 0 ? span.start.x : system.xStart,
      xEnd: index === systems.length - 1 ? span.stop.x : system.xEnd,
      repeatPass: span.start.repeatPass ?? 1,
      systemOccurrence: system.occurrence,
      segmentIndex: index,
      segmentCount: systems.length,
      showLabel: index === 0,
      showHook: index === systems.length - 1,
      sourceXModeStart: span.start.sourceXMode,
      sourceXModeEnd: span.stop.sourceXMode,
    }))
    .filter((segment) => Number(segment.xEnd) >= Number(segment.xStart))
}

function buildSourceOctaveShiftSegments(
  timingMap,
  layout,
  octaveShiftEvents,
  writtenMeasures,
) {
  const byMeasure = new Map()
  for (const event of octaveShiftEvents) {
    const number = writtenMeasureNumberForEvent(event, timingMap)
    if (number == null) continue
    const events = byMeasure.get(Number(number)) ?? []
    events.push(event)
    byMeasure.set(Number(number), events)
  }
  const projected = []
  for (const measure of layout.measures ?? []) {
    const written = writtenMeasures.get(Number(measure.measureNumber))
    for (const event of byMeasure.get(Number(measure.measureNumber)) ?? []) {
      projected.push({
        ...event,
        x: directionXInMeasure(event, written, measure),
        repeatPass: measure.repeatPass,
        systemOccurrence: measure.systemOccurrence,
        sourceXMode:
          finite(event.defaultX) && Number(written?.engravedWidth) > 0
            ? 'musicxml-default-x'
            : finite(event.relativeX) && Number(written?.engravedWidth) > 0
              ? 'semantic-onset-plus-relative-x'
              : 'semantic-onset-fallback',
      })
    }
  }
  return pairNumberedDirectionEvents(projected).flatMap((span) =>
    splitProjectedOctaveShiftSpan(span, layout),
  )
}

function buildTemporalOctaveShiftSegments(octaveShiftEvents, pixelsPerSecond) {
  const projected = octaveShiftEvents.map((event) => ({
    ...event,
    x: Number(event.timeSeconds ?? 0) * pixelsPerSecond,
    repeatPass: 1,
    systemOccurrence: null,
    sourceXMode: 'temporal-fallback',
  }))
  return pairNumberedDirectionEvents(projected)
    .filter((span) => span.start?.printObject !== false)
    .map((span, index) => {
      const spanId = `octave-shift-${span.start.sourceOrder ?? index}-temporal`
      return {
        id: spanId,
        spanId,
        type: span.type,
        number: span.start.number ?? '1',
        size: span.start.size ?? span.stop.size ?? 8,
        partId: span.start.partId,
        staff: span.start.staff ?? span.stop.staff,
        placement: span.start.placement ?? span.stop.placement,
        printObject: span.start.printObject,
        defaultY: span.start.defaultY ?? span.stop.defaultY,
        relativeY: span.start.relativeY ?? span.stop.relativeY,
        dashLength: span.start.dashLength ?? span.stop.dashLength,
        spaceLength: span.start.spaceLength ?? span.stop.spaceLength,
        xStart: span.start.x,
        xEnd: span.stop.x,
        repeatPass: 1,
        systemOccurrence: null,
        segmentIndex: 0,
        segmentCount: 1,
        showLabel: true,
        showHook: true,
        sourceXModeStart: 'temporal-fallback',
        sourceXModeEnd: 'temporal-fallback',
      }
    })
}

function pairPedalDirectionEvents(events) {
  const openByKey = new Map()
  const spans = []
  for (const event of events) {
    const key = directionPairKey(event)
    if (event.stage === 'start') {
      const previous = openByKey.get(key)
      if (previous) {
        spans.push({ start: previous, stop: event, endStage: 'change' })
      }
      openByKey.set(key, event)
      continue
    }
    if (event.stage === 'continue') {
      const open = openByKey.get(key)
      if (open) open.continuations = [...(open.continuations ?? []), event]
      continue
    }
    if (event.stage === 'change') {
      const open = openByKey.get(key)
      if (!open) continue
      spans.push({ start: open, stop: event, endStage: 'change' })
      openByKey.set(key, {
        ...event,
        stage: 'start',
        sign: false,
        line: Boolean(event.line || open.line),
        startedByChange: true,
      })
      continue
    }
    if (event.stage !== 'stop') continue
    const open = openByKey.get(key)
    if (!open) continue
    openByKey.delete(key)
    spans.push({ start: open, stop: event, endStage: 'stop' })
  }
  return spans
}

function splitProjectedPedalSpan(span, layout) {
  if (span.start?.printObject === false) return []
  const startSystemIndex = (layout?.systems ?? []).findIndex(
    (system) => system.occurrence === span.start.systemOccurrence,
  )
  const stopSystemIndex = (layout?.systems ?? []).findIndex(
    (system) => system.occurrence === span.stop.systemOccurrence,
  )
  if (startSystemIndex < 0 || stopSystemIndex < startSystemIndex) return []
  const systems = layout.systems.slice(startSystemIndex, stopSystemIndex + 1)
  const spanId = [
    `pedal-${span.start.sourceOrder ?? 0}`,
    `pass-${span.start.repeatPass ?? 1}`,
    `system-${span.start.systemOccurrence ?? 'unknown'}`,
  ].join('-')
  return systems
    .map((system, index) => ({
      id: `${spanId}-segment-${index}`,
      spanId,
      partId: span.start.partId,
      staff: span.start.staff ?? span.stop.staff,
      number: span.start.number ?? '1',
      placement: span.start.placement ?? span.stop.placement ?? 'below',
      printObject: span.start.printObject,
      line: Boolean(span.start.line || span.stop.line),
      sign: span.start.sign !== false,
      abbreviated: Boolean(span.start.abbreviated),
      defaultY: span.start.defaultY ?? span.stop.defaultY,
      relativeY: span.start.relativeY ?? span.stop.relativeY,
      xStart: index === 0 ? span.start.x : system.xStart,
      xEnd: index === systems.length - 1 ? span.stop.x : system.xEnd,
      repeatPass: span.start.repeatPass ?? 1,
      systemOccurrence: system.occurrence,
      segmentIndex: index,
      segmentCount: systems.length,
      showLabel: index === 0 && span.start.sign !== false && !span.start.startedByChange,
      showChangeStart: index === 0 && Boolean(span.start.startedByChange),
      showChangeEnd: index === systems.length - 1 && span.endStage === 'change',
      showRelease: index === systems.length - 1 && span.endStage === 'stop',
      sourceXModeStart: span.start.sourceXMode,
      sourceXModeEnd: span.stop.sourceXMode,
    }))
    .filter((segment) => Number(segment.xEnd) >= Number(segment.xStart))
}

function buildSourcePedalSegments(timingMap, layout, pedalEvents, writtenMeasures) {
  const byMeasure = new Map()
  for (const event of pedalEvents) {
    const number = writtenMeasureNumberForEvent(event, timingMap)
    if (number == null) continue
    const events = byMeasure.get(Number(number)) ?? []
    events.push(event)
    byMeasure.set(Number(number), events)
  }
  const projected = []
  for (const measure of layout.measures ?? []) {
    const written = writtenMeasures.get(Number(measure.measureNumber))
    for (const event of byMeasure.get(Number(measure.measureNumber)) ?? []) {
      projected.push({
        ...event,
        x: directionXInMeasure(event, written, measure),
        repeatPass: measure.repeatPass,
        systemOccurrence: measure.systemOccurrence,
        sourceXMode:
          finite(event.defaultX) && Number(written?.engravedWidth) > 0
            ? 'musicxml-default-x'
            : finite(event.relativeX) && Number(written?.engravedWidth) > 0
              ? 'semantic-onset-plus-relative-x'
              : 'semantic-onset-fallback',
      })
    }
  }
  return pairPedalDirectionEvents(projected).flatMap((span) =>
    splitProjectedPedalSpan(span, layout),
  )
}

function buildTemporalPedalSegments(pedalEvents, pixelsPerSecond) {
  const projected = pedalEvents.map((event) => ({
    ...event,
    x: Number(event.timeSeconds ?? 0) * pixelsPerSecond,
    repeatPass: 1,
    systemOccurrence: null,
    sourceXMode: 'temporal-fallback',
  }))
  return pairPedalDirectionEvents(projected)
    .filter((span) => span.start?.printObject !== false)
    .map((span, index) => ({
      id: `pedal-${span.start.sourceOrder ?? index}-temporal`,
      spanId: `pedal-${span.start.sourceOrder ?? index}-temporal`,
      partId: span.start.partId,
      staff: span.start.staff ?? span.stop.staff,
      number: span.start.number ?? '1',
      placement: span.start.placement ?? span.stop.placement ?? 'below',
      printObject: span.start.printObject,
      line: Boolean(span.start.line || span.stop.line),
      sign: span.start.sign !== false,
      abbreviated: Boolean(span.start.abbreviated),
      defaultY: span.start.defaultY ?? span.stop.defaultY,
      relativeY: span.start.relativeY ?? span.stop.relativeY,
      xStart: span.start.x,
      xEnd: span.stop.x,
      repeatPass: 1,
      systemOccurrence: null,
      segmentIndex: 0,
      segmentCount: 1,
      showLabel: span.start.sign !== false && !span.start.startedByChange,
      showChangeStart: Boolean(span.start.startedByChange),
      showChangeEnd: span.endStage === 'change',
      showRelease: span.endStage === 'stop',
      sourceXModeStart: 'temporal-fallback',
      sourceXModeEnd: 'temporal-fallback',
    }))
}

function clefsAtQuarter(clefEvents, quarterTime) {
  const activeByStaff = new Map()
  for (const event of clefEvents) {
    if (Number(event.quarterTime) > quarterTime + 1e-9) break
    activeByStaff.set(Number(event.staff ?? 1), event)
  }
  return [...activeByStaff.values()]
}

function buildSystemClefs(timingMap, layout, clefEvents) {
  if (!clefEvents.length) return []
  return (layout?.systems ?? []).flatMap((system) => {
    const firstMeasure = layout.measures.find(
      (measure) => measure.systemOccurrence === system.occurrence,
    )
    const startQuarter = Number(firstMeasure?.layout?.startQuarters)
    if (!Number.isFinite(startQuarter)) return []
    return clefsAtQuarter(clefEvents, startQuarter).map((event) => ({
      ...event,
      id: `system-clef-${system.occurrence}-staff-${event.staff}`,
      systemOccurrence: system.occurrence,
      sourceSystemIndex: system.systemIndex,
    }))
  })
}

/**
 * Project written structural symbols onto source-derived measure boundaries.
 * The marks contain semantic symbol identity plus reconstructed coordinates;
 * the renderer still draws native SVG/text glyphs and never source pixels.
 */
export function buildSourceFidelityStructuralMarks(timingMap, layout) {
  const dynamicEvents = primaryDynamicEvents(timingMap)
  const wedgeEvents = primaryWedgeEvents(timingMap)
  const octaveShiftEvents = primaryOctaveShiftEvents(timingMap)
  const pedalEvents = primaryPedalEvents(timingMap)
  if (layout?.mode !== 'source-fidelity' || !layout.measures?.length) {
    const result = emptyStructuralMarks()
    result.dynamics = dynamicEvents.map((event, index) => ({
      ...event,
      id: `dynamic-${event.measureNumber ?? 'unknown'}-${index}`,
      x: Number(event.timeSeconds ?? 0) * Number(layout?.pixelsPerSecond ?? 120),
      systemOccurrence: null,
      repeatPass: 1,
      sourceXMode: 'temporal-fallback',
    }))
    result.wedges = buildTemporalWedgeSegments(
      wedgeEvents,
      Number(layout?.pixelsPerSecond ?? 120),
    )
    result.octaveShifts = buildTemporalOctaveShiftSegments(
      octaveShiftEvents,
      Number(layout?.pixelsPerSecond ?? 120),
    )
    result.pedals = buildTemporalPedalSegments(
      pedalEvents,
      Number(layout?.pixelsPerSecond ?? 120),
    )
    return result
  }

  const result = emptyStructuralMarks()
  const writtenMeasures = new Map(
    (timingMap?.measures ?? []).map((measure) => [Number(measure.number), measure]),
  )
  result.wedges = buildSourceWedgeSegments(
    timingMap,
    layout,
    wedgeEvents,
    writtenMeasures,
  )
  result.octaveShifts = buildSourceOctaveShiftSegments(
    timingMap,
    layout,
    octaveShiftEvents,
    writtenMeasures,
  )
  result.pedals = buildSourcePedalSegments(
    timingMap,
    layout,
    pedalEvents,
    writtenMeasures,
  )
  const keyEventsByMeasure = new Map()
  for (const event of timingMap?.keySignatures ?? []) {
    const number = writtenMeasureNumberForEvent(event, timingMap)
    if (number != null) keyEventsByMeasure.set(Number(number), event)
  }
  const timeEventsByMeasure = new Map()
  for (const event of timingMap?.timeSignatures ?? []) {
    const number = writtenMeasureNumberForEvent(event, timingMap)
    if (number != null) timeEventsByMeasure.set(Number(number), event)
  }
  const clefEvents = primaryClefEvents(timingMap)
  result.systemClefs = buildSystemClefs(timingMap, layout, clefEvents)

  let activeEnding = null
  for (let index = 0; index < layout.measures.length; index += 1) {
    const measure = layout.measures[index]
    const previous = layout.measures[index - 1] ?? null
    const written = writtenMeasures.get(Number(measure.measureNumber))
    const marking = written?.marking ?? null
    const system = systemForMeasure(layout, measure)

    for (const [dynamicIndex, event] of dynamicEvents.entries()) {
      const eventMeasureNumber = writtenMeasureNumberForEvent(event, timingMap)
      if (Number(eventMeasureNumber) !== Number(measure.measureNumber)) continue
      result.dynamics.push({
        ...event,
        id: `dynamic-${measure.measureNumber}-${dynamicIndex}-pass-${measure.repeatPass}`,
        x: clefXInMeasure(event, written, measure),
        repeatPass: measure.repeatPass,
        systemOccurrence: measure.systemOccurrence,
        sourceXMode:
          finite(event.defaultX) && Number(written?.engravedWidth) > 0
            ? 'musicxml-default-x'
            : 'semantic-onset-fallback',
      })
    }

    if (
      activeEnding &&
      previous &&
      (previous.repeatPass !== measure.repeatPass ||
        previous.systemOccurrence !== measure.systemOccurrence)
    ) {
      const previousSystem = systemForMeasure(layout, previous)
      result.endings.push({
        ...activeEnding,
        id: `${activeEnding.id}-segment-${result.endings.length}`,
        xEnd: previousSystem?.xEnd ?? previous.xEnd,
        continued: activeEnding.continued,
      })
      if (previous.repeatPass !== measure.repeatPass) {
        activeEnding = null
      } else {
        activeEnding = {
          ...activeEnding,
          xStart: system?.xStart ?? measure.xStart,
          systemOccurrence: measure.systemOccurrence,
          continued: true,
        }
      }
    }

    if (marking?.endingStartNumbers?.length) {
      if (activeEnding) {
        result.endings.push({
          ...activeEnding,
          id: `${activeEnding.id}-segment-${result.endings.length}`,
          xEnd: measure.xStart,
        })
      }
      activeEnding = {
        id: `ending-${measure.measureNumber}-pass-${measure.repeatPass}`,
        numbers: [...marking.endingStartNumbers],
        repeatPass: measure.repeatPass,
        systemOccurrence: measure.systemOccurrence,
        xStart: measure.xStart,
        continued: false,
      }
    }

    if (marking?.forwardRepeat) {
      result.repeats.push({
        id: `repeat-forward-${measure.measureNumber}-pass-${measure.repeatPass}`,
        direction: 'forward',
        x: measure.xStart,
        systemOccurrence: measure.systemOccurrence,
      })
    }
    if (marking?.backwardRepeat) {
      result.repeats.push({
        id: `repeat-backward-${measure.measureNumber}-pass-${measure.repeatPass}`,
        direction: 'backward',
        times: marking.backwardRepeatTimes ?? null,
        x: measure.xEnd,
        systemOccurrence: measure.systemOccurrence,
      })
    }

    if (activeEnding && (marking?.endingStop || marking?.endingDiscontinue)) {
      result.endings.push({
        ...activeEnding,
        id: `${activeEnding.id}-segment-${result.endings.length}`,
        xEnd: measure.xEnd,
        discontinue: Boolean(marking.endingDiscontinue),
      })
      activeEnding = null
    }

    if (!isSystemStart(layout, measure)) {
      const keySignature = keyEventsByMeasure.get(Number(measure.measureNumber))
      if (keySignature) {
        result.keySignatures.push({
          id: `key-${measure.measureNumber}-pass-${measure.repeatPass}`,
          ...keySignature,
          x: measure.xStart,
          systemOccurrence: measure.systemOccurrence,
          clefs: clefsAtQuarter(
            clefEvents,
            Number(keySignature.quarterTime ?? written?.startQuarters ?? 0),
          ),
        })
      }
      const timeSignature = timeEventsByMeasure.get(Number(measure.measureNumber))
      if (timeSignature) {
        result.timeSignatures.push({
          id: `time-${measure.measureNumber}-pass-${measure.repeatPass}`,
          ...timeSignature,
          x: measure.xStart,
          systemOccurrence: measure.systemOccurrence,
        })
      }
    }

    for (const event of clefEvents) {
      if (!event.changed) continue
      const eventMeasureNumber = writtenMeasureNumberForEvent(event, timingMap)
      if (Number(eventMeasureNumber) !== Number(measure.measureNumber)) continue
      const atSystemStart =
        isSystemStart(layout, measure) &&
        Math.abs(
          Number(event.quarterTime) - Number(written?.startQuarters),
        ) < 1e-9
      if (atSystemStart) continue
      result.clefs.push({
        ...event,
        id: `clef-${measure.measureNumber}-staff-${event.staff}-q-${event.quarterTime}-pass-${measure.repeatPass}`,
        x: clefXInMeasure(event, written, measure),
        repeatPass: measure.repeatPass,
        systemOccurrence: measure.systemOccurrence,
      })
    }
  }

  if (activeEnding) {
    const lastMeasure = layout.measures[layout.measures.length - 1]
    const lastSystem = systemForMeasure(layout, lastMeasure)
    result.endings.push({
      ...activeEnding,
      id: `${activeEnding.id}-segment-${result.endings.length}`,
      xEnd: lastSystem?.xEnd ?? lastMeasure.xEnd,
    })
  }

  return result
}
