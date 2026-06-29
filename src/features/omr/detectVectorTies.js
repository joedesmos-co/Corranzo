import { detectTieToNext } from './detectNoteRhythmFeatures.js'
import { isInk } from './omrInk.js'
import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'

export const TIE_BEGIN_GLYPH = '\ue8e2'
export const TIE_END_GLYPH = '\ue8e3'
export const SLUR_BEGIN_GLYPH = '\ue8e4'
export const SLUR_END_GLYPH = '\ue8e5'

const MAX_SAME_MEASURE_TIE_PX = 96
const MAX_CROSS_MEASURE_TIE_PX = 140

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function measureBounds(measureBox, imageData) {
  return {
    left: measureBox.x0 * imageData.width,
    right: measureBox.x1 * imageData.width,
  }
}

function flattenMeasureNotes(measureRecords) {
  const instances = []
  for (const record of measureRecords) {
    for (let eventIndex = 0; eventIndex < (record.events ?? []).length; eventIndex += 1) {
      const event = record.events[eventIndex]
      if (event.type !== 'note') {
        continue
      }
      for (let noteIndex = 0; noteIndex < (event.notes ?? []).length; noteIndex += 1) {
        const note = event.notes[noteIndex]
        instances.push({
          measureNumber: record.measureNumber,
          eventIndex,
          noteIndex,
          startDivision: event.startDivision ?? 0,
          midi: note.midi,
          clef: note.clef,
          cx: note.cx ?? event.cx,
          cy: note.cy,
        })
      }
    }
  }
  return instances.sort(
    (left, right) =>
      left.measureNumber - right.measureNumber ||
      left.startDivision - right.startDivision ||
      left.clef.localeCompare(right.clef) ||
      left.cx - right.cx,
  )
}

function findNextSamePitchInstance(instances, fromIndex) {
  const current = instances[fromIndex]
  for (let index = fromIndex + 1; index < instances.length; index += 1) {
    const candidate = instances[index]
    if (candidate.clef !== current.clef) {
      continue
    }
    if (candidate.midi !== current.midi) {
      continue
    }
    if (candidate.measureNumber < current.measureNumber) {
      continue
    }
    if (
      candidate.measureNumber === current.measureNumber &&
      candidate.startDivision <= current.startDivision
    ) {
      continue
    }
    return { instance: candidate, index }
  }
  return null
}

function detectInkArcBetween(imageData, fromNote, toNote, measureBox, inkThreshold) {
  const bounds = measureBounds(measureBox, imageData)
  const dx = Math.abs(toNote.cx - fromNote.cx)
  if (dx <= 22) {
    return detectTieToNext(imageData, fromNote.cx, fromNote.cy, inkThreshold, bounds)
  }

  const x0 = Math.min(fromNote.cx, toNote.cx) + 4
  const x1 = Math.max(fromNote.cx, toNote.cx) + 10
  const yMid = (fromNote.cy + toNote.cy) / 2
  let arcInk = 0
  for (let x = x0; x <= x1; x += 2) {
    for (let y = yMid - 8; y <= yMid + 2; y += 1) {
      if (inkAt(imageData, x, y, inkThreshold)) {
        arcInk += 1
      }
    }
  }
  const maxSpan =
    fromNote.measureNumber === toNote.measureNumber
      ? MAX_SAME_MEASURE_TIE_PX
      : MAX_CROSS_MEASURE_TIE_PX
  return dx <= maxSpan && arcInk >= 4 && arcInk <= 72
}

function nearestInstance(instances, glyph, imageData) {
  let best = null
  let bestScore = Infinity
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index]
    const dx = Math.abs(instance.cx - glyph.x)
    const dy = Math.abs(instance.cy - glyph.y)
    if (dx > 28 || dy > 18) {
      continue
    }
    const score = dx + dy * 1.5
    if (score < bestScore) {
      bestScore = score
      best = { instance, index }
    }
  }
  return best
}

function pairControlGlyphs(glyphs, instances, imageData, measureBoxByNumber) {
  const begins = []
  const ends = []
  for (const glyph of glyphs) {
    if (glyph.text === TIE_BEGIN_GLYPH) {
      begins.push(glyph)
    } else if (glyph.text === TIE_END_GLYPH) {
      ends.push(glyph)
    }
  }

  const pairs = []
  const usedEnds = new Set()
  for (const begin of begins) {
    let bestEnd = null
    let bestScore = Infinity
    for (const end of ends) {
      if (usedEnds.has(end)) {
        continue
      }
      const dx = end.x - begin.x
      const dy = Math.abs(end.y - begin.y)
      if (dx <= 0 || dx > MAX_CROSS_MEASURE_TIE_PX || dy > 24) {
        continue
      }
      const score = dx + dy * 2
      if (score < bestScore) {
        bestScore = score
        bestEnd = end
      }
    }
    if (!bestEnd) {
      continue
    }
    usedEnds.add(bestEnd)
    const from = nearestInstance(instances, begin, imageData)
    const to = nearestInstance(instances, bestEnd, imageData)
    if (!from || !to || from.index >= to.index) {
      continue
    }
    if (from.instance.midi !== to.instance.midi) {
      continue
    }
    if (from.instance.clef !== to.instance.clef) {
      continue
    }
    pairs.push({
      from: from.instance,
      to: to.instance,
      source: 'control-glyph',
      measureBoxByNumber,
    })
  }
  return pairs
}

function countUncertainSlurs(glyphs, instances, imageData, inkThreshold, measureBoxByNumber) {
  let count = 0
  if (glyphs.some((glyph) => glyph.text === SLUR_BEGIN_GLYPH || glyph.text === SLUR_END_GLYPH)) {
    count += glyphs.filter(
      (glyph) => glyph.text === SLUR_BEGIN_GLYPH || glyph.text === SLUR_END_GLYPH,
    ).length
  }

  for (let index = 0; index < instances.length - 1; index += 1) {
    const current = instances[index]
    const next = instances[index + 1]
    if (current.measureNumber !== next.measureNumber) {
      continue
    }
    if (current.clef !== next.clef) {
      continue
    }
    if (current.midi === next.midi) {
      continue
    }
    const box = measureBoxByNumber.get(current.measureNumber)
    if (!box) {
      continue
    }
    if (detectInkArcBetween(imageData, current, next, box, inkThreshold)) {
      count += 1
    }
  }
  return count
}

function eventRefKey(ref) {
  return `${ref.measureNumber}:${ref.eventIndex}`
}

function canTieEvents(fromEvent, toEvent) {
  return (
    (fromEvent?.notes?.length ?? 0) === 1 &&
    (toEvent?.notes?.length ?? 0) === 1
  )
}

function applyTieMarks(measureRecords, tiePairs) {
  const recordByMeasure = new Map(measureRecords.map((record) => [record.measureNumber, record]))
  const applied = new Set()

  for (const pair of tiePairs) {
    const key = `${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`
    if (applied.has(key)) {
      continue
    }
    const fromRecord = recordByMeasure.get(pair.from.measureNumber)
    const toRecord = recordByMeasure.get(pair.to.measureNumber)
    const fromEvent = fromRecord?.events?.[pair.from.eventIndex]
    const toEvent = toRecord?.events?.[pair.to.eventIndex]
    if (!fromEvent || !toEvent || !canTieEvents(fromEvent, toEvent)) {
      continue
    }
    fromEvent.tieStart = true
    toEvent.tieStop = true
    applied.add(key)
  }

  return applied.size
}

/**
 * Detect and apply conservative tie links for vector OMR measures.
 */
export function applyVectorPageTies({
  measureRecords = [],
  measureBoxByNumber = new Map(),
  glyphs = [],
  imageData = null,
  inkThreshold = 170,
} = {}) {
  if (!measureRecords.length || !imageData) {
    return {
      diagnostics: {
        detectedTieCount: 0,
        appliedTieCount: 0,
        appliedTiePairs: [],
        uncertainSlurCount: 0,
        tieControlGlyphCount: 0,
      },
    }
  }

  const instances = flattenMeasureNotes(measureRecords)
  const tiePairs = []
  const seen = new Set()

  for (const pair of pairControlGlyphs(glyphs, instances, imageData, measureBoxByNumber)) {
    const key = `${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    tiePairs.push(pair)
  }

  for (let index = 0; index < instances.length; index += 1) {
    const nextMatch = findNextSamePitchInstance(instances, index)
    if (!nextMatch) {
      continue
    }
    const from = instances[index]
    const to = nextMatch.instance
    const key = `${eventRefKey(from)}->${eventRefKey(to)}`
    if (seen.has(key)) {
      continue
    }
    const box = measureBoxByNumber.get(from.measureNumber) ?? measureBoxByNumber.get(to.measureNumber)
    if (!box) {
      continue
    }
    if (from.measureNumber === to.measureNumber) {
      const measureWidth = (box.x1 - box.x0) * imageData.width
      if (to.cx - from.cx > measureWidth * 0.45) {
        continue
      }
    } else {
      if (to.measureNumber !== from.measureNumber + 1) {
        continue
      }
      if ((to.startDivision ?? 0) > 0) {
        continue
      }
      const toBox = measureBoxByNumber.get(to.measureNumber)
      if (toBox) {
        const playableStart = (toBox.playableX0 ?? toBox.x0) * imageData.width
        const measureWidth = (toBox.x1 - toBox.x0) * imageData.width
        if (to.cx - playableStart > measureWidth * 0.2) {
          continue
        }
      }
      if (!detectTieToNext(imageData, from.cx, from.cy, inkThreshold, measureBounds(box, imageData))) {
        continue
      }
    }
    if (!detectInkArcBetween(imageData, from, to, box, inkThreshold)) {
      continue
    }
    seen.add(key)
    tiePairs.push({ from, to, source: 'ink-arc' })
  }

  const appliedTieCount = applyTieMarks(measureRecords, tiePairs)
  const uncertainSlurCount = countUncertainSlurs(
    glyphs,
    instances,
    imageData,
    inkThreshold,
    measureBoxByNumber,
  )

  return {
    diagnostics: {
      detectedTieCount: tiePairs.length,
      appliedTieCount,
      appliedTiePairs: tiePairs.map((pair) => ({
        fromMeasure: pair.from.measureNumber,
        toMeasure: pair.to.measureNumber,
        midi: pair.from.midi,
        clef: pair.from.clef,
        source: pair.source,
      })),
      uncertainSlurCount,
      tieControlGlyphCount: glyphs.filter(
        (glyph) => glyph.text === TIE_BEGIN_GLYPH || glyph.text === TIE_END_GLYPH,
      ).length,
    },
  }
}
