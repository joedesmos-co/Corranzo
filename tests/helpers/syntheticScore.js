/**
 * Deterministic synthetic sheet-music images for score-follow geometry tests.
 *
 * Produces `{ width, height, data }` ImageData-shaped objects (RGBA
 * Uint8ClampedArray, white background, dark ink) that the staff/barline
 * detectors consume directly — no native canvas / PDF rasteriser required.
 *
 * A "system" here is a piano grand staff (treble + bass, drawn close together
 * so the detector merges them into one band, as real engraving does).
 */

import { rotateImageData } from '../../src/features/score-follow/pageOrientation.js'

const INK = 24
const PAGE_BG = 255

export function createPage(width = 460, height = 620) {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(PAGE_BG) // white, alpha 255
  return { width, height, data }
}

function setPx(img, x, y, value) {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= img.width || py >= img.height) {
    return
  }
  const index = (py * img.width + px) * 4
  img.data[index] = value
  img.data[index + 1] = value
  img.data[index + 2] = value
  // alpha left at 255
}

function hLine(img, y, x0, x1, value = INK) {
  for (let x = x0; x <= x1; x += 1) {
    setPx(img, x, y, value)
  }
}

function vLine(img, x, y0, y1, value = INK) {
  for (let y = y0; y <= y1; y += 1) {
    setPx(img, x, y, value)
  }
}

function fillRect(img, x0, y0, x1, y1, value = INK) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPx(img, x, y, value)
    }
  }
}

/** Draw a 5-line staff. Returns the bottom y. */
function drawStaff(img, topY, x0, x1, { lineGap = 5, lineValue = INK } = {}) {
  for (let line = 0; line < 5; line += 1) {
    hLine(img, topY + line * lineGap, x0, x1, lineValue)
  }
  return topY + 4 * lineGap
}

/** Draw a piano grand staff (treble + bass). Returns { top, bottom }. */
function drawGrandStaff(img, topY, x0, x1, { lineGap = 5, innerGap = 10 } = {}) {
  const trebleBottom = drawStaff(img, topY, x0, x1, { lineGap })
  const bassTop = trebleBottom + innerGap
  const bassBottom = drawStaff(img, bassTop, x0, x1, { lineGap })
  return { top: topY, bottom: bassBottom }
}

/** A few short strokes near the top — a title/composer block to be ignored. */
function drawHeader(img) {
  const cx0 = Math.floor(img.width * 0.3)
  const cx1 = Math.floor(img.width * 0.7)
  for (let line = 0; line < 3; line += 1) {
    hLine(img, Math.floor(img.height * 0.03) + line * 4, cx0, cx1, 60)
  }
}

/** Footer/page-number text near the bottom margin. */
function drawFooter(img) {
  const y = Math.floor(img.height * 0.93)
  for (let line = 0; line < 2; line += 1) {
    hLine(img, y + line * 4, Math.floor(img.width * 0.38), Math.floor(img.width * 0.62), 60)
  }
}

/** Strong title/footer bands that can bias naive page-level orientation. */
export function cleanPianoPageWithEdgeText(options = {}) {
  const img = cleanPianoPage({ ...options, header: false })
  for (let line = 0; line < 5; line += 1) {
    hLine(
      img,
      Math.floor(img.height * 0.02) + line * 5,
      Math.floor(img.width * 0.12),
      Math.floor(img.width * 0.88),
      40,
    )
  }
  drawFooter(img)
  return img
}

/**
 * Mixed scan orientations like Winter: middle pages scanned one quarter-turn,
 * first/last scanned the opposite way with extra title/footer text.
 */
export function winterLikeMixedScanPages(pageCount = 8) {
  const middleScan = (page) => rotateImageData(page, 90)
  const edgeScan = (page) => rotateImageData(page, 270)

  return Array.from({ length: pageCount }, (_, index) => {
    const edge = index === 0 || index === pageCount - 1
    const upright = edge
      ? cleanPianoPageWithEdgeText({ systems: 3, measuresPerSystem: 4 })
      : cleanPianoPage({ systems: 3, measuresPerSystem: 4, header: false })
    return edge ? edgeScan(upright) : middleScan(upright)
  })
}

/** Scatter noteheads + stems across a system band to mimic dense notation. */
function addDenseNotation(img, top, bottom, x0, x1, { columns = 26 } = {}) {
  const step = (x1 - x0) / columns
  for (let c = 0; c < columns; c += 1) {
    const cx = Math.floor(x0 + c * step + step * 0.3)
    // noteheads at a few vertical positions within the staff
    for (let row = 0; row < 5; row += 1) {
      const ny = Math.floor(top + ((bottom - top) * (row + 0.5)) / 5) + ((c % 2) * 3 - 1)
      fillRect(img, cx, ny - 1, cx + 4, ny + 2)
      // stem
      vLine(img, cx + 4, ny - 10, ny)
    }
    // ledger lines for some columns
    if (c % 4 === 0) {
      hLine(img, top - 4, cx - 2, cx + 6)
      hLine(img, bottom + 4, cx - 2, cx + 6)
    }
  }
}

/** Dense beamed eighth-note texture — stems + horizontal beams between groups. */
function addBeamedNotation(img, top, bottom, x0, x1, { columns = 40, beamGroup = 4 } = {}) {
  const step = (x1 - x0) / columns
  const trebleMid = Math.floor(top + (bottom - top) * 0.28)
  const bassMid = Math.floor(top + (bottom - top) * 0.72)
  for (let c = 0; c < columns; c += 1) {
    const cx = Math.floor(x0 + c * step + step * 0.15)
    for (const ny of [trebleMid - 6, trebleMid, trebleMid + 6, bassMid - 4, bassMid + 4]) {
      fillRect(img, cx, ny - 1, cx + 3, ny + 2)
      vLine(img, cx + 3, ny - 8, ny + 2)
    }
    if (c % beamGroup !== beamGroup - 1) {
      const beamY = trebleMid - 14
      hLine(img, beamY, cx, cx + Math.floor(step * 0.95))
      hLine(img, beamY + 1, cx, cx + Math.floor(step * 0.95))
      const bassBeamY = bassMid + 12
      hLine(img, bassBeamY, cx, cx + Math.floor(step * 0.95))
    }
  }
}

function drawSystemBarlines(img, band, x0, x1, measures, width) {
  const fracs = []
  for (let m = 0; m <= measures; m += 1) {
    const bx = Math.floor(x0 + ((x1 - x0) * m) / measures)
    for (let dx = 0; dx < 3; dx += 1) {
      vLine(img, bx + dx, band.top, band.bottom, INK)
    }
    fracs.push(bx / width)
  }
  return fracs
}

/**
 * Clean one-page piano score: evenly spaced grand-staff systems with barlines.
 * Also returns system metadata for assertions.
 */
export function cleanPianoPage({
  width = 460,
  height = 640,
  systems = 3,
  measuresPerSystem = 4,
  measuresPerSystemList = null,
  barlines = true,
  header = true,
} = {}) {
  const systemCount = measuresPerSystemList ? measuresPerSystemList.length : systems
  const measuresFor = (s) =>
    measuresPerSystemList ? measuresPerSystemList[s] : measuresPerSystem
  // Fixed grand-staff height + a modest inter-system gap, like engraved music.
  // (Large gaps would make the valley-split detector return loose bands.)
  const lineGap = 5
  const innerGap = 10
  const staffHeight = 4 * lineGap + innerGap + 4 * lineGap // treble + gap + bass
  const gap = 30
  const topFrac = 0.18

  const pageHeight = Math.max(
    height,
    Math.ceil((Math.floor(640 * topFrac) + systemCount * (staffHeight + gap) + 40)),
  )
  const img = createPage(width, pageHeight)
  const x0 = Math.floor(width * 0.08)
  const x1 = Math.floor(width * 0.92)
  if (header) {
    drawHeader(img)
  }

  const top = Math.floor(pageHeight * topFrac)
  const systemBands = []
  const systemBarlineFracs = []

  for (let s = 0; s < systemCount; s += 1) {
    const sysTop = top + s * (staffHeight + gap)
    const band = drawGrandStaff(img, sysTop, x0, x1, { lineGap, innerGap })
    systemBands.push(band)
    if (barlines) {
      const measures = measuresFor(s)
      const fracs = []
      for (let m = 0; m <= measures; m += 1) {
        const bx = Math.floor(x0 + ((x1 - x0) * m) / measures)
        // 2px wide: the column peak survives ±2 smoothing in barline detection
        // without flooding the inter-line gaps (which would look "dense").
        vLine(img, bx, band.top, band.bottom)
        vLine(img, bx + 1, band.top, band.bottom)
        fracs.push(bx / width)
      }
      systemBarlineFracs.push(fracs)
    }
  }

  img.systemBands = systemBands
  if (barlines) {
    img.systemBarlineFracs = systemBarlineFracs
  }
  return img
}

/**
 * Multi-page synthetic score with explicit per-page, per-system measure counts —
 * the structure needed to reproduce a real piece's visual layout (e.g. Guren).
 * `pageSpecs` is an array (one per page) of arrays of measures-per-system.
 * Returns an array of page ImageData.
 */
export function multiPageScoreWithCounts(pageSpecs) {
  return pageSpecs.map((measuresPerSystemList) =>
    cleanPianoPage({ measuresPerSystemList, barlines: true, header: true }),
  )
}

/**
 * Page where the title sits just above the first staff with only a thin gap, so
 * the detector's first band merges title + first system and straddles the header
 * cutoff — the exact layout that used to drop the first system entirely.
 */
export function titledFirstSystemPage({ systems = 4, measuresPerSystem = 4, width = 460 } = {}) {
  const lineGap = 5
  const innerGap = 10
  const staffHeight = 4 * lineGap + innerGap + 4 * lineGap // 50
  const gap = 34
  // Tall page so the header cutoff (~11% tolerant) lands in pixels, and place the
  // title + first staff near the very top with only a thin gap, so they merge
  // into one band that straddles the cutoff (the Minuet failure mode).
  const pageHeight = 640
  const titleTop = 26
  const firstStaffTop = 56 // y0 ≈ 0.088 < tolerant cutoff 0.11 → straddles
  const img = createPage(width, pageHeight)
  const x0 = Math.floor(width * 0.08)
  const x1 = Math.floor(width * 0.92)

  // Title / composer block just above the first staff (thin gap → merges).
  for (let line = 0; line < 2; line += 1) {
    hLine(img, titleTop + line * 6, Math.floor(width * 0.32), Math.floor(width * 0.68), 50)
  }

  const systemBands = []
  for (let s = 0; s < systems; s += 1) {
    const sysTop = firstStaffTop + s * (staffHeight + gap)
    const band = drawGrandStaff(img, sysTop, x0, x1, { lineGap, innerGap })
    systemBands.push(band)
    for (let m = 0; m <= measuresPerSystem; m += 1) {
      const bx = Math.floor(x0 + ((x1 - x0) * m) / measuresPerSystem)
      vLine(img, bx, band.top, band.bottom)
      vLine(img, bx + 1, band.top, band.bottom)
    }
  }
  img.systemBands = systemBands
  img.firstStaffCenterNorm = (systemBands[0].top + systemBands[0].bottom) / (2 * pageHeight)
  return img
}

/** Dense arrangement (anime/game style): many noteheads, ledger lines, stems. */
export function densePianoPage({
  width = 480,
  height = 660,
  systems = 5,
  measuresPerSystem = 6,
} = {}) {
  const img = cleanPianoPage({
    width,
    height,
    systems,
    measuresPerSystem,
    barlines: true,
    header: true,
  })
  const x0 = Math.floor(width * 0.08)
  const x1 = Math.floor(width * 0.92)
  for (const band of img.systemBands) {
    addDenseNotation(img, band.top, band.bottom, x0, x1)
  }
  return img
}

/**
 * Dense beamed piano (game/anime style): thick barlines plus beamed eighth-note
 * grids. Real barlines must survive stem/beam clutter — regression for scores
 * like Spider Dance where too-few-barlines used to collapse calibration.
 */
export function denseBeamedPianoPage({
  width = 480,
  height = 660,
  systems = 4,
  measuresPerSystem = 5,
} = {}) {
  const lineGap = 5
  const innerGap = 10
  const staffHeight = 4 * lineGap + innerGap + 4 * lineGap
  const gap = 30
  const topFrac = 0.18
  const pageHeight = Math.max(
    height,
    Math.ceil(Math.floor(640 * topFrac) + systems * (staffHeight + gap) + 40),
  )
  const img = createPage(width, pageHeight)
  const x0 = Math.floor(width * 0.08)
  const x1 = Math.floor(width * 0.92)
  drawHeader(img)

  const top = Math.floor(pageHeight * topFrac)
  const systemBands = []
  const systemBarlineFracs = []
  for (let s = 0; s < systems; s += 1) {
    const sysTop = top + s * (staffHeight + gap)
    const band = drawGrandStaff(img, sysTop, x0, x1, { lineGap, innerGap })
    systemBands.push(band)
    systemBarlineFracs.push(drawSystemBarlines(img, band, x0, x1, measuresPerSystem, width))
    addBeamedNotation(img, band.top, band.bottom, x0, x1, { columns: 44 })
    addDenseNotation(img, band.top, band.bottom, x0, x1, { columns: 30 })
  }

  img.systemBands = systemBands
  img.systemBarlineFracs = systemBarlineFracs
  img.measuresPerSystem = measuresPerSystem
  return img
}

/** Staff lines visible but barlines weak/absent. */
export function weakBarlinePage(options = {}) {
  return cleanPianoPage({ ...options, barlines: false })
}

/** Two-page score; returns an array of pages. */
export function multiPageScore({
  pages = 2,
  systemsPerPage = 3,
  measuresPerSystem = 4,
} = {}) {
  return Array.from({ length: pages }, () =>
    cleanPianoPage({ systems: systemsPerPage, measuresPerSystem }),
  )
}

/**
 * Light classical-piano page (Satie / Gymnopédie style): THIN, LIGHT-gray staff
 * lines, SHORTER systems that don't span the page, large vertical whitespace,
 * and slur arcs that cross the gaps between systems. This is the layout that
 * defeated the fixed-threshold detector and returned "no systems".
 */
export function lightClassicalPage({
  width = 480,
  height = 1000,
  systems = 4,
  measuresPerSystem = 4,
  lineValue = 185, // light gray (not near-black)
} = {}) {
  const img = createPage(width, height)
  // Short systems: ~68% of width, centered-ish (lots of left/right margin).
  const x0 = Math.floor(width * 0.17)
  const x1 = Math.floor(width * 0.85)
  const lineGap = 4 // thin staff (5 lines × 4px)
  const staffHeight = 4 * lineGap // 16
  const innerGap = 22 // treble↔bass: detected as two separate staves
  const grandHeight = staffHeight + innerGap + staffHeight // 54
  const systemGap = 52 // > innerGap → clean bimodal separation for pairing
  const top = Math.floor(height * 0.14)

  const drawLightStaff = (topY) => {
    for (let l = 0; l < 5; l += 1) {
      hLine(img, topY + l * lineGap, x0, x1, lineValue)
    }
  }

  const systemBands = []
  const systemBarlineFracs = []
  for (let s = 0; s < systems; s += 1) {
    const sysTop = top + s * (grandHeight + systemGap)
    drawLightStaff(sysTop)
    const bassTop = sysTop + staffHeight + innerGap
    drawLightStaff(bassTop)
    const bandBottom = bassTop + staffHeight
    systemBands.push({ top: sysTop, bottom: bandBottom })

    // Light barlines spanning the grand staff (treble top → bass bottom).
    const fracs = []
    for (let m = 0; m <= measuresPerSystem; m += 1) {
      const bx = Math.floor(x0 + ((x1 - x0) * m) / measuresPerSystem)
      vLine(img, bx, sysTop, bandBottom, lineValue)
      fracs.push(bx / width)
    }
    systemBarlineFracs.push(fracs)
    // A couple of sparse noteheads.
    for (let n = 0; n < measuresPerSystem * 2; n += 1) {
      const cx = x0 + Math.floor(((x1 - x0) * n) / (measuresPerSystem * 2)) + 6
      fillRect(img, cx, sysTop + 6, cx + 3, sysTop + 9, 60)
    }

    // Slur arc in the whitespace BELOW the system (crosses toward the next one).
    if (s < systems - 1) {
      const arcY = bandBottom + Math.floor(systemGap / 2)
      for (let k = 0; k <= 30; k += 1) {
        const ax = x0 + Math.floor(((x1 - x0) * 0.3 * k) / 30)
        const ay = arcY - Math.round(6 * Math.sin((Math.PI * k) / 30))
        setPx(img, ax, ay, 90)
      }
    }
  }
  img.systemBands = systemBands
  img.systemBarlineFracs = systemBarlineFracs
  return img
}

/**
 * Hungarian Dance-style page: full-width grand staves with thin/light staff lines
 * plus very dense piano notation (broken staff-line runs). Exercises the faint-
 * line pass that dense dark ink otherwise hides from the adaptive threshold.
 */
export function hungarianDanceStylePage({
  width = 480,
  height = 1200,
  systems = 5,
  measuresPerSystem = 4,
  lineValue = 200,
} = {}) {
  const lineGap = 5
  const innerGap = 10
  const staffHeight = 4 * lineGap + innerGap + 4 * lineGap
  const gap = 28
  const top = Math.floor(height * 0.12)
  const img = createPage(width, height)
  const x0 = Math.floor(width * 0.08)
  const x1 = Math.floor(width * 0.92)
  drawHeader(img)

  const systemBands = []
  const systemBarlineFracs = []
  for (let s = 0; s < systems; s += 1) {
    const sysTop = top + s * (staffHeight + gap)
    const trebleBottom = drawStaff(img, sysTop, x0, x1, { lineGap, lineValue })
    const bassTop = trebleBottom + innerGap
    const bassBottom = drawStaff(img, bassTop, x0, x1, { lineGap, lineValue })
    const band = { top: sysTop, bottom: bassBottom }
    systemBands.push(band)

    const fracs = []
    for (let m = 0; m <= measuresPerSystem; m += 1) {
      const bx = Math.floor(x0 + ((x1 - x0) * m) / measuresPerSystem)
      vLine(img, bx, band.top, band.bottom)
      vLine(img, bx + 1, band.top, band.bottom)
      fracs.push(bx / width)
    }
    systemBarlineFracs.push(fracs)
    addDenseNotation(img, band.top, band.bottom, x0, x1, { columns: 34 })
  }

  img.systemBands = systemBands
  img.systemBarlineFracs = systemBarlineFracs
  return img
}

/**
 * A clean page whose measures are UNEVENLY spaced within each system (e.g. a
 * wide clef/key-bearing first measure, then narrower ones). Even distribution
 * mis-places the inner measure boundaries; detected barlines place them exactly.
 *
 * `systemBarlineFracs` is an array (one per system) of normalized barline x
 * fractions (within [0,1] of page width), length = measuresPerSystem + 1, that
 * are drawn AND returned as ground truth.
 */
export function unevenMeasurePage({
  width = 460,
  height = 640,
  systemBarlineFracs = [
    [0.08, 0.34, 0.5, 0.66, 0.92],
    [0.08, 0.3, 0.52, 0.74, 0.92],
  ],
} = {}) {
  const lineGap = 5
  const innerGap = 10
  const staffHeight = 4 * lineGap + innerGap + 4 * lineGap
  const gap = 30
  const topFrac = 0.18
  const systemCount = systemBarlineFracs.length
  const pageHeight = Math.max(
    height,
    Math.ceil(Math.floor(640 * topFrac) + systemCount * (staffHeight + gap) + 40),
  )
  const img = createPage(width, pageHeight)
  const x0 = Math.floor(width * (systemBarlineFracs[0][0] - 0.0))
  const x1 = Math.floor(width * systemBarlineFracs[0][systemBarlineFracs[0].length - 1])
  drawHeader(img)
  const top = Math.floor(pageHeight * topFrac)
  const systemBands = []
  systemBarlineFracs.forEach((fracs, s) => {
    const sysTop = top + s * (staffHeight + gap)
    const band = drawGrandStaff(img, sysTop, x0, x1, { lineGap, innerGap })
    systemBands.push(band)
    for (const frac of fracs) {
      const bx = Math.floor(width * frac)
      vLine(img, bx, band.top, band.bottom)
      vLine(img, bx + 1, band.top, band.bottom)
    }
  })
  img.systemBands = systemBands
  img.systemBarlineFracs = systemBarlineFracs
  return img
}

/**
 * Build ground-truth reference anchors from synthetic pages that expose
 * `systemBarlineFracs` (clean / light / uneven pages). Measure numbers run
 * sequentially in reading order; geometry fields mirror the drawn barlines, so
 * detected anchors can be scored against the true printed measure boundaries.
 */
export function groundTruthAnchors(pages) {
  const anchors = []
  let measureNumber = 1
  let systemIndex = 0
  pages.forEach((page, pageIndex) => {
    for (const fracs of page.systemBarlineFracs ?? []) {
      const n = fracs.length - 1
      const systemEndX = fracs[n]
      for (let i = 0; i < n; i += 1) {
        anchors.push({
          page: pageIndex + 1,
          measureNumber,
          meta: {
            systemIndex,
            measureStartX: fracs[i],
            playableStartX: fracs[i],
            playableEndX: fracs[i + 1],
            systemEndX,
          },
        })
        measureNumber += 1
      }
      systemIndex += 1
    }
  })
  return anchors
}

function drawHollowNotehead(img, cx, cy, { w = 4, h = 3 } = {}) {
  for (let y = cy - h; y <= cy + h; y += 1) {
    for (let x = cx - w; x <= cx + w; x += 1) {
      const onEdge = x <= cx - w + 1 || x >= cx + w - 1 || y <= cy - h + 1 || y >= cy + h - 1
      if (onEdge) {
        setPx(img, x, y, INK)
      }
    }
  }
}

function drawFilledNotehead(img, cx, cy, { w = 4, h = 3 } = {}) {
  fillRect(img, cx - w, cy - h, cx + w, cy + h)
}

function drawStem(img, cx, cy, { up = true, length = 22 } = {}) {
  const stemX = cx + 4
  if (up) {
    vLine(img, stemX, cy - length, cy - 1)
  } else {
    vLine(img, stemX, cy + 1, cy + length)
  }
  return { stemX, tipY: up ? cy - length : cy + length }
}

function drawBeam(img, x0, x1, y) {
  hLine(img, y, x0, x1)
  hLine(img, y + 1, x0, x1)
}

function drawDot(img, cx, cy) {
  fillRect(img, cx + 8, cy - 1, cx + 10, cy + 1)
}

function drawQuarterRest(img, cx, cy) {
  for (let y = cy - 4; y <= cy + 4; y += 2) {
    fillRect(img, cx - 2, y, cx + 2, y + 1)
  }
}

function drawRhythmNote(img, cx, cy, spec = {}) {
  const {
    kind = 'quarter',
    stemUp = true,
    beamToX = null,
    dotted = false,
    tie = false,
  } = spec

  if (kind === 'whole') {
    drawHollowNotehead(img, cx, cy)
    return
  }

  const hollow = kind === 'half'
  if (hollow) {
    drawHollowNotehead(img, cx, cy)
  } else {
    drawFilledNotehead(img, cx, cy)
  }

  if (kind === 'half' || kind === 'quarter' || kind === 'eighth' || kind === 'sixteenth') {
    const stem = drawStem(img, cx, cy, {
      up: stemUp,
      length: kind === 'half' ? 28 : 22,
    })
    if ((kind === 'eighth' || kind === 'sixteenth') && beamToX != null) {
      const beamY = stemUp ? stem.tipY : stem.tipY
      drawBeam(img, stem.stemX, beamToX, beamY)
      if (kind === 'sixteenth') {
        drawBeam(img, stem.stemX, beamToX, beamY + (stemUp ? 4 : -4))
      }
    }
  }

  if (dotted) {
    drawDot(img, cx, cy)
  }

  if (tie) {
    for (let x = cx + 5; x <= cx + 18; x += 1) {
      const arcY = cy - 4 - Math.round(3 * Math.sin(((x - cx) / 18) * Math.PI))
      setPx(img, x, arcY, INK)
    }
  }
}

/**
 * One-system piano page with explicit rhythmic patterns per measure (for OMR v2 tests).
 * `patterns` is an array (one per measure) of note specs: { kind, xFrac, stemUp?, beamToXFrac?, dotted?, tie? }
 * or `{ kind: 'rest', xFrac }`.
 */
export function rhythmicPianoPage({
  width = 460,
  height = 640,
  measuresPerSystem = 4,
  patterns = null,
} = {}) {
  const img = cleanPianoPage({
    width,
    height,
    systems: 1,
    measuresPerSystem,
    barlines: true,
    header: false,
  })
  const x0 = Math.floor(width * 0.08)
  const x1 = Math.floor(width * 0.92)
  const band = img.systemBands[0]
  const lineGap = 5
  const trebleY = band.top + lineGap * 2 + 2
  const defaultPatterns = [
    [
      { kind: 'quarter', xFrac: 0.12 },
      { kind: 'quarter', xFrac: 0.32 },
      { kind: 'quarter', xFrac: 0.52 },
      { kind: 'quarter', xFrac: 0.72 },
    ],
    [
      { kind: 'half', xFrac: 0.2, stemUp: true },
      { kind: 'half', xFrac: 0.62, stemUp: true },
    ],
    (() => {
      const notes = []
      for (let i = 0; i < 4; i += 1) {
        const xFrac = 0.1 + i * 0.2
        notes.push({
          kind: 'eighth',
          xFrac,
          stemUp: true,
          beamToXFrac: 0.1 + (i + 1) * 0.2 - 0.04,
        })
      }
      return notes
    })(),
    [
      { kind: 'rest', xFrac: 0.14 },
      { kind: 'quarter', xFrac: 0.38 },
      { kind: 'quarter', xFrac: 0.58, dotted: true },
      { kind: 'quarter', xFrac: 0.78, tie: true },
    ],
  ]

  const measurePatterns = patterns ?? defaultPatterns

  for (let measure = 0; measure < measuresPerSystem; measure += 1) {
    const measureX0 = x0 + ((x1 - x0) * measure) / measuresPerSystem
    const measureX1 = x0 + ((x1 - x0) * (measure + 1)) / measuresPerSystem
    const measureWidth = measureX1 - measureX0
    const specs = measurePatterns[measure] ?? []

    for (const spec of specs) {
      const cx = Math.floor(measureX0 + measureWidth * spec.xFrac)
      if (spec.kind === 'rest') {
        drawQuarterRest(img, cx, trebleY + 8)
        continue
      }
      const beamToX =
        spec.beamToXFrac != null
          ? Math.floor(measureX0 + measureWidth * spec.beamToXFrac)
          : null
      drawRhythmNote(img, cx, trebleY, {
        kind: spec.kind,
        stemUp: spec.stemUp ?? true,
        beamToX,
        dotted: spec.dotted,
        tie: spec.tie,
      })
    }
  }

  img.rhythmicPatterns = measurePatterns
  return img
}

function drawSharpGlyph(img, cx, cy) {
  vLine(img, cx, cy - 6, cy + 6)
  hLine(img, cy - 3, cx - 3, cx + 1)
  hLine(img, cy + 1, cx - 3, cx + 1)
  hLine(img, cy - 2, cx + 1, cx + 4)
  hLine(img, cy + 2, cx + 1, cx + 4)
}

function drawFlatGlyph(img, cx, cy) {
  vLine(img, cx, cy - 5, cy + 5)
  for (let y = cy; y <= cy + 4; y += 1) {
    setPx(img, cx + 2, y, INK)
    setPx(img, cx + 3, y, INK)
  }
}

function drawRepeatDots(img, x, y0, y1) {
  const mid = Math.floor((y0 + y1) / 2)
  fillRect(img, x - 1, mid - 2, x + 1, mid + 2)
  fillRect(img, x - 1, mid - 10, x + 1, mid - 6)
}

function drawRepeatBarline(img, x, y0, y1) {
  vLine(img, x, y0, y1)
  vLine(img, x + 3, y0, y1)
  drawRepeatDots(img, x - 7, y0, y1)
}

function drawLedgerLines(img, cx, cy, staffTop, staffBottom, count, direction = 'above') {
  const gap = 5
  for (let i = 1; i <= count; i += 1) {
    const y =
      direction === 'above'
        ? staffTop - i * gap
        : staffBottom + i * gap
    hLine(img, y, cx - 5, cx + 5)
  }
}

/**
 * Synthetic page for OMR v3 musical details: key signature, accidental, ledger line, repeat.
 */
export function musicalPianoPage({
  width = 460,
  height = 640,
  measuresPerSystem = 3,
} = {}) {
  const img = cleanPianoPage({
    width,
    height,
    systems: 1,
    measuresPerSystem,
    barlines: true,
    header: false,
  })
  const x0 = Math.floor(width * 0.08)
  const x1 = Math.floor(width * 0.92)
  const band = img.systemBands[0]
  const lineGap = 5
  const trebleLines = [0, 1, 2, 3, 4].map((i) => band.top + i * lineGap)
  const measureWidth = (x1 - x0) / measuresPerSystem

  // G major key signature — one sharp on the top (F#) line.
  drawSharpGlyph(img, x0 + 12, trebleLines[0])

  // Measure 1: C quarter + F# with accidental + high C with ledger line.
  const m1x = x0 + Math.floor(measureWidth * 0.25)
  const m1x2 = x0 + Math.floor(measureWidth * 0.55)
  const m1x3 = x0 + Math.floor(measureWidth * 0.8)
  const fNaturalY = trebleLines[4] - 3
  drawFilledNotehead(img, m1x, trebleLines[2])
  drawStem(img, m1x, trebleLines[2], { up: true })
  drawSharpGlyph(img, m1x2 - 10, fNaturalY)
  drawFilledNotehead(img, m1x2, fNaturalY)
  drawStem(img, m1x2, fNaturalY, { up: true })
  const highY = trebleLines[0] - lineGap
  drawLedgerLines(img, m1x3, highY, trebleLines[0], trebleLines[4], 1, 'above')
  drawFilledNotehead(img, m1x3, highY)
  drawStem(img, m1x3, highY, { up: true })

  // Measure 2: half note + backward repeat barline.
  const m2x = x0 + measureWidth + Math.floor(measureWidth * 0.35)
  drawHollowNotehead(img, m2x, trebleLines[2])
  drawStem(img, m2x, trebleLines[2], { up: true, length: 28 })
  const barX = Math.floor(x0 + measureWidth * 2) - 2
  drawRepeatBarline(img, barX, band.top, band.bottom)

  // Measure 3: quarter with staccato dot above.
  const m3x = x0 + measureWidth * 2 + Math.floor(measureWidth * 0.4)
  drawFilledNotehead(img, m3x, trebleLines[3])
  drawStem(img, m3x, trebleLines[3], { up: true })
  fillRect(img, m3x - 1, trebleLines[3] - 10, m3x + 1, trebleLines[3] - 8)

  img.musicalFixture = { keyFifths: 1, hasRepeat: true }
  return img
}

/** Blank page (no ink) — used to assert the concise no-systems failure. */
export function blankPage(width = 460, height = 620) {
  return createPage(width, height)
}

/**
 * Degrade a clean rhythmic page to mimic a scanned PDF: gray wash, noise, low contrast.
 */
export function scannedPianoPage(options = {}) {
  const base = rhythmicPianoPage({
    measuresPerSystem: options.measuresPerSystem ?? 4,
    width: options.width ?? 460,
    height: options.height ?? 640,
    patterns: options.patterns,
  })
  const { width, height, data } = base
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i]
    const paper = 210 + ((i / 4) % 17)
    const faded = Math.round(lum * 0.72 + paper * 0.28)
    data[i] = faded
    data[i + 1] = faded
    data[i + 2] = faded
  }
  for (let n = 0; n < Math.floor(width * height * 0.018); n += 1) {
    const x = (n * 37 + 11) % width
    const y = (n * 53 + 7) % height
    const index = (y * width + x) * 4
    const speck = ((n * 19) % 2 === 0) ? 175 : 95
    data[index] = speck
    data[index + 1] = speck
    data[index + 2] = speck
  }
  return base
}

/**
 * Build a `renderPage(pdfSource, pageNumber)` function over an array of pages,
 * for injecting into analyzeSemiAutoScoreSetup in tests.
 */
export function renderPagesFromArray(pages) {
  return async (_pdfSource, pageNumber) => ({ imageData: pages[pageNumber - 1] })
}
