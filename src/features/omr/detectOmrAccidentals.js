import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import {
  applyAlterToMidi,
  resolvePitchFromGrandStaff,
} from './pitchFromStaffPosition.js'

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function staffSpaceForNote(notehead, imageData) {
  const lines = [...(notehead?.pitchMapping?.lineYs ?? [])]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (lines.length < 2) return 8
  const gap =
    ((lines.at(-1) - lines[0]) * imageData.height) / (lines.length - 1)
  return gap >= 3 && gap <= 48 ? gap : 8
}

function contiguousInkRun(imageData, x, y0, y1, threshold) {
  let longest = 0
  let current = 0
  for (let y = y0; y <= y1; y += 1) {
    if (inkAt(imageData, x, y, threshold)) {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }
  return longest
}

function horizontalInkRun(imageData, x, y, threshold, limit) {
  if (!inkAt(imageData, x, y, threshold)) return null
  let left = Math.round(x)
  let right = Math.round(x)
  while (left > 0 && right - left < limit && inkAt(imageData, left - 1, y, threshold)) {
    left -= 1
  }
  while (
    right < imageData.width - 1 &&
    right - left < limit &&
    inkAt(imageData, right + 1, y, threshold)
  ) {
    right += 1
  }
  return { left, right, length: right - left + 1 }
}

/**
 * Scan-safe sharp topology: two tall posts separated by less than one staff
 * space. A filled notehead plus its stem has one such post, while a sharp has
 * two. Requiring the paired posts prevents staff lines, slurs, and notehead
 * bodies from becoming accidental evidence on their own.
 */
export function detectRasterSharpTopology(
  imageData,
  cx,
  cy,
  threshold,
  staffSpace = 8,
) {
  const scale = Number.isFinite(staffSpace) && staffSpace >= 3 ? staffSpace : 8
  const halfWidth = Math.max(5, Math.round(scale * 0.82))
  const halfHeight = Math.max(7, Math.round(scale * 1.15))
  const minPostRun = Math.max(6, Math.round(scale * 0.92))
  const postColumns = []
  for (let x = Math.round(cx) - halfWidth; x <= Math.round(cx) + halfWidth; x += 1) {
    const run = contiguousInkRun(
      imageData,
      x,
      Math.round(cy) - halfHeight,
      Math.round(cy) + halfHeight,
      threshold,
    )
    if (run >= minPostRun) postColumns.push({ x, run })
  }
  if (postColumns.length < 2) return null

  // Adjacent dark pixels are one engraved post. Collapse them before looking
  // for the second post so a single thick stem cannot satisfy the pair gate.
  const posts = []
  for (const column of postColumns) {
    const previous = posts.at(-1)
    if (previous && column.x <= previous.x1 + 1) {
      previous.x1 = column.x
      previous.run = Math.max(previous.run, column.run)
    } else {
      posts.push({ x0: column.x, x1: column.x, run: column.run })
    }
  }
  let best = null
  for (let leftIndex = 0; leftIndex < posts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < posts.length; rightIndex += 1) {
      const left = posts[leftIndex]
      const right = posts[rightIndex]
      const leftCenter = (left.x0 + left.x1) / 2
      const rightCenter = (right.x0 + right.x1) / 2
      const separation = rightCenter - leftCenter
      if (separation < scale * 0.42 || separation > scale * 1.12) continue
      const midpoint = (leftCenter + rightCenter) / 2
      const centerOffset = Math.abs(midpoint - cx)
      if (centerOffset > scale * 0.42) continue
      const score =
        Math.min(left.run, right.run) / scale -
        centerOffset / scale -
        Math.abs(separation / scale - 0.78) * 0.2
      if (!best || score > best.score) {
        best = { left, right, separation, midpoint, score }
      }
    }
  }
  if (!best) return null
  const crossbarRows = []
  const horizontalLimit = Math.ceil(scale * 4)
  for (let y = Math.round(cy) - halfHeight; y <= Math.round(cy) + halfHeight; y += 1) {
    const run = horizontalInkRun(imageData, best.midpoint, y, threshold, horizontalLimit)
    if (
      run &&
      run.length >= scale * 0.62 &&
      run.length <= scale * 2.35 &&
      run.left <= best.left.x1 &&
      run.right >= best.right.x0
    ) {
      crossbarRows.push(y)
    }
  }
  const crossbarBands = []
  for (const y of crossbarRows) {
    const previous = crossbarBands.at(-1)
    if (previous && y <= previous.y1 + 1) {
      previous.y1 = y
    } else {
      crossbarBands.push({ y0: y, y1: y })
    }
  }
  let crossbarPair = null
  for (let upperIndex = 0; upperIndex < crossbarBands.length; upperIndex += 1) {
    for (let lowerIndex = upperIndex + 1; lowerIndex < crossbarBands.length; lowerIndex += 1) {
      const upper = crossbarBands[upperIndex]
      const lower = crossbarBands[lowerIndex]
      const upperCenter = (upper.y0 + upper.y1) / 2
      const lowerCenter = (lower.y0 + lower.y1) / 2
      const separation = lowerCenter - upperCenter
      if (separation < scale * 0.25 || separation > scale * 0.92) continue
      const centerY = (upperCenter + lowerCenter) / 2
      const centerOffset = Math.abs(centerY - cy)
      if (centerOffset > scale * 0.42) continue
      const score = centerOffset + Math.abs(separation / scale - 0.55) * scale * 0.2
      if (!crossbarPair || score < crossbarPair.score) {
        crossbarPair = { upper, lower, centerY, separation, score }
      }
    }
  }
  if (!crossbarPair) return null
  return {
    alter: 1,
    type: 'sharp',
    confidence: Math.min(0.94, 0.78 + Math.max(0, best.score - 0.8) * 0.08),
    source: 'raster-paired-post-topology',
    centerX: best.midpoint,
    centerY: crossbarPair.centerY,
    postSeparation: best.separation,
    crossbarSeparation: crossbarPair.separation,
  }
}

function detectAccidentalGlyph(imageData, cx, cy, threshold) {
  let sharpScore = 0
  let flatScore = 0

  for (let y = cy - 5; y <= cy + 5; y += 1) {
    if (inkAt(imageData, cx, y, threshold)) {
      sharpScore += 1
      flatScore += 1
    }
  }
  for (const dx of [-2, 2]) {
    for (let y = cy - 2; y <= cy + 2; y += 2) {
      if (inkAt(imageData, cx + dx, y, threshold)) {
        sharpScore += 1
      }
    }
  }
  for (let x = cx - 1; x <= cx + 2; x += 1) {
    for (let y = cy; y <= cy + 4; y += 2) {
      if (inkAt(imageData, x, y, threshold)) {
        flatScore += 1
      }
    }
  }

  if (sharpScore >= 4 && sharpScore > flatScore + 1) {
    return { alter: 1, confidence: Math.min(0.9, 0.5 + sharpScore * 0.05), type: 'sharp' }
  }
  if (flatScore >= 4 && flatScore > sharpScore + 1) {
    return { alter: -1, confidence: Math.min(0.88, 0.48 + flatScore * 0.05), type: 'flat' }
  }
  return null
}

/**
 * Detect a notated accidental immediately left of a notehead.
 */
export function detectAccidentalNearNote(imageData, notehead, inkThreshold) {
  const { cx, cy } = notehead
  const staffSpace = staffSpaceForNote(notehead, imageData)
  const far = Math.max(18, Math.round(staffSpace * 2.35))
  const near = Math.max(5, Math.round(staffSpace * 0.48))
  for (let scanX = cx - far; scanX <= cx - near; scanX += 1) {
    const topology = detectRasterSharpTopology(
      imageData,
      scanX,
      cy,
      inkThreshold,
      staffSpace,
    )
    if (topology) return topology
  }
  for (let scanX = cx - Math.min(18, far); scanX >= cx - near; scanX -= 2) {
    const glyph = detectAccidentalGlyph(imageData, scanX, cy, inkThreshold)
    if (glyph) {
      return glyph
    }
  }
  return null
}

function assignRasterAccidentalCandidates(noteheads, imageData, inkThreshold) {
  const suppressed = new Set()
  const assigned = new Map()
  for (let index = 0; index < noteheads.length; index += 1) {
    const candidate = noteheads[index]
    const staffSpace = staffSpaceForNote(candidate, imageData)
    const topology = detectRasterSharpTopology(
      imageData,
      candidate.cx,
      candidate.cy,
      inkThreshold,
      staffSpace,
    )
    if (!topology) continue
    const nearby = noteheads
      .map((note, ownerIndex) => ({ note, ownerIndex }))
      .filter(({ note, ownerIndex }) => {
        if (ownerIndex === index || note.clef !== candidate.clef) return false
        const dx = note.cx - candidate.cx
        return (
          dx >= staffSpace * 1.05 &&
          dx <= staffSpace * 2.55 &&
          Math.abs(note.cy - candidate.cy) <= staffSpace * 1.55
        )
      })
    if (!nearby.length) continue
    suppressed.add(index)
    const owners = nearby
      .filter(
        ({ note }) => Math.abs(note.cy - candidate.cy) <= staffSpace * 0.48,
      )
      .sort(
        (left, right) =>
          Math.abs(left.note.cy - candidate.cy) -
            Math.abs(right.note.cy - candidate.cy) ||
          left.note.cx - right.note.cx,
      )
    const owner = owners[0]
    if (!owner) continue
    const previous = assigned.get(owner.ownerIndex)
    if (!previous || topology.confidence > previous.confidence) {
      assigned.set(owner.ownerIndex, {
        ...topology,
        candidateX: candidate.cx,
        candidateY: candidate.cy,
      })
    }
  }
  for (let ownerIndex = 0; ownerIndex < noteheads.length; ownerIndex += 1) {
    if (suppressed.has(ownerIndex)) continue
    const owner = noteheads[ownerIndex]
    const accidental = detectAccidentalNearNote(imageData, owner, inkThreshold)
    if (accidental?.source !== 'raster-paired-post-topology') continue
    const staffSpace = staffSpaceForNote(owner, imageData)
    if (owner.cx - accidental.centerX < staffSpace * 1.4) continue
    for (let candidateIndex = 0; candidateIndex < noteheads.length; candidateIndex += 1) {
      if (candidateIndex === ownerIndex || suppressed.has(candidateIndex)) continue
      const candidate = noteheads[candidateIndex]
      if (
        candidate.clef !== owner.clef ||
        !candidate?.detectionEvidence?.recoveredBy ||
        candidate.cx < accidental.centerX ||
        candidate.cx >= owner.cx
      ) {
        continue
      }
      if (
        candidate.cx - accidental.centerX <= staffSpace * 0.82 &&
        Math.abs(candidate.cy - accidental.centerY) <= staffSpace * 0.95
      ) {
        suppressed.add(candidateIndex)
      }
    }
  }
  return { suppressed, assigned }
}

export function snapRecoveredNoteToCrossingLine(
  notehead,
  imageData,
  inkThreshold,
) {
  if (!notehead?.detectionEvidence?.recoveredBy) return notehead
  const staffSpace = staffSpaceForNote(notehead, imageData)
  const lines = [...(notehead?.pitchMapping?.lineYs ?? [])]
    .filter(Number.isFinite)
    .map((line) => line * imageData.height)
    .sort((left, right) => left - right)
  if (lines.length < 2) return notehead
  const candidates = []
  for (let index = -4; index <= lines.length + 3; index += 1) {
    candidates.push(lines[0] + index * staffSpace)
  }
  const nearest = candidates
    .map((y) => ({ y, distance: Math.abs(y - notehead.cy) }))
    .sort((left, right) => left.distance - right.distance)[0]
  if (!nearest || nearest.distance > staffSpace * 0.38) return notehead
  const accidental = detectAccidentalNearNote(
    imageData,
    notehead,
    inkThreshold,
  )
  if (
    accidental?.source === 'raster-paired-post-topology' &&
    Math.abs(accidental.centerY - notehead.cy) <= staffSpace * 0.5 &&
    Math.abs(accidental.centerY - nearest.y) > staffSpace * 0.25
  ) {
    return notehead
  }
  const run = horizontalInkRun(
    imageData,
    notehead.cx,
    Math.round(nearest.y),
    inkThreshold,
    Math.ceil(staffSpace * 4),
  )
  if (!run || run.length < staffSpace * 1.25) return notehead

  const bounds = notehead.pitchMapping?.staffBounds
  const treble = bounds?.treble?.lines
  const bass = bounds?.bass?.lines
  if (!(treble?.length >= 2) || !(bass?.length >= 2)) return notehead
  const pitchMapping = resolvePitchFromGrandStaff(
    nearest.y / imageData.height,
    {
      treble,
      bass,
      splitY: (treble.at(-1) + bass[0]) / 2,
    },
    notehead.pitchMapping.staffClefs,
  )
  if (pitchMapping.midi == null) return notehead
  return {
    ...notehead,
    midi: pitchMapping.midi,
    pitchMapping,
    pitchAnchorCorrection: {
      source: 'recovered-head-crossing-line',
      rawCy: notehead.cy,
      crossingLineY: nearest.y,
      horizontalRun: run.length,
    },
  }
}

export function refineNotePitch(notehead, {
  keySignature = null,
  imageData = null,
  inkThreshold = 170,
  assignedAccidental = null,
} = {}) {
  let accidental = assignedAccidental
  if (!accidental && imageData) {
    accidental = detectAccidentalNearNote(imageData, notehead, inkThreshold)
  }

  // The notehead owns the staff step. A sharp/flat instance may be vertically
  // offset by its posts and crossbars, so its raster center must never replace
  // the notehead's diatonic base pitch.
  let midi = notehead.midi
  let alter = null
  let pitchConfidence = 0.7

  if (accidental && accidental.confidence >= OMR_MUSICAL_CONFIDENCE.ACCIDENTAL) {
    alter = accidental.alter
    midi = applyAlterToMidi(midi, alter)
    pitchConfidence = accidental.confidence
  } else if (keySignature?.fifths && (keySignature.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.KEY) {
    pitchConfidence = Math.min(0.82, keySignature.confidence)
  }

  return {
    ...notehead,
    midi,
    alter,
    accidental,
    pitchConfidence,
    ledger: notehead.ledger ?? null,
  }
}

export function refineMeasurePitches(noteheads, context) {
  if (!context?.imageData || !(noteheads?.length > 0)) {
    return noteheads.map((notehead) => refineNotePitch(notehead, context))
  }
  const anchored = noteheads.map((notehead) =>
    snapRecoveredNoteToCrossingLine(
      notehead,
      context.imageData,
      context.inkThreshold ?? 170,
    ),
  )
  const ownership = assignRasterAccidentalCandidates(
    anchored,
    context.imageData,
    context.inkThreshold ?? 170,
  )
  return anchored.flatMap((notehead, index) => {
    if (ownership.suppressed.has(index)) return []
    return [
      refineNotePitch(notehead, {
        ...context,
        assignedAccidental: ownership.assigned.get(index) ?? null,
      }),
    ]
  })
}
