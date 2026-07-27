import { isInk } from './omrInk.js'
import {
  FLAT_ORDER_SEMITONES,
  OMR_MUSICAL_CONFIDENCE,
  SHARP_ORDER_SEMITONES,
} from './omrMusicalConstants.js'

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function isSharpGlyph(imageData, cx, cy, threshold) {
  let vertical = 0
  for (let y = cy - 6; y <= cy + 6; y += 1) {
    if (inkAt(imageData, cx, y, threshold)) {
      vertical += 1
    }
  }
  let crosses = 0
  for (const dx of [-3, -2, 2, 3]) {
    for (let y = cy - 3; y <= cy + 3; y += 2) {
      if (inkAt(imageData, cx + dx, y, threshold)) {
        crosses += 1
      }
    }
  }
  return vertical >= 4 && crosses >= 2
}

function isFlatGlyph(imageData, cx, cy, threshold) {
  let vertical = 0
  for (let y = cy - 5; y <= cy + 5; y += 1) {
    if (inkAt(imageData, cx, y, threshold)) {
      vertical += 1
    }
  }
  let loop = 0
  for (let x = cx - 1; x <= cx + 3; x += 1) {
    for (let y = cy; y <= cy + 4; y += 1) {
      if (inkAt(imageData, x, y, threshold)) {
        loop += 1
      }
    }
  }
  return vertical >= 5 && loop >= 4 && loop <= 14
}

const SHARP_STAFF_OFFSETS = [0, 1.5, -0.5, 1, 2.5, 0.5, 2]
const FLAT_STAFF_OFFSETS = [2, 0.5, 2.5, 1, 3, 1.5, 3.5]

function staffGapPixels(lineYs, height) {
  if (!Array.isArray(lineYs) || lineYs.length < 2) {
    return 10
  }
  const sorted = [...lineYs].sort((left, right) => left - right)
  return Math.max(4, ((sorted[sorted.length - 1] - sorted[0]) / 4) * height)
}

function expectedAccidentalCandidates({
  imageData,
  lineYs,
  staff,
  type,
  xStart,
  xEnd,
  threshold,
}) {
  if (!Array.isArray(lineYs) || lineYs.length < 5) {
    return []
  }
  const offsets = type === 'sharp' ? SHARP_STAFF_OFFSETS : FLAT_STAFF_OFFSETS
  const detector = type === 'sharp' ? isSharpGlyph : isFlatGlyph
  const top = Math.min(...lineYs) * imageData.height
  const gap = staffGapPixels(lineYs, imageData.height)
  const candidates = []
  for (let orderIndex = 0; orderIndex < offsets.length; orderIndex += 1) {
    const cy = Math.round(top + offsets[orderIndex] * gap)
    for (let cx = xStart; cx <= xEnd; cx += 2) {
      if (!detector(imageData, cx, cy, threshold)) {
        continue
      }
      const previous = candidates[candidates.length - 1]
      if (
        previous &&
        previous.orderIndex === orderIndex &&
        Math.abs(previous.cx - cx) <= 5
      ) {
        previous.cx = Math.round((previous.cx + cx) / 2)
        continue
      }
      candidates.push({
        type,
        staff,
        orderIndex,
        yNorm: cy / imageData.height,
        cx,
      })
    }
  }
  return candidates
}

function selectOrderedPrefix(candidates, type, gap) {
  const selected = []
  let previousX = -Infinity
  for (let orderIndex = 0; orderIndex < 7; orderIndex += 1) {
    const options = candidates
      .filter(
        (candidate) =>
          candidate.type === type &&
          candidate.orderIndex === orderIndex &&
          candidate.cx > previousX + (selected.length ? gap * 0.35 : 0),
      )
      .sort((left, right) => left.cx - right.cx)
    const next = options[0]
    if (!next) {
      break
    }
    selected.push(next)
    previousX = next.cx
  }
  return selected
}

function isDenseVerticalFragment(candidates, selected) {
  if (selected.length !== 1) {
    return false
  }
  const anchor = selected[0]
  const nearbyOrderIndexes = new Set(
    candidates
      .filter(
        (candidate) =>
          candidate.type === anchor.type &&
          candidate.staff === anchor.staff &&
          Math.abs(candidate.cx - anchor.cx) <= 6,
      )
      .map((candidate) => candidate.orderIndex),
  )
  // Clef/barline fragments form a tall ink column that can satisfy the sharp
  // probe at most or all standard key-signature heights. A real single
  // accidental is compact and does not recur across nearly the entire
  // seven-symbol vertical order.
  return nearbyOrderIndexes.size >= 6
}

function isOpeningGlyphFragment(selected, measureBox, staffLines, height, width) {
  if (selected.length !== 1) {
    return false
  }
  const candidate = selected[0]
  const gap = staffGapPixels(staffLines[candidate.staff], height)
  const measureLeft = measureBox.x0 * width
  // A clef starts immediately after the opening barline. Even a one-symbol
  // key signature follows the clef by more than roughly one staff space.
  return candidate.cx - measureLeft < Math.max(12, gap * 1.25)
}

/**
 * Detect key signature sharps/flats in the left margin of the first measure.
 */
export function detectKeySignature(imageData, measureBox, staffLines, inkThreshold) {
  const { width, height } = imageData
  // Skip the opening barline itself. Its vertical stroke plus staff-line
  // crossings can satisfy both the sharp and flat probes.
  const xStart = Math.floor(measureBox.x0 * width) + 8
  const xEnd = xStart + Math.floor((measureBox.x1 - measureBox.x0) * width * 0.22)
  const keyRegionEnd = xStart + Math.floor((xEnd - xStart) * 0.7)
  const candidates = []
  for (const [staff, lineYs] of [
    ['treble', staffLines.treble],
    ['bass', staffLines.bass],
  ]) {
    for (const type of ['sharp', 'flat']) {
      candidates.push(
        ...expectedAccidentalCandidates({
          imageData,
          lineYs,
          staff,
          type,
          xStart,
          xEnd: keyRegionEnd,
          threshold: inkThreshold,
        }),
      )
    }
  }
  if (!candidates.length) {
    return { fifths: 0, mode: 'major', confidence: 0, candidates: [] }
  }

  const selectedByType = new Map()
  for (const type of ['sharp', 'flat']) {
    const staffPrefixes = ['treble', 'bass']
      .map((staff) => {
        const lineYs = staffLines[staff]
        const gap = staffGapPixels(lineYs, height)
        return selectOrderedPrefix(
          candidates.filter((candidate) => candidate.staff === staff),
          type,
          gap,
        )
      })
      .filter((prefix) => prefix.length)
    const longest = staffPrefixes.sort(
      (left, right) => right.length - left.length,
    )[0] ?? []
    const unsafeOpeningFragment =
      isDenseVerticalFragment(candidates, longest) ||
      isOpeningGlyphFragment(longest, measureBox, staffLines, height, width)
    selectedByType.set(type, unsafeOpeningFragment ? [] : longest)
  }

  const sharps = selectedByType.get('sharp')
  const flats = selectedByType.get('flat')
  if (!sharps.length && !flats.length) {
    return { fifths: 0, mode: 'major', confidence: 0, candidates }
  }
  if (sharps.length && flats.length) {
    return { fifths: 0, mode: 'major', confidence: 0, candidates }
  }

  const selected = sharps.length ? sharps : flats
  const count = selected.length
  const fifths = sharps.length ? count : -count
  const confidence = Math.min(0.95, 0.64 + count * 0.05)
  return {
    fifths,
    mode: 'major',
    confidence,
    count,
    order: sharps.length ? SHARP_ORDER_SEMITONES : FLAT_ORDER_SEMITONES,
    candidates,
    selectedCandidates: selected,
  }
}

export function shouldEmitKeySignature(keySignature) {
  return (keySignature?.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.KEY && keySignature.fifths !== 0
}
