import { isInk } from './omrInk.js'
import {
  OMR_DURATION_DIVISIONS,
  OMR_RHYTHM_CONFIDENCE,
} from './omrRhythmConstants.js'

const STEM_OFFSET = 4
const MAX_STEM_SCAN = 42
const BEAM_SCAN_X = 28
const DOT_OFFSET_X = 9
const DOT_WINDOW = 4

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

/**
 * Hollow noteheads have a bright center; filled noteheads stay dark throughout.
 */
export function isHollowNotehead(imageData, cx, cy, threshold) {
  let centerDark = 0
  let edgeDark = 0
  for (let y = cy - 2; y <= cy + 2; y += 1) {
    for (let x = cx - 3; x <= cx + 3; x += 1) {
      if (!inkAt(imageData, x, y, threshold)) {
        continue
      }
      const onEdge = x <= cx - 2 || x >= cx + 2 || y <= cy - 1 || y >= cy + 1
      if (onEdge) {
        edgeDark += 1
      } else {
        centerDark += 1
      }
    }
  }
  return edgeDark >= 4 && centerDark <= 2
}

export function detectStem(imageData, cx, cy, threshold, staffMidY) {
  const stemUp = cy <= staffMidY
  const stemX = cx + STEM_OFFSET
  let length = 0
  const direction = stemUp ? -1 : 1
  const startOffset = 3

  for (let step = startOffset; step <= MAX_STEM_SCAN; step += 1) {
    const y = cy + direction * step
    if (inkAt(imageData, stemX, y, threshold) || inkAt(imageData, stemX - 1, y, threshold)) {
      length = step - startOffset + 1
    } else if (length > 0) {
      break
    }
  }

  if (length < 4) {
    return null
  }

  const tipY = cy + direction * (startOffset + length - 1)
  return {
    x: stemX,
    tipY,
    length: startOffset + length,
    direction: stemUp ? 'up' : 'down',
  }
}

/**
 * Horizontal ink run length at a stem tip Y (or parallel beam row).
 */
export function measureBeamStrengthAtY(imageData, stem, threshold, beamY) {
  if (!stem || !Number.isFinite(beamY)) {
    return 0
  }
  let run = 0
  for (let x = stem.x; x <= stem.x + BEAM_SCAN_X; x += 1) {
    if (inkAt(imageData, x, beamY, threshold)) {
      run += 1
    } else if (run > 0) {
      break
    }
  }
  return run
}

export function measureBeamStrength(imageData, stem, threshold) {
  if (!stem) {
    return 0
  }
  return measureBeamStrengthAtY(imageData, stem, threshold, stem.tipY)
}

/**
 * Detect a secondary beam as a second horizontal ink row parallel to the tip
 * beam, offset toward the notehead along the stem. Does NOT use saturated
 * tip-row strength as a sixteenth proxy.
 */
export function hasSecondaryBeamRow(imageData, stem, threshold) {
  if (!stem) {
    return false
  }
  const primary = measureBeamStrengthAtY(imageData, stem, threshold, stem.tipY)
  if (primary < 8) {
    return false
  }
  // Secondary beams sit toward the notehead from the tip (stem-up tip is above).
  const towardHead = stem.direction === 'up' ? 1 : -1
  const offsets = [3, 4, 5, 6, 7]
  for (const offset of offsets) {
    const y = stem.tipY + towardHead * offset
    const secondary = measureBeamStrengthAtY(imageData, stem, threshold, y)
    // Require a real second run, not residual tip-row thickness.
    if (secondary >= 8 && Math.abs(y - stem.tipY) >= 3) {
      return true
    }
  }
  return false
}

/**
 * Count unbeamed flags at a stem tip.
 *
 * Single flag → eighth; double flag → sixteenth. Requires no primary beam and
 * short tip runs only — never tip-row darkness / beamStrength alone.
 */
export function countFlags(imageData, stem, threshold) {
  if (!stem || (stem.length ?? 0) < 12) {
    return 0
  }
  const primary = measureBeamStrength(imageData, stem, threshold)
  if (primary >= 8) {
    return 0
  }
  const towardHead = stem.direction === 'up' ? 1 : -1
  // Flags hang off the tip opposite the notehead along the stem, typically to
  // the right of an up-stem / left of a down-stem in engraved music.
  const flagSide = stem.direction === 'up' ? 1 : -1

  function shortRunAt(y) {
    let run = 0
    for (let step = 1; step <= 12; step += 1) {
      const x = stem.x + flagSide * step
      if (inkAt(imageData, x, y, threshold) || inkAt(imageData, x, y + towardHead, threshold)) {
        run += 1
      } else if (run > 0) {
        break
      }
    }
    return run
  }

  const tipRun = shortRunAt(stem.tipY)
  if (tipRun < 4 || tipRun > 11) {
    return 0
  }
  let second = 0
  for (const offset of [3, 4, 5]) {
    const run = shortRunAt(stem.tipY + towardHead * offset)
    if (run >= 4 && run <= 11) {
      second += 1
    }
  }
  if (second >= 1) {
    return 2
  }
  return 1
}

/**
 * Count beam attachments for a stem.
 *
 * Continuous primary beams often saturate BEAM_SCAN_X (~28). A long tip-row
 * run is still one primary beam (eighths). Sixteenths require a second parallel
 * beam row toward the notehead — never tip-row strength alone.
 *
 * Unbeamed flags are handled by countFlags for callers that opt in; countBeams
 * itself stays beam-row-only so residual tip ink cannot invent eighths/sixteenths.
 */
export function countBeams(imageData, stem, threshold, bounds) {
  void bounds
  const strength = measureBeamStrength(imageData, stem, threshold)
  if (strength < 8) {
    return 0
  }
  if (hasSecondaryBeamRow(imageData, stem, threshold)) {
    return 2
  }
  return 1
}

export function detectDot(imageData, cx, cy, threshold) {
  const dotX = cx + DOT_OFFSET_X
  let dark = 0
  for (let y = cy - 1; y <= cy + 1; y += 1) {
    for (let x = dotX - 1; x <= dotX + 1; x += 1) {
      if (inkAt(imageData, x, y, threshold)) {
        dark += 1
      }
    }
  }
  if (dark < 2 || dark > 6) {
    return false
  }
  // A dot sits beside the note, not on a stem or beam.
  return !inkAt(imageData, dotX, cy - 4, threshold) && !inkAt(imageData, dotX, cy + 4, threshold)
}

export function detectTieToNext(imageData, cx, cy, threshold, bounds) {
  let arcInk = 0
  for (let x = cx + 4; x <= cx + 22 && x <= bounds.right; x += 1) {
    for (let y = cy - 6; y <= cy + 2; y += 1) {
      if (inkAt(imageData, x, y, threshold)) {
        arcInk += 1
      }
    }
  }
  return arcInk >= 5 && arcInk <= 40
}

/**
 * Classify duration from stem / beam / hollowness evidence.
 *
 * Important: a saturated beamStrength (long continuous primary beam) is NOT a
 * sixteenth. The tip-row scan cannot see a second beam; treating strength≥14 as
 * sixteenth produced mass Eighth→16th errors on dense vector scores.
 */
export function inferNoteDuration({ hollow, stem, beams, dotted, beamStrength = 0 }) {
  let durationType = 'quarter'
  let confidence = OMR_RHYTHM_CONFIDENCE.MEDIUM

  if (!stem) {
    if (hollow) {
      durationType = 'whole'
      confidence = 0.74
    } else {
      durationType = 'quarter'
      confidence = OMR_RHYTHM_CONFIDENCE.LOW
    }
  } else if (hollow) {
    durationType = 'half'
    confidence = 0.82
  } else if (beams >= 2) {
    // Explicit multi-beam count only (not tip-row strength saturation).
    durationType = 'sixteenth'
    confidence = 0.72
  } else if (beams >= 1 || beamStrength >= 8) {
    durationType = 'eighth'
    confidence = 0.76
  } else if (stem.length > 30) {
    durationType = 'half'
    confidence = 0.58
  } else {
    durationType = 'quarter'
    confidence = 0.8
  }

  let durationDivisions = OMR_DURATION_DIVISIONS[durationType]
  if (dotted) {
    durationDivisions = Math.round(durationDivisions * 1.5)
    confidence *= 0.92
  }

  return { durationType, durationDivisions, confidence }
}

export function enrichNoteheadRhythm(imageData, notehead, measureBox, inkThreshold, bounds) {
  const staffMidY = Math.round(
    ((measureBox.y0 + measureBox.y1) / 2) * imageData.height,
  )
  // Vector noteheads carry authoritative hollowness from the glyph codepoint
  // (half/whole vs black). Prefer it over ink probing, which misreads hollow
  // heads crossed by ledger lines and filled heads touched by other ink.
  const hollow =
    typeof notehead.hollowGlyph === 'boolean'
      ? notehead.hollowGlyph
      : isHollowNotehead(imageData, notehead.cx, notehead.cy, inkThreshold)
  const stem = detectStem(imageData, notehead.cx, notehead.cy, inkThreshold, staffMidY)
  const beamStrength = measureBeamStrength(imageData, stem, inkThreshold)
  const beams = countBeams(imageData, stem, inkThreshold, bounds)
  const dotted = detectDot(imageData, notehead.cx, notehead.cy, inkThreshold)
  const tieStart = detectTieToNext(imageData, notehead.cx, notehead.cy, inkThreshold, bounds)
  const rhythm = inferNoteDuration({ hollow, stem, beams, dotted, beamStrength })

  return {
    ...notehead,
    hollow,
    stem,
    beams,
    // Persist tip-row strength so downstream beam caps can use it even when
    // beams was historically dropped for saturated runs.
    beamStrength,
    dotted,
    tieStart,
    ...rhythm,
  }
}
