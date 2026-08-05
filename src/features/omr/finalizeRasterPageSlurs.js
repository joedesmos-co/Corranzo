/**
 * Raster page slur emission from event-pair-anchored ink arcs.
 *
 * Distinct from finalizeRasterPageTies:
 * - different pitches only (never emits tie marks)
 * - wider vertical search for phrase bows
 * - allows one intervening monophonic note under a cross-bar slur
 * - does not merge durations or suppress playback attacks
 */

import { isInk } from './omrInk.js'

const MIN_SLUR_DX_PX = 48
const MAX_SLUR_DX_PX = 230

function inkAt(imageData, x, y, threshold) {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) {
    return false
  }
  return isInk(imageData.data, (py * imageData.width + px) * 4, threshold)
}

function staffGapPx(note, measureBox, imageData) {
  const staffLines = measureBox?.staffLines
  const lineYs =
    note?.clef === 'bass' ? staffLines?.bass : staffLines?.treble ?? staffLines?.bass
  if (Array.isArray(lineYs) && lineYs.length >= 2) {
    const sorted = [...lineYs].sort((left, right) => left - right)
    const gaps = []
    for (let index = 1; index < sorted.length; index += 1) {
      gaps.push((sorted[index] - sorted[index - 1]) * imageData.height)
    }
    gaps.sort((left, right) => left - right)
    const median = gaps[Math.floor(gaps.length / 2)]
    if (Number.isFinite(median) && median > 4) {
      return median
    }
  }
  return 11
}

function isLaterOnset(left, right) {
  return (
    right.measureNumber > left.measureNumber ||
    (right.measureNumber === left.measureNumber &&
      right.startDivision > left.startDivision)
  )
}

function eventKey(ref) {
  return `${ref.measureNumber}:${ref.eventIndex}`
}

function flattenMonoInstances(measureRecords) {
  const instances = []
  for (const record of measureRecords) {
    for (let eventIndex = 0; eventIndex < (record.events ?? []).length; eventIndex += 1) {
      const event = record.events[eventIndex]
      if (event?.type !== 'note') continue
      const notes = event.notes ?? []
      if (notes.length !== 1) continue
      const note = notes[0]
      const beams = Number(note.beams ?? event.beams ?? 0) || 0
      if (beams > 0) continue
      if (
        !Number.isFinite(note.midi) ||
        !Number.isFinite(note.cx ?? event.cx) ||
        !Number.isFinite(note.cy)
      ) {
        continue
      }
      instances.push({
        measureNumber: record.measureNumber,
        systemIndex: record.systemIndex ?? 0,
        eventIndex,
        noteIndex: 0,
        startDivision: event.startDivision ?? 0,
        midi: note.midi,
        clef: note.clef ?? 'treble',
        cx: note.cx ?? event.cx,
        cy: note.cy,
        note,
        event,
      })
    }
  }
  return instances.sort(
    (left, right) =>
      left.measureNumber - right.measureNumber ||
      left.startDivision - right.startDivision ||
      left.cx - right.cx ||
      left.midi - right.midi,
  )
}

/**
 * Phrase-slur ink probe: wider vertical band than tie arcs, staff corridors excluded.
 */
export function probeRasterSlurWindow(
  imageData,
  fromNote,
  toNote,
  xStart,
  xEnd,
  measureBox,
  inkThreshold,
  options = {},
) {
  const coverageFloor = options.coverageFloor ?? 0.42
  const midFloor = options.midFloor ?? 0.55
  if (xEnd - xStart < 10) {
    return {
      passes: false,
      side: null,
      covered: { below: 0, above: 0 },
      midCovered: { below: 0, above: 0 },
      columns: 0,
      midColumns: 0,
      gap: 11,
    }
  }
  const yMid = (fromNote.cy + toNote.cy) / 2
  const gap = staffGapPx(fromNote, measureBox, imageData)
  const bandMin = Math.max(3, Math.round(gap * 0.25))
  const bandMax = Math.max(8, Math.round(gap * 2.2))

  const continuousRows = new Set()
  for (let offset = -(bandMax + 2); offset <= bandMax + 2; offset += 1) {
    const y = Math.round(yMid + offset)
    let ink = 0
    let total = 0
    for (let x = xStart; x <= xEnd; x += 1) {
      total += 1
      if (inkAt(imageData, x, y, inkThreshold)) ink += 1
    }
    if (total && ink / total >= 0.85) {
      continuousRows.add(y)
    }
  }
  const nearLineRow = (y) => {
    const row = Math.round(y)
    return (
      continuousRows.has(row) ||
      continuousRows.has(row - 1) ||
      continuousRows.has(row + 1)
    )
  }

  const midStart = xStart + (xEnd - xStart) / 3
  const midEnd = xEnd - (xEnd - xStart) / 3
  let columns = 0
  let midColumns = 0
  const covered = { below: 0, above: 0 }
  const midCovered = { below: 0, above: 0 }
  const inkYs = { below: [], above: [] }
  for (let x = xStart; x <= xEnd; x += 1) {
    columns += 1
    const inMiddle = x >= midStart && x <= midEnd
    if (inMiddle) midColumns += 1
    let belowY = null
    let aboveY = null
    for (let offset = bandMin; offset <= bandMax; offset += 1) {
      if (
        belowY == null &&
        !nearLineRow(yMid + offset) &&
        inkAt(imageData, x, yMid + offset, inkThreshold)
      ) {
        belowY = yMid + offset
      }
      if (
        aboveY == null &&
        !nearLineRow(yMid - offset) &&
        inkAt(imageData, x, yMid - offset, inkThreshold)
      ) {
        aboveY = yMid - offset
      }
      if (belowY != null && aboveY != null) break
    }
    if (belowY != null) {
      covered.below += 1
      inkYs.below.push(belowY)
      if (inMiddle) midCovered.below += 1
    }
    if (aboveY != null) {
      covered.above += 1
      inkYs.above.push(aboveY)
      if (inMiddle) midCovered.above += 1
    }
  }

  if (!columns || !midColumns) {
    return { passes: false, side: null, covered, midCovered, columns, midColumns, gap }
  }

  const sidePasses = (side) =>
    covered[side] / columns >= coverageFloor &&
    midCovered[side] / midColumns >= midFloor
  const sideCurves = (side) => {
    const ys = inkYs[side]
    if (ys.length < 6) return false
    let minY = ys[0]
    let maxY = ys[0]
    for (const y of ys) {
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    return maxY - minY >= 3
  }
  const belowRatio = covered.below / columns
  const aboveRatio = covered.above / columns
  const dominance = Math.abs(belowRatio - aboveRatio)

  let side = null
  if (dominance >= 0.12) {
    if (belowRatio >= aboveRatio && sidePasses('below') && sideCurves('below')) {
      side = 'below'
    } else if (aboveRatio > belowRatio && sidePasses('above') && sideCurves('above')) {
      side = 'above'
    }
  }

  return {
    passes: side != null,
    side,
    covered,
    midCovered,
    columns,
    midColumns,
    gap,
    dominance,
  }
}

function endpointSupport(imageData, note, side, towardX, inkThreshold, gap) {
  const near = Math.max(4, Math.round(gap * 0.45))
  const far = Math.max(10, Math.round(gap * 2.4))
  const direction = Math.sign(towardX - note.cx) || 1
  const reach = Math.min(gap * 1.8, Math.max(gap * 0.9, Math.abs(towardX - note.cx) * 0.4))
  const xStart = Math.round(note.cx + direction * 3)
  const xEnd = Math.round(note.cx + direction * Math.max(5, reach))
  const lo = Math.min(xStart, xEnd)
  const hi = Math.max(xStart, xEnd)
  let hits = 0
  let total = 0
  for (let x = lo; x <= hi; x += 1) {
    for (let depth = near; depth <= far; depth += 1) {
      total += 1
      const y = side === 'below' ? note.cy + depth : note.cy - depth
      if (inkAt(imageData, x, y, inkThreshold)) hits += 1
    }
  }
  return total > 0 ? hits / total : 0
}

function clearSlurMarks(measureRecords) {
  for (const record of measureRecords) {
    for (const event of record.events ?? []) {
      delete event.slurStart
      delete event.slurStop
      delete event.slurNumber
      delete event.slurPlacement
      for (const note of event.notes ?? []) {
        delete note.slurStart
        delete note.slurStop
        delete note.slurNumber
        delete note.slurPlacement
        delete note.slurProvenance
      }
    }
  }
}

function applySlurPair(measureRecords, pair, number) {
  const recordByMeasure = new Map(
    measureRecords.map((record) => [record.measureNumber, record]),
  )
  const fromRecord = recordByMeasure.get(pair.from.measureNumber)
  const toRecord = recordByMeasure.get(pair.to.measureNumber)
  const fromEvent = fromRecord?.events?.[pair.from.eventIndex]
  const toEvent = toRecord?.events?.[pair.to.eventIndex]
  const fromNote = fromEvent?.notes?.[pair.from.noteIndex]
  const toNote = toEvent?.notes?.[pair.to.noteIndex]
  if (!fromEvent || !toEvent || !fromNote || !toNote) {
    return false
  }
  const slurNumber = String(number)
  const placement = pair.side === 'below' ? 'below' : 'above'
  const provenance = {
    source: 'raster-ink-arc-slur',
    side: pair.side,
    score: pair.score,
    startSupport: pair.startSupport,
    stopSupport: pair.stopSupport,
    rejectedCompetitors: pair.rejectedCompetitors ?? [],
  }
  fromNote.slurStart = true
  fromNote.slurNumber = slurNumber
  fromNote.slurPlacement = placement
  fromNote.slurProvenance = provenance
  toNote.slurStop = true
  toNote.slurNumber = slurNumber
  toNote.slurPlacement = placement
  toNote.slurProvenance = provenance
  if ((fromEvent.notes?.length ?? 0) === 1) {
    fromEvent.slurStart = true
    fromEvent.slurNumber = slurNumber
    fromEvent.slurPlacement = placement
  }
  if ((toEvent.notes?.length ?? 0) === 1) {
    toEvent.slurStop = true
    toEvent.slurNumber = slurNumber
    toEvent.slurPlacement = placement
  }
  return true
}

/**
 * Detect and emit raster slurs for source-supported different-pitch curves.
 */
export function finalizeRasterPageSlurs({
  measureRecords = [],
  measureBoxByNumber = new Map(),
  imageData,
  inkThreshold,
} = {}) {
  if (!measureRecords.length || !imageData) {
    return {
      diagnostics: {
        candidateCount: 0,
        acceptedCount: 0,
        appliedSlurCount: 0,
        rejectedCount: 0,
      },
    }
  }

  clearSlurMarks(measureRecords)
  const instances = flattenMonoInstances(measureRecords)
  const raw = []

  for (let i = 0; i < instances.length; i += 1) {
    for (let j = i + 1; j < instances.length; j += 1) {
      const from = instances[i]
      const to = instances[j]
      if (!isLaterOnset(from, to)) continue
      if (from.clef !== to.clef) continue
      if (from.systemIndex !== to.systemIndex) continue
      if (from.midi === to.midi) continue
      if (to.measureNumber - from.measureNumber > 1) continue

      const dx = to.cx - from.cx
      if (dx < MIN_SLUR_DX_PX || dx > MAX_SLUR_DX_PX) continue

      let intervening = 0
      for (let k = i + 1; k < j; k += 1) {
        const mid = instances[k]
        if (mid.clef !== from.clef) continue
        if (isLaterOnset(from, mid) && isLaterOnset(mid, to)) {
          intervening += 1
        }
      }
      if (intervening > 1) continue

      const fromBox = measureBoxByNumber.get(from.measureNumber)
      if (!fromBox) continue
      const xStart = Math.ceil(from.cx + 8)
      const xEnd = Math.floor(to.cx - 8)
      const full = probeRasterSlurWindow(
        imageData,
        from,
        to,
        xStart,
        xEnd,
        fromBox,
        inkThreshold,
      )
      if (!full.passes) continue

      const startSupport = endpointSupport(
        imageData,
        from,
        full.side,
        to.cx,
        inkThreshold,
        full.gap,
      )
      const stopSupport = endpointSupport(
        imageData,
        to,
        full.side,
        from.cx,
        inkThreshold,
        full.gap,
      )
      if (startSupport < 0.03 || stopSupport < 0.03) {
        raw.push({
          from,
          to,
          accept: false,
          reason: 'weak-endpoint-support',
          startSupport,
          stopSupport,
          side: full.side,
        })
        continue
      }

      let crossHalfOk = true
      if (from.measureNumber !== to.measureNumber) {
        const toBox = measureBoxByNumber.get(to.measureNumber)
        if (!toBox) continue
        const barX = fromBox.x1 * imageData.width
        const left = probeRasterSlurWindow(
          imageData,
          from,
          to,
          xStart,
          Math.floor(barX - 4),
          fromBox,
          inkThreshold,
          { coverageFloor: 0.35, midFloor: 0.35 },
        )
        const right = probeRasterSlurWindow(
          imageData,
          from,
          to,
          Math.ceil(barX + 4),
          xEnd,
          toBox,
          inkThreshold,
          { coverageFloor: 0.35, midFloor: 0.35 },
        )
        crossHalfOk =
          (left.passes && left.side === full.side) ||
          (right.passes && right.side === full.side)
        if (!crossHalfOk) {
          raw.push({
            from,
            to,
            accept: false,
            reason: 'cross-bar-half-missing',
            side: full.side,
          })
          continue
        }
      }

      const score =
        full.covered[full.side] / full.columns +
        full.midCovered[full.side] / full.midColumns +
        (from.measureNumber !== to.measureNumber ? 0.35 : 0) +
        Math.min(startSupport, 0.2) +
        Math.min(stopSupport, 0.2) +
        Math.min(dx / 400, 0.4)

      raw.push({
        from,
        to,
        accept: true,
        side: full.side,
        score,
        startSupport,
        stopSupport,
        dx,
        intervening,
        dominance: full.dominance,
      })
    }
  }

  const candidates = raw.filter((entry) => entry.accept).sort((a, b) => b.score - a.score)
  const usedStart = new Set()
  const usedStop = new Set()
  const selected = []
  const rejectedCompetitors = []

  for (const candidate of candidates) {
    const startKey = eventKey(candidate.from)
    const stopKey = eventKey(candidate.to)
    if (
      usedStart.has(startKey) ||
      usedStop.has(stopKey) ||
      usedStart.has(stopKey) ||
      usedStop.has(startKey)
    ) {
      rejectedCompetitors.push({
        from: startKey,
        to: stopKey,
        reason: 'endpoint-conflict',
        score: candidate.score,
      })
      continue
    }
    usedStart.add(startKey)
    usedStop.add(stopKey)
    selected.push({
      ...candidate,
      rejectedCompetitors: rejectedCompetitors.filter(
        (item) => item.from === startKey || item.to === stopKey,
      ),
    })
  }

  let appliedSlurCount = 0
  for (const pair of selected) {
    if (applySlurPair(measureRecords, pair, appliedSlurCount + 1)) {
      appliedSlurCount += 1
    }
  }

  return {
    diagnostics: {
      candidateCount: candidates.length,
      acceptedCount: selected.length,
      appliedSlurCount,
      rejectedCount: raw.length - selected.length,
      pairs: selected.map((pair) => ({
        from: eventKey(pair.from),
        to: eventKey(pair.to),
        midiFrom: pair.from.midi,
        midiTo: pair.to.midi,
        side: pair.side,
        score: pair.score,
      })),
    },
  }
}
