/**
 * Extended staff pitch mapping with ledger-line range and written pitch output.
 */

import { partitionHorizontalRowsForInkRecovery } from './localLedgerStaffClassifier.js'

export const CLEF_BOTTOM_MIDI = {
  treble: 64, // E4
  bass: 43, // G2
}

const NATURAL_STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11]
const STEP_INDEX_BY_NAME = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
}
const CLEF_BOTTOM_DIATONIC = {
  treble: { step: 'E', octave: 4 },
  bass: { step: 'G', octave: 2 },
}
// Allow stacked ledger lines for extreme-register chords (e.g. guitar open-E
// written on treble). Returning null here silently drops real noteheads.
const MIN_LEDGER_DIATONIC_OFFSET = -16
const MAX_LEDGER_DIATONIC_OFFSET = 24

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor
}

function diatonicNumber({ step, octave }) {
  return octave * 7 + STEP_INDEX_BY_NAME[step]
}

function midiFromDiatonicNumber(value) {
  const stepIndex = positiveModulo(value, 7)
  const octave = Math.floor(value / 7)
  return (octave + 1) * 12 + NATURAL_STEP_SEMITONES[stepIndex]
}

export function midiToWrittenPitch(midi) {
  const octave = Math.floor(midi / 12) - 1
  const semitone = ((midi % 12) + 12) % 12
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const name = names[semitone]
  return {
    step: name.replace('#', ''),
    alter: name.includes('#') ? 1 : null,
    octave,
  }
}

/**
 * @param {number} yNorm - normalized 0–1 y (top of image = 0)
 * @param {number[]} lineYs - five normalized y positions, top line first
 * @param {'treble'|'bass'} clef
 */
export function midiFromStaffPosition(yNorm, lineYs, clef = 'treble') {
  if (!lineYs?.length) {
    return null
  }
  const sorted = [...lineYs].sort((a, b) => a - b)
  const top = sorted[0]
  const bottom = sorted[sorted.length - 1]
  const span = bottom - top
  if (span <= 0) {
    return null
  }
  const lineGap = span / 4
  const diatonicOffset = Math.round(((bottom - yNorm) / lineGap) * 2)
  if (
    diatonicOffset < MIN_LEDGER_DIATONIC_OFFSET ||
    diatonicOffset > MAX_LEDGER_DIATONIC_OFFSET
  ) {
    return null
  }
  const base = CLEF_BOTTOM_DIATONIC[clef] ?? CLEF_BOTTOM_DIATONIC.treble
  return midiFromDiatonicNumber(diatonicNumber(base) + diatonicOffset)
}

function resolveClefSignForStaffRole(yNorm, lineYs, detectedClef, staffRole) {
  if (staffRole !== 'lower' || detectedClef !== 'treble' || !lineYs?.length) {
    return detectedClef
  }
  const gap = staffLineGap(lineYs)
  const sorted = [...lineYs].sort((a, b) => a - b)
  const bottomLine = sorted[sorted.length - 1]
  const deepBassThreshold = bottomLine + gap * 0.1
  if (yNorm < deepBassThreshold) {
    return detectedClef
  }
  const bassMidi = midiFromStaffPosition(yNorm, lineYs, 'bass')
  return bassMidi == null ? detectedClef : 'bass'
}

function refineGrandStaffPitchMapping(pitchMapping, staffLines, staffClefs) {
  const clefs = normalizeStaffClefs(staffClefs)
  const staffRole = pitchMapping.staffRole
  const linesKey = staffRoleToLinesKey(staffRole)
  const lineYs = staffLines?.[linesKey] ?? pitchMapping.lineYs ?? []
  const detectedClef = staffRole === 'upper' ? clefs.upper : clefs.lower
  const clefSign = resolveClefSignForStaffRole(
    pitchMapping.yNorm,
    lineYs,
    detectedClef,
    staffRole,
  )
  if (clefSign === pitchMapping.clefSign) {
    return pitchMapping
  }
  const midi = midiFromStaffPosition(pitchMapping.yNorm, lineYs, clefSign)
  if (midi == null) {
    return pitchMapping
  }
  const alternateStaffRole = staffRole === 'upper' ? 'lower' : 'upper'
  const alternateLinesKey = staffRoleToLinesKey(alternateStaffRole)
  const alternateClefSign =
    alternateStaffRole === 'upper' ? clefs.upper : clefs.lower
  return {
    ...pitchMapping,
    clefSign,
    midi,
    lineYs,
    alternateClefSign,
    alternateMidi: midiFromStaffPosition(
      pitchMapping.yNorm,
      staffLines?.[alternateLinesKey] ?? [],
      alternateClefSign,
    ),
  }
}

export function estimateLedgerLineCount(yNorm, lineYs) {
  const sorted = [...lineYs].sort((a, b) => a - b)
  const top = sorted[0]
  const bottom = sorted[sorted.length - 1]
  const lineGap = (bottom - top) / 4
  if (yNorm < top - lineGap * 0.35) {
    return { direction: 'above', count: Math.ceil((top - yNorm) / lineGap) }
  }
  if (yNorm > bottom + lineGap * 0.35) {
    return { direction: 'below', count: Math.ceil((yNorm - bottom) / lineGap) }
  }
  return { direction: null, count: 0 }
}

/**
 * Minimum normalized system height to treat a single detected band as a merged
 * grand staff (two staffs + gap). Typical single 5-line bands are ~0.04; paired
 * grand-staff systems are ~0.14–0.16. Splitting a short single-staff band into
 * phantom treble/bass halves mis-assigns degrees (e.g. E4→E2, F4→E4).
 */
export const MERGED_GRAND_MIN_SYSTEM_HEIGHT = 0.07

function fiveLinesFromStaffBounds(y0, y1) {
  const lineGap = (y1 - y0) / 4
  if (!(lineGap > 0)) {
    return null
  }
  return [0, 1, 2, 3, 4].map((i) => y0 + i * lineGap)
}

function singleStaffLines(y0, y1) {
  const treble = fiveLinesFromStaffBounds(y0, y1)
  if (!treble) {
    return { treble: [], bass: [], splitY: null, singleStaff: true }
  }
  return {
    treble,
    // Empty bass forces resolveStaffRoleForY onto the upper/treble mapping so
    // a single detected band is not split into a phantom lower staff.
    bass: [],
    splitY: null,
    singleStaff: true,
  }
}

function staveLineCount(stave) {
  const fromLineYs = Array.isArray(stave?.lineYs)
    ? stave.lineYs.filter(Number.isFinite).length
    : 0
  const fromDetected = Array.isArray(stave?.detectedLineYs)
    ? stave.detectedLineYs.filter(Number.isFinite).length
    : 0
  if (Number.isFinite(stave?.lineCount) && stave.lineCount > 0) {
    return Math.max(stave.lineCount, fromLineYs, fromDetected)
  }
  return Math.max(fromLineYs, fromDetected)
}

/** Six-line (or denser) bands are TAB, not piano bass. */
function staveLooksLikeTab(stave) {
  if (!stave) return false
  if (stave.kind === 'tab' || stave.isTab || stave.stringCount >= 6) return true
  return staveLineCount(stave) >= 6
}

function measuredLinesForStaff(stave) {
  const canonical = Array.isArray(stave?.lineYs)
    ? stave.lineYs.filter(Number.isFinite).sort((left, right) => left - right)
    : []
  if (canonical.length === 5 && canonical[4] > canonical[0]) {
    return canonical
  }
  const lineGap = (stave.y1 - stave.y0) / 4
  return [0, 1, 2, 3, 4].map((i) => stave.y0 + i * lineGap)
}

export function estimateGrandStaffLines(system, { systemRole = null } = {}) {
  const measuredStaves = Array.isArray(system?.staves)
    ? system.staves
        .filter((stave) => Number.isFinite(stave?.y0) && Number.isFinite(stave?.y1))
        .sort((left, right) => left.y0 - right.y0)
    : []

  // Mixed notation+TAB guitar systems nest the TAB band as stave[1]. Treating
  // that band as a piano bass staff invents absurdly low MIDI (TAB lines ≠
  // bass clef) and inflates ledger y-padding so the next system's noteheads
  // are stolen into this measure — both break notation↔TAB pairing.
  const roleImpliesTabPair =
    systemRole?.kind === 'mixed' ||
    systemRole?.kind === 'tab' ||
    Boolean(systemRole?.tabStave) ||
    Boolean(system?.tabStave)
  const notationStaves = measuredStaves.filter((stave) => !staveLooksLikeTab(stave))

  if (roleImpliesTabPair) {
    const notation = notationStaves[0] ?? measuredStaves[0]
    if (notation) {
      return singleStaffLines(notation.y0, notation.y1)
    }
  }

  if (notationStaves.length >= 2) {
    const treble = notationStaves[0]
    const bass = notationStaves[1]
    return {
      treble: measuredLinesForStaff(treble),
      bass: measuredLinesForStaff(bass),
      splitY: (treble.y1 + bass.y0) / 2,
    }
  }

  if (notationStaves.length === 1) {
    return singleStaffLines(notationStaves[0].y0, notationStaves[0].y1)
  }

  // No explicit notation filter match — fall back to raw measured staves
  // (piano grand staff / single staff).
  if (measuredStaves.length >= 2) {
    const treble = measuredStaves[0]
    const bass = measuredStaves[1]
    return {
      treble: measuredLinesForStaff(treble),
      bass: measuredLinesForStaff(bass),
      splitY: (treble.y1 + bass.y0) / 2,
    }
  }

  if (measuredStaves.length === 1) {
    return singleStaffLines(measuredStaves[0].y0, measuredStaves[0].y1)
  }

  const { y0, y1 } = system
  const height = y1 - y0
  if (!Number.isFinite(height) || height <= 0) {
    return { treble: [], bass: [], splitY: null, singleStaff: true }
  }

  // groupStavesIntoSystems spreads a lone stave onto the system object
  // (staveCount === 1, no nested staves[]). Use the full band as one staff
  // unless the band is tall enough to be a merged grand-staff detection.
  const staveCount = Math.max(1, Math.round(system?.staveCount ?? 1))
  if (staveCount <= 1 && height < MERGED_GRAND_MIN_SYSTEM_HEIGHT) {
    return singleStaffLines(y0, y1)
  }

  const innerGap = height * 0.11
  const staffHeight = (height - innerGap) / 2
  const trebleTop = y0
  const bassTop = y0 + staffHeight + innerGap

  function linesForStaff(top) {
    const lineGap = staffHeight / 4
    return [0, 1, 2, 3, 4].map((i) => top + i * lineGap)
  }

  return {
    treble: linesForStaff(trebleTop),
    bass: linesForStaff(bassTop),
    splitY: y0 + staffHeight + innerGap / 2,
  }
}

export function distanceToNearestStaffLine(yNorm, lineYs) {
  if (!Array.isArray(lineYs) || lineYs.length === 0) {
    return Infinity
  }
  let best = Infinity
  for (const lineY of lineYs) {
    const distance = Math.abs(yNorm - lineY)
    if (distance < best) {
      best = distance
    }
  }
  return best
}

export function staffLineGap(lineYs) {
  const sorted = [...lineYs].sort((a, b) => a - b)
  if (sorted.length < 2) {
    return 0
  }
  return (sorted[sorted.length - 1] - sorted[0]) / 4
}

export function staffSpanWithLedger(
  lineYs,
  { aboveLedgers = 4, belowLedgers = 4, clipTop = null, clipBottom = null } = {},
) {
  const sorted = [...lineYs].sort((a, b) => a - b)
  const gap = staffLineGap(lineYs)
  let top = sorted[0] - gap * aboveLedgers
  let bottom = sorted[sorted.length - 1] + gap * belowLedgers
  if (Number.isFinite(clipTop)) {
    top = Math.max(top, clipTop)
  }
  if (Number.isFinite(clipBottom)) {
    bottom = Math.min(bottom, clipBottom)
  }
  return {
    top,
    bottom,
    gap,
    lines: sorted,
  }
}

const TREBLE_CLEF_GLYPH = '\uE050'
const BASS_CLEF_GLYPH = '\uE062'

export const DEFAULT_STAFF_CLEFS = {
  upper: 'treble',
  lower: 'bass',
}

function normalizeStaffClefs(staffClefs) {
  const source = staffClefs ?? DEFAULT_STAFF_CLEFS
  return {
    upper: source.upper === 'bass' ? 'bass' : 'treble',
    lower: source.lower === 'bass' ? 'bass' : 'treble',
  }
}

function staffRoleFromLines(staffRole) {
  return staffRole === 'lower' ? 'bass' : 'treble'
}

function staffRoleToLinesKey(staffRole) {
  return staffRole === 'lower' ? 'bass' : 'treble'
}

function resolveMetricNoteheadYNorm(glyph, imageData, lineYs) {
  if (!glyph || !imageData?.height) {
    return null
  }
  const anchorYNorm = glyph.y / imageData.height
  const heightNorm = (glyph.height ?? 0) / imageData.height
  if (!Array.isArray(lineYs) || lineYs.length === 0 || heightNorm <= 0) {
    return anchorYNorm
  }
  const gap = staffLineGap(lineYs)
  if (gap <= 0) {
    return anchorYNorm
  }
  const heightRatio = heightNorm / gap
  if (heightRatio < 0.45 || heightRatio > 2.4) {
    return anchorYNorm
  }
  const centerFactor = Math.min(0.2, 0.08 + heightRatio * 0.05)
  return anchorYNorm - heightNorm * centerFactor
}

function lineYsInPixels(lineYs, imageHeight) {
  if (!Array.isArray(lineYs) || !lineYs.length) {
    return []
  }
  const scale = lineYs.every((value) => Math.abs(value) <= 1.5)
    ? imageHeight
    : 1
  return lineYs.map((value) => value * scale)
}

function pixelIsInk(imageData, x, y, threshold) {
  if (
    x < 0 ||
    y < 0 ||
    x >= imageData.width ||
    y >= imageData.height
  ) {
    return false
  }
  const index = (y * imageData.width + x) * 4
  const alpha = imageData.data[index + 3] / 255
  const luminance =
    (0.299 * imageData.data[index] +
      0.587 * imageData.data[index + 1] +
      0.114 * imageData.data[index + 2]) *
      alpha +
    255 * (1 - alpha)
  return luminance < threshold
}

function metricAnchorResult(glyph, imageData, lineYs, rejectedReason = null) {
  const yNorm = resolveMetricNoteheadYNorm(glyph, imageData, lineYs)
  return {
    yNorm,
    fallbackYNorm: yNorm,
    rawYNorm: imageData?.height ? glyph?.y / imageData.height : null,
    source: 'glyph-metrics-fallback',
    confidence: 0.45,
    visualBounds: null,
    suppressedStaffOrLedgerRows: 0,
    suppressedStemColumns: 0,
    rejectedReason,
  }
}

function collectCompactRowComponents({
  imageData,
  left,
  right,
  top,
  bottom,
  suppressedRows,
  suppressedColumns,
  inkThreshold,
}) {
  const pixels = new Map()
  for (let y = top; y <= bottom; y += 1) {
    if (suppressedRows.has(y)) {
      continue
    }
    for (let x = left; x <= right; x += 1) {
      if (
        suppressedColumns.has(x) ||
        !pixelIsInk(imageData, x, y, inkThreshold)
      ) {
        continue
      }
      pixels.set(`${x}:${y}`, { x, y })
    }
  }

  const components = []
  while (pixels.size) {
    const first = pixels.values().next().value
    const queue = [first]
    pixels.delete(`${first.x}:${first.y}`)
    const component = {
      top: first.y,
      bottom: first.y,
      left: first.x,
      right: first.x,
      pixels: 0,
    }
    for (let index = 0; index < queue.length; index += 1) {
      const point = queue[index]
      component.top = Math.min(component.top, point.y)
      component.bottom = Math.max(component.bottom, point.y)
      component.left = Math.min(component.left, point.x)
      component.right = Math.max(component.right, point.x)
      component.pixels += 1
      // Bridge only the narrow gaps left by suppressed staff or ledger rows.
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue
          }
          const key = `${point.x + dx}:${point.y + dy}`
          const neighbor = pixels.get(key)
          if (neighbor) {
            pixels.delete(key)
            queue.push(neighbor)
          }
        }
      }
    }
    components.push(component)
  }
  return components
}

function longestHorizontalInkRun(imageData, y, left, right, inkThreshold) {
  let run = 0
  let longest = 0
  let longestStart = left
  let longestEnd = left
  let currentStart = left
  for (let x = left; x <= right; x += 1) {
    if (pixelIsInk(imageData, x, y, inkThreshold)) {
      if (run === 0) {
        currentStart = x
      }
      run += 1
      if (run > longest) {
        longest = run
        longestStart = currentStart
        longestEnd = x
      }
    } else {
      run = 0
    }
  }
  return { longest, runStart: longestStart, runEnd: longestEnd }
}

function verticalInkExtent(imageData, x, y, inkThreshold, radius = 3) {
  if (!pixelIsInk(imageData, x, y, inkThreshold)) {
    return 0
  }
  let top = y
  let bottom = y
  for (let dy = 1; dy <= radius; dy += 1) {
    if (pixelIsInk(imageData, x, y - dy, inkThreshold)) {
      top = y - dy
    } else {
      break
    }
  }
  for (let dy = 1; dy <= radius; dy += 1) {
    if (pixelIsInk(imageData, x, y + dy, inkThreshold)) {
      bottom = y + dy
    } else {
      break
    }
  }
  return bottom - top + 1
}

function collectCompactRowComponentsMasked({
  imageData,
  left,
  right,
  top,
  bottom,
  suppressedRows,
  maskedLedgerRows,
  suppressedColumns,
  inkThreshold,
}) {
  const pixels = new Map()
  for (let y = top; y <= bottom; y += 1) {
    if (suppressedRows.has(y)) {
      continue
    }
    for (let x = left; x <= right; x += 1) {
      if (suppressedColumns.has(x)) {
        continue
      }
      if (
        maskedLedgerRows.has(y) &&
        verticalInkExtent(imageData, x, y, inkThreshold) <= 2
      ) {
        continue
      }
      if (!pixelIsInk(imageData, x, y, inkThreshold)) {
        continue
      }
      pixels.set(`${x}:${y}`, { x, y })
    }
  }

  const components = []
  while (pixels.size) {
    const first = pixels.values().next().value
    const queue = [first]
    pixels.delete(`${first.x}:${first.y}`)
    const component = {
      top: first.y,
      bottom: first.y,
      left: first.x,
      right: first.x,
      pixels: 0,
    }
    for (let index = 0; index < queue.length; index += 1) {
      const point = queue[index]
      component.top = Math.min(component.top, point.y)
      component.bottom = Math.max(component.bottom, point.y)
      component.left = Math.min(component.left, point.x)
      component.right = Math.max(component.right, point.x)
      component.pixels += 1
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue
          }
          const key = `${point.x + dx}:${point.y + dy}`
          const neighbor = pixels.get(key)
          if (neighbor) {
            pixels.delete(key)
            queue.push(neighbor)
          }
        }
      }
    }
    components.push(component)
  }
  return components
}

function buildLedgerClassifierProvenance(partitioned) {
  const acceptedLedgerRows = partitioned.acceptedLedgerRows
    .map((row) => row.y)
    .sort((left, right) => left - right)
  const suppressedStaffRows = [...partitioned.suppressedStaffRows].sort(
    (left, right) => left - right,
  )
  const ambiguousRows = partitioned.ambiguousRows
    .map((row) => row.y)
    .sort((left, right) => left - right)
  let result = 'staff-like-suppressed'
  if (acceptedLedgerRows.length && suppressedStaffRows.length) {
    result = 'mixed-staff-and-local-ledger'
  } else if (acceptedLedgerRows.length) {
    result = 'local-ledger-preserved'
  }
  const confidences = partitioned.classifications
    .map((entry) => entry.confidence)
    .filter(Number.isFinite)
  const confidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0.35
  return {
    result,
    confidence,
    acceptedLedgerRows,
    suppressedStaffRows,
    ambiguousRows,
    maskedLedgerStrokeRows: acceptedLedgerRows,
    featuresUsed: [
      'lengthRelativeToSystem',
      'lengthRelativeToLocalWindow',
      'staffBandMembership',
      'halfSpaceAlignment',
      'noteheadOrChordProximity',
    ],
  }
}

function anchorDiagnostics(
  fallback,
  {
    ledgerClassifier,
    suppressedRows,
    maskedLedgerRows,
    suppressedColumns,
    gapPx,
    imageData,
    extra = {},
  },
) {
  return {
    ...fallback,
    ...extra,
    suppressedStaffOrLedgerRows: suppressedRows.size + maskedLedgerRows.size,
    suppressedOrMaskedRowCount: suppressedRows.size + maskedLedgerRows.size,
    suppressedStemColumns: suppressedColumns.size,
    localStaffGapNorm: gapPx / imageData.height,
    ledgerClassifier,
  }
}

/**
 * Resolve a notehead's visual center from local rendered ink. PDF text origins
 * and glyph boxes vary by music font, so the metric anchor is retained unless
 * one compact head-shaped component survives staff-line and stem suppression.
 */
export function resolveNoteheadAnchor(
  glyph,
  imageData,
  lineYs,
  { inkThreshold = 170, chordColumnXs = null } = {},
) {
  const fallback = metricAnchorResult(glyph, imageData, lineYs)
  if (!glyph || !imageData?.data || !imageData.width || !imageData.height) {
    return { ...fallback, rejectedReason: 'missing-image-geometry' }
  }
  if (glyph.legacyMusicFontNormalized) {
    return { ...fallback, rejectedReason: 'legacy-font-profile-unavailable' }
  }

  const pixelLines = lineYsInPixels(lineYs, imageData.height)
  const gapPx = staffLineGap(pixelLines)
  if (!(gapPx >= 4)) {
    return { ...fallback, rejectedReason: 'missing-local-staff-spacing' }
  }

  const glyphX = Number(glyph.x)
  const glyphY = Number(glyph.y)
  const glyphWidth = Math.max(1, Number(glyph.width) || gapPx * 0.8)
  const glyphHeight = Math.max(1, Number(glyph.height) || gapPx)
  if (!Number.isFinite(glyphX) || !Number.isFinite(glyphY)) {
    return { ...fallback, rejectedReason: 'invalid-glyph-origin' }
  }

  const metricY = (fallback.yNorm ?? glyphY / imageData.height) * imageData.height
  const supportRadius = Math.ceil(Math.max(gapPx * 1.7, glyphWidth * 1.1))
  const leftSupport = Math.max(0, Math.floor(glyphX - supportRadius))
  const rightSupport = Math.min(
    imageData.width - 1,
    Math.ceil(glyphX + supportRadius),
  )
  const left = Math.max(0, Math.floor(glyphX - gapPx * 0.3))
  const right = Math.min(imageData.width - 1, Math.ceil(glyphX + gapPx * 1.15))
  const top = Math.max(
    0,
    Math.floor(Math.min(metricY, glyphY) - Math.max(gapPx * 1.35, glyphHeight * 0.9)),
  )
  const bottom = Math.min(
    imageData.height - 1,
    Math.ceil(glyphY + gapPx * 0.3),
  )
  if (right <= left || bottom <= top) {
    return { ...fallback, rejectedReason: 'empty-anchor-window' }
  }

  const horizontalSupportThreshold = Math.max(
    gapPx * 1.02,
    (right - left + 1) * 0.82,
  )
  const localWindowWidth = rightSupport - leftSupport + 1
  const candidateRows = []
  for (let y = top; y <= bottom; y += 1) {
    const local = longestHorizontalInkRun(
      imageData,
      y,
      leftSupport,
      rightSupport,
      inkThreshold,
    )
    if (local.longest < horizontalSupportThreshold * 0.5) {
      continue
    }
    const system = longestHorizontalInkRun(
      imageData,
      y,
      0,
      imageData.width - 1,
      inkThreshold,
    )
    candidateRows.push({
      y,
      longestRunPx: local.longest,
      runStart: local.runStart,
      runEnd: local.runEnd,
      lengthRelativeToSystem: system.longest / imageData.width,
      lengthRelativeToLocalWindow: local.longest / localWindowWidth,
    })
  }

  const staffTopPx = Math.min(...pixelLines)
  const staffBottomPx = Math.max(...pixelLines)
  const partitioned = partitionHorizontalRowsForInkRecovery(candidateRows, {
    gapPx,
    staffTopPx,
    staffBottomPx,
    noteheadX: glyphX,
    chordColumnXs: chordColumnXs ?? [glyphX],
    systemEventSupport: 0,
  })
  const ledgerClassifier = buildLedgerClassifierProvenance(partitioned)
  const suppressedRows = new Set(partitioned.suppressedStaffRows)
  const maskedLedgerRows = new Set(
    partitioned.acceptedLedgerRows.map((row) => row.y),
  )
  // When the glyph origin sits on a local ledger stroke, masking that row strips
  // the owned notehead ink and can snap the anchor to the nearest staff line.
  const effectiveMaskedLedgerRows = new Set(maskedLedgerRows)
  for (const row of partitioned.acceptedLedgerRows) {
    if (Math.abs(row.y - glyphY) <= gapPx * 0.35) {
      effectiveMaskedLedgerRows.delete(row.y)
    }
  }

  const suppressedColumns = new Set()
  const verticalSupportThreshold = Math.max(
    gapPx * 0.9,
    (bottom - top + 1) * 0.42,
  )
  for (let x = left; x <= right; x += 1) {
    let count = 0
    for (let y = top; y <= bottom; y += 1) {
      if (suppressedRows.has(y)) {
        continue
      }
      if (
        effectiveMaskedLedgerRows.has(y) &&
        verticalInkExtent(imageData, x, y, inkThreshold) <= 2
      ) {
        continue
      }
      if (pixelIsInk(imageData, x, y, inkThreshold)) {
        count += 1
      }
    }
    if (count >= verticalSupportThreshold) {
      suppressedColumns.add(x)
    }
  }

  const rowComponents = collectCompactRowComponentsMasked({
    imageData,
    left,
    right,
    top,
    bottom,
    suppressedRows,
    maskedLedgerRows: effectiveMaskedLedgerRows,
    suppressedColumns,
    inkThreshold,
  }).map((component) => {
    const width = component.right - component.left + 1
    const height = component.bottom - component.top + 1
    const centerX = (component.left + component.right) / 2
    const centerY = (component.top + component.bottom) / 2
    const widthRatio = width / gapPx
    const heightRatio = height / gapPx
    const xDistance = Math.abs(centerX - glyphX) / gapPx
    const metricDistance = Math.abs(centerY - metricY) / gapPx
    const xOriginOffset = (centerX - glyphX) / gapPx
    const yOriginOffset = (glyphY - centerY) / gapPx
    return {
      ...component,
      width,
      height,
      centerX,
      centerY,
      widthRatio,
      heightRatio,
      xDistance,
      metricDistance,
      xOriginOffset,
      yOriginOffset,
      score:
        Math.abs(xOriginOffset - 0.55) * 0.2 +
        Math.abs(yOriginOffset - 0.51) * 0.8 +
        Math.abs(widthRatio - 0.86) * 0.25 +
        Math.abs(heightRatio - 0.54) * 0.25,
    }
  })
  const headSized = rowComponents.filter(
    (component) =>
      component.widthRatio >= 0.42 &&
      component.widthRatio <= 1.05 &&
      component.heightRatio >= 0.22 &&
      component.heightRatio <= 0.7,
  )

  const diagnosticsBase = {
    ledgerClassifier,
    suppressedRows,
    maskedLedgerRows,
    suppressedColumns,
    gapPx,
    imageData,
  }

  if (!headSized.length) {
    return anchorDiagnostics(fallback, {
      ...diagnosticsBase,
      extra: { rejectedReason: 'no-head-sized-component' },
    })
  }

  const verticallyCompeting = headSized.some((component, index) =>
    headSized.some(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        Math.abs(candidate.centerY - component.centerY) >= gapPx * 0.35 &&
        Math.abs(candidate.centerY - component.centerY) <= gapPx * 1.25 &&
        Math.abs(candidate.centerX - component.centerX) <= gapPx * 0.18 &&
        Math.abs(candidate.width - component.width) <= gapPx * 0.25,
    ),
  )

  let selected = null
  let selectedFromCompetition = false
  let competingHeadCandidates = null

  if (verticallyCompeting) {
    const ranked = [...headSized].sort(
      (leftComponent, rightComponent) =>
        leftComponent.score - rightComponent.score,
    )
    competingHeadCandidates = ranked.map((component) => ({
      centerY: component.centerY,
      centerX: component.centerX,
      score: component.score,
      yOriginOffset: component.yOriginOffset,
    }))
    const best = ranked[0]
    const second = ranked[1]
    const clearWinner =
      ranked.length >= 2 && second.score - best.score >= 0.12
    const inRelaxedOriginBand =
      best.xOriginOffset >= -0.32 &&
      best.xOriginOffset <= 0.95 &&
      best.yOriginOffset >= 0.35 &&
      best.yOriginOffset <= 1
    if (clearWinner && inRelaxedOriginBand) {
      selected = best
      selectedFromCompetition = true
    } else {
      return anchorDiagnostics(fallback, {
        ...diagnosticsBase,
        extra: {
          rejectedReason: 'ambiguous-components',
          competingHeadCandidates,
        },
      })
    }
  } else {
    const compact = headSized
      .filter(
        (component) =>
          component.xOriginOffset >= -0.32 &&
          component.xOriginOffset <= 0.95 &&
          component.yOriginOffset >= 0.45 &&
          component.yOriginOffset <= 1,
      )
      .sort(
        (leftComponent, rightComponent) =>
          leftComponent.score - rightComponent.score,
      )

    if (!compact.length) {
      return anchorDiagnostics(fallback, {
        ...diagnosticsBase,
        extra: { rejectedReason: 'component-outside-font-origin-range' },
      })
    }

    selected = compact[0]
  }

  if (
    selected &&
    glyphY > staffBottomPx + gapPx * 0.25 &&
    selected.centerY < glyphY - gapPx * 0.35 &&
    Math.abs(selected.centerY - staffBottomPx) <= gapPx * 0.35
  ) {
    return anchorDiagnostics(fallback, {
      ...diagnosticsBase,
      extra: { rejectedReason: 'below-staff-ink-snapped-to-line' },
    })
  }

  const confidence = selectedFromCompetition
    ? 0.84
    : maskedLedgerRows.size
      ? 0.9
      : 0.96

  return {
    yNorm: selected.centerY / imageData.height,
    fallbackYNorm: fallback.yNorm,
    rawYNorm: glyphY / imageData.height,
    source: maskedLedgerRows.size
      ? 'ledger-masked-ink-notehead-geometry'
      : 'ink-notehead-geometry',
    confidence,
    visualBounds: {
      x: selected.left,
      y: selected.top,
      width: selected.width,
      height: selected.height,
    },
    suppressedStaffOrLedgerRows: suppressedRows.size + maskedLedgerRows.size,
    suppressedOrMaskedRowCount: suppressedRows.size + maskedLedgerRows.size,
    suppressedStemColumns: suppressedColumns.size,
    localStaffGapNorm: gapPx / imageData.height,
    rejectedReason: null,
    ledgerClassifier,
    competingHeadCandidates,
  }
}

/**
 * Backward-compatible scalar anchor for callers that do not need provenance.
 */
export function resolveNoteheadYNorm(glyph, imageData, lineYs) {
  return resolveNoteheadAnchor(glyph, imageData, lineYs).yNorm
}

/**
 * Pick upper vs lower staff from geometry. Returns staff role names that match
 * existing note.clef routing: upper → 'treble', lower → 'bass'.
 */
export function resolveStaffRoleForY(yNorm, staffLines) {
  const trebleLines = staffLines?.treble ?? []
  const bassLines = staffLines?.bass ?? []
  if (!trebleLines.length || !bassLines.length) {
    return {
      staffRole: 'upper',
      clef: 'treble',
      trebleLineDistance: distanceToNearestStaffLine(yNorm, trebleLines),
      bassLineDistance: distanceToNearestStaffLine(yNorm, bassLines),
      ambiguous: false,
      alternateStaffRole: 'lower',
      alternateClef: 'bass',
      staffBounds: null,
    }
  }

  const splitY = staffLines.splitY
  const trebleGap = staffLineGap(trebleLines)
  const bassGap = staffLineGap(bassLines)
  const splitMargin = Math.min(trebleGap, bassGap) * 0.35
  const trebleSpan = staffSpanWithLedger(trebleLines, {
    clipBottom: Number.isFinite(splitY) ? splitY - splitMargin : null,
  })
  const bassSpan = staffSpanWithLedger(bassLines, {
    clipTop: Number.isFinite(splitY) ? splitY + splitMargin : null,
  })
  const trebleDist = distanceToNearestStaffLine(yNorm, trebleLines)
  const bassDist = distanceToNearestStaffLine(yNorm, bassLines)

  const inTreble = yNorm >= trebleSpan.top && yNorm <= trebleSpan.bottom
  const inBass = yNorm >= bassSpan.top && yNorm <= bassSpan.bottom
  const margin = Math.min(trebleSpan.gap, bassSpan.gap) * 0.2

  let staffRole
  let ambiguous = false

  if (inTreble && !inBass) {
    staffRole = 'upper'
  } else if (inBass && !inTreble) {
    staffRole = 'lower'
  } else if (trebleDist + margin < bassDist) {
    staffRole = 'upper'
  } else if (bassDist + margin < trebleDist) {
    staffRole = 'lower'
  } else if (Number.isFinite(staffLines.splitY)) {
    ambiguous = true
    staffRole = yNorm <= staffLines.splitY ? 'upper' : 'lower'
  } else {
    ambiguous = true
    staffRole = trebleDist <= bassDist ? 'upper' : 'lower'
  }

  const alternateStaffRole = staffRole === 'upper' ? 'lower' : 'upper'

  return {
    staffRole,
    clef: staffRoleFromLines(staffRole),
    trebleLineDistance: trebleDist,
    bassLineDistance: bassDist,
    ambiguous,
    alternateStaffRole,
    alternateClef: staffRoleFromLines(alternateStaffRole),
    staffBounds: {
      treble: {
        top: trebleSpan.top,
        bottom: trebleSpan.bottom,
        gap: trebleSpan.gap,
        lines: trebleSpan.lines,
      },
      bass: {
        top: bassSpan.top,
        bottom: bassSpan.bottom,
        gap: bassSpan.gap,
        lines: bassSpan.lines,
      },
    },
  }
}

/** @deprecated alias for staff-role resolution used by rests */
export function resolveClefForY(yNorm, staffLines) {
  return resolveStaffRoleForY(yNorm, staffLines)
}

/**
 * Map a note y to MIDI using per-staff clef signs (G vs F) on each staff's lines.
 */
export function resolvePitchFromGrandStaff(yNorm, staffLines, staffClefs = DEFAULT_STAFF_CLEFS) {
  const clefs = normalizeStaffClefs(staffClefs)
  const staffResolution = resolveStaffRoleForY(yNorm, staffLines)
  const staffRole = staffResolution.staffRole
  const linesKey = staffRoleToLinesKey(staffRole)
  const clefSign = staffRole === 'upper' ? clefs.upper : clefs.lower
  const lineYs = staffLines?.[linesKey] ?? []
  const alternateStaffRole = staffResolution.alternateStaffRole
  const alternateLinesKey = staffRoleToLinesKey(alternateStaffRole)
  const alternateClefSign = alternateStaffRole === 'upper' ? clefs.upper : clefs.lower
  const midi = midiFromStaffPosition(yNorm, lineYs, clefSign)
  const alternateMidi = midiFromStaffPosition(
    yNorm,
    staffLines?.[alternateLinesKey] ?? [],
    alternateClefSign,
  )

  return refineGrandStaffPitchMapping(
    {
      yNorm,
      staffRole,
      clef: staffResolution.clef,
      clefSign,
      midi,
      alternateStaffRole,
      alternateClef: staffResolution.alternateClef,
      alternateClefSign,
      alternateMidi,
      lineYs,
      staffClefs: clefs,
      ...staffResolution,
    },
    staffLines,
    staffClefs,
  )
}

export function clefForY(yNorm, staffLines) {
  return resolveStaffRoleForY(yNorm, staffLines).clef
}

function staffRoleForClefGlyph(yNorm, staffLines) {
  const trebleSpan = staffSpanWithLedger(staffLines.treble, { aboveLedgers: 2, belowLedgers: 2 })
  const bassSpan = staffSpanWithLedger(staffLines.bass, { aboveLedgers: 2, belowLedgers: 2 })
  const inUpper = yNorm >= trebleSpan.top && yNorm <= trebleSpan.bottom
  const inLower = yNorm >= bassSpan.top && yNorm <= bassSpan.bottom
  if (inUpper && !inLower) {
    return 'upper'
  }
  if (inLower && !inUpper) {
    return 'lower'
  }
  if (!inUpper && !inLower) {
    return null
  }
  const trebleDist = distanceToNearestStaffLine(yNorm, staffLines.treble)
  const bassDist = distanceToNearestStaffLine(yNorm, staffLines.bass)
  return trebleDist <= bassDist ? 'upper' : 'lower'
}

/**
 * Detect G/F clef glyphs near each staff at the start of a system.
 */
export function detectStaffClefsFromGlyphs(glyphs, imageData, staffLines, { xMaxNorm = 0.34 } = {}) {
  const result = {
    ...DEFAULT_STAFF_CLEFS,
    confidence: 0,
    source: 'default',
    detections: [],
  }
  if (!staffLines?.treble?.length || !imageData?.width) {
    return result
  }

  const singleStaff = !staffLines.bass?.length || staffLines.singleStaff === true
  const upperCandidates = []
  const lowerCandidates = []
  for (const glyph of glyphs ?? []) {
    if (glyph.text !== TREBLE_CLEF_GLYPH && glyph.text !== BASS_CLEF_GLYPH) {
      continue
    }
    const xNorm = glyph.x / imageData.width
    if (xNorm > xMaxNorm) {
      continue
    }
    const yNorm = glyph.y / imageData.height
    const clefSign = glyph.text === BASS_CLEF_GLYPH ? 'bass' : 'treble'
    if (singleStaff) {
      const trebleDist = distanceToNearestStaffLine(yNorm, staffLines.treble)
      const gap = staffLineGap(staffLines.treble)
      // Clef glyphs sit left of the staff; accept when near the single band.
      if (!(gap > 0) || trebleDist > gap * 6) {
        continue
      }
      upperCandidates.push({
        clefSign,
        xNorm,
        yNorm,
        trebleDist,
        bassDist: Infinity,
      })
      continue
    }
    const staffRole = staffRoleForClefGlyph(yNorm, staffLines)
    if (!staffRole) {
      continue
    }
    const candidate = {
      clefSign,
      xNorm,
      yNorm,
      trebleDist: distanceToNearestStaffLine(yNorm, staffLines.treble),
      bassDist: distanceToNearestStaffLine(yNorm, staffLines.bass),
    }
    if (staffRole === 'upper') {
      upperCandidates.push(candidate)
    } else {
      lowerCandidates.push(candidate)
    }
  }

  for (const [staffRole, candidates] of [
    ['upper', upperCandidates],
    ['lower', lowerCandidates],
  ]) {
    if (!candidates.length) {
      continue
    }
    candidates.sort((left, right) => left.xNorm - right.xNorm)
    const best = candidates[0]
    result[staffRole] = best.clefSign
    result.detections.push({ staffRole, ...best })
  }

  if (result.detections.length) {
    result.confidence = 0.92
    result.source = 'vector-glyph'
  }
  return result
}

export function applyAlterToMidi(midi, alter) {
  if (alter == null || alter === 0) {
    return midi
  }
  return midi + alter
}
