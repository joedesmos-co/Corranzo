import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'

/**
 * SMuFL articulation glyphs in vector PDF text (Bravura / Bravura Text).
 * U+E4E5 is staccatissimo wedge in Bravura Text — treated as staccato for playback.
 */
const VECTOR_STACCATO_GLYPHS = new Set(['\ue4a0', '\ue4a1', '\ue4a2', '\ue4e5'])

/** SMuFL rhythm dot — only staccato when above/below a notehead, not beside it. */
const RHYTHM_DOT_GLYPH = '\ue1e7'

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

function isAugmentationDotRelativeToNote(glyph, note) {
  const dx = glyph.x - note.cx
  const dy = Math.abs(glyph.y - note.cy)
  return dx >= 3 && dx <= 24 && dy <= Math.max(4, dx * 0.35)
}

function isStaccatoRelativeToNote(glyph, note, staffSpace) {
  if (isAugmentationDotRelativeToNote(glyph, note)) {
    return false
  }
  const dx = Math.abs(glyph.x - note.cx)
  const absDy = Math.abs(glyph.y - note.cy)
  if (absDy < staffSpace * 0.4) {
    return false
  }
  if (dx > staffSpace * 1.25) {
    return false
  }
  if (absDy > staffSpace * 3) {
    return false
  }
  return true
}

function isStaccatoCandidateGlyph(glyph) {
  if (VECTOR_STACCATO_GLYPHS.has(glyph.text)) {
    return true
  }
  return glyph.text === RHYTHM_DOT_GLYPH
}

function staccatoMatchScore(note, glyph, measureBox, imageData) {
  const staffSpace = staffSpacePixels(measureBox, imageData, note.clef)
  if (!isStaccatoRelativeToNote(glyph, note, staffSpace)) {
    return null
  }
  const dx = Math.abs(glyph.x - note.cx)
  const dy = Math.abs(glyph.y - note.cy)
  return dx + dy * 0.75
}

/**
 * Bind staccato-related glyphs to the nearest qualifying notehead in a measure.
 */
export function assignVectorStaccato(glyphs, notes, measureBox, imageData) {
  const assignments = new Map()
  let detectedStaccatoCount = 0
  const claimedGlyphs = new Set()

  for (const glyph of glyphs ?? []) {
    if (!isStaccatoCandidateGlyph(glyph)) {
      continue
    }
    if (!glyphInMeasureBox(glyph, measureBox, imageData)) {
      continue
    }

    let bestIndex = null
    let bestScore = Infinity
    for (let index = 0; index < notes.length; index += 1) {
      const score = staccatoMatchScore(notes[index], glyph, measureBox, imageData)
      if (score == null || score >= bestScore) {
        continue
      }
      bestScore = score
      bestIndex = index
    }

    if (bestIndex == null) {
      continue
    }

    detectedStaccatoCount += 1
    const glyphKey = `${glyph.text}:${Math.round(glyph.x)}:${Math.round(glyph.y)}`
    if (claimedGlyphs.has(glyphKey)) {
      continue
    }
    claimedGlyphs.add(glyphKey)

    if (!assignments.has(bestIndex)) {
      assignments.set(bestIndex, {
        type: 'staccato',
        confidence: 0.82,
        source: 'vector-glyph',
        glyph: glyph.text,
      })
    }
  }

  const appliedStaccatoCount = [...assignments.values()].filter(
    (articulation) => (articulation.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ARTICULATION,
  ).length

  return { assignments, detectedStaccatoCount, appliedStaccatoCount }
}

export function summarizeVectorStaccatoDiagnostics(measureRecords = []) {
  let detectedStaccatoCount = 0
  let appliedStaccatoCount = 0
  for (const record of measureRecords) {
    const diagnostics = record.vectorStaccatoDiagnostics ?? {}
    detectedStaccatoCount += diagnostics.detectedStaccatoCount ?? 0
    appliedStaccatoCount += diagnostics.appliedStaccatoCount ?? 0
  }
  return { detectedStaccatoCount, appliedStaccatoCount }
}

export { VECTOR_STACCATO_GLYPHS, RHYTHM_DOT_GLYPH, isAugmentationDotRelativeToNote, isStaccatoRelativeToNote }
