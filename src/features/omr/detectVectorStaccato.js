import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import {
  broadcastArticulationToChordMates,
  staffSpacePixelsForArticulation,
} from './articulationGeometry.js'
import { isOmrProvenanceEnabled } from './omrDiagnosticFlags.js'

/**
 * SMuFL articulation glyphs in vector PDF text (Bravura / Bravura Text).
 * U+E4A2/E4A3 are the authoritative above/below staccato glyphs.
 *
 * Keep rest glyphs (U+E4E3–U+E4E7) out of this set. In particular, U+E4E5 is
 * a quarter rest, not a staccatissimo wedge.
 */
const VECTOR_STACCATO_GLYPHS = new Set(['\ue4a2', '\ue4a3'])

/** SMuFL augmentation dot. It is never authoritative staccato evidence. */
const RHYTHM_DOT_GLYPH = '\ue1e7'

function glyphInMeasureBox(glyph, measureBox, imageData, { yPad = 0.025 } = {}) {
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
  // Column-aligned marks may sit farther when staff-gap estimation is tight.
  const maxDy = Math.max(staffSpace * 3.2, dx < staffSpace * 0.5 ? 40 : staffSpace * 3.2)
  if (absDy > maxDy) {
    return false
  }
  return true
}

function isStaccatoCandidateGlyph(glyph) {
  return VECTOR_STACCATO_GLYPHS.has(glyph.text)
}

function staccatoPlacementForGlyph(glyph) {
  if (glyph?.text === '\ue4a2') {
    return 'above'
  }
  if (glyph?.text === '\ue4a3') {
    return 'below'
  }
  return null
}

function staccatoMatchScore(note, glyph, measureBox, imageData) {
  const staffSpace = staffSpacePixels(measureBox, imageData, note.clef)
  if (!isStaccatoRelativeToNote(glyph, note, staffSpace)) {
    return null
  }
  const placement = staccatoPlacementForGlyph(glyph)
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
 * Bind staccato-related glyphs to the nearest qualifying notehead in a measure.
 */
export function assignVectorStaccato(glyphs, notes, measureBox, imageData) {
  const assignments = new Map()
  let detectedStaccatoCount = 0
  const claimedGlyphs = new Set()
  const detectedCandidates = []
  const selectedAttachments = []
  const rejectedCandidates = []

  for (const glyph of glyphs ?? []) {
    if (!isStaccatoCandidateGlyph(glyph)) {
      continue
    }
    if (!glyphInMeasureBox(glyph, measureBox, imageData)) {
      continue
    }
    detectedCandidates.push({
      glyph,
      type: 'staccato',
      placement: staccatoPlacementForGlyph(glyph),
      source: 'vector-glyph',
    })

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
      rejectedCandidates.push({
        glyph,
        type: 'staccato',
        placement: staccatoPlacementForGlyph(glyph),
        reason: 'no-compatible-note-on-staff',
      })
      continue
    }

    detectedStaccatoCount += 1
    const glyphKey = `${glyph.text}:${Math.round(glyph.x)}:${Math.round(glyph.y)}`
    if (claimedGlyphs.has(glyphKey)) {
      continue
    }
    claimedGlyphs.add(glyphKey)

    if (!assignments.has(bestIndex)) {
      const articulation = {
        type: 'staccato',
        placement: staccatoPlacementForGlyph(glyph),
        confidence: 0.82,
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
        type: 'staccato',
        placement: articulation.placement,
        noteIndex: bestIndex,
        note: notes[bestIndex],
        score: bestScore,
      })
    }
  }

  const appliedStaccatoCount = [...assignments.values()].filter(
    (articulation) => (articulation.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.ARTICULATION,
  ).length

  return {
    assignments,
    detectedStaccatoCount,
    appliedStaccatoCount,
    detectedCandidates,
    selectedAttachments,
    rejectedCandidates,
  }
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

function isAugmentationDotGlyph(glyph) {
  const text = glyph?.text ?? ''
  return text === RHYTHM_DOT_GLYPH || text === '.'
}

/**
 * Bind SMuFL / period augmentation dots to the nearest notehead beside them.
 * Vector scores should not rely on ink detectDot, which false-triggers on
 * neighboring noteheads and articulation marks.
 *
 * One printed augmentation dot may apply to an entire same-onset chord (shared
 * written duration) without attaching to neighboring onsets or other voices.
 *
 * When DEV provenance is enabled, returns `{ assignments, diagnostics }` so
 * callers can inspect geometry / owners / rejection reasons. Production callers
 * that ignore the shape still receive a Map when provenance is off (unchanged).
 */
function competingDotInterpretationScores(glyph, notes, measureBox, imageData) {
  let articulationScore = 0
  const x0 = (measureBox.playableX0 ?? measureBox.x0 ?? 0) * imageData.width
  const x1 = (measureBox.x1 ?? 1) * imageData.width
  const edgeDist = Math.min(Math.abs(glyph.x - x0), Math.abs(glyph.x - x1))
  const measureWidth = Math.max(1, x1 - x0)
  // Repeat dots sit near barlines; score rises toward either measure edge.
  const repeatDotScore = Math.max(0, 1 - edgeDist / (measureWidth * 0.18))
  for (const note of notes ?? []) {
    const staffSpace = staffSpacePixels(measureBox, imageData, note.clef)
    if (!isStaccatoRelativeToNote(glyph, note, staffSpace)) {
      continue
    }
    const dx = Math.abs(glyph.x - note.cx)
    const dy = Math.abs(glyph.y - note.cy)
    articulationScore = Math.max(articulationScore, 1 / (1 + dx + dy * 0.75))
  }
  return { articulationScore, repeatDotScore }
}

export function assignVectorAugmentationDots(glyphs, notes, measureBox, imageData) {
  const collect = isOmrProvenanceEnabled()
  const assignments = new Map()
  const claimed = new Set()
  const diagnostics = collect ? [] : null

  for (const glyph of glyphs ?? []) {
    if (!isAugmentationDotGlyph(glyph)) {
      continue
    }
    const competing = collect
      ? competingDotInterpretationScores(glyph, notes, measureBox, imageData)
      : null
    if (!glyphInMeasureBox(glyph, measureBox, imageData)) {
      if (diagnostics) {
        diagnostics.push({
          glyph: { text: glyph.text, x: glyph.x, y: glyph.y },
          geometry: { x: glyph.x, y: glyph.y },
          possibleOwners: [],
          augmentationScore: 0,
          articulationScore: competing.articulationScore,
          repeatDotScore: competing.repeatDotScore,
          rejectionReason: 'outside-measure',
          finalOwner: null,
        })
      }
      continue
    }
    if (glyph.source === 'vector-path' && glyph.repeatPairCandidate) {
      if (diagnostics) {
        diagnostics.push({
          glyph: { text: glyph.text, x: glyph.x, y: glyph.y },
          geometry: { x: glyph.x, y: glyph.y },
          possibleOwners: [],
          augmentationScore: 0,
          articulationScore: competing.articulationScore,
          repeatDotScore: competing.repeatDotScore,
          rejectionReason: 'path-repeat-dot-pair',
          finalOwner: null,
        })
      }
      continue
    }

    const possibleOwners = []
    let bestIndex = null
    let bestScore = Infinity
    for (let index = 0; index < notes.length; index += 1) {
      const note = notes[index]
      const dx = glyph.x - note.cx
      const staffSpace = staffSpacePixels(measureBox, imageData, note.clef)
      // PDF paths use their actual visual center, while vector notehead text
      // items expose a font baseline. Normalize only the cross-source case.
      const ownerY =
        glyph.source === 'vector-path'
          ? glyph.y + staffSpace * 0.5
          : glyph.y
      const dy = Math.abs(ownerY - note.cy)
      const gate = Math.max(4, dx * 0.35)
      const compatible = dx >= 3 && dx <= 24 && dy <= gate
      const score = Math.abs(dx) + dy * 0.5
      if (collect) {
        possibleOwners.push({
          noteIndex: index,
          cx: note.cx,
          cy: note.cy,
          midi: note.midi ?? null,
          clef: note.clef ?? null,
          dx,
          dy,
          ownerY,
          gate,
          compatible,
          augmentationScore: compatible ? 1 / (1 + score) : 0,
          rejectionReason: compatible
            ? null
            : dx < 3
              ? 'dxTooSmall'
              : dx > 24
                ? 'dxTooLarge'
                : 'dyFail',
        })
      }
      if (!compatible) {
        continue
      }
      if (score >= bestScore) {
        continue
      }
      bestScore = score
      bestIndex = index
    }

    if (bestIndex == null) {
      if (diagnostics) {
        diagnostics.push({
          glyph: { text: glyph.text, x: glyph.x, y: glyph.y },
          geometry: { x: glyph.x, y: glyph.y },
          possibleOwners,
          augmentationScore: 0,
          articulationScore: competing.articulationScore,
          repeatDotScore: competing.repeatDotScore,
          rejectionReason:
            possibleOwners.find((owner) => owner.rejectionReason)?.rejectionReason ??
            'no-compatible-note',
          finalOwner: null,
        })
      }
      continue
    }
    const glyphKey = `${glyph.text}:${Math.round(glyph.x)}:${Math.round(glyph.y)}`
    if (claimed.has(glyphKey) || assignments.has(bestIndex)) {
      if (diagnostics) {
        diagnostics.push({
          glyph: { text: glyph.text, x: glyph.x, y: glyph.y },
          geometry: { x: glyph.x, y: glyph.y },
          possibleOwners,
          augmentationScore: 1 / (1 + bestScore),
          articulationScore: competing.articulationScore,
          repeatDotScore: competing.repeatDotScore,
          rejectionReason: claimed.has(glyphKey) ? 'glyph-already-claimed' : 'note-already-dotted',
          finalOwner: null,
        })
      }
      continue
    }
    claimed.add(glyphKey)
    assignments.set(bestIndex, true)

    const chordOwners = [bestIndex]
    // Propagate to same-onset chord tones (near-identical X, same staff/clef).
    const anchor = notes[bestIndex]
    const clef = anchor?.clef ?? 'treble'
    for (let index = 0; index < notes.length; index += 1) {
      if (index === bestIndex || assignments.has(index)) {
        continue
      }
      const sibling = notes[index]
      if ((sibling?.clef ?? 'treble') !== clef) {
        continue
      }
      if (Math.abs((sibling?.cx ?? 0) - (anchor?.cx ?? 0)) > 3) {
        continue
      }
      assignments.set(index, true)
      chordOwners.push(index)
    }

    if (diagnostics) {
      diagnostics.push({
        glyph: { text: glyph.text, x: glyph.x, y: glyph.y },
        geometry: { x: glyph.x, y: glyph.y },
        possibleOwners,
        augmentationScore: 1 / (1 + bestScore),
        articulationScore: competing.articulationScore,
        repeatDotScore: competing.repeatDotScore,
        rejectionReason: null,
        finalOwner: {
          noteIndex: bestIndex,
          chordNoteIndexes: chordOwners,
          midi: notes[bestIndex]?.midi ?? null,
          clef: notes[bestIndex]?.clef ?? null,
        },
      })
    }
  }

  if (collect) {
    return { assignments, diagnostics }
  }
  return assignments
}
