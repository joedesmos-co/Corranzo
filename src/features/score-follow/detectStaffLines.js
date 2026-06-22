/**
 * Staff-line-based staff-system detection — the primary, dense-music-robust
 * detector for auto score-follow.
 *
 * Row-density band detection fails on dense piano/anime/game arrangements:
 * note ink fills every row, so systems blur together with no clean valleys.
 * Staff LINES, however, are an invariant feature of any engraved score — long,
 * thin, near-full-width horizontal runs of ink. Detecting those runs and
 * grouping them into systems (using the MusicXML staves-per-system count) is
 * far more reliable. Barlines are then long vertical runs spanning the full
 * grand-staff height, which give measures-per-system.
 *
 * Validated on a real dense 4-page arrangement (exact systems + measure counts
 * per page) and on the public-domain demo.
 */

/** Luminance composited over white so transparent PDF backgrounds aren't ink. */
function compositeLuminance(data, index) {
  const alpha = data[index + 3] / 255
  const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  return lum * alpha + 255 * (1 - alpha)
}

function contentColumns(imageData, contentBounds) {
  const { width } = imageData
  const left = Math.max(0, Math.floor((contentBounds.left ?? contentBounds.x0 * width)))
  const right = Math.min(width - 1, Math.ceil((contentBounds.right ?? contentBounds.x1 * width)))
  return { left, right, span: Math.max(1, right - left + 1) }
}

/**
 * Per-row fraction of the content width covered by the longest contiguous run
 * of dark pixels. Staff lines → high (≈0.7–1.0); note rows → low (notes don't
 * span the width as one run).
 */
export function computeHorizontalRunCoverage(imageData, contentBounds, darkThreshold = 170) {
  const { width, height, data } = imageData
  const { left, right, span } = contentColumns(imageData, contentBounds)
  const coverage = new Float32Array(height)
  for (let y = 0; y < height; y += 1) {
    let run = 0
    let best = 0
    const rowOffset = y * width
    for (let x = left; x <= right; x += 1) {
      const index = (rowOffset + x) * 4
      if (compositeLuminance(data, index) < darkThreshold) {
        run += 1
        if (run > best) best = run
      } else {
        run = 0
      }
    }
    coverage[y] = best / span
  }
  return coverage
}

/**
 * Detect individual staves (each a thin band of ~5 staff lines) from staff-line
 * rows. Returns bands { y0, y1, center } in normalized page coordinates.
 */
export function detectStaffLineStaves(imageData, contentBounds, options = {}) {
  const { coverageThreshold = 0.5, darkThreshold = 170, minGapNorm = 0.018 } = options
  const { height } = imageData
  const coverage = computeHorizontalRunCoverage(imageData, contentBounds, darkThreshold)

  const lineRows = []
  for (let y = 0; y < height; y += 1) {
    if (coverage[y] > coverageThreshold) {
      lineRows.push(y)
    }
  }
  if (lineRows.length === 0) {
    return []
  }

  const gapPx = Math.max(3, Math.floor(height * minGapNorm))
  const clusters = []
  let current = [lineRows[0]]
  for (let i = 1; i < lineRows.length; i += 1) {
    if (lineRows[i] - lineRows[i - 1] > gapPx) {
      clusters.push(current)
      current = []
    }
    current.push(lineRows[i])
  }
  clusters.push(current)

  return clusters
    .map((rows) => {
      const y0 = rows[0] / height
      const y1 = rows[rows.length - 1] / height
      return { y0, y1, center: (y0 + y1) / 2, lineCount: rows.length }
    })
    .filter((stave) => stave.lineCount >= 2) // a real stave shows several line rows
}

/**
 * Group detected staves into systems.
 *
 * The reliable discriminator is the GAP STRUCTURE, not a fixed chunk size,
 * because a grand staff's treble + bass may be detected as two separate staves
 * (high-resolution renders) or merged into one (low-resolution / tight
 * spacing):
 *   - Bimodal gaps (clear small intra-system vs large inter-system) → split at
 *     the large gaps. This pairs treble+bass into one system.
 *   - Uniform gaps → each detected stave is already its own system (merged
 *     grand staff, or genuinely single-staff systems).
 *
 * `stavesPerSystem` (from MusicXML) is used as a cross-check / cap, not as the
 * sole grouping rule.
 */
export function groupStavesIntoSystems(staves, stavesPerSystem = 1) {
  if (staves.length <= 1) {
    return staves.map((stave) => ({ ...stave, staveCount: 1 }))
  }
  const perSystem = Math.max(1, Math.round(stavesPerSystem))

  // Hypothesis test for chunking by `stavesPerSystem` (e.g. pair treble+bass):
  // it's correct only when the gaps WITHIN a chunk are clearly smaller than the
  // gaps BETWEEN chunks. This works whether treble/bass are detected as two
  // staves (chunk them) or merged into one (don't) — without a brittle fixed
  // ratio on the raw gap spread.
  if (perSystem >= 2 && staves.length > perSystem && staves.length % perSystem === 0) {
    const intra = []
    const inter = []
    for (let i = 1; i < staves.length; i += 1) {
      const gap = staves[i].center - staves[i - 1].center
      if (i % perSystem === 0) {
        inter.push(gap) // gap at a chunk boundary
      } else {
        intra.push(gap) // gap inside a chunk
      }
    }
    if (inter.length > 0 && intra.length > 0 && median(inter) > median(intra) * 1.2) {
      const systems = []
      for (let i = 0; i < staves.length; i += perSystem) {
        systems.push(mergeStaveGroup(staves.slice(i, i + perSystem)))
      }
      return systems
    }
  }

  // Otherwise each detected cluster is already a whole system (a merged grand
  // staff, or genuinely single-staff systems).
  return staves.map((stave) => ({ ...stave, staveCount: 1 }))
}

function median(values) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function mergeStaveGroup(group) {
  const y0 = group[0].y0
  const y1 = group[group.length - 1].y1
  return { y0, y1, center: (y0 + y1) / 2, staveCount: group.length }
}

/**
 * Count barlines in a system band: vertical dark runs spanning most of the
 * system height. Stems are short (one staff), barlines span the full grand
 * staff, so the height fraction separates them. Adjacent columns are merged so
 * a thick barline counts once.
 */
export function countSystemBarlines(imageData, contentBounds, system, options = {}) {
  const positions = detectSystemBarlinePositions(imageData, contentBounds, system, options)
  return positions.length
}

/** Normalized x positions of detected barlines within a system band. */
export function detectSystemBarlinePositions(imageData, contentBounds, system, options = {}) {
  const { darkThreshold = 150, heightFraction = 0.7 } = options
  const { width, height, data } = imageData
  const { left, right } = contentColumns(imageData, contentBounds)
  const y0 = Math.max(0, Math.floor(system.y0 * height))
  const y1 = Math.min(height - 1, Math.ceil(system.y1 * height))
  const bandHeight = Math.max(1, y1 - y0)

  const cols = []
  for (let x = left; x <= right; x += 1) {
    let run = 0
    let best = 0
    for (let y = y0; y <= y1; y += 1) {
      const index = (y * width + x) * 4
      if (compositeLuminance(data, index) < darkThreshold) {
        run += 1
        if (run > best) best = run
      } else {
        run = 0
      }
    }
    if (best / bandHeight > heightFraction) {
      cols.push(x)
    }
  }

  const mergeGap = Math.max(2, Math.floor(width * 0.01))
  const merged = []
  for (const x of cols) {
    const last = merged[merged.length - 1]
    if (last && x - last.x1 <= mergeGap) {
      last.x1 = x
    } else {
      merged.push({ x0: x, x1: x })
    }
  }
  return merged.map((m) => (m.x0 + m.x1) / 2 / width)
}

/**
 * Full staff-line system detection for one page: detect staves, group into
 * systems using staves-per-system, and (optionally) attach a barline-based
 * measure-count estimate per system.
 *
 * Returns { systems: [{ y0, y1, center, staveCount, barlineCount, measureEstimate }] }.
 */
export function detectStaffLineSystems(imageData, contentBounds, options = {}) {
  const { stavesPerSystem = 1, countBarlines = true } = options
  const staves = detectStaffLineStaves(imageData, contentBounds, options)
  const grouped = groupStavesIntoSystems(staves, stavesPerSystem)

  const systems = grouped.map((system) => {
    const barlineCount = countBarlines
      ? countSystemBarlines(imageData, contentBounds, system, options)
      : 0
    // N barlines (start + internal + end) bound N-1 measures.
    const measureEstimate = barlineCount >= 2 ? barlineCount - 1 : null
    return { ...system, barlineCount, measureEstimate, contentBounds }
  })

  return { staves, systems }
}
