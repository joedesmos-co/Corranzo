/**
 * Note-anchored raster articulation classification.
 *
 * Materially different from rejected approaches:
 * - Not a global page/morphology instance extractor
 * - Not a bare 5×5 ink-count probe on every head
 * - Crops a small staff-space patch relative to a known note/chord column,
 *   masks staff/notehead ink inside that patch, classifies local components,
 *   and attaches at most one mark per onset column.
 */

import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import {
  broadcastArticulationToChordMates,
  staffSpacePixelsForArticulation,
} from './articulationGeometry.js'
import { OMR_CHORD_MERGE_X } from './omrRhythmConstants.js'
import { shouldEmitArticulation } from './detectOmrExpression.js'

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function staffLineYs(measureBox, imageData) {
  const ys = []
  for (const role of ['treble', 'bass']) {
    for (const yNorm of measureBox?.staffLines?.[role] ?? []) {
      if (!Number.isFinite(yNorm)) continue
      ys.push(yNorm * imageData.height)
    }
  }
  return ys
}

function groupColumns(noteheads) {
  const sorted = [...noteheads].sort((a, b) => (a.cx ?? 0) - (b.cx ?? 0))
  const columns = []
  for (const note of sorted) {
    if (!Number.isFinite(note?.cx) || !Number.isFinite(note?.cy)) continue
    const column = columns.find(
      (entry) =>
        (entry.clef ?? 'treble') === (note.clef ?? 'treble') &&
        Math.abs(entry.cx - note.cx) <= OMR_CHORD_MERGE_X,
    )
    if (column) {
      column.notes.push(note)
      column.cx =
        column.notes.reduce((sum, item) => sum + item.cx, 0) / column.notes.length
      column.topCy = Math.min(column.topCy, note.cy)
      column.bottomCy = Math.max(column.bottomCy, note.cy)
      continue
    }
    columns.push({
      cx: note.cx,
      topCy: note.cy,
      bottomCy: note.cy,
      clef: note.clef ?? 'treble',
      notes: [note],
    })
  }
  for (const column of columns) {
    column.indices = column.notes
      .map((note) => noteheads.indexOf(note))
      .filter((index) => index >= 0)
  }
  return columns
}

/**
 * True staff / ledger corridors are dense across a *wide* horizontal probe.
 * Measuring density only inside the articulation crop wrongly treats accents
 * (which fill most of the narrow crop) as staff lines.
 */
function rowIsDenseStaff(imageData, y, columnCx, staffSpace, threshold) {
  const halfProbe = Math.max(Math.round(staffSpace * 5), 40)
  const x0 = Math.round(columnCx - halfProbe)
  const x1 = Math.round(columnCx + halfProbe)
  let ink = 0
  let total = 0
  for (let x = x0; x <= x1; x += 1) {
    total += 1
    if (inkAt(imageData, x, y, threshold)) ink += 1
  }
  return total > 0 && ink / total >= 0.45
}

function insideNoteheadBody(x, y, column, staffSpace) {
  const radius = staffSpace * 0.5
  return column.notes.some((note) => {
    const dx = x - note.cx
    const dy = y - note.cy
    return dx * dx + dy * dy <= radius * radius
  })
}

function collectPatchBlobs(
  imageData,
  inkThreshold,
  x0,
  y0,
  x1,
  y1,
  column,
  staffSpace,
  staffYs,
) {
  const left = Math.floor(Math.min(x0, x1))
  const right = Math.ceil(Math.max(x0, x1))
  const top = Math.floor(Math.min(y0, y1))
  const bottom = Math.ceil(Math.max(y0, y1))
  const width = right - left + 1
  const height = bottom - top + 1
  if (width < 3 || height < 3 || width * height > 8_000) {
    return []
  }

  const denseRows = new Set()
  for (let y = top; y <= bottom; y += 1) {
    // Known staff-line corridors (narrow band).
    for (const staffY of staffYs) {
      if (Math.abs(y - staffY) <= Math.max(1, staffSpace * 0.1)) {
        denseRows.add(y)
      }
    }
    // Adaptive dense rows only when the *wide* probe looks like a staff/ledger.
    if (rowIsDenseStaff(imageData, y, column.cx, staffSpace, inkThreshold)) {
      denseRows.add(y)
    }
  }

  const seen = new Uint8Array(width * height)
  const blobs = []
  const horizontalRunLength = (x, y) => {
    let run = 0
    let px = x
    while (px >= left && inkAt(imageData, px, y, inkThreshold)) {
      run += 1
      px -= 1
    }
    px = x + 1
    while (px <= right && inkAt(imageData, px, y, inkThreshold)) {
      run += 1
      px += 1
    }
    return run
  }
  const at = (lx, ly) => {
    if (lx < 0 || ly < 0 || lx >= width || ly >= height) return false
    const x = left + lx
    const y = top + ly
    if (insideNoteheadBody(x, y, column, staffSpace)) return false
    if (!inkAt(imageData, x, y, inkThreshold)) return false
    // Keep compact islands on staff corridors (staccato sitting on a line);
    // suppress the long horizontal staff/ledger run itself.
    if (denseRows.has(y) && horizontalRunLength(x, y) >= staffSpace * 0.55) {
      return false
    }
    return true
  }

  for (let ly = 0; ly < height; ly += 1) {
    for (let lx = 0; lx < width; lx += 1) {
      const idx = ly * width + lx
      if (seen[idx] || !at(lx, ly)) continue
      const stack = [[lx, ly]]
      seen[idx] = 1
      let minX = lx
      let maxX = lx
      let minY = ly
      let maxY = ly
      let area = 0
      const pixels = [[lx, ly]]
      while (stack.length) {
        const [cx, cy] = stack.pop()
        area += 1
        minX = Math.min(minX, cx)
        maxX = Math.max(maxX, cx)
        minY = Math.min(minY, cy)
        maxY = Math.max(maxY, cy)
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const nidx = ny * width + nx
          if (seen[nidx] || !at(nx, ny)) continue
          seen[nidx] = 1
          stack.push([nx, ny])
          pixels.push([nx, ny])
        }
      }
      const midX = (minX + maxX) / 2
      let leftInk = 0
      let rightInk = 0
      for (const [px] of pixels) {
        if (px <= midX) leftInk += 1
        else rightInk += 1
      }
      const blob = {
        area,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        cx: left + (minX + maxX) / 2,
        cy: top + (minY + maxY) / 2,
        leftInk,
        rightInk,
      }
      // Spans almost the full crop → staff/beam/slur fragment.
      if (blob.width >= width * 0.85) continue
      // Stem hairline.
      if (blob.width <= 2 && blob.height >= staffSpace * 0.75) continue
      blobs.push(blob)
    }
  }
  return blobs
}

function classifyBlob(blob, staffSpace, columnCx) {
  if (!blob) return null
  const boxArea = Math.max(1, blob.width * blob.height)
  const fill = blob.area / boxArea
  const aspect = blob.width / Math.max(1, blob.height)
  const dx = Math.abs(blob.cx - columnCx)
  // Articulations sit near the chord column; accidental / digit / slur crumbs
  // that drift sideways are rejected here rather than classified by aspect alone.
  if (dx > staffSpace * 0.65) {
    return null
  }

  const sideBalance =
    Math.abs((blob.leftInk ?? 0) - (blob.rightInk ?? 0)) /
    Math.max(1, (blob.leftInk ?? 0) + (blob.rightInk ?? 0))

  // Accent: filled wedge *or* hollow chevron (scan accents are often outline `>`).
  // Do not require wide aspect — printed accents can be near-square in raster.
  const accentSize =
    blob.width >= staffSpace * 0.4 &&
    blob.width <= staffSpace * 2.4 &&
    blob.height >= Math.max(3, staffSpace * 0.22) &&
    blob.height <= staffSpace * 1.15 &&
    blob.area >= Math.max(8, staffSpace * staffSpace * 0.04) &&
    blob.area <= staffSpace * staffSpace * 1.35
  const accentShape =
    (aspect >= 0.7 && aspect <= 2.8 && fill >= 0.16 && fill <= 0.72) ||
    (aspect >= 1.2 && aspect <= 3.2 && fill >= 0.35 && fill <= 0.95)
  // Prefer true wedges/chevrons: strong left-right imbalance, wide aspect, or
  // hollow fill. Symmetric filled blocks that only pass size are usually noise.
  const accentAsymmetry =
    sideBalance >= 0.12 || aspect >= 1.45 || (fill <= 0.5 && aspect >= 0.85)
  if (
    accentSize &&
    accentShape &&
    accentAsymmetry &&
    // Accents are centered on the chord; left-shifted accidentals / digits abstain.
    dx <= staffSpace * 0.48
  ) {
    return {
      type: 'accent',
      confidence: 0.9,
      source: 'note-anchored-raster-patch',
      features: {
        width: blob.width,
        height: blob.height,
        area: blob.area,
        fill,
        aspect,
        sideBalance,
        dx,
      },
    }
  }

  // Staccato: compact roughly round mark, centered, not beside-head augmentation.
  if (
    blob.width >= 2 &&
    blob.height >= 2 &&
    blob.width <= staffSpace * 0.4 &&
    blob.height <= staffSpace * 0.4 &&
    blob.area >= Math.max(4, staffSpace * staffSpace * 0.014) &&
    blob.area <= Math.max(16, staffSpace * staffSpace * 0.16) &&
    aspect >= 0.55 &&
    aspect <= 1.85 &&
    fill >= 0.45 &&
    dx <= staffSpace * 0.4
  ) {
    return {
      type: 'staccato',
      confidence: 0.86,
      source: 'note-anchored-raster-patch',
      features: {
        width: blob.width,
        height: blob.height,
        area: blob.area,
        fill,
        aspect,
        dx,
      },
    }
  }

  // Tenuto disabled on raster for now: short staff/ledger crumbs were emitting
  // false tenutos on piano-articulation-scan (m6/m7). Re-enable only with a
  // stronger isolation test against dense horizontal corridors.
  return null
}

function classifyColumnPatch(imageData, column, measureBox, inkThreshold, staffYs) {
  const staffSpace = staffSpacePixelsForArticulation(
    measureBox,
    imageData,
    column.clef,
  )
  const halfW = staffSpace * 0.95
  const near = staffSpace * 0.28
  const far = staffSpace * 3.6
  const windows = [
    {
      placement: 'above',
      x0: column.cx - halfW,
      x1: column.cx + halfW,
      y0: column.topCy - far,
      y1: column.topCy - near,
      bias: 0,
    },
    {
      placement: 'below',
      x0: column.cx - halfW,
      x1: column.cx + halfW,
      y0: column.bottomCy + near,
      y1: column.bottomCy + far,
      bias: 5,
    },
  ]

  let best = null
  let bestScore = Infinity
  const candidates = []
  for (const window of windows) {
    const blobs = collectPatchBlobs(
      imageData,
      inkThreshold,
      window.x0,
      window.y0,
      window.x1,
      window.y1,
      column,
      staffSpace,
      staffYs,
    )
    for (const blob of blobs) {
      const mark = classifyBlob(blob, staffSpace, column.cx)
      if (!mark || !shouldEmitArticulation(mark)) {
        candidates.push({ blob, mark: null, reason: 'abstain-or-unclassified' })
        continue
      }
      const anchorY = window.placement === 'above' ? column.topCy : column.bottomCy
      const dy = Math.abs(blob.cy - anchorY)
      // Engraved articulations sit close to the chord extreme; distant slur /
      // fingering / beam crumbs are not articulation owners.
      if (dy > staffSpace * 3.05) {
        candidates.push({ blob, mark: null, reason: 'too-far-from-chord' })
        continue
      }
      const score =
        Math.abs(blob.cx - column.cx) +
        dy * 0.35 +
        window.bias +
        (mark.type === 'accent' ? -28 : 0)
      candidates.push({ blob, mark, placement: window.placement, score })
      if (score < bestScore) {
        bestScore = score
        best = {
          ...mark,
          placement: window.placement,
          staffSpace,
          cropBounds: {
            x0: window.x0,
            y0: window.y0,
            x1: window.x1,
            y1: window.y1,
          },
          blob,
        }
      }
    }
  }
  return { mark: best, candidates, staffSpace }
}

/**
 * Assign articulations from note-anchored local patches.
 */
export function assignNoteAnchoredRasterArticulations(
  imageData,
  noteheads = [],
  measureBox,
  inkThreshold,
) {
  for (const note of noteheads) {
    delete note.articulation
    delete note.accentArticulation
    delete note.articulationProvenance
  }
  if (!noteheads.length || !measureBox) {
    return { columnCount: 0, staccatoColumns: 0, accentColumns: 0, tenutoColumns: 0 }
  }

  const staffYs = staffLineYs(measureBox, imageData)
  const columns = groupColumns(noteheads)
  const staccatoAssignments = new Map()
  const accentAssignments = new Map()
  const tenutoAssignments = new Map()
  let staccatoColumns = 0
  let accentColumns = 0
  let tenutoColumns = 0

  for (const column of columns) {
    const { mark, candidates, staffSpace } = classifyColumnPatch(
      imageData,
      column,
      measureBox,
      inkThreshold,
      staffYs,
    )
    if (!mark) continue
    const seedIndex = column.indices[0]
    if (seedIndex == null) continue

    const provenance = {
      cropBounds: mark.cropBounds,
      candidateCount: candidates.length,
      selectedType: mark.type,
      confidence: mark.confidence,
      placement: mark.placement,
      features: mark.features,
      ownerSeedIndex: seedIndex,
      source: mark.source,
    }

    if (mark.type === 'accent') {
      accentColumns += 1
      accentAssignments.set(seedIndex, mark)
      broadcastArticulationToChordMates(
        accentAssignments,
        noteheads,
        seedIndex,
        mark,
        staffSpace,
      )
    } else if (mark.type === 'tenuto') {
      tenutoColumns += 1
      tenutoAssignments.set(seedIndex, mark)
      broadcastArticulationToChordMates(
        tenutoAssignments,
        noteheads,
        seedIndex,
        mark,
        staffSpace,
      )
    } else {
      staccatoColumns += 1
      staccatoAssignments.set(seedIndex, mark)
      broadcastArticulationToChordMates(
        staccatoAssignments,
        noteheads,
        seedIndex,
        mark,
        staffSpace,
      )
    }

    for (const index of column.indices) {
      noteheads[index].articulationProvenance = { ...provenance }
    }
  }

  for (let index = 0; index < noteheads.length; index += 1) {
    const note = noteheads[index]
    const accent = accentAssignments.get(index)
    const tenuto = tenutoAssignments.get(index)
    const staccato = staccatoAssignments.get(index)
    if (accent) {
      note.accentArticulation = accent
    } else if (tenuto) {
      note.articulation = tenuto
    } else if (staccato) {
      note.articulation = staccato
    }
  }

  return {
    columnCount: columns.length,
    staccatoColumns,
    accentColumns,
    tenutoColumns,
    staccatoCount: staccatoAssignments.size,
    accentCount: accentAssignments.size,
    tenutoCount: tenutoAssignments.size,
  }
}

export function articulationConfidenceFloor() {
  return OMR_MUSICAL_CONFIDENCE.ARTICULATION
}
