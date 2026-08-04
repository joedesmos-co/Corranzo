import { isInk } from './omrInk.js'
import {
  OMR_DURATION_DIVISIONS,
  OMR_RHYTHM_CONFIDENCE,
} from './omrRhythmConstants.js'

const DEFAULT_STAFF_SPACE = 8
const MAX_STEM_SCAN_SPACES = 4.5
const BEAM_SCAN_X = 28

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
      // Use the full 3×3 interior. Slanted filled heads can leave the lower
      // three pixels antialiased while five interior pixels remain black; the
      // old single-row probe misread those as an open half-note center.
      const onEdge = Math.abs(x - cx) >= 2 || Math.abs(y - cy) >= 2
      if (onEdge) {
        edgeDark += 1
      } else {
        centerDark += 1
      }
    }
  }
  // A one-pixel staff line can cross an otherwise open center, contributing
  // exactly three interior pixels. Filled heads retain more two-dimensional
  // center ink, so this remains distinct from the five-pixel slanted-fill case.
  return edgeDark >= 4 && centerDark <= 3
}

export function detectStem(
  imageData,
  cx,
  cy,
  threshold,
  staffMidY,
  staffSpace = DEFAULT_STAFF_SPACE,
) {
  const scale = Number.isFinite(staffSpace) && staffSpace >= 3
    ? staffSpace
    : DEFAULT_STAFF_SPACE
  const startOffset = Math.max(2, Math.round(scale * 0.18))
  const maxStemScan = Math.max(18, Math.round(scale * MAX_STEM_SCAN_SPACES))
  const minStemRun = Math.max(5, Math.round(scale * 0.55))
  const expectedDirection = cy <= staffMidY ? -1 : 1
  const absoluteOffsets = [...new Set([
    Math.max(3, Math.round(scale * 0.34)),
    Math.max(3, Math.round(scale * 0.42)),
    Math.max(4, Math.round(scale * 0.5)),
    Math.max(4, Math.round(scale * 0.58)),
    Math.max(4, Math.round(scale * 0.66)),
    Math.max(5, Math.round(scale * 0.74)),
  ])]
  const candidates = []

  for (const absoluteOffset of absoluteOffsets) {
    for (const side of [-1, 1]) {
      const stemX = Math.round(cx + side * absoluteOffset)
      for (const direction of [-1, 1]) {
        let lastInkStep = 0
        let inkCount = 0
        let misses = 0
        for (let step = startOffset; step <= maxStemScan; step += 1) {
          const y = cy + direction * step
          const hasInk =
            inkAt(imageData, stemX, y, threshold) ||
            inkAt(imageData, stemX - side, y, threshold)
          if (hasInk) {
            lastInkStep = step
            inkCount += 1
            misses = 0
          } else if (lastInkStep > 0 && misses < 1) {
            // Scans and deskewing can leave a one-pixel break in a real stem.
            misses += 1
          } else if (lastInkStep > 0) {
            break
          }
        }
        const runLength = lastInkStep > 0 ? lastInkStep - startOffset + 1 : 0
        if (runLength < minStemRun || inkCount / Math.max(1, runLength) < 0.72) {
          continue
        }
        const conventionalSide = direction < 0 ? 1 : -1
        const score =
          runLength +
          (side === conventionalSide ? scale * 0.18 : 0) +
          (direction === expectedDirection ? scale * 0.04 : 0)
        candidates.push({
          x: stemX,
          tipY: cy + direction * lastInkStep,
          length: lastInkStep,
          direction: direction < 0 ? 'up' : 'down',
          side: side > 0 ? 'right' : 'left',
          inkRatio: inkCount / Math.max(1, runLength),
          score,
        })
      }
    }
  }

  if (!candidates.length) {
    return null
  }
  const best = candidates.sort(
    (left, right) => right.score - left.score || right.inkRatio - left.inkRatio,
  )[0]
  const { score: _score, ...stem } = best
  return stem
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

export function detectDot(
  imageData,
  cx,
  cy,
  threshold,
  staffSpace = DEFAULT_STAFF_SPACE,
  stem = null,
) {
  const scale = Number.isFinite(staffSpace) && staffSpace >= 3
    ? staffSpace
    : DEFAULT_STAFF_SPACE
  const xStart = Math.max(6, Math.round(scale * 0.88))
  const xEnd = Math.max(xStart, Math.round(scale * 1.55))
  const yRange = Math.max(2, Math.round(scale * 0.35))
  const isolationProbe = Math.max(4, Math.round(scale * 0.42))
  for (let yCenter = Math.round(cy) - yRange; yCenter <= Math.round(cy) + yRange; yCenter += 1) {
    for (let dotX = Math.round(cx) + xStart; dotX <= Math.round(cx) + xEnd; dotX += 1) {
      if (stem && Math.abs(dotX - stem.x) <= scale * 0.35) continue
      if (!inkAt(imageData, dotX, yCenter, threshold)) continue
      let dark = 0
      for (let y = yCenter - 1; y <= yCenter + 1; y += 1) {
        for (let x = dotX - 1; x <= dotX + 1; x += 1) {
          if (inkAt(imageData, x, y, threshold)) dark += 1
        }
      }
      if (dark < 2 || dark > 7) continue
      // Staff lines, stems, and beams continue well beyond a compact dot.
      if (
        inkAt(imageData, dotX - isolationProbe, yCenter, threshold) ||
        inkAt(imageData, dotX + isolationProbe, yCenter, threshold) ||
        inkAt(imageData, dotX, yCenter - isolationProbe, threshold) ||
        inkAt(imageData, dotX, yCenter + isolationProbe, threshold)
      ) {
        continue
      }
      return true
    }
  }
  return false
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
export function inferNoteDuration({
  hollow,
  stem,
  beams,
  dotted,
  beamStrength = 0,
  noteheadGlyph = null,
}) {
  let durationType = 'quarter'
  let confidence = OMR_RHYTHM_CONFIDENCE.MEDIUM

  // SMuFL open heads distinguish whole vs half; prefer codepoint over stem ink.
  if (noteheadGlyph === 'whole') {
    durationType = 'whole'
    confidence = 0.9
  } else if (noteheadGlyph === 'half') {
    durationType = 'half'
    confidence = 0.88
  } else if (!stem) {
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
  const pitchLines = notehead?.pitchMapping?.lineYs ??
    (notehead?.clef === 'bass'
      ? measureBox?.staffLines?.bass
      : measureBox?.staffLines?.treble)
  const sortedPitchLines = [...(pitchLines ?? [])]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const staffSpace = sortedPitchLines.length >= 2
    ? ((sortedPitchLines.at(-1) - sortedPitchLines[0]) * imageData.height) /
      (sortedPitchLines.length - 1)
    : DEFAULT_STAFF_SPACE
  const stem = detectStem(
    imageData,
    notehead.cx,
    notehead.cy,
    inkThreshold,
    staffMidY,
    staffSpace,
  )
  const rawBeamStrength = measureBeamStrength(imageData, stem, inkThreshold)
  // A stem that terminates on a staff row can make that infinite row look like
  // a primary beam. The notehead's own staff geometry is independent evidence;
  // suppress only tip rows coincident with a canonical staff line.
  const beamTipOnStaffLine = Boolean(
    stem &&
    sortedPitchLines.some(
      (line) => Math.abs(line * imageData.height - stem.tipY) <= Math.max(1, staffSpace * 0.14),
    ),
  )
  const beamStrength = beamTipOnStaffLine ? 0 : rawBeamStrength
  const beams = beamTipOnStaffLine
    ? 0
    : countBeams(imageData, stem, inkThreshold, bounds)
  const dotted = detectDot(
    imageData,
    notehead.cx,
    notehead.cy,
    inkThreshold,
    staffSpace,
    stem,
  )
  const tieStart = detectTieToNext(imageData, notehead.cx, notehead.cy, inkThreshold, bounds)
  const rhythm = inferNoteDuration({
    hollow,
    stem,
    beams,
    dotted,
    beamStrength,
    noteheadGlyph: notehead.noteheadGlyph ?? null,
  })

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
