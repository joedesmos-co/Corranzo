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
  barlines = true,
  header = true,
} = {}) {
  // Fixed grand-staff height + a modest inter-system gap, like engraved music.
  // (Large gaps would make the valley-split detector return loose bands.)
  const lineGap = 5
  const innerGap = 10
  const staffHeight = 4 * lineGap + innerGap + 4 * lineGap // treble + gap + bass
  const gap = 30
  const topFrac = 0.18

  const pageHeight = Math.max(
    height,
    Math.ceil((Math.floor(640 * topFrac) + systems * (staffHeight + gap) + 40)),
  )
  const img = createPage(width, pageHeight)
  const x0 = Math.floor(width * 0.08)
  const x1 = Math.floor(width * 0.92)
  if (header) {
    drawHeader(img)
  }

  const top = Math.floor(pageHeight * topFrac)
  const systemBands = []

  for (let s = 0; s < systems; s += 1) {
    const sysTop = top + s * (staffHeight + gap)
    const band = drawGrandStaff(img, sysTop, x0, x1, { lineGap, innerGap })
    systemBands.push(band)
    if (barlines) {
      for (let m = 0; m <= measuresPerSystem; m += 1) {
        const bx = Math.floor(x0 + ((x1 - x0) * m) / measuresPerSystem)
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
