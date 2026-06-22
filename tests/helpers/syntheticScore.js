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
function drawStaff(img, topY, x0, x1, { lineGap = 5 } = {}) {
  for (let line = 0; line < 5; line += 1) {
    hLine(img, topY + line * lineGap, x0, x1)
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

  for (let s = 0; s < systemCount; s += 1) {
    const sysTop = top + s * (staffHeight + gap)
    const band = drawGrandStaff(img, sysTop, x0, x1, { lineGap, innerGap })
    systemBands.push(band)
    if (barlines) {
      const measures = measuresFor(s)
      for (let m = 0; m <= measures; m += 1) {
        const bx = Math.floor(x0 + ((x1 - x0) * m) / measures)
        // 2px wide: the column peak survives ±2 smoothing in barline detection
        // without flooding the inter-line gaps (which would look "dense").
        vLine(img, bx, band.top, band.bottom)
        vLine(img, bx + 1, band.top, band.bottom)
      }
    }
  }

  img.systemBands = systemBands
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
  for (let s = 0; s < systems; s += 1) {
    const sysTop = top + s * (grandHeight + systemGap)
    drawLightStaff(sysTop)
    const bassTop = sysTop + staffHeight + innerGap
    drawLightStaff(bassTop)
    const bandBottom = bassTop + staffHeight
    systemBands.push({ top: sysTop, bottom: bandBottom })

    // Light barlines spanning the grand staff (treble top → bass bottom).
    for (let m = 0; m <= measuresPerSystem; m += 1) {
      const bx = Math.floor(x0 + ((x1 - x0) * m) / measuresPerSystem)
      vLine(img, bx, sysTop, bandBottom, lineValue)
    }
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
  return img
}

/** Blank page (no ink) — used to assert the concise no-systems failure. */
export function blankPage(width = 460, height = 620) {
  return createPage(width, height)
}

/**
 * Build a `renderPage(pdfSource, pageNumber)` function over an array of pages,
 * for injecting into analyzeSemiAutoScoreSetup in tests.
 */
export function renderPagesFromArray(pages) {
  return async (_pdfSource, pageNumber) => ({ imageData: pages[pageNumber - 1] })
}
