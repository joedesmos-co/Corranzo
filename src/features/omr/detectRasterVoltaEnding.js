/**
 * Conservative raster volta (repeat ending) detection for scanned pages
 * without a PDF text layer.
 *
 * Requires joint evidence:
 *   1. Long horizontal bracket above the staff within the measure
 *   2. Short vertical start hook near the measure left
 *   3. Local digit classification of "1" or "2" in the bracket corner
 *
 * Does not run page OCR. Abstains when any of the three signals is weak.
 * Measure numbers, fingerings, beams, staff lines, and bare underlines are
 * rejected by the joint gate (bracket + hook + digit pocket).
 */

import { isInk } from './omrInk.js'

function inkAt(imageData, x, y, threshold) {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) {
    return false
  }
  return isInk(imageData.data, (py * imageData.width + px) * 4, threshold)
}

function normalizeMeasureBox(measureBox) {
  return {
    x0: measureBox.x0 ?? measureBox.xStart ?? 0,
    x1: measureBox.x1 ?? measureBox.xEnd ?? 1,
    y0: measureBox.y0 ?? measureBox.yTop ?? 0,
    y1: measureBox.y1 ?? measureBox.yBottom ?? 1,
  }
}

function staffTopPx(measureBox, staffLineYs, imageHeight) {
  if (Array.isArray(staffLineYs) && staffLineYs.length >= 5) {
    const ys = staffLineYs
      .filter(Number.isFinite)
      .map((value) => (value <= 1 ? value * imageHeight : value))
      .sort((left, right) => left - right)
    if (ys.length >= 5) {
      return Math.round(ys[0])
    }
  }
  const treble = measureBox?.staffLines?.treble
  if (Array.isArray(treble) && treble.length >= 5) {
    const ys = treble
      .map((value) => (value <= 1 ? value * imageHeight : value))
      .sort((left, right) => left - right)
    return Math.round(ys[0])
  }
  const box = normalizeMeasureBox(measureBox)
  return Math.round(box.y0 * imageHeight)
}

/**
 * Find the strongest horizontal volta candidate row above the staff.
 */
export function findVoltaBracketRow(imageData, measureBox, inkThreshold, staffLineYs = null) {
  const { width, height } = imageData
  const box = normalizeMeasureBox(measureBox)
  const x0 = Math.round(box.x0 * width)
  const x1 = Math.round(box.x1 * width)
  const span = Math.max(1, x1 - x0)
  if (span < 40) {
    return null
  }
  const staffTop = staffTopPx(measureBox, staffLineYs, height)
  const yLo = Math.max(0, staffTop - 48)
  const yHi = Math.max(yLo, staffTop - 8)
  let best = null
  for (let y = yLo; y <= yHi; y += 1) {
    let inkCount = 0
    let run = 0
    let maxRun = 0
    for (let x = x0; x <= x1; x += 1) {
      if (inkAt(imageData, x, y, inkThreshold)) {
        inkCount += 1
        run += 1
        maxRun = Math.max(maxRun, run)
      } else {
        run = 0
      }
    }
    const dens = inkCount / (span + 1)
    // Volta brackets are long thin lines spanning most of the measure.
    // Reject sparse underlines / slur crumbs / short fragments.
    if (dens < 0.42 && maxRun < span * 0.52) {
      continue
    }
    if (maxRun < span * 0.4) {
      continue
    }
    const score = dens * 0.55 + (maxRun / span) * 0.45
    if (!best || score > best.score) {
      best = { y, dens, maxRun, span, score, x0, x1, staffTop }
    }
  }
  return best
}

/**
 * Short vertical stroke at the left of the bracket (start hook).
 */
export function findVoltaStartHook(imageData, bracket, inkThreshold) {
  if (!bracket) {
    return null
  }
  const { y, x0 } = bracket
  for (let hx = x0 - 4; hx <= x0 + 16; hx += 1) {
    let vertical = 0
    for (let yy = y; yy <= y + 18; yy += 1) {
      if (
        inkAt(imageData, hx, yy, inkThreshold) ||
        inkAt(imageData, hx + 1, yy, inkThreshold)
      ) {
        vertical += 1
      }
    }
    if (vertical >= 5) {
      return { x: hx, vertical }
    }
  }
  return null
}

/**
 * Optional short vertical at the right of the bracket (stop hook).
 */
export function findVoltaStopHookAtBracket(imageData, bracket, inkThreshold) {
  if (!bracket) {
    return false
  }
  const { y, x1 } = bracket
  let vertical = 0
  for (let yy = y; yy <= y + 16; yy += 1) {
    if (
      inkAt(imageData, x1, yy, inkThreshold) ||
      inkAt(imageData, x1 - 1, yy, inkThreshold) ||
      inkAt(imageData, x1 - 2, yy, inkThreshold) ||
      inkAt(imageData, x1 - 5, yy, inkThreshold) ||
      inkAt(imageData, x1 - 8, yy, inkThreshold)
    ) {
      vertical += 1
    }
  }
  return vertical >= 4
}

function collectInkComponents(imageData, lx0, ly0, lx1, ly1, inkThreshold) {
  const W = lx1 - lx0 + 1
  const H = ly1 - ly0 + 1
  if (W < 4 || H < 4) {
    return []
  }
  const seen = new Uint8Array(W * H)
  const comps = []
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const index = y * W + x
      if (seen[index]) {
        continue
      }
      if (!inkAt(imageData, lx0 + x, ly0 + y, inkThreshold)) {
        seen[index] = 1
        continue
      }
      const queue = [[x, y]]
      seen[index] = 1
      let minx = x
      let maxx = x
      let miny = y
      let maxy = y
      let area = 0
      while (queue.length) {
        const [cx, cy] = queue.pop()
        area += 1
        minx = Math.min(minx, cx)
        maxx = Math.max(maxx, cx)
        miny = Math.min(miny, cy)
        maxy = Math.max(maxy, cy)
        for (const [dx, dy] of dirs) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
            continue
          }
          const ni = ny * W + nx
          if (seen[ni]) {
            continue
          }
          if (inkAt(imageData, lx0 + nx, ly0 + ny, inkThreshold)) {
            seen[ni] = 1
            queue.push([nx, ny])
          } else {
            seen[ni] = 1
          }
        }
      }
      if (area >= 4) {
        comps.push({
          minx,
          maxx,
          miny,
          maxy,
          area,
          w: maxx - minx + 1,
          h: maxy - miny + 1,
        })
      }
    }
  }
  return comps
}

/**
 * Classify a small ink blob as ending digit 1 or 2. Abstain otherwise.
 * Period evidence is supportive but not required when geometry is clear —
 * the bracket+hook gate already excludes ordinary measure numbers.
 */
export function classifyEndingDigitBlob(imageData, lx0, ly0, digit, inkThreshold) {
  if (!digit || digit.h < 7 || digit.w < 2 || digit.area < 10) {
    return null
  }
  // Reject tall measure-number / rehearsal-like glyphs.
  if (digit.h > 22 || digit.w > 16 || digit.area > 120) {
    return null
  }
  const bands = { top: 0, mid: 0, bot: 0, left: 0, right: 0, center: 0 }
  let total = 0
  for (let y = digit.miny; y <= digit.maxy; y += 1) {
    for (let x = digit.minx; x <= digit.maxx; x += 1) {
      if (!inkAt(imageData, lx0 + x, ly0 + y, inkThreshold)) {
        continue
      }
      total += 1
      const yr = (y - digit.miny) / Math.max(1, digit.h - 1)
      const xr = (x - digit.minx) / Math.max(1, digit.w - 1)
      if (yr < 0.33) {
        bands.top += 1
      } else if (yr > 0.66) {
        bands.bot += 1
      } else {
        bands.mid += 1
      }
      if (xr < 0.33) {
        bands.left += 1
      } else if (xr > 0.66) {
        bands.right += 1
      } else {
        bands.center += 1
      }
    }
  }
  if (total < 10) {
    return null
  }
  const aspect = digit.h / Math.max(1, digit.w)
  // "1": tall thin stem, ink concentrated in center/right columns.
  if (aspect >= 2.1 && digit.w <= 6 && bands.center + bands.right >= bands.left) {
    return 1
  }
  // "2": wider glyph with ink in top and bottom thirds.
  if (
    aspect < 2.35 &&
    digit.w >= 5 &&
    bands.top >= 2 &&
    bands.bot >= 2 &&
    bands.top + bands.bot >= bands.mid
  ) {
    return 2
  }
  return null
}

/**
 * Read ending label "1." / "2." from the pocket just above the bracket start.
 */
export function classifyVoltaEndingLabel(
  imageData,
  bracket,
  hook,
  inkThreshold,
) {
  if (!bracket || !hook) {
    return null
  }
  const lx0 = Math.max(0, hook.x - 2)
  const lx1 = Math.min(imageData.width - 1, hook.x + 28)
  const ly0 = Math.max(0, bracket.y - 30)
  const ly1 = Math.max(ly0 + 1, bracket.y - 2)
  const comps = collectInkComponents(imageData, lx0, ly0, lx1, ly1, inkThreshold)
  const digitCands = comps
    .filter((comp) => comp.h >= 7 && comp.w >= 2 && comp.area >= 10)
    .sort((left, right) => right.area - left.area)
  const periodCands = comps.filter(
    (comp) => comp.area <= 20 && comp.h <= 7 && comp.w <= 7 && comp.h < 8,
  )
  for (const digit of digitCands) {
    const number = classifyEndingDigitBlob(imageData, lx0, ly0, digit, inkThreshold)
    if (number == null) {
      continue
    }
    const periodRight = periodCands.some(
      (period) =>
        period.minx >= digit.maxx - 2 &&
        period.minx <= digit.maxx + 10 &&
        Math.abs((period.miny + period.maxy) / 2 - (digit.miny + digit.maxy) / 2) <=
          digit.h + 2,
    )
    return {
      endingStartNumbers: [number],
      confidence: periodRight ? 0.86 : 0.82,
      periodRight,
      source: 'raster',
    }
  }
  return null
}

/**
 * Detect a first/second ending from raster bracket + local digit evidence.
 */
export function detectVoltaFromRaster(
  imageData,
  measureBox,
  inkThreshold,
  { staffLineYs = null } = {},
) {
  if (!imageData?.width || !imageData?.height || !measureBox) {
    return null
  }
  const bracket = findVoltaBracketRow(imageData, measureBox, inkThreshold, staffLineYs)
  if (!bracket) {
    return null
  }
  const hook = findVoltaStartHook(imageData, bracket, inkThreshold)
  if (!hook) {
    return null
  }
  const label = classifyVoltaEndingLabel(imageData, bracket, hook, inkThreshold)
  if (!label) {
    return null
  }
  const endingStop = findVoltaStopHookAtBracket(imageData, bracket, inkThreshold)
  return {
    endingStartNumbers: label.endingStartNumbers,
    endingStop: endingStop || undefined,
    confidence: Math.max(label.confidence, endingStop ? 0.88 : label.confidence),
    source: 'raster',
  }
}
