import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import { isAugmentationDotRelativeToNote } from './detectVectorStaccato.js'

/** SMuFL accent articulation glyphs (Bravura / Bravura Text). */
const VECTOR_ACCENT_GLYPHS = new Set(['\ue4a3', '\ue4a4'])

/** Hairpin / crescendo / decrescendo — never treat as per-note accent. */
const VECTOR_HAIRPIN_GLYPHS = new Set(['\ue53d', '\ue53e', '\ue53f', '\ue540'])

function glyphInMeasureBox(glyph, measureBox, imageData, { yPad = 0.025 } = {}) {
  const xNorm = glyph.x / imageData.width
  const yNorm = glyph.y / imageData.height
  return (
    xNorm >= (measureBox.playableX0 ?? measureBox.x0) &&
    xNorm <= measureBox.x1 &&
    yNorm >= measureBox.y0 - yPad &&
    yNorm <= measureBox.y1 + yPad
  )
}

function staffSpacePixels(measureBox, imageData, clef) {
  const lines =
    clef === 'treble' ? measureBox.staffLines?.treble : measureBox.staffLines?.bass
  if (!lines?.length || lines.length < 2) {
    return 8
  }
  return Math.max(4, (lines[1] - lines[0]) * imageData.height)
}

function looksLikeHairpinGlyph(glyph, staffSpace) {
  if (VECTOR_HAIRPIN_GLYPHS.has(glyph.text)) {
    return true
  }
  const width = glyph.width ?? 0
  return width > staffSpace * 2.5
}

function isAccentRelativeToNote(glyph, note, staffSpace) {
  if (isAugmentationDotRelativeToNote(glyph, note)) {
    return false
  }
  const dx = Math.abs(glyph.x - note.cx)
  const absDy = Math.abs(glyph.y - note.cy)
  if (absDy < staffSpace * 0.35) {
    return false
  }
  if (dx > staffSpace * 1.1) {
    return false
  }
  if (absDy > staffSpace * 2.8) {
    return false
  }
  return true
}

function accentMatchScore(note, glyph, measureBox, imageData) {
  const staffSpace = staffSpacePixels(measureBox, imageData, note.clef)
  if (looksLikeHairpinGlyph(glyph, staffSpace)) {
    return null
  }
  if (!VECTOR_ACCENT_GLYPHS.has(glyph.text)) {
    return null
  }
  if (!isAccentRelativeToNote(glyph, note, staffSpace)) {
    return null
  }
  const dx = Math.abs(glyph.x - note.cx)
  const dy = Math.abs(glyph.y - note.cy)
  return dx + dy * 0.75
}

/**
 * Bind accent glyphs to the nearest qualifying notehead in a measure.
 */
export function assignVectorAccent(glyphs, notes, measureBox, imageData) {
  const assignments = new Map()
  let detectedAccentCount = 0
  const claimedGlyphs = new Set()

  for (const glyph of glyphs ?? []) {
    if (!glyphInMeasureBox(glyph, measureBox, imageData)) {
      continue
    }

    let bestIndex = null
    let bestScore = Infinity
    for (let index = 0; index < notes.length; index += 1) {
      const score = accentMatchScore(notes[index], glyph, measureBox, imageData)
      if (score == null || score >= bestScore) {
        continue
      }
      bestScore = score
      bestIndex = index
    }

    if (bestIndex == null) {
      continue
    }

    detectedAccentCount += 1
    const glyphKey = `${glyph.text}:${Math.round(glyph.x)}:${Math.round(glyph.y)}`
    if (claimedGlyphs.has(glyphKey)) {
      continue
    }
    claimedGlyphs.add(glyphKey)

    if (!assignments.has(bestIndex)) {
      assignments.set(bestIndex, {
        type: 'accent',
        confidence: 0.84,
        source: 'vector-glyph',
        glyph: glyph.text,
      })
    }
  }

  const appliedAccentCount = [...assignments.values()].filter(
    (articulation) => (articulation.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ARTICULATION,
  ).length

  return { assignments, detectedAccentCount, appliedAccentCount }
}

export function summarizeVectorAccentDiagnostics(measureRecords = []) {
  let detectedAccentCount = 0
  let appliedAccentCount = 0
  for (const record of measureRecords) {
    const diagnostics = record.vectorAccentDiagnostics ?? {}
    detectedAccentCount += diagnostics.detectedAccentCount ?? 0
    appliedAccentCount += diagnostics.appliedAccentCount ?? 0
  }
  return { detectedAccentCount, appliedAccentCount }
}

export {
  VECTOR_ACCENT_GLYPHS,
  VECTOR_HAIRPIN_GLYPHS,
  looksLikeHairpinGlyph,
  isAccentRelativeToNote,
}
