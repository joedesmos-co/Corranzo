import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import { staffSpacePixelsForArticulation } from './articulationGeometry.js'
import { isAugmentationDotRelativeToNote } from './detectVectorStaccato.js'

/**
 * Authoritative SMuFL glyphs not handled by the legacy staccato/accent
 * detectors. Above/below variants carry placement through to MusicXML.
 */
export const VECTOR_NOTATION_ARTICULATION_GLYPHS = new Map([
  ['\ue4a4', { type: 'tenuto', placement: 'above' }],
  ['\ue4a5', { type: 'tenuto', placement: 'below' }],
  ['\ue4ac', { type: 'marcato', placement: 'above' }],
  ['\ue4ad', { type: 'marcato', placement: 'below' }],
  ['\ue4c0', { type: 'fermata', placement: 'above' }],
  ['\ue4c1', { type: 'fermata', placement: 'below' }],
])

function glyphInMeasureBox(glyph, measureBox, imageData, { yPad = 0.03 } = {}) {
  const xNorm = glyph.x / imageData.width
  const yNorm = glyph.y / imageData.height
  const x0 = measureBox.playableX0 ?? measureBox.x0 ?? measureBox.xStart
  const x1 = measureBox.x1 ?? measureBox.xEnd
  const y0 = measureBox.y0 ?? measureBox.yTop
  const y1 = measureBox.y1 ?? measureBox.yBottom
  if (![x0, x1, y0, y1].every(Number.isFinite)) {
    return false
  }
  return xNorm >= x0 && xNorm <= x1 && yNorm >= y0 - yPad && yNorm <= y1 + yPad
}

function placementMatches(meta, glyph, note) {
  if (meta.placement === 'above') {
    return glyph.y < note.cy
  }
  if (meta.placement === 'below') {
    return glyph.y > note.cy
  }
  return true
}

function matchScore(note, glyph, meta, measureBox, imageData) {
  const staffSpace = staffSpacePixelsForArticulation(
    measureBox,
    imageData,
    note.clef,
  )
  if (!placementMatches(meta, glyph, note)) {
    return null
  }
  if (isAugmentationDotRelativeToNote(glyph, note)) {
    return null
  }

  const dx = Math.abs(glyph.x - note.cx)
  const dy = Math.abs(glyph.y - note.cy)
  const maxDx = staffSpace * 1.6
  const maxDy =
    meta.type === 'fermata'
      ? Math.max(staffSpace * 5.5, dx < staffSpace * 0.5 ? 64 : 48)
      : Math.max(staffSpace * 4.2, dx < staffSpace * 0.5 ? 60 : 44)
  if (dx > maxDx || dy < staffSpace * 0.35 || dy > maxDy) {
    return null
  }

  // Long horizontal rules are staff/beam/hairpin evidence, not tenuto.
  if (
    meta.type === 'tenuto' &&
    Number.isFinite(glyph.width) &&
    glyph.width > staffSpace * 1.9
  ) {
    return null
  }
  // A fermata is authoritative only as one complete SMuFL glyph. Wide path
  // fragments and isolated raster arcs are handled as diagnostics elsewhere.
  if (
    meta.type === 'fermata' &&
    Number.isFinite(glyph.width) &&
    glyph.width > staffSpace * 3
  ) {
    return null
  }

  return dx + dy * 0.72
}

function pushAssignment(assignments, index, articulation) {
  const current = assignments.get(index) ?? []
  if (current.some((entry) => entry.type === articulation.type)) {
    return false
  }
  assignments.set(index, [...current, { ...articulation }])
  return true
}

function broadcastToChordMates(assignments, notes, seedIndex, articulation, staffSpace) {
  const seed = notes[seedIndex]
  if (!seed) {
    return
  }
  for (let index = 0; index < notes.length; index += 1) {
    if (index === seedIndex) {
      continue
    }
    const note = notes[index]
    if (Math.abs(note.cx - seed.cx) > staffSpace * 0.75) {
      continue
    }
    if (Math.abs(note.cy - seed.cy) > staffSpace * 4.5) {
      continue
    }
    if (seed.clef && note.clef && seed.clef !== note.clef) {
      continue
    }
    pushAssignment(assignments, index, articulation)
  }
}

function emptyCounts() {
  return { tenuto: 0, marcato: 0, fermata: 0 }
}

/**
 * Attach reliable SMuFL tenuto/marcato/fermata glyphs to one note/chord
 * column. Raster/path guesses never override these vector assignments.
 */
export function assignVectorNotationArticulations(
  glyphs,
  notes,
  measureBox,
  imageData,
) {
  const assignments = new Map()
  const detectedByType = emptyCounts()
  const appliedByType = emptyCounts()
  const detectedCandidates = []
  const selectedAttachments = []
  const rejectedCandidates = []
  const claimedGlyphs = new Set()

  for (const glyph of glyphs ?? []) {
    const meta = VECTOR_NOTATION_ARTICULATION_GLYPHS.get(glyph.text)
    if (!meta || !glyphInMeasureBox(glyph, measureBox, imageData)) {
      continue
    }
    const glyphKey = `${glyph.text}:${Math.round(glyph.x)}:${Math.round(glyph.y)}`
    if (claimedGlyphs.has(glyphKey)) {
      continue
    }
    claimedGlyphs.add(glyphKey)
    detectedByType[meta.type] += 1
    detectedCandidates.push({
      glyph,
      type: meta.type,
      placement: meta.placement,
      source: 'vector-glyph',
    })

    let bestIndex = null
    let bestScore = Infinity
    for (let index = 0; index < notes.length; index += 1) {
      const score = matchScore(notes[index], glyph, meta, measureBox, imageData)
      if (score == null || score >= bestScore) {
        continue
      }
      bestIndex = index
      bestScore = score
    }
    if (bestIndex == null) {
      rejectedCandidates.push({
        glyph,
        type: meta.type,
        placement: meta.placement,
        reason: 'no-compatible-note-on-staff',
      })
      continue
    }

    const articulation = {
      type: meta.type,
      placement: meta.placement,
      confidence: meta.type === 'fermata' ? 0.9 : 0.86,
      source: 'vector-glyph',
      glyph: glyph.text,
    }
    pushAssignment(assignments, bestIndex, articulation)
    const staffSpace = staffSpacePixelsForArticulation(
      measureBox,
      imageData,
      notes[bestIndex]?.clef,
    )
    broadcastToChordMates(
      assignments,
      notes,
      bestIndex,
      articulation,
      staffSpace,
    )
    selectedAttachments.push({
      glyph,
      type: meta.type,
      placement: meta.placement,
      noteIndex: bestIndex,
      note: notes[bestIndex],
      score: bestScore,
    })
  }

  for (const articulations of assignments.values()) {
    for (const articulation of articulations) {
      if (
        (articulation.confidence ?? 0) >=
        OMR_MUSICAL_CONFIDENCE.ARTICULATION
      ) {
        appliedByType[articulation.type] += 1
      }
    }
  }

  return {
    assignments,
    detectedByType,
    appliedByType,
    detectedCandidates,
    selectedAttachments,
    rejectedCandidates,
  }
}

/**
 * Fermatas are valid on rests. Reuse the same authoritative glyph/placement
 * geometry, but keep this narrow so rest recognition itself remains frozen.
 */
export function assignVectorFermatasToRests(
  glyphs,
  rests,
  measureBox,
  imageData,
) {
  const assignments = new Map()
  const detectedCandidates = []
  const selectedAttachments = []
  const rejectedCandidates = []

  for (const glyph of glyphs ?? []) {
    const meta = VECTOR_NOTATION_ARTICULATION_GLYPHS.get(glyph.text)
    if (
      meta?.type !== 'fermata' ||
      !glyphInMeasureBox(glyph, measureBox, imageData)
    ) {
      continue
    }
    detectedCandidates.push({
      glyph,
      type: 'fermata',
      placement: meta.placement,
      source: 'vector-glyph',
    })
    let bestIndex = null
    let bestScore = Infinity
    for (let index = 0; index < (rests ?? []).length; index += 1) {
      const score = matchScore(
        rests[index],
        glyph,
        meta,
        measureBox,
        imageData,
      )
      if (score == null || score >= bestScore) {
        continue
      }
      bestIndex = index
      bestScore = score
    }
    if (bestIndex == null) {
      rejectedCandidates.push({
        glyph,
        type: 'fermata',
        placement: meta.placement,
        reason: 'no-compatible-rest-on-staff',
      })
      continue
    }
    const articulation = {
      type: 'fermata',
      placement: meta.placement,
      confidence: 0.9,
      source: 'vector-glyph',
      glyph: glyph.text,
    }
    assignments.set(bestIndex, articulation)
    selectedAttachments.push({
      glyph,
      type: 'fermata',
      placement: meta.placement,
      restIndex: bestIndex,
      rest: rests[bestIndex],
      score: bestScore,
    })
  }
  return {
    assignments,
    detectedCandidates,
    selectedAttachments,
    rejectedCandidates,
  }
}

export function summarizeVectorNotationArticulationDiagnostics(
  measureRecords = [],
) {
  const detectedByType = emptyCounts()
  const appliedByType = emptyCounts()
  let rejectedCandidateCount = 0
  for (const record of measureRecords) {
    const diagnostics = record.vectorNotationArticulationDiagnostics ?? {}
    for (const type of Object.keys(detectedByType)) {
      detectedByType[type] += diagnostics.detectedByType?.[type] ?? 0
      appliedByType[type] += diagnostics.appliedByType?.[type] ?? 0
    }
    rejectedCandidateCount += diagnostics.rejectedCandidates?.length ?? 0
  }
  return { detectedByType, appliedByType, rejectedCandidateCount }
}
