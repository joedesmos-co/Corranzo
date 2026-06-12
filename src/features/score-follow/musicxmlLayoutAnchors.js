import { groupMeasuresBySystemBreaks } from './allocateMeasuresToSystems.js'
import { ANCHOR_SOURCE } from './anchorUtils.js'
import { createAnchorId } from './scoreFollowStorage.js'

const MIN_LAYOUT_COVERAGE = 0.55
const MIN_SYSTEM_MONOTONIC_RATIO = 0.8

function isAutoSystemStartAnchor(anchor) {
  const source = anchor?.source
  const role = anchor?.meta?.role
  if (role === 'system-end') {
    return false
  }
  return role === 'system-start' || source === ANCHOR_SOURCE.AUTO_SYSTEM || source === ANCHOR_SOURCE.AUTO
}

function isAutoSystemEndAnchor(anchor) {
  return anchor?.meta?.role === 'system-end'
}

/**
 * Per-measure minimum default-x from engraved note positions.
 */
export function collectMeasureDefaultXHints(timingMap) {
  const hints = new Map()
  for (const note of timingMap?.notes ?? []) {
    if (note.defaultX == null) {
      continue
    }
    const existing = hints.get(note.measureNumber)
    if (existing == null || note.defaultX < existing) {
      hints.set(note.measureNumber, note.defaultX)
    }
  }
  return hints
}

/**
 * Score whether MusicXML default-x is dense and monotonic enough for measure anchors.
 */
export function assessMusicXmlLayoutConfidence(timingMap) {
  const measureNumbers = timingMap?.measures?.map((measure) => measure.number) ?? []
  if (measureNumbers.length === 0) {
    return { ok: false, coverage: 0, monotonicRatio: 0 }
  }

  const hints = collectMeasureDefaultXHints(timingMap)
  const coverage = hints.size / measureNumbers.length
  if (coverage < MIN_LAYOUT_COVERAGE) {
    return { ok: false, coverage, monotonicRatio: 0 }
  }

  const groups = groupMeasuresBySystemBreaks(measureNumbers, timingMap)
  const layoutGroups = groups.length > 0 ? groups : [measureNumbers]
  let monotonicSystems = 0
  for (const group of layoutGroups) {
    const values = group
      .map((number) => hints.get(number))
      .filter((value) => value != null)
    if (values.length < 2) {
      monotonicSystems += 1
      continue
    }
    let monotonicSteps = 0
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] >= values[index - 1] - 0.5) {
        monotonicSteps += 1
      }
    }
    if (monotonicSteps / (values.length - 1) >= MIN_SYSTEM_MONOTONIC_RATIO) {
      monotonicSystems += 1
    }
  }

  const monotonicRatio =
    layoutGroups.length > 0 ? monotonicSystems / layoutGroups.length : 0
  const ok = coverage >= MIN_LAYOUT_COVERAGE && monotonicRatio >= MIN_SYSTEM_MONOTONIC_RATIO

  return { ok, coverage, monotonicRatio }
}

function pairSystemSpanAnchors(systemAnchors) {
  const sorted = [...systemAnchors].sort(
    (left, right) => left.measureNumber - right.measureNumber,
  )
  const spans = []
  let pendingStart = null

  for (const anchor of sorted) {
    if (anchor.meta?.role === 'system-start' || isAutoSystemStartAnchor(anchor)) {
      pendingStart = anchor
      continue
    }
    if (
      pendingStart &&
      (anchor.meta?.role === 'system-end' || isAutoSystemEndAnchor(anchor)) &&
      anchor.page === pendingStart.page
    ) {
      spans.push({ start: pendingStart, end: anchor })
      pendingStart = null
    }
  }

  return spans
}

function mapDefaultXToBand(measureNumbers, hints, startAnchor, endAnchor) {
  const values = measureNumbers
    .map((number) => ({ number, defaultX: hints.get(number) }))
    .filter((entry) => entry.defaultX != null)

  if (values.length === 0) {
    return []
  }

  const minX = Math.min(...values.map((entry) => entry.defaultX))
  const maxX = Math.max(...values.map((entry) => entry.defaultX))
  const range = maxX - minX

  return measureNumbers.map((number) => {
    const defaultX = hints.get(number)
    const t =
      defaultX == null || range < 1
        ? measureNumbers.indexOf(number) / Math.max(1, measureNumbers.length - 1)
        : (defaultX - minX) / range

    return {
      page: startAnchor.page,
      x: startAnchor.x + (endAnchor.x - startAnchor.x) * t,
      y: startAnchor.y + (endAnchor.y - startAnchor.y) * t * 0.12,
      measureNumber: number,
      source: ANCHOR_SOURCE.MUSICXML_LAYOUT,
      meta: {
        role: 'measure',
        layout: 'default-x',
        systemIndex: startAnchor.meta?.systemIndex,
      },
    }
  })
}

/**
 * Place measure anchors from MusicXML default-x inside existing semi-auto system spans.
 * Requires system-start/end anchors for y and horizontal extent.
 */
export function buildMusicXmlLayoutAnchors(timingMap, systemAnchors) {
  const assessment = assessMusicXmlLayoutConfidence(timingMap)
  if (!assessment.ok) {
    return []
  }

  const hints = collectMeasureDefaultXHints(timingMap)
  const spans = pairSystemSpanAnchors(
    systemAnchors.filter(
      (anchor) =>
        anchor.source === ANCHOR_SOURCE.AUTO_SYSTEM ||
        anchor.source === ANCHOR_SOURCE.AUTO ||
        anchor.source === ANCHOR_SOURCE.MUSICXML_LAYOUT,
    ),
  )

  if (spans.length === 0) {
    return []
  }

  const anchors = []
  for (const span of spans) {
    const measureNumbers = []
    for (
      let number = span.start.measureNumber;
      number <= span.end.measureNumber;
      number += 1
    ) {
      measureNumbers.push(number)
    }
    anchors.push(...mapDefaultXToBand(measureNumbers, hints, span.start, span.end))
  }

  return anchors
    .map((anchor) => ({
      ...anchor,
      id: anchor.id ?? createAnchorId(),
    }))
    .sort((left, right) => left.measureNumber - right.measureNumber)
}
