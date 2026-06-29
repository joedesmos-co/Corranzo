import { isInk, contentPixelBounds } from './omrInk.js'
import { estimateLedgerLineCount, resolvePitchFromGrandStaff } from './pitchFromStaffPosition.js'

const WINDOW = 5
const MIN_DARK = 10
const MERGE_X = 7
const MERGE_Y = 5

// Loose presence test: enough local ink to be worth considering a notehead.
// Shape discrimination happens after merging (see detectNoteheadsInMeasure).
function darkCountInWindow(imageData, cx, cy, threshold, bounds) {
  const { data, width } = imageData
  let dark = 0
  let total = 0
  const half = Math.floor(WINDOW / 2)
  for (let y = cy - half; y <= cy + half; y += 1) {
    if (y < bounds.top || y > bounds.bottom) {
      continue
    }
    for (let x = cx - half; x <= cx + half; x += 1) {
      if (x < bounds.left || x > bounds.right) {
        continue
      }
      total += 1
      if (isInk(data, (y * width + x) * 4, threshold)) {
        dark += 1
      }
    }
  }
  return { dark, total }
}

function isLikelyStaffLine(imageData, cx, cy, threshold, bounds) {
  const { data, width } = imageData
  let run = 0
  for (let x = bounds.left; x <= bounds.right; x += 1) {
    const index = (cy * width + x) * 4
    if (isInk(data, index, threshold)) {
      run += 1
    }
  }
  const span = bounds.right - bounds.left + 1
  return run / span > 0.55
}

function maxVerticalInkRun(imageData, cx, threshold, top, bottom) {
  const { data, width } = imageData
  let maxRun = 0
  let run = 0
  for (let y = top; y <= bottom; y += 1) {
    const index = (y * width + cx) * 4
    if (isInk(data, index, threshold)) {
      run += 1
      maxRun = Math.max(maxRun, run)
    } else {
      run = 0
    }
  }
  return maxRun
}

function isLikelyBarline(imageData, cx, cy, threshold, y0, y1) {
  const { data, width, height } = imageData
  const top = Math.floor(y0 * height)
  const bottom = Math.ceil(y1 * height)
  let run = 0
  for (let y = top; y <= bottom; y += 1) {
    const index = (y * width + cx) * 4
    if (isInk(data, index, threshold)) {
      run += 1
    }
  }
  return run / Math.max(1, bottom - top + 1) > 0.62
}

function isLikelyBeamInk(imageData, cx, cy, threshold) {
  const { data, width } = imageData
  let run = 0
  for (let x = cx - 8; x <= cx + 8; x += 1) {
    if (x < 0 || x >= width) {
      continue
    }
    const index = (cy * width + x) * 4
    if (isInk(data, index, threshold)) {
      run += 1
    }
  }
  return run >= 9
}

function clampInt(value, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(value)))
}

// Natural pixel scale of the staff. All shape gates are expressed as multiples
// of this so they stay valid whether a page packs 2 systems or 12.
function staffSpacePx(measureBox, height) {
  const treble = measureBox?.staffLines?.treble
  const bass = measureBox?.staffLines?.bass
  const lines = Array.isArray(treble) && treble.length >= 2 ? treble : bass
  if (Array.isArray(lines) && lines.length >= 2) {
    const ys = [...lines].map((value) => value * height).sort((a, b) => a - b)
    const spacing = (ys[ys.length - 1] - ys[0]) / (ys.length - 1)
    if (Number.isFinite(spacing) && spacing >= 3 && spacing <= 48) {
      return spacing
    }
  }
  return 8
}

function fillRatio(imageData, cx, cy, threshold, bounds, halfW, halfH) {
  const { data, width } = imageData
  let dark = 0
  let total = 0
  for (let y = cy - halfH; y <= cy + halfH; y += 1) {
    if (y < bounds.top || y > bounds.bottom) {
      continue
    }
    for (let x = cx - halfW; x <= cx + halfW; x += 1) {
      if (x < bounds.left || x > bounds.right) {
        continue
      }
      total += 1
      if (isInk(data, (y * width + x) * 4, threshold)) {
        dark += 1
      }
    }
  }
  return total > 0 ? dark / total : 0
}

// Bounding box of ink within a local window — distinguishes a compact notehead
// (filled or hollow) from a dot/speck (tiny) or a stroke fragment (elongated).
function inkBoundingBox(imageData, cx, cy, threshold, radiusX, radiusY) {
  const { data, width, height } = imageData
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let count = 0
  for (let y = cy - radiusY; y <= cy + radiusY; y += 1) {
    if (y < 0 || y >= height) {
      continue
    }
    for (let x = cx - radiusX; x <= cx + radiusX; x += 1) {
      if (x < 0 || x >= width) {
        continue
      }
      if (isInk(data, (y * width + x) * 4, threshold)) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        count += 1
      }
    }
  }
  if (count === 0) {
    return { w: 0, h: 0, count: 0 }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1, count }
}

// Length of the contiguous horizontal ink run covering (or nearest to) cx on row
// cy. Long runs are beams, ties, ledger lines or staff remnants, not noteheads.
function horizontalRunCovering(imageData, cx, cy, threshold, left, right, searchHalf) {
  const { data, width } = imageData
  const inkAtX = (x) => x >= left && x <= right && isInk(data, (cy * width + x) * 4, threshold)
  let center = cx
  if (!inkAtX(center)) {
    center = -1
    for (let d = 1; d <= searchHalf; d += 1) {
      if (inkAtX(cx - d)) {
        center = cx - d
        break
      }
      if (inkAtX(cx + d)) {
        center = cx + d
        break
      }
    }
    if (center < 0) {
      return 0
    }
  }
  let a = center
  let b = center
  while (a - 1 >= left && inkAtX(a - 1)) a -= 1
  while (b + 1 <= right && inkAtX(b + 1)) b += 1
  return b - a + 1
}

/**
 * Detect filled notehead blobs inside a measure box (experimental, local-only).
 */
export function detectNoteheadsInMeasure(
  imageData,
  measureBox,
  inkThreshold = 170,
  options = {},
) {
  const { dense = false, skipDenseFallback = false } = options
  const step = dense ? 2 : 3
  const maxVerticalRatio = dense ? 0.28 : 0.34
  const { width, height } = imageData
  const bounds = contentPixelBounds(imageData, {
    x0: measureBox.playableX0 ?? measureBox.x0,
    x1: measureBox.x1,
    y0: measureBox.y0,
    y1: measureBox.y1,
  })

  // Notehead shape gates, scaled to the staff so they hold whether a page packs
  // 2 systems or 12. These reject the dominant raster false positives (beams,
  // ledger lines, ties, stems, dots, articulations, text) without piece-specific
  // tuning and without changing any rejection threshold downstream.
  const ss = staffSpacePx(measureBox, height)
  // "mid" box ~ one notehead: large enough that a hollow head's ring still fills
  // it, so half/whole notes are not mistaken for sparse noise.
  const midHalfW = clampInt(ss * 0.75, 2, 12)
  const midHalfH = clampInt(ss * 0.6, 2, 10)
  const outerHalfW = clampInt(ss * 1.2, midHalfW + 2, 20)
  const outerHalfH = clampInt(ss * 0.95, midHalfH + 2, 18)
  // The mid-box fill is the primary discriminator: a real notehead (filled or
  // hollow) fills a notehead-sized box far more densely than the beam / stem /
  // ledger / text fragments that dominate raster false positives, and measuring
  // it after merging leaves real heads untouched (verified: 0 lost matched notes
  // on the one accepted raster score). The remaining gates stay deliberately
  // loose — only catching egregious shapes — so they never erode recall.
  const minMidFill = dense ? 0.26 : 0.3
  const maxHorizontalRun = Math.max(48, Math.round(ss * 12))
  const maxOuterFill = dense ? 0.97 : 0.96
  const minAspect = 0.12
  const maxAspect = 8
  // Merge radius unchanged from the original detector: a notehead is ~1 staff
  // space tall and a second is ~0.5 space, so widening it would risk collapsing
  // stacked chord tones. Duplicate suppression comes from the shape gates above.
  const mergeX = dense ? 5 : MERGE_X
  const mergeY = dense ? 4 : MERGE_Y

  const candidates = []
  const measureWidth = bounds.right - bounds.left + 1

  for (let cy = bounds.top; cy <= bounds.bottom; cy += step) {
    for (let cx = bounds.left; cx <= bounds.right; cx += step) {
      if (isLikelyStaffLine(imageData, cx, cy, inkThreshold, bounds)) {
        continue
      }
      if (isLikelyBarline(imageData, cx, cy, inkThreshold, measureBox.y0, measureBox.y1)) {
        continue
      }
      let nearBarline = false
      for (let dx = -3; dx <= 3; dx += 1) {
        if (isLikelyBarline(imageData, cx + dx, cy, inkThreshold, measureBox.y0, measureBox.y1)) {
          nearBarline = true
          break
        }
      }
      if (nearBarline) {
        continue
      }
      const verticalRun = maxVerticalInkRun(imageData, cx, inkThreshold, bounds.top, bounds.bottom)
      if (dense && verticalRun <= WINDOW && isLikelyBeamInk(imageData, cx, cy, inkThreshold)) {
        continue
      }
      const bandHeight = bounds.bottom - bounds.top + 1
      if (verticalRun / Math.max(1, bandHeight) > maxVerticalRatio) {
        continue
      }
      const leftMargin = Math.max(4, Math.floor(measureWidth * 0.05))
      const rightMargin = Math.max(6, Math.floor(measureWidth * 0.1))
      if (cx - bounds.left < leftMargin || bounds.right - cx < rightMargin) {
        continue
      }
      const { dark, total } = darkCountInWindow(imageData, cx, cy, inkThreshold, bounds)
      if (total === 0 || dark < MIN_DARK) {
        continue
      }
      candidates.push({ cx, cy })
    }
  }

  const merged = []
  for (const point of candidates) {
    const existing = merged.find(
      (item) =>
        Math.abs(item.cx - point.cx) <= mergeX && Math.abs(item.cy - point.cy) <= mergeY,
    )
    if (existing) {
      existing.cx = Math.round((existing.cx + point.cx) / 2)
      existing.cy = Math.round((existing.cy + point.cy) / 2)
      existing.count += 1
    } else {
      merged.push({ ...point, count: 1 })
    }
  }

  const detected = merged
    .map((item) => {
      const { cx, cy } = item
      // Shape gates on the merged blob. Applied here (not per scan point) so the
      // merge topology stays identical to the original detector — filtering raw
      // points fragments clusters and paradoxically inflates the count.
      // 1. Long horizontal ink = beam, tie/slur, ledger line or staff remnant.
      if (
        horizontalRunCovering(imageData, cx, cy, inkThreshold, bounds.left, bounds.right, midHalfW) >
        maxHorizontalRun
      ) {
        return null
      }
      // 2. Sparse neighbourhood = thin stroke fragment or faint speck (a notehead,
      //    filled or hollow, fills a notehead-sized box well above this). This is
      //    the primary discriminator against beam/stem/text false positives.
      if (fillRatio(imageData, cx, cy, inkThreshold, bounds, midHalfW, midHalfH) < minMidFill) {
        return null
      }
      // 3. Over-dense neighbourhood = inside a beam body, thick text or barline.
      //    (Replaces the dead `dark > maxDark` ceiling, which could never fire.)
      if (fillRatio(imageData, cx, cy, inkThreshold, bounds, outerHalfW, outerHalfH) > maxOuterFill) {
        return null
      }
      // 4. Roughly round bounding box = notehead; reject elongated stroke fragments
      //    (the dot/speck case is already covered by the mid-fill gate above).
      const blob = inkBoundingBox(imageData, cx, cy, inkThreshold, outerHalfW, outerHalfH)
      if (blob.count === 0) {
        return null
      }
      const aspect = blob.w / Math.max(1, blob.h)
      if (aspect < minAspect || aspect > maxAspect) {
        return null
      }

      const yNorm = item.cy / height
      const xNorm = item.cx / width
      const pitchMapping = resolvePitchFromGrandStaff(
        yNorm,
        measureBox.staffLines,
        measureBox.staffClefs,
      )
      const clef = pitchMapping.clef
      const midi = pitchMapping.midi
      if (midi == null) {
        return null
      }
      const lineYs = pitchMapping.lineYs
      const ledger = estimateLedgerLineCount(yNorm, lineYs)
      const positionInMeasure = (item.cx - bounds.left) / Math.max(1, measureWidth)
      return {
        midi,
        clef,
        cx: item.cx,
        cy: item.cy,
        xNorm,
        yNorm,
        ledger,
        pitchMapping,
        positionInMeasure,
        measureNumber: measureBox.measureNumber,
        page: measureBox.page,
      }
    })
    .filter(Boolean)

  if (dense && !skipDenseFallback) {
    const normalDetected = detectNoteheadsInMeasure(imageData, measureBox, inkThreshold, {
      ...options,
      dense: false,
      skipDenseFallback: true,
    })
    for (const note of normalDetected) {
      const alreadyDetected = detected.some(
        (entry) => Math.abs(entry.cx - note.cx) <= MERGE_X && Math.abs(entry.cy - note.cy) <= MERGE_Y,
      )
      if (!alreadyDetected) {
        detected.push(note)
      }
    }
  }

  return detected.sort((left, right) => left.cx - right.cx || left.cy - right.cy)
}
