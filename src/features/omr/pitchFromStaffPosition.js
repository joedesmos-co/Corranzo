/**
 * Extended staff pitch mapping with ledger-line range and written pitch output.
 */

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
const MIN_LEDGER_DIATONIC_OFFSET = -8
const MAX_LEDGER_DIATONIC_OFFSET = 18

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

export function estimateGrandStaffLines(system) {
  const measuredStaves = Array.isArray(system?.staves)
    ? system.staves
        .filter((stave) => Number.isFinite(stave?.y0) && Number.isFinite(stave?.y1))
        .sort((left, right) => left.y0 - right.y0)
    : []
  if (measuredStaves.length >= 2) {
    const treble = measuredStaves[0]
    const bass = measuredStaves[1]
    function measuredLinesForStaff(stave) {
      const lineGap = (stave.y1 - stave.y0) / 4
      return [0, 1, 2, 3, 4].map((i) => stave.y0 + i * lineGap)
    }
    return {
      treble: measuredLinesForStaff(treble),
      bass: measuredLinesForStaff(bass),
      splitY: (treble.y1 + bass.y0) / 2,
    }
  }

  const { y0, y1 } = system
  const height = y1 - y0
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

/**
 * Shift glyph anchor toward notehead center for pitch mapping (bounded).
 */
export function resolveNoteheadYNorm(glyph, imageData, lineYs) {
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
  if (!staffLines?.treble?.length || !staffLines?.bass?.length || !imageData?.width) {
    return result
  }

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
    const staffRole = staffRoleForClefGlyph(yNorm, staffLines)
    if (!staffRole) {
      continue
    }
    const clefSign = glyph.text === BASS_CLEF_GLYPH ? 'bass' : 'treble'
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
