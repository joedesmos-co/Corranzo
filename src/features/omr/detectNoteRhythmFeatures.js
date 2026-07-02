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

export function measureBeamStrength(imageData, stem, threshold) {
  if (!stem) {
    return 0
  }
  const beamY = stem.tipY
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

export function countBeams(imageData, stem, threshold, bounds) {
  const strength = measureBeamStrength(imageData, stem, threshold)
  if (strength < 8 || strength > 22) {
    return 0
  }
  if (strength >= 8) {
    return 1
  }
  return 0
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
  } else if (beamStrength >= 14) {
    durationType = 'sixteenth'
    confidence = 0.7
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
  const beams = countBeams(imageData, stem, inkThreshold, bounds)
  const beamStrength = measureBeamStrength(imageData, stem, inkThreshold)
  const dotted = detectDot(imageData, notehead.cx, notehead.cy, inkThreshold)
  const tieStart = detectTieToNext(imageData, notehead.cx, notehead.cy, inkThreshold, bounds)
  const rhythm = inferNoteDuration({ hollow, stem, beams, dotted, beamStrength })

  return {
    ...notehead,
    hollow,
    stem,
    beams,
    dotted,
    tieStart,
    ...rhythm,
  }
}
