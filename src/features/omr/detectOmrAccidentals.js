import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import { applyAlterToMidi } from './pitchFromStaffPosition.js'

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function detectAccidentalGlyph(imageData, cx, cy, threshold) {
  let sharpScore = 0
  let flatScore = 0

  for (let y = cy - 5; y <= cy + 5; y += 1) {
    if (inkAt(imageData, cx, y, threshold)) {
      sharpScore += 1
      flatScore += 1
    }
  }
  for (const dx of [-2, 2]) {
    for (let y = cy - 2; y <= cy + 2; y += 2) {
      if (inkAt(imageData, cx + dx, y, threshold)) {
        sharpScore += 1
      }
    }
  }
  for (let x = cx - 1; x <= cx + 2; x += 1) {
    for (let y = cy; y <= cy + 4; y += 2) {
      if (inkAt(imageData, x, y, threshold)) {
        flatScore += 1
      }
    }
  }

  if (sharpScore >= 4 && sharpScore > flatScore + 1) {
    return { alter: 1, confidence: Math.min(0.9, 0.5 + sharpScore * 0.05), type: 'sharp' }
  }
  if (flatScore >= 4 && flatScore > sharpScore + 1) {
    return { alter: -1, confidence: Math.min(0.88, 0.48 + flatScore * 0.05), type: 'flat' }
  }
  return null
}

/**
 * Detect a notated accidental immediately left of a notehead.
 */
export function detectAccidentalNearNote(imageData, notehead, inkThreshold) {
  const { cx, cy } = notehead
  for (let scanX = cx - 18; scanX >= cx - 6; scanX -= 2) {
    const glyph = detectAccidentalGlyph(imageData, scanX, cy, inkThreshold)
    if (glyph) {
      return glyph
    }
  }
  return null
}

export function refineNotePitch(notehead, { keySignature = null, imageData = null, inkThreshold = 170 } = {}) {
  let accidental = null
  if (imageData) {
    accidental = detectAccidentalNearNote(imageData, notehead, inkThreshold)
  }

  let midi = notehead.midi
  let alter = null
  let pitchConfidence = 0.7

  if (accidental && accidental.confidence >= OMR_MUSICAL_CONFIDENCE.ACCIDENTAL) {
    alter = accidental.alter
    midi = applyAlterToMidi(midi, alter)
    pitchConfidence = accidental.confidence
  } else if (keySignature?.fifths && (keySignature.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.KEY) {
    pitchConfidence = Math.min(0.82, keySignature.confidence)
  }

  return {
    ...notehead,
    midi,
    alter,
    accidental,
    pitchConfidence,
    ledger: notehead.ledger ?? null,
  }
}

export function refineMeasurePitches(noteheads, context) {
  return noteheads.map((notehead) => refineNotePitch(notehead, context))
}
