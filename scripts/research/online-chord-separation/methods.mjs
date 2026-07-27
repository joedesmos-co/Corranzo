/**
 * Isolated research methods for on-line stacked chord separation.
 * Not wired into the production OMR detector.
 */
import { isInk } from '../../../src/features/omr/omrInk.js'
import {
  midiFromStaffPosition,
  staffLineGap,
} from '../../../src/features/omr/pitchFromStaffPosition.js'

export const DEFAULT_INK_THRESHOLD = 170

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

function inkAt(imageData, x, y, threshold = DEFAULT_INK_THRESHOLD) {
  const { data, width, height } = imageData
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return false
  }
  return isInk(data, (y * width + x) * 4, threshold)
}

function localFillRatio(imageData, cx, cy, halfW, halfH, threshold) {
  let dark = 0
  let total = 0
  for (let y = cy - halfH; y <= cy + halfH; y += 1) {
    for (let x = cx - halfW; x <= cx + halfW; x += 1) {
      total += 1
      if (inkAt(imageData, x, y, threshold)) {
        dark += 1
      }
    }
  }
  return total ? dark / total : 0
}

function verticalThickness(imageData, cx, cy, halfH, threshold) {
  let run = 0
  let maxRun = 0
  for (let y = cy - halfH; y <= cy + halfH; y += 1) {
    if (inkAt(imageData, cx, y, threshold)) {
      run += 1
      maxRun = Math.max(maxRun, run)
    } else {
      run = 0
    }
  }
  return maxRun
}

/**
 * Head-like support at a proposed center: mid-box fill + vertical thickness.
 * Uses a dual gate so hollow heads (ring ink) can still pass when vertically thick.
 */
export function hasHeadLikeInk(imageData, cx, cy, staffSpace, threshold = DEFAULT_INK_THRESHOLD) {
  const halfW = clamp(Math.round(staffSpace * 0.7), 2, 14)
  const halfH = clamp(Math.round(staffSpace * 0.55), 2, 12)
  const fill = localFillRatio(imageData, cx, cy, halfW, halfH, threshold)
  const thickness = verticalThickness(imageData, cx, cy, halfH, threshold)
  const filledOk = fill >= 0.28 && thickness >= staffSpace * 0.45
  const hollowOk = fill >= 0.16 && thickness >= staffSpace * 0.55
  return {
    ok: filledOk || hollowOk,
    fill,
    thickness,
  }
}

/**
 * 1. Local staff-line subtraction in a narrow column.
 * Removes only thin horizontal pixels near estimated local line Y values.
 */
export function subtractLocalStaffLines(imageData, {
  columnX,
  lineYsPx,
  halfWidth = 10,
  maxLineThickness = 2,
  threshold = DEFAULT_INK_THRESHOLD,
} = {}) {
  const { data, width, height } = imageData
  const out = new Uint8ClampedArray(data)
  const x0 = clamp(columnX - halfWidth, 0, width - 1)
  const x1 = clamp(columnX + halfWidth, 0, width - 1)

  for (const lineY of lineYsPx) {
    const yCenter = Math.round(lineY)
    for (let y = yCenter - maxLineThickness; y <= yCenter + maxLineThickness; y += 1) {
      if (y < 0 || y >= height) {
        continue
      }
      for (let x = x0; x <= x1; x += 1) {
        const index = (y * width + x) * 4
        if (!isInk(out, index, threshold)) {
          continue
        }
        // Keep pixels that are part of a vertically thick blob (notehead body).
        let vertical = 0
        for (let dy = -4; dy <= 4; dy += 1) {
          const yy = y + dy
          if (yy < 0 || yy >= height) {
            continue
          }
          if (isInk(out, (yy * width + x) * 4, threshold)) {
            vertical += 1
          }
        }
        if (vertical <= maxLineThickness + 1) {
          out[index] = out[index + 1] = out[index + 2] = 255
        }
      }
    }
  }
  return { data: out, width, height }
}

/**
 * 2. Vertical ink-profile splitting in a chord column.
 * Returns local maxima of row-wise ink density as candidate centers.
 */
export function splitByVerticalInkProfile(imageData, {
  columnX,
  y0,
  y1,
  halfWidth = 8,
  staffSpace,
  threshold = DEFAULT_INK_THRESHOLD,
  minPeakRatio = 0.45,
  minPeakSeparationSpaces = 0.55,
} = {}) {
  const profile = []
  for (let y = y0; y <= y1; y += 1) {
    let dark = 0
    for (let x = columnX - halfWidth; x <= columnX + halfWidth; x += 1) {
      if (inkAt(imageData, x, y, threshold)) {
        dark += 1
      }
    }
    profile.push({ y, dark })
  }
  const maxDark = Math.max(0, ...profile.map((row) => row.dark))
  if (maxDark <= 0) {
    return { centers: [], profile }
  }
  const minDark = maxDark * minPeakRatio
  const minSep = Math.max(3, Math.round(staffSpace * minPeakSeparationSpaces))
  const peaks = []
  for (let i = 1; i < profile.length - 1; i += 1) {
    const prev = profile[i - 1].dark
    const cur = profile[i].dark
    const next = profile[i + 1].dark
    if (cur >= minDark && cur >= prev && cur >= next) {
      peaks.push(profile[i])
    }
  }
  // Keep strongest peaks with separation.
  peaks.sort((a, b) => b.dark - a.dark)
  const kept = []
  for (const peak of peaks) {
    if (kept.some((existing) => Math.abs(existing.y - peak.y) < minSep)) {
      continue
    }
    const support = hasHeadLikeInk(imageData, columnX, peak.y, staffSpace, threshold)
    if (!support.ok) {
      continue
    }
    kept.push({ y: peak.y, dark: peak.dark, ...support })
  }
  kept.sort((a, b) => a.y - b.y)
  return { centers: kept.map((peak) => ({ cx: columnX, cy: peak.y, score: peak.dark })), profile }
}

/**
 * 3. Shape / lobe detection via connected-component row bands.
 * Splits a merged vertical blob into head-sized lobes using gaps in the profile.
 */
export function detectHeadLobes(imageData, {
  columnX,
  y0,
  y1,
  halfWidth = 10,
  staffSpace,
  threshold = DEFAULT_INK_THRESHOLD,
} = {}) {
  const profile = []
  for (let y = y0; y <= y1; y += 1) {
    let dark = 0
    for (let x = columnX - halfWidth; x <= columnX + halfWidth; x += 1) {
      if (inkAt(imageData, x, y, threshold)) {
        dark += 1
      }
    }
    profile.push({ y, dark })
  }
  const maxDark = Math.max(0, ...profile.map((row) => row.dark))
  const active = maxDark * 0.25
  const bands = []
  let start = null
  for (const row of profile) {
    if (row.dark >= active) {
      if (start == null) {
        start = row.y
      }
    } else if (start != null) {
      bands.push({ y0: start, y1: row.y - 1 })
      start = null
    }
  }
  if (start != null) {
    bands.push({ y0: start, y1: y1 })
  }

  const lobes = []
  for (const band of bands) {
    const height = band.y1 - band.y0 + 1
    // One notehead is ~0.7–1.1 staff spaces tall. Taller bands may be multi-lobe.
    if (height >= staffSpace * 1.35) {
      const mid = Math.round((band.y0 + band.y1) / 2)
      const candidates = [
        Math.round(band.y0 + staffSpace * 0.4),
        Math.round(band.y1 - staffSpace * 0.4),
      ]
      // Prefer interior local maxima inside the tall band.
      const inner = splitByVerticalInkProfile(imageData, {
        columnX,
        y0: band.y0,
        y1: band.y1,
        halfWidth,
        staffSpace,
        threshold,
      }).centers
      if (inner.length >= 2) {
        for (const center of inner) {
          lobes.push(center)
        }
        continue
      }
      for (const cy of candidates) {
        const support = hasHeadLikeInk(imageData, columnX, cy, staffSpace, threshold)
        if (support.ok) {
          lobes.push({ cx: columnX, cy, score: support.fill })
        }
      }
      // Fallback: endpoints of the tall band.
      if (!lobes.length) {
        lobes.push({ cx: columnX, cy: mid, score: 0.1 })
      }
    } else if (height >= staffSpace * 0.4) {
      const cy = Math.round((band.y0 + band.y1) / 2)
      const support = hasHeadLikeInk(imageData, columnX, cy, staffSpace, threshold)
      if (support.ok) {
        lobes.push({ cx: columnX, cy, score: support.fill })
      }
    }
  }
  lobes.sort((a, b) => a.cy - b.cy)
  return { centers: lobes, bands }
}

/**
 * 4. Staff-position hypothesis testing.
 * Propose centers only at valid line/space positions that have supporting ink.
 */
export function hypothesizeStaffPositions(imageData, {
  columnX,
  lineYsPx,
  clef = 'treble',
  staffSpace,
  ledgerSpaces = 2,
  threshold = DEFAULT_INK_THRESHOLD,
} = {}) {
  if (!lineYsPx?.length || !(staffSpace > 0)) {
    return { centers: [], hypotheses: [] }
  }
  const sorted = [...lineYsPx].sort((a, b) => a - b)
  const top = sorted[0]
  const bottom = sorted[sorted.length - 1]
  const gap = (bottom - top) / 4
  const lineYsNorm = sorted.map((y) => y / imageData.height)
  const hypotheses = []
  const minOffset = -ledgerSpaces * 2
  const maxOffset = 8 + ledgerSpaces * 2
  for (let diatonicOffset = minOffset; diatonicOffset <= maxOffset; diatonicOffset += 1) {
    // bottom line = offset 0; each step is half a staff space.
    const yPx = bottom - (diatonicOffset / 2) * gap
    const yNorm = yPx / imageData.height
    const midi = midiFromStaffPosition(yNorm, lineYsNorm, clef)
    if (midi == null) {
      continue
    }
    const cy = Math.round(yPx)
    const support = hasHeadLikeInk(imageData, columnX, cy, staffSpace, threshold)
    hypotheses.push({
      cy,
      diatonicOffset,
      midi,
      supported: support.ok,
      fill: support.fill,
      thickness: support.thickness,
    })
  }
  const centers = hypotheses
    .filter((hypothesis) => hypothesis.supported)
    .map((hypothesis) => ({
      cx: columnX,
      cy: hypothesis.cy,
      score: hypothesis.fill,
      midi: hypothesis.midi,
    }))
  return { centers, hypotheses }
}

/**
 * 5. Merge prevention scoring.
 * Given raw candidates, refuse merges that land on an unsupported midpoint.
 */
export function preventUnsupportedMidpointMerge(candidates, imageData, {
  staffSpace,
  mergeX = 7,
  mergeY = 5,
  threshold = DEFAULT_INK_THRESHOLD,
} = {}) {
  const sorted = [...candidates].sort((a, b) => a.cy - b.cy || a.cx - b.cx)
  const clusters = []
  for (const point of sorted) {
    const host = clusters.find((cluster) => {
      if (Math.abs(cluster.cx - point.cx) > mergeX) {
        return false
      }
      const minCy = Math.min(...cluster.members.map((member) => member.cy))
      const maxCy = Math.max(...cluster.members.map((member) => member.cy))
      if (point.cy < minCy - mergeY || point.cy > maxCy + mergeY) {
        return false
      }
      const nextMin = Math.min(minCy, point.cy)
      const nextMax = Math.max(maxCy, point.cy)
      // Allow merge only within one head body.
      if (nextMax - nextMin > staffSpace * 0.78) {
        return false
      }
      return true
    })
    if (host) {
      host.members.push(point)
      host.cx = Math.round(host.members.reduce((sum, member) => sum + member.cx, 0) / host.members.length)
      host.cy = Math.round(host.members.reduce((sum, member) => sum + member.cy, 0) / host.members.length)
    } else {
      clusters.push({ cx: point.cx, cy: point.cy, members: [point] })
    }
  }

  // Split any cluster whose centroid lacks head ink while members at ±0.5ss do.
  const centers = []
  for (const cluster of clusters) {
    const midSupport = hasHeadLikeInk(imageData, cluster.cx, cluster.cy, staffSpace, threshold)
    const above = hasHeadLikeInk(
      imageData,
      cluster.cx,
      Math.round(cluster.cy - staffSpace),
      staffSpace,
      threshold,
    )
    const below = hasHeadLikeInk(
      imageData,
      cluster.cx,
      Math.round(cluster.cy + staffSpace),
      staffSpace,
      threshold,
    )
    if (!midSupport.ok && above.ok && below.ok) {
      centers.push({ cx: cluster.cx, cy: Math.round(cluster.cy - staffSpace), score: above.fill })
      centers.push({ cx: cluster.cx, cy: Math.round(cluster.cy + staffSpace), score: below.fill })
      continue
    }
    centers.push({ cx: cluster.cx, cy: cluster.cy, score: midSupport.fill })
  }
  centers.sort((a, b) => a.cy - b.cy || a.cx - b.cx)
  return { centers, clusters }
}

/**
 * Combine methods for a single chord column (research ensemble, not production).
 */
export function separateOnlineChordColumn(imageData, context) {
  const {
    columnX,
    lineYsPx,
    clef = 'treble',
    yPadSpaces = 2.5,
    threshold = DEFAULT_INK_THRESHOLD,
  } = context
  const staffSpace = staffLineGap(lineYsPx.map((y) => y / imageData.height)) * imageData.height
  const sortedLines = [...lineYsPx].sort((a, b) => a - b)
  const y0 = Math.round(sortedLines[0] - staffSpace * yPadSpaces)
  const y1 = Math.round(sortedLines[sortedLines.length - 1] + staffSpace * yPadSpaces)

  const subtracted = subtractLocalStaffLines(imageData, {
    columnX,
    lineYsPx: sortedLines,
    halfWidth: Math.round(staffSpace * 0.9),
    threshold,
  })
  const profile = splitByVerticalInkProfile(subtracted, {
    columnX,
    y0,
    y1,
    staffSpace,
    threshold,
  })
  const lobes = detectHeadLobes(subtracted, {
    columnX,
    y0,
    y1,
    staffSpace,
    threshold,
  })
  const hypotheses = hypothesizeStaffPositions(imageData, {
    columnX,
    lineYsPx: sortedLines,
    clef,
    staffSpace,
    threshold,
  })
  const rawCandidates = [...profile.centers, ...lobes.centers]
  // Intentionally omit pure staff-hypotheses from the ensemble: they invent
  // extra tones on single on-line notes when neighboring line/space ink exists.
  const mergeSafe = preventUnsupportedMidpointMerge(rawCandidates, imageData, {
    staffSpace,
    threshold,
  })

  return {
    staffSpace,
    y0,
    y1,
    methods: {
      staffLineSubtraction: { applied: true },
      verticalProfile: profile,
      lobes,
      hypotheses,
      mergePrevention: mergeSafe,
    },
    proposedCenters: mergeSafe.centers,
  }
}

export { staffLineGap }
