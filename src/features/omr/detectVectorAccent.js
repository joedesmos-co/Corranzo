import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import {
  broadcastArticulationToChordMates,
  staffSpacePixelsForArticulation,
} from './articulationGeometry.js'
import { isAugmentationDotRelativeToNote } from './detectVectorStaccato.js'

/** SMuFL accent articulation glyphs (Bravura / Bravura Text). */
const VECTOR_ACCENT_GLYPHS = new Set(['\ue4a0', '\ue4a1'])

/** Hairpin / crescendo / decrescendo — never treat as per-note accent. */
const VECTOR_HAIRPIN_GLYPHS = new Set(['\ue53d', '\ue53e', '\ue53f', '\ue540'])

function glyphInMeasureBox(glyph, measureBox, imageData, { yPad = 0.045 } = {}) {
  const xNorm = glyph.x / imageData.width
  const yNorm = glyph.y / imageData.height
  const x0 = measureBox.playableX0 ?? measureBox.x0 ?? measureBox.xStart
  const x1 = measureBox.x1 ?? measureBox.xEnd
  const y0 = measureBox.y0 ?? measureBox.yTop
  const y1 = measureBox.y1 ?? measureBox.yBottom
  if (![x0, x1, y0, y1].every(Number.isFinite)) {
    return false
  }
  return (
    xNorm >= x0 &&
    xNorm <= x1 &&
    yNorm >= y0 - yPad &&
    yNorm <= y1 + yPad
  )
}

function staffSpacePixels(measureBox, imageData, clef) {
  return staffSpacePixelsForArticulation(measureBox, imageData, clef)
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
  // Accents sit outside the notehead column; reject staff-line / notehead ink.
  if (absDy < staffSpace * 0.35) {
    return false
  }
  if (dx > staffSpace * 1.25) {
    return false
  }
  // Allow marks a few spaces above/below chords. When staff-gap estimation is
  // compressed, still accept column-aligned marks within a modest pixel reach.
  const maxDy = Math.max(staffSpace * 3.5, dx < staffSpace * 0.5 ? 42 : staffSpace * 3.5)
  if (absDy > maxDy) {
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
  const placement = glyph.text === '\ue4a0' ? 'above' : 'below'
  if (placement === 'above' && glyph.y >= note.cy) {
    return null
  }
  if (placement === 'below' && glyph.y <= note.cy) {
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
  const detectedCandidates = []
  const selectedAttachments = []
  const rejectedCandidates = []

  for (const glyph of glyphs ?? []) {
    if (!glyphInMeasureBox(glyph, measureBox, imageData)) {
      continue
    }
    if (!VECTOR_ACCENT_GLYPHS.has(glyph.text)) {
      continue
    }
    detectedCandidates.push({
      glyph,
      type: 'accent',
      placement: glyph.text === '\ue4a0' ? 'above' : 'below',
      source: 'vector-glyph',
    })

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
      rejectedCandidates.push({
        glyph,
        type: 'accent',
        placement: glyph.text === '\ue4a0' ? 'above' : 'below',
        reason: 'no-compatible-note-on-staff',
      })
      continue
    }

    detectedAccentCount += 1
    const glyphKey = `${glyph.text}:${Math.round(glyph.x)}:${Math.round(glyph.y)}`
    if (claimedGlyphs.has(glyphKey)) {
      continue
    }
    claimedGlyphs.add(glyphKey)

    if (!assignments.has(bestIndex)) {
      const articulation = {
        type: 'accent',
        placement: glyph.text === '\ue4a0' ? 'above' : 'below',
        confidence: 0.84,
        source: 'vector-glyph',
        glyph: glyph.text,
      }
      assignments.set(bestIndex, articulation)
      const staffSpace = staffSpacePixels(measureBox, imageData, notes[bestIndex]?.clef)
      broadcastArticulationToChordMates(
        assignments,
        notes,
        bestIndex,
        articulation,
        staffSpace,
      )
      selectedAttachments.push({
        glyph,
        type: 'accent',
        placement: articulation.placement,
        noteIndex: bestIndex,
        note: notes[bestIndex],
        score: bestScore,
      })
    }
  }

  const appliedAccentCount = [...assignments.values()].filter(
    (articulation) => (articulation.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ARTICULATION,
  ).length

  return {
    assignments,
    detectedAccentCount,
    appliedAccentCount,
    detectedCandidates,
    selectedAttachments,
    rejectedCandidates,
  }
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
