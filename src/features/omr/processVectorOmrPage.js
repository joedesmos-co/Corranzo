import {
  measureConfidenceBreakdown,
  measureConfidenceFromRhythm,
  systemConfidenceFromMeasures,
} from './buildOmrDiagnostics.js'
import { restsForMeasure, summarizeVectorRestDiagnostics, insertMixedMeasureRests, buildEmptyMeasureRestEvents } from './detectVectorRests.js'
import { recoverVectorTupletEvents } from './recoverDigitGatedTriplets.js'
import { assignVectorStaccato, assignVectorAugmentationDots, summarizeVectorStaccatoDiagnostics } from './detectVectorStaccato.js'
import { assignVectorAccent, summarizeVectorAccentDiagnostics } from './detectVectorAccent.js'
import {
  assignVectorFermatasToRests,
  assignVectorNotationArticulations,
  summarizeVectorNotationArticulationDiagnostics,
} from './detectVectorNotationArticulations.js'
import { applyVectorPageTies } from './detectVectorTies.js'
import {
  OMR_CHORD_MERGE_X,
  OMR_DIVISIONS_PER_QUARTER,
  OMR_DURATION_DIVISIONS,
} from './omrRhythmConstants.js'
import {
  detectStaffClefsFromGlyphs,
  midiToWrittenPitch,
  resolveNoteheadAnchor,
  resolvePitchFromGrandStaff,
  staffLineGap,
} from './pitchFromStaffPosition.js'
import {
  accidentalStateKey,
  assignLocalAccidentals,
  resolveNotePitchWithMeasureState,
} from './omrPitchAlteration.js'
import { detectVectorPathAccidentals } from './detectVectorPathAccidentals.js'
import { dedupeNoteheads } from './omrNoteDedupe.js'
import {
  adjacentSlotChordShareAllowed,
  beginAdjacentSlotDiagnostics,
  takeAdjacentSlotDiagnostics,
} from './omrAdjacentSlotChordGrouping.js'
import { summarizeMeasureNoteMatching } from './omrNoteMatchingDiagnostics.js'
import { vectorGlyphInMeasure } from './vectorGlyphMeasureBounds.js'
import {
  assignVectorOrphanNoteheads,
  noteheadGlyphKey,
} from './vectorOrphanNoteheads.js'
import { summarizeVectorChordGrouping } from './omrChordGroupingDiagnostics.js'
import { enrichNoteheadRhythm } from './detectNoteRhythmFeatures.js'
import { vectorGlyphAllocationBounds } from './vectorGlyphMeasureBounds.js'
import { summarizeVectorRhythmDiagnostics } from './vectorRhythmDiagnostics.js'
import {
  createMeasureRhythmProvenance,
  beamTypeFromCount,
} from './omrRhythmProvenance.js'
import {
  reconstructMusicalEvents,
  summarizeMusicalEventReconstruction,
} from './reconstructMusicalEvents.js'
import {
  buildBeamStemGraph,
  summarizeBeamStemGraph,
} from './beamStemReconstructionDiagnostics.js'
import {
  applyVectorPrimaryBeamTopology,
  summarizeAppliedVectorBeamTopology,
} from './applyVectorBeamTopology.js'
import { packJointPolyphonicRhythm } from './jointPolyphonicRhythm.js'
import {
  applyNoteheadFallbackCalibration,
  buildNoteheadFallbackCalibrations,
  createNoteheadFallbackCalibrationSample,
} from './noteheadFallbackCalibration.js'
import {
  ACCIDENTAL_PATH_CALIBRATION_LIMITS,
  buildAccidentalPathCalibrations,
  createAccidentalPathCalibrationSample,
} from './accidentalPathCalibration.js'

const HALF_NOTEHEAD_GLYPH = '\ue0a3'
const WHOLE_NOTEHEAD_GLYPH = '\ue0a2'
const BLACK_NOTEHEAD_GLYPH = '\ue0a4'
const NOTEHEAD_GLYPHS = new Set([HALF_NOTEHEAD_GLYPH, WHOLE_NOTEHEAD_GLYPH, BLACK_NOTEHEAD_GLYPH])

function noteheadGlyphKind(text) {
  if (text === WHOLE_NOTEHEAD_GLYPH) {
    return 'whole'
  }
  if (text === HALF_NOTEHEAD_GLYPH) {
    return 'half'
  }
  if (text === BLACK_NOTEHEAD_GLYPH) {
    return 'black'
  }
  return null
}
const SHARP_GLYPH = '\ue262'
const NATURAL_GLYPH = '\ue261'
const FLAT_GLYPH = '\ue260'
const DOUBLE_SHARP_GLYPH = '\ue263'
const DOUBLE_FLAT_GLYPH = '\ue264'
const ACCIDENTAL_GLYPHS = new Map([
  [SHARP_GLYPH, { alter: 1, type: 'sharp' }],
  [NATURAL_GLYPH, { alter: 0, type: 'natural' }],
  [FLAT_GLYPH, { alter: -1, type: 'flat' }],
  [DOUBLE_SHARP_GLYPH, { alter: 2, type: 'double-sharp' }],
  [DOUBLE_FLAT_GLYPH, { alter: -2, type: 'double-flat' }],
])
const TIME_DIGIT_GLYPHS = {
  '\ue083': 3,
  '\ue084': 4,
}
const VECTOR_MIN_NOTEHEADS = 12

function noteheadAnchorCacheKey(glyph, lineYs = []) {
  return [
    glyph?.fontName ?? '',
    glyph?.text ?? '',
    Number(glyph?.x).toFixed(4),
    Number(glyph?.y).toFixed(4),
    lineYs.map((value) => Number(value).toFixed(6)).join(','),
  ].join('|')
}

function rawNoteheadAnchor(
  glyph,
  imageData,
  lineYs,
  inkThreshold,
  calibration,
) {
  const cacheKey = noteheadAnchorCacheKey(glyph, lineYs)
  const cached = calibration?.anchorCache?.get(cacheKey)
  if (cached) {
    return cached
  }
  const anchor = resolveNoteheadAnchor(glyph, imageData, lineYs, {
    inkThreshold,
  })
  calibration?.anchorCache?.set(cacheKey, anchor)
  return anchor
}

export function buildPageNoteheadFallbackCalibration({
  glyphs,
  imageData,
  systems,
  systemMeasureBoxes,
  staffClefsBySystem,
  inkThreshold = 170,
}) {
  const anchorCache = new Map()
  const samples = []
  const sampledGlyphs = new Set()

  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const boxes = systemMeasureBoxes[systemIndex] ?? []
    const referenceBox = boxes[0]
    if (!referenceBox) {
      continue
    }
    const staffClefs = staffClefsBySystem.get(systemIndex)
    const staffLines = referenceBox.staffLines
    for (const glyph of glyphs) {
      if (
        !NOTEHEAD_GLYPHS.has(glyph.text) ||
        sampledGlyphs.has(glyph) ||
        !boxes.some((measureBox, measureIndex) =>
          vectorGlyphInMeasure(glyph, measureBox, imageData, {
            isLastInSystem: measureIndex === boxes.length - 1,
          }),
        )
      ) {
        continue
      }
      sampledGlyphs.add(glyph)
      const roughMapping = resolvePitchFromGrandStaff(
        glyph.y / imageData.height,
        staffLines,
        staffClefs,
      )
      const anchor = rawNoteheadAnchor(
        glyph,
        imageData,
        roughMapping.lineYs,
        inkThreshold,
        { anchorCache },
      )
      const sample = createNoteheadFallbackCalibrationSample({
        glyph,
        anchor,
        imageData,
      })
      if (sample) {
        samples.push(sample)
      }
    }
  }

  const calibration = buildNoteheadFallbackCalibrations(samples)
  return {
    ...calibration,
    anchorCache,
    diagnostics: {
      scope: 'page-font-glyph',
      sampledGlyphCount: sampledGlyphs.size,
      eligibleSampleCount: calibration.eligibleSampleCount,
      accepted: calibration.accepted,
      rejected: calibration.rejected,
    },
  }
}

function average(values) {
  if (!values.length) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function textGlyphsToImage(pageText, imageData) {
  const glyphs = []
  for (const item of pageText ?? []) {
    const text = item.text ?? ''
    if (!text.length || !Number.isFinite(item.pageWidth) || !Number.isFinite(item.pageHeight)) {
      continue
    }
    const scaleX = imageData.width / item.pageWidth
    const scaleY = imageData.height / item.pageHeight
    const charWidth = (item.width ?? 0) / Math.max(1, text.length)
    const originalText = item.originalArticulationText ?? text
    for (let index = 0; index < text.length; index += 1) {
      const textX = item.x + charWidth * (index + 0.5)
      glyphs.push({
        text: text[index],
        originalText: originalText[index] ?? text[index],
        sourceText: text,
        sourceIndex: index,
        sourceLength: text.length,
        x: textX * scaleX,
        y: imageData.height - item.y * scaleY,
        width: charWidth * scaleX,
        height: (item.height ?? 0) * scaleY,
        fontName: item.fontName ?? '',
        originalLegacyText: item.originalLegacyText?.[index] ?? null,
        legacyMusicFontNormalized: Boolean(item.legacyMusicFontNormalized),
      })
    }
  }
  return glyphs
}

export function hasVectorOmrNoteheads(pageText = []) {
  let noteheads = 0
  for (const item of pageText) {
    for (const char of item.text ?? '') {
      if (NOTEHEAD_GLYPHS.has(char)) {
        noteheads += 1
      }
    }
  }
  return noteheads >= VECTOR_MIN_NOTEHEADS
}

function glyphInBox(glyph, box, imageData, { usePlayableStart = true, yPad = 0 } = {}) {
  const xNorm = glyph.x / imageData.width
  const yNorm = glyph.y / imageData.height
  return (
    xNorm >= (usePlayableStart ? (box.playableX0 ?? box.x0) : box.x0) &&
    xNorm <= box.x1 &&
    yNorm >= box.y0 - yPad &&
    yNorm <= box.y1 + yPad
  )
}

function detectVectorKeySignature(glyphs, imageData, firstSystemBoxes = []) {
  const firstBox = firstSystemBoxes[0]
  if (!firstBox) {
    return { fifths: 0, mode: 'major', confidence: 0 }
  }
  let sharps = 0
  let flats = 0
  for (const glyph of glyphs) {
    if (!glyphInBox(glyph, firstBox, imageData, { usePlayableStart: false, yPad: 0.02 })) {
      continue
    }
    const xNorm = glyph.x / imageData.width
    if (xNorm >= (firstBox.playableX0 ?? firstBox.x0)) {
      continue
    }
    if (glyph.text === SHARP_GLYPH) {
      sharps += 1
    } else if (glyph.text === FLAT_GLYPH) {
      flats += 1
    }
  }

  if (sharps >= 2) {
    return {
      fifths: Math.max(1, Math.min(7, Math.round(sharps / 2))),
      mode: 'major',
      confidence: 0.9,
      source: 'vector-glyphs',
    }
  }
  if (flats >= 2) {
    return {
      fifths: -Math.max(1, Math.min(7, Math.round(flats / 2))),
      mode: 'major',
      confidence: 0.9,
      source: 'vector-glyphs',
    }
  }
  return { fifths: 0, mode: 'major', confidence: 0 }
}

function detectVectorTimeSignature(glyphs, imageData, firstSystemBoxes = []) {
  const firstBox = firstSystemBoxes[0]
  if (!firstBox) {
    return { beats: 4, beatType: 4, confidence: 0 }
  }
  const digits = []
  for (const glyph of glyphs) {
    if (!glyphInBox(glyph, firstBox, imageData, { usePlayableStart: false, yPad: 0.02 })) {
      continue
    }
    const xNorm = glyph.x / imageData.width
    if (xNorm >= (firstBox.playableX0 ?? firstBox.x0)) {
      continue
    }
    const digit = TIME_DIGIT_GLYPHS[glyph.text]
    if (digit != null) {
      digits.push(digit)
    }
  }

  if (digits.includes(3) && digits.includes(4)) {
    return { beats: 3, beatType: 4, confidence: 0.92, source: 'vector-glyphs' }
  }
  return { beats: 4, beatType: 4, confidence: 0 }
}

function noteheadsForMeasure(
  glyphs,
  imageData,
  measureBox,
  keySignature,
  placement = {},
  orphanGlyphs = [],
  inkThreshold = 170,
  vectorAccidentalPaths = [],
  vectorAugmentationDotPaths = [],
  noteheadFallbackCalibration = null,
  accidentalPathCalibration = null,
) {
  const notes = []
  const consumed = new Set()

  const addNoteheadGlyph = (glyph, { skipBounds = false } = {}) => {
    if (!NOTEHEAD_GLYPHS.has(glyph.text)) {
      return
    }
    const key = noteheadGlyphKey(glyph)
    if (consumed.has(key)) {
      return
    }
    if (!skipBounds && !vectorGlyphInMeasure(glyph, measureBox, imageData, placement)) {
      return
    }
    consumed.add(key)

    const yRough = glyph.y / imageData.height
    const roughMapping = resolvePitchFromGrandStaff(
      yRough,
      measureBox.staffLines,
      measureBox.staffClefs,
    )
    const uncalibratedAnchor = rawNoteheadAnchor(
      glyph,
      imageData,
      roughMapping.lineYs,
      inkThreshold,
      noteheadFallbackCalibration,
    )
    const noteheadAnchor = applyNoteheadFallbackCalibration({
      anchor: uncalibratedAnchor,
      glyph,
      imageData,
      lineYs: roughMapping.lineYs,
      calibration: noteheadFallbackCalibration,
    })
    const yNorm = noteheadAnchor.yNorm ?? yRough
    const pitchMapping = resolvePitchFromGrandStaff(
      yNorm,
      measureBox.staffLines,
      measureBox.staffClefs,
    )
    const xNorm = glyph.x / imageData.width
    const clef = pitchMapping.clef
    const naturalMidi = pitchMapping.midi
    if (naturalMidi == null) {
      return
    }
    const left = (measureBox.playableX0 ?? measureBox.x0) * imageData.width
    const right = measureBox.x1 * imageData.width
    notes.push({
      naturalMidi,
      clef,
      // The glyph codepoint is authoritative for hollowness (half vs black)
      // on vector pages; ink probing misreads ledger-line noteheads.
      // Whole (U+E0A2) vs half (U+E0A3) are distinct — both hollow, different values.
      noteheadGlyph: noteheadGlyphKind(glyph.text),
      hollowGlyph:
        glyph.text === HALF_NOTEHEAD_GLYPH || glyph.text === WHOLE_NOTEHEAD_GLYPH,
      cx: glyph.x,
      cy: glyph.y,
      xNorm,
      yNorm,
      noteheadAnchor,
      noteheadFont: {
        fontName: glyph.fontName ?? null,
        glyph: glyph.text ?? null,
        originalGlyph: glyph.originalLegacyText ?? glyph.text ?? null,
        legacyNormalized: Boolean(glyph.legacyMusicFontNormalized),
      },
      pitchMapping,
      positionInMeasure: (glyph.x - left) / Math.max(1, right - left),
      measureNumber: measureBox.measureNumber,
      page: measureBox.page,
      confidence: skipBounds ? 0.9 : 0.94,
      pitchConfidence: skipBounds ? 0.88 : 0.92,
      source: skipBounds ? 'vector-glyph-orphan' : 'vector-glyph',
    })
  }

  for (const glyph of glyphs) {
    addNoteheadGlyph(glyph)
  }
  for (const glyph of orphanGlyphs) {
    addNoteheadGlyph(glyph, { skipBounds: true })
  }

  const accidentalState = new Map()
  const sortedNotes = notes.sort((left, right) => left.cx - right.cx || left.cy - right.cy)
  const measureAccidentalGlyphs = glyphs.filter(
    (glyph) =>
      ACCIDENTAL_GLYPHS.has(glyph.text) &&
      glyphInBox(glyph, measureBox, imageData, { usePlayableStart: false, yPad: 0.03 }),
  )
  const pathAccidentalResult = detectVectorPathAccidentals({
    imageData,
    notes: sortedNotes,
    measureBox,
    inkThreshold,
    pathCandidates: vectorAccidentalPaths,
    textAccidentalGlyphs: measureAccidentalGlyphs,
    accidentalGlyphs: ACCIDENTAL_GLYPHS,
  })
  const localAccidentals = assignLocalAccidentals(
    [...measureAccidentalGlyphs, ...pathAccidentalResult.glyphs],
    imageData,
    measureBox,
    sortedNotes,
    ACCIDENTAL_GLYPHS,
    { accidentalPathCalibration },
  )
  localAccidentals.diagnostics = {
    ...(localAccidentals.diagnostics ?? {}),
    pathInk: pathAccidentalResult.diagnostics,
  }
  const staccatoResult = assignVectorStaccato(glyphs, sortedNotes, measureBox, imageData)
  const accentResult = assignVectorAccent(glyphs, sortedNotes, measureBox, imageData)
  const notationArticulationResult = assignVectorNotationArticulations(
    glyphs,
    sortedNotes,
    measureBox,
    imageData,
  )
  const augmentationDotResult = assignVectorAugmentationDots(
    [...glyphs, ...vectorAugmentationDotPaths],
    sortedNotes,
    measureBox,
    imageData,
  )
  const augmentationDots =
    augmentationDotResult instanceof Map
      ? augmentationDotResult
      : augmentationDotResult.assignments
  const augmentationDotDiagnostics =
    augmentationDotResult instanceof Map
      ? null
      : augmentationDotResult.diagnostics
  const allocationBounds = vectorGlyphAllocationBounds(measureBox, placement)
  const rhythmBounds = {
    left: allocationBounds.x0 * imageData.width,
    right: allocationBounds.x1 * imageData.width,
    top: allocationBounds.y0 * imageData.height,
    bottom: allocationBounds.y1 * imageData.height,
  }
  const mappedNotes = sortedNotes.map((note, index) => {
      const localAccidental = localAccidentals.get(index) ?? null
      const stateKey = accidentalStateKey(note)
      const carriedAlter = accidentalState.has(stateKey)
        ? accidentalState.get(stateKey)
        : null
      const resolved = resolveNotePitchWithMeasureState({
        naturalMidi: note.naturalMidi,
        keySignature,
        localAccidental,
        carriedAlter,
      })
      if (resolved.measureAccidentalState != null) {
        accidentalState.set(stateKey, resolved.measureAccidentalState)
      }

      const staccatoArticulation =
        staccatoResult.assignments.get(index) ?? null
      const accentArticulation =
        accentResult.assignments.get(index) ?? null
      const notationArticulations = [
        staccatoArticulation,
        accentArticulation,
        ...(notationArticulationResult.assignments.get(index) ?? []),
      ].filter(Boolean)
      const withPitch = {
        ...note,
        midi: resolved.midi,
        alter: resolved.alter,
        pitchAlteration: resolved.pitchAlteration,
        accidental: localAccidental
          ? {
              type: localAccidental.type,
              alter: localAccidental.alter,
              confidence: localAccidental.confidence,
              courtesy:
                carriedAlter != null &&
                carriedAlter === resolved.measureAccidentalState,
            }
          : null,
        articulation: staccatoArticulation,
        accentArticulation,
        notationArticulations,
      }
      const enriched = imageData?.data?.length
        ? enrichNoteheadRhythm(imageData, withPitch, measureBox, inkThreshold, rhythmBounds)
        : withPitch
      // Vector augmentation dots are authoritative; ink detectDot false-triggers.
      const dotted = augmentationDots.has(index)
      const baseType = enriched.durationType ?? 'quarter'
      const baseDivisions =
        OMR_DURATION_DIVISIONS[baseType] ?? OMR_DIVISIONS_PER_QUARTER
      return {
        ...enriched,
        dotted,
        durationDivisions: dotted ? Math.round(baseDivisions * 1.5) : baseDivisions,
      }
    })
  return {
    notes: mappedNotes,
    vectorAccidentalDiagnostics: localAccidentals.diagnostics ?? {
      detectedCandidates: [],
      selectedAttachments: [],
      rejectedGlyphCount: 0,
    },
    vectorStaccatoDiagnostics: {
      detectedStaccatoCount: staccatoResult.detectedStaccatoCount,
      appliedStaccatoCount: staccatoResult.appliedStaccatoCount,
      detectedCandidates: staccatoResult.detectedCandidates,
      selectedAttachments: staccatoResult.selectedAttachments,
      rejectedCandidates: staccatoResult.rejectedCandidates,
    },
    vectorAccentDiagnostics: {
      detectedAccentCount: accentResult.detectedAccentCount,
      appliedAccentCount: accentResult.appliedAccentCount,
      detectedCandidates: accentResult.detectedCandidates,
      selectedAttachments: accentResult.selectedAttachments,
      rejectedCandidates: accentResult.rejectedCandidates,
    },
    vectorNotationArticulationDiagnostics: {
      detectedByType: notationArticulationResult.detectedByType,
      appliedByType: notationArticulationResult.appliedByType,
      detectedCandidates: notationArticulationResult.detectedCandidates,
      selectedAttachments: notationArticulationResult.selectedAttachments,
      rejectedCandidates: notationArticulationResult.rejectedCandidates,
    },
    augmentationDotDiagnostics,
  }
}

function beatSlotForPosition(positionInMeasure, slotsPerMeasure) {
  if (!Number.isFinite(positionInMeasure)) {
    return null
  }
  return Math.round(positionInMeasure * slotsPerMeasure)
}

function groupAnchorPosition(group) {
  const positions = (group.notes ?? [])
    .map((note) => note.positionInMeasure)
    .filter(Number.isFinite)
  if (!positions.length) {
    return group.positionInMeasure
  }
  return Math.min(...positions)
}

function sortedGroupPositions(groups) {
  return groups
    .map((group) => groupAnchorPosition(group))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
}

/**
 * Use horizontal positions for rhythm when group count alone would force quarter
 * indexing but noteheads sit closer than quarter spacing (eighth/sixteenth grids)
 * or when sparse group counts still land off the sequential quarter grid.
 */
export function shouldInferRhythmFromPositions(groups, beats) {
  if (!groups.length) {
    return false
  }
  if (groups.length > beats) {
    return true
  }
  if (
    groups.some((group) =>
      (group.notes ?? []).some((note) => note.dotted === true),
    )
  ) {
    return true
  }
  const positions = sortedGroupPositions(groups)
  if (positions.length !== groups.length || positions.length < 2) {
    return false
  }
  const quarterSpacing = 1 / Math.max(1, beats)
  let minGap = Infinity
  for (let index = 1; index < positions.length; index += 1) {
    minGap = Math.min(minGap, positions[index] - positions[index - 1])
  }
  if (Number.isFinite(minGap) && minGap < quarterSpacing * 0.55) {
    return true
  }
  let maxGap = 0
  for (let index = 1; index < positions.length; index += 1) {
    maxGap = Math.max(maxGap, positions[index] - positions[index - 1])
  }
  // Sparse half+quarter (and similar) ties sit far apart on the X axis but still
  // beat the sequential quarter index (0,4) when only two groups are present.
  if (
    groups.length <= Math.max(1, beats - 2) &&
    maxGap >= quarterSpacing * 1.5
  ) {
    return true
  }
  return false
}

function vectorChordMergeXPx(notes, beats) {
  if (!notes?.length) {
    return OMR_CHORD_MERGE_X
  }
  const cxValues = notes.map((note) => note.cx).filter(Number.isFinite)
  if (!cxValues.length) {
    return OMR_CHORD_MERGE_X
  }
  const span = Math.max(...cxValues) - Math.min(...cxValues)
  if (span <= 0) {
    return OMR_CHORD_MERGE_X
  }
  const slotsPerMeasure = Math.max(4, beats * 4)
  const slotWidthPx = span / slotsPerMeasure
  const baseMergeX = Math.max(OMR_CHORD_MERGE_X, Math.min(28, slotWidthPx * 2.2))
  // Dense monophonic runs (sixteenths) produce many ~slot-width neighbors.
  // Cap merge width below the typical inter-onset gap so sequential attacks are
  // not glued into false dyads, while near-coincident chord stacks still merge.
  const sortedCx = [...cxValues].sort((left, right) => left - right)
  const positiveGaps = []
  for (let index = 1; index < sortedCx.length; index += 1) {
    const gap = sortedCx[index] - sortedCx[index - 1]
    if (gap > 0.75) {
      positiveGaps.push(gap)
    }
  }
  if (positiveGaps.length >= 4) {
    const medianGap = medianNumber(positiveGaps)
    if (Number.isFinite(medianGap) && medianGap > 0) {
      const calibrated = Math.max(OMR_CHORD_MERGE_X * 0.35, medianGap * 0.45)
      return Math.min(baseMergeX, calibrated)
    }
  }
  return baseMergeX
}

function groupsShareBeatSlot(left, right, slotsPerMeasure, chordMergeX = OMR_CHORD_MERGE_X) {
  const leftNotes = left.notes ?? (Number.isFinite(left.cx) ? [{ cx: left.cx }] : [])
  const rightNotes = right.notes ?? (Number.isFinite(right.cx) ? [{ cx: right.cx }] : [])
  if (slotsPerMeasure) {
    const leftPosition = leftNotes[0]?.positionInMeasure ?? left.positionInMeasure
    const rightPosition = rightNotes[0]?.positionInMeasure ?? right.positionInMeasure
    if (Number.isFinite(leftPosition) && Number.isFinite(rightPosition)) {
      const leftSlot = beatSlotForPosition(leftPosition, slotsPerMeasure)
      const rightSlot = beatSlotForPosition(rightPosition, slotsPerMeasure)
      if (leftSlot !== rightSlot) {
        // Conservative adjacent-slot exception for stacked chord tones only.
        if (
          leftSlot != null &&
          rightSlot != null &&
          Math.abs(leftSlot - rightSlot) === 1 &&
          adjacentSlotChordShareAllowed(leftNotes, rightNotes, { chordMergeX })
        ) {
          // Fall through to horizontal proximity check below.
        } else {
          return false
        }
      }
    }
  }
  for (const leftNote of leftNotes) {
    for (const rightNote of rightNotes) {
      if (Math.abs(leftNote.cx - rightNote.cx) <= chordMergeX) {
        return true
      }
    }
  }
  return false
}

function clusterHorizontalSpan(clusterGroups) {
  const cxValues = clusterGroups
    .flatMap((group) => (group.notes ?? []).map((note) => note.cx))
    .filter(Number.isFinite)
  if (!cxValues.length) {
    return 0
  }
  return Math.max(...cxValues) - Math.min(...cxValues)
}

function clusterPositionSpan(clusterGroups) {
  const positions = clusterGroups
    .flatMap((group) => (group.notes ?? []).map((note) => note.positionInMeasure))
    .filter(Number.isFinite)
  if (positions.length < 2) {
    return 0
  }
  return Math.max(...positions) - Math.min(...positions)
}

function chordSameSlotMaxSpan(chordMergeX) {
  return Math.min(38, chordMergeX * 4)
}

function clusterMaxAdjacentGap(clusterGroups) {
  const cxValues = clusterGroups
    .flatMap((group) => (group.notes ?? []).map((note) => note.cx))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (cxValues.length < 2) {
    return 0
  }
  let maxGap = 0
  for (let index = 1; index < cxValues.length; index += 1) {
    maxGap = Math.max(maxGap, cxValues[index] - cxValues[index - 1])
  }
  return maxGap
}

function shouldSpanMergeSameSlotCluster(clusterGroups, chordMergeX) {
  if (clusterGroups.length < 3) {
    return false
  }
  const span = clusterHorizontalSpan(clusterGroups)
  if (span > chordSameSlotMaxSpan(chordMergeX)) {
    return false
  }
  if (clusterMaxAdjacentGap(clusterGroups) > chordMergeX + 3) {
    return false
  }
  const positionSpan = clusterPositionSpan(clusterGroups)
  if (clusterGroups.length >= 4) {
    return positionSpan <= 0.035
  }
  return positionSpan <= 0.015
}

function mergeClusterGroups(clusterGroups, chordMergeX, slotsPerMeasure) {
  if (clusterGroups.length === 1) {
    return clusterGroups
  }
  if (shouldSpanMergeSameSlotCluster(clusterGroups, chordMergeX)) {
    const notes = dedupeNoteheads(
      clusterGroups
        .flatMap((entry) => entry.notes ?? [])
        .sort((left, right) => right.midi - left.midi),
    )
    return [
      {
        cx: average(notes.map((note) => note.cx)),
        notes,
        positionInMeasure: groupAnchorPosition({ notes }),
      },
    ]
  }
  return mergeGroupsByChordProximity(clusterGroups, chordMergeX, slotsPerMeasure)
}

function mergeGroupsByChordProximity(groups, chordMergeX, slotsPerMeasure = null) {
  let merged = groups.map((group) => ({ ...group, notes: [...(group.notes ?? [])] }))
  let changed = true
  while (changed) {
    changed = false
    for (let index = 0; index < merged.length; index += 1) {
      for (let other = index + 1; other < merged.length; other += 1) {
        if (!groupsShareBeatSlot(merged[index], merged[other], slotsPerMeasure, chordMergeX)) {
          continue
        }
        const notes = dedupeNoteheads([...merged[index].notes, ...merged[other].notes]).sort(
          (left, right) => right.midi - left.midi,
        )
        merged[index] = {
          cx: average(notes.map((note) => note.cx)),
          notes,
        }
        merged.splice(other, 1)
        changed = true
        break
      }
      if (changed) {
        break
      }
    }
  }
  return merged.sort((left, right) => left.cx - right.cx)
}

function groupVectorNoteheads(notes, { beats = 4 } = {}) {
  beginAdjacentSlotDiagnostics()
  const slotsPerMeasure = Math.max(4, beats * 4)
  const chordMergeX = vectorChordMergeXPx(notes, beats)
  const groups = []
  for (const note of notes) {
    let group = groups.find((entry) =>
      groupsShareBeatSlot(entry, { cx: note.cx, notes: [note] }, slotsPerMeasure, chordMergeX),
    )
    if (!group) {
      group = { cx: note.cx, notes: [] }
      groups.push(group)
    }
    group.notes.push(note)
    group.cx = average(group.notes.map((entry) => entry.cx))
  }
  return groups
    .map((group) => ({
      ...group,
      notes: dedupeNoteheads(group.notes).sort((left, right) => right.midi - left.midi),
    }))
    .sort((left, right) => left.cx - right.cx)
}

function sortVectorRhythmEvents(events) {
  return [...events].sort(
    (left, right) =>
      left.startDivision - right.startDivision ||
      (left.notes?.[0]?.clef === 'bass' ? -1 : 1) -
        (right.notes?.[0]?.clef === 'bass' ? -1 : 1),
  )
}

function writtenStep(midi) {
  return midiToWrittenPitch(midi).step
}

function noteSustainsIntoLaterHarmony(note, laterEvents, fromStart) {
  const step = writtenStep(note.midi)
  for (const event of laterEvents) {
    if (event.type !== 'note') {
      continue
    }
    if ((event.startDivision ?? 0) <= fromStart) {
      continue
    }
    if ((event.notes ?? []).some((entry) => writtenStep(entry.midi) === step)) {
      return true
    }
  }
  return false
}

function notesAtNextOnset(laterEvents, fromStart) {
  const nextOnset = laterEvents
    .filter((event) => event.type === 'note' && (event.startDivision ?? 0) > fromStart)
    .reduce((min, event) => Math.min(min, event.startDivision ?? 0), Infinity)
  if (!Number.isFinite(nextOnset)) {
    return []
  }
  return laterEvents
    .filter((event) => event.type === 'note' && event.startDivision === nextOnset)
    .flatMap((event) => event.notes ?? [])
}

function hasPenultimateClosingFigure(events) {
  if (events.length < 3) {
    return false
  }
  const last = events[events.length - 1]
  if (last.type !== 'note' || (last.notes?.length ?? 0) !== 1) {
    return false
  }
  const lastStart = last.startDivision ?? 0
  const sharedBeat = lastStart - OMR_DIVISIONS_PER_QUARTER
  if (sharedBeat < 0) {
    return false
  }
  const sharedEvents = events.filter(
    (event) => event.type === 'note' && event.startDivision === sharedBeat,
  )
  return sharedEvents.length > 1 || (sharedEvents[0]?.notes?.length ?? 0) > 1
}

function closesOnFinalBeat(events, totalDivisions) {
  const last = events[events.length - 1]
  if (last?.type !== 'note') {
    return false
  }
  const lastStart = last.startDivision ?? 0
  return lastStart + OMR_DIVISIONS_PER_QUARTER >= totalDivisions
}

function sameClefRearticulatesDifferentPitchBeforeClosing(events, openingNote, totalDivisions) {
  const clef = openingNote.clef ?? 'treble'
  const openingStep = writtenStep(openingNote.midi)
  const last = events[events.length - 1]
  const closingStart = last?.startDivision ?? totalDivisions
  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    const start = event.startDivision ?? 0
    if (start <= 0 || start >= closingStart) {
      continue
    }
    for (const note of event.notes ?? []) {
      if ((note.clef ?? clef) !== clef) {
        continue
      }
      if (writtenStep(note.midi) !== openingStep) {
        return true
      }
    }
  }
  return false
}

function sameStartTrebleDuration(trebleNote, bassNote, events, extended, totalDivisions) {
  if (hasPenultimateClosingFigure(events)) {
    const closingNote = events[events.length - 1]?.notes?.[0]
    if (
      closesOnFinalBeat(events, totalDivisions) &&
      closingNote &&
      writtenStep(closingNote.midi) === writtenStep(trebleNote.midi) &&
      !sameClefRearticulatesDifferentPitchBeforeClosing(events, trebleNote, totalDivisions)
    ) {
      return OMR_DURATION_DIVISIONS.half
    }
    return OMR_DIVISIONS_PER_QUARTER
  }
  if (writtenStep(trebleNote.midi) === writtenStep(bassNote.midi)) {
    return extended
  }
  const laterEvents = events.slice(2)
  if (noteSustainsIntoLaterHarmony(trebleNote, laterEvents, 0)) {
    return extended
  }
  const innerNotes = notesAtNextOnset(laterEvents, 0)
  if (innerNotes.length) {
    return extended
  }
  return OMR_DIVISIONS_PER_QUARTER
}

function followsWithUpperStaffContent(followerNotes, bassNote) {
  if (!followerNotes?.length || !bassNote) {
    return false
  }
  if (followerNotes.some((note) => note.clef === 'treble')) {
    return true
  }
  const bassMidi = bassNote.midi ?? 0
  return followerNotes.some((note) => note.midi >= bassMidi + 12)
}

function isAuxiliaryUpperVoice(note, peers) {
  if (note.clef === 'bass') {
    return false
  }
  const maxMidi = Math.max(...peers.map((peer) => peer.midi))
  const corePeers = peers.filter((peer) => peer.midi <= maxMidi - 5)
  if (corePeers.length >= 2) {
    const coreMax = Math.max(...corePeers.map((peer) => peer.midi))
    return note.midi >= coreMax + 4
  }
  const others = peers.filter((peer) => peer.midi !== note.midi)
  if (!others.length) {
    return false
  }
  const highestPeer = Math.max(...others.map((peer) => peer.midi))
  return note.midi >= highestPeer + 7
}

/**
 * Merge notehead groups that sit on the same beat slot so chord tones do not
 * inflate the group count and force proportional spacing.
 */
function mergeGroupsSharingBeat(groups, beats) {
  if (!groups.length || !groups.every((group) => Number.isFinite(group.notes[0]?.positionInMeasure))) {
    return groups
  }
  const slotsPerMeasure = Math.max(4, beats * 4)
  const chordMergeX = vectorChordMergeXPx(
    groups.flatMap((group) => group.notes ?? []),
    beats,
  )
  const sorted = [...groups].sort((left, right) => left.cx - right.cx)
  const clusters = []
  for (const group of sorted) {
    const slot = beatSlotForPosition(group.notes[0].positionInMeasure, slotsPerMeasure)
    const cluster =
      slot == null
        ? null
        : clusters.find((entry) => entry.slot === slot)
    if (!cluster) {
      clusters.push({ slot, groups: [group] })
      continue
    }
    cluster.groups.push(group)
  }
  return clusters.flatMap((cluster) => mergeClusterGroups(cluster.groups, chordMergeX, slotsPerMeasure))
}

/**
 * Grand-staff groups can contain both staves at one horizontal slot. Split them
 * into separate rhythm events at the same start so overlap rules can apply.
 */
export function splitMixedClefEvents(events) {
  const expanded = []
  for (const event of events) {
    if (event.type !== 'note') {
      expanded.push(event)
      continue
    }
    const bassNotes = (event.notes ?? []).filter((note) => note.clef === 'bass')
    const trebleNotes = (event.notes ?? []).filter((note) => note.clef === 'treble')
    if (bassNotes.length && trebleNotes.length) {
      expanded.push({ ...event, notes: bassNotes })
      expanded.push({ ...event, notes: trebleNotes })
      continue
    }
    expanded.push(event)
  }
  return sortVectorRhythmEvents(expanded)
}

function noteClefFromNotes(notes) {
  return notes?.[0]?.clef ?? 'treble'
}

function hasQuarterStemInk(notes) {
  return (notes ?? []).some(
    (note) =>
      note.durationDivisions === OMR_DIVISIONS_PER_QUARTER &&
      (note.confidence ?? 0) >= 0.78 &&
      note.stem &&
      !note.hollow &&
      (note.beams ?? 0) === 0 &&
      (note.beamStrength ?? 0) < 8,
  )
}

export function hasConfidentQuarterInference(notes, globalDuration = OMR_DIVISIONS_PER_QUARTER) {
  void globalDuration
  // Trust stem+enrich evidence even when gap packing already collapsed the
  // event duration to an eighth. The old globalDuration≤eighth gate blocked
  // recovering written quarters (common 1→0.5 / inventory duration errors).
  return hasQuarterStemInk(notes)
}

export function isDenseSubdivisionRun(globalDuration, sameClefSpan) {
  return (
    globalDuration <= OMR_DURATION_DIVISIONS.eighth + 1 &&
    sameClefSpan <= OMR_DURATION_DIVISIONS.eighth + 1
  )
}

export function hasBeamEvidenceForNotes(notes) {
  return (notes ?? []).some(
    (note) => (note.beams ?? 0) >= 1 || (note.beamStrength ?? 0) >= 8,
  )
}

function inferredBeamDurationCap(notes) {
  // Cap only on explicit beam counts. Tip-row strength alone is too noisy on
  // quarters near staff lines and was shortening true quarters to eighths.
  if (!(notes ?? []).some((note) => (note.beams ?? 0) >= 1)) {
    return null
  }
  let cap = OMR_DIVISIONS_PER_QUARTER
  for (const note of notes ?? []) {
    if ((note.beams ?? 0) >= 2) {
      cap = Math.min(cap, OMR_DURATION_DIVISIONS.sixteenth)
    } else if ((note.beams ?? 0) >= 1) {
      cap = Math.min(cap, OMR_DURATION_DIVISIONS.eighth)
    }
  }
  return cap
}

/**
 * Minimum duration implied by beam evidence. Gap-primary packing often invents
 * sixteenth gaps between position-snapped starts; a primary beam means the note
 * cannot be shorter than an eighth unless a secondary beam is present.
 */
export function inferredBeamDurationFloor(notes) {
  // Require an explicit beam count from countBeams — not tip-row strength alone.
  // Strength-only false positives on quarters caused Sprint 2 Q→eighth regressions
  // when combined with the duration cap.
  if (!(notes ?? []).some((note) => (note.beams ?? 0) >= 1)) {
    return null
  }
  let floor = OMR_DURATION_DIVISIONS.eighth
  for (const note of notes ?? []) {
    if ((note.beams ?? 0) >= 2) {
      floor = Math.min(floor, OMR_DURATION_DIVISIONS.sixteenth)
    }
  }
  return floor
}

function countSameClefEventsInSpan(clefEvents, startIndex, spanDivisions) {
  const start = clefEvents[startIndex]?.startDivision ?? 0
  let count = 0
  for (let index = startIndex; index < clefEvents.length; index += 1) {
    const eventStart = clefEvents[index].startDivision ?? 0
    if (eventStart >= start + spanDivisions) {
      break
    }
    count += 1
  }
  return count
}

function sameClefSubdivisionRun(clefEvents, index) {
  const quarterSpan = OMR_DIVISIONS_PER_QUARTER
  if (countSameClefEventsInSpan(clefEvents, index, quarterSpan) >= 3) {
    return true
  }
  // Ordinary eighth runs place only two attacks per quarter. A half-note window
  // with four attacks (or a measure-wide ≤eighth chain) is still a subdivision
  // pack — do not promote pairs to overlapping quarters.
  if (countSameClefEventsInSpan(clefEvents, index, quarterSpan * 2) >= 4) {
    return true
  }
  if (clefEvents.length >= 6) {
    const gaps = []
    for (let cursor = 1; cursor < clefEvents.length; cursor += 1) {
      gaps.push(
        (clefEvents[cursor].startDivision ?? 0) - (clefEvents[cursor - 1].startDivision ?? 0),
      )
    }
    const eighthGap = OMR_DURATION_DIVISIONS.eighth + 1
    const mostlyEighth =
      gaps.filter((gap) => gap > 0 && gap <= eighthGap).length >= Math.ceil(gaps.length * 0.75)
    if (mostlyEighth) {
      return true
    }
  }
  const start = clefEvents[index]?.startDivision ?? 0
  const prev = index > 0 ? clefEvents[index - 1] : null
  const next = index + 1 < clefEvents.length ? clefEvents[index + 1] : null
  const eighthGap = OMR_DURATION_DIVISIONS.eighth + 1
  if (prev && start - (prev.startDivision ?? 0) <= eighthGap && hasBeamEvidenceForNotes(prev.notes)) {
    return true
  }
  if (next && (next.startDivision ?? 0) - start <= eighthGap && hasBeamEvidenceForNotes(next.notes)) {
    return true
  }
  return false
}

export function eventPitchMultiset(notes) {
  return new Set((notes ?? []).map((note) => note.midi).filter(Number.isFinite))
}

export function eventsShareHarmonicPitch(leftEvent, rightEvent) {
  const left = eventPitchMultiset(leftEvent?.notes)
  const right = eventPitchMultiset(rightEvent?.notes)
  if (!left.size || !right.size) {
    return false
  }
  for (const midi of left) {
    if (right.has(midi)) {
      return true
    }
  }
  return false
}

function hasLongToneEvidence(notes = []) {
  return notes.some(
    (note) =>
      note.hollow === true ||
      (note.durationDivisions ?? 0) >= OMR_DURATION_DIVISIONS.half,
  )
}

function hasDottedEvidence(notes = []) {
  return notes.some((note) => note.dotted === true)
}

function followsDottedSubdivisionTail(clefEvents, index) {
  if (index <= 0) {
    return false
  }
  const previous = clefEvents[index - 1]
  const current = clefEvents[index]
  if (!hasDottedEvidence(previous?.notes) && !previous?.dotted) {
    return false
  }
  const previousStart = previous.startDivision ?? 0
  const previousDuration =
    dottedWrittenDurationDivisions(previous.notes) ??
    previous.durationDivisions ??
    OMR_DIVISIONS_PER_QUARTER
  const currentStart = current.startDivision ?? 0
  return currentStart === previousStart + previousDuration
}

function hasStemEvidence(notes = []) {
  return notes.some((note) => note.stem)
}

function hasOnlyQuarterDurationEvidence(notes = []) {
  return (
    notes.length > 0 &&
    notes.every(
      (note) =>
        (note.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER) ===
        OMR_DIVISIONS_PER_QUARTER,
    )
  )
}

/**
 * A same-staff onset missed inside a dense upper chord can stretch a plain
 * quarter-looking chord to five sixteenth divisions. That span has no supported
 * note value in the emitted MusicXML, so keep the conservative quarter value
 * unless ink evidence shows a longer/dotted note.
 */
export function unsupportedUpperChordOverhangCap(clefEvents, index, sameClefSpan) {
  const event = clefEvents[index]
  const notes = event?.notes ?? []
  const duration = event?.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
  const unsupportedOverhang = OMR_DIVISIONS_PER_QUARTER + 1
  if (
    noteClefFromNotes(notes) === 'bass' ||
    notes.length < 3 ||
    (duration !== OMR_DIVISIONS_PER_QUARTER && duration !== unsupportedOverhang) ||
    sameClefSpan !== unsupportedOverhang ||
    !hasOnlyQuarterDurationEvidence(notes) ||
    hasLongToneEvidence(notes) ||
    hasDottedEvidence(notes) ||
    hasBeamEvidenceForNotes(notes) ||
    sameClefSubdivisionRun(clefEvents, index)
  ) {
    return null
  }
  return OMR_DIVISIONS_PER_QUARTER
}

/**
 * Dense piano reductions can hold an opening lower-staff chord while a same-clef
 * inner voice enters one beat later. This is not a subdivision run: the opening
 * event is a multi-note bass chord with long-tone glyph evidence and no beams.
 */
export function openingBassChordSustainSpan(clefEvents, index, totalDivisions) {
  const anchor = clefEvents[index]
  const next = clefEvents[index + 1]
  const following = clefEvents[index + 2]
  const start = anchor?.startDivision ?? 0
  const duration = anchor?.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
  const half = OMR_DURATION_DIVISIONS.half
  const quarter = OMR_DIVISIONS_PER_QUARTER
  const notes = anchor?.notes ?? []

  if (
    start !== 0 ||
    duration !== quarter ||
    totalDivisions < half ||
    noteClefFromNotes(notes) !== 'bass' ||
    notes.length < 3 ||
    !hasLongToneEvidence(notes) ||
    hasBeamEvidenceForNotes(notes) ||
    sameClefSubdivisionRun(clefEvents, index) ||
    !next ||
    (next.startDivision ?? 0) !== quarter ||
    (next.notes?.length ?? 0) !== 1 ||
    hasBeamEvidenceForNotes(next.notes)
  ) {
    return null
  }

  if (following && (following.startDivision ?? 0) < half) {
    return null
  }

  return Math.min(half, totalDivisions - start)
}

/**
 * A plain lower-staff opening note can be stretched across a dense subdivision
 * run when no stem/beam was recovered. If the same bass voice re-enters inside
 * the first beat, keep the opening event at an eighth unless ink supports a
 * long tone.
 */
export function openingBassSubdivisionCap(clefEvents, index, totalDivisions) {
  const anchor = clefEvents[index]
  const next = clefEvents[index + 1]
  const following = clefEvents[index + 2]
  const start = anchor?.startDivision ?? 0
  const duration = anchor?.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
  const notes = anchor?.notes ?? []
  const eighth = OMR_DURATION_DIVISIONS.eighth
  const firstBeat = OMR_DIVISIONS_PER_QUARTER
  const nextGap = next ? (next.startDivision ?? 0) - start : null
  const followingGap = following ? (following.startDivision ?? 0) - start : null

  if (
    start !== 0 ||
    noteClefFromNotes(notes) !== 'bass' ||
    notes.length !== 1 ||
    duration < OMR_DURATION_DIVISIONS.half ||
    nextGap == null ||
    nextGap < eighth + 1 ||
    nextGap > firstBeat ||
    followingGap == null ||
    followingGap > firstBeat + eighth ||
    !hasOnlyQuarterDurationEvidence(notes) ||
    hasLongToneEvidence(notes) ||
    hasDottedEvidence(notes) ||
    hasStemEvidence(notes) ||
    hasBeamEvidenceForNotes(notes) ||
    (next.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER) > eighth
  ) {
    return null
  }

  return Math.min(eighth, Math.max(1, totalDivisions - start))
}

/**
 * Half notes on dense grand-staff scores often leave one or two same-pitch chord
 * fragments on the sixteenth grid before the next true same-clef attack a half
 * beat away. Extend only when every intermediate onset shares pitch with the
 * opening harmonic attack (not a beamed subdivision run).
 */
export function sparseHarmonicHalfSpan(clefEvents, index, totalDivisions) {
  const anchor = clefEvents[index]
  const start = anchor?.startDivision ?? 0
  const duration = anchor?.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
  const half = OMR_DURATION_DIVISIONS.half
  const sixteenthGridGap = OMR_DURATION_DIVISIONS.eighth + 1
  if (duration !== sixteenthGridGap || duration >= half || start < half) {
    return null
  }
  if (hasBeamEvidenceForNotes(anchor?.notes) || sameClefSubdivisionRun(clefEvents, index)) {
    return null
  }
  if (index + 1 >= clefEvents.length) {
    return null
  }
  const immediateSpan = (clefEvents[index + 1].startDivision ?? 0) - start
  if (immediateSpan > sixteenthGridGap) {
    return null
  }

  let fragmentCount = 0
  for (let look = index + 1; look < clefEvents.length; look += 1) {
    const ahead = clefEvents[look]
    const aheadStart = ahead?.startDivision ?? 0
    const span = aheadStart - start
    if (span > half + sixteenthGridGap) {
      break
    }
    if (span >= half - 1) {
      if (
        fragmentCount >= 1 &&
        fragmentCount <= 3 &&
        countSameClefEventsInSpan(clefEvents, index, span) <= fragmentCount + 2 &&
        !hasBeamEvidenceForNotes(ahead?.notes)
      ) {
        return Math.min(half, span, totalDivisions - start)
      }
      break
    }
    if (span <= sixteenthGridGap) {
      if (hasBeamEvidenceForNotes(ahead?.notes)) {
        return null
      }
      if (!eventsShareHarmonicPitch(anchor, ahead)) {
        break
      }
      fragmentCount += 1
      if (fragmentCount > 3) {
        return null
      }
      continue
    }
    break
  }
  return null
}

/**
 * When a clef voice has no later attack in the measure, a sixteenth-grid gap at
 * beat 2+ often means a half note should sustain through the bar remainder.
 */
function sameClefChordEventCount(clefEvents, index) {
  const start = clefEvents[index]?.startDivision ?? 0
  let count = 0
  for (let look = index; look < clefEvents.length; look += 1) {
    if ((clefEvents[look]?.startDivision ?? 0) !== start) {
      break
    }
    count += 1
  }
  return count
}

function isSameOnsetClefCluster(clefEvents, index) {
  const start = clefEvents[index]?.startDivision ?? 0
  const count = sameClefChordEventCount(clefEvents, index)
  if (count < 2) {
    return false
  }
  return clefEvents[index + count - 1]?.startDivision === start
}

function nextDistinctSameClefStart(clefEvents, index, totalDivisions) {
  const start = clefEvents[index]?.startDivision ?? 0
  for (let look = index + 1; look < clefEvents.length; look += 1) {
    const nextStart = clefEvents[look]?.startDivision ?? totalDivisions
    if (nextStart > start) {
      return nextStart
    }
  }
  return totalDivisions
}

/**
 * When a same-clef voice lands on the beat grid as an eighth but the next
 * distinct same-clef attack is exactly one quarter away, sustain through that
 * beat for same-onset harmonic chords. Bass inner voices that re-enter on the
 * offbeat keep their shorter span.
 */
export function sameClefBeatQuarterFloor(clefEvents, index, totalDivisions, currentDuration) {
  const anchor = clefEvents[index]
  const start = anchor?.startDivision ?? 0
  const duration = currentDuration ?? anchor?.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
  const quarter = OMR_DIVISIONS_PER_QUARTER
  const notes = anchor?.notes ?? []
  const nextStart = nextDistinctSameClefStart(clefEvents, index, totalDivisions)
  const sameClefSpan = nextStart - start

  if (
    duration !== OMR_DURATION_DIVISIONS.eighth ||
    sameClefSpan !== quarter ||
    start % quarter !== 0 ||
    nextStart % quarter !== 0 ||
    hasBeamEvidenceForNotes(notes) ||
    (sameClefSubdivisionRun(clefEvents, index) &&
      !isSameOnsetClefCluster(clefEvents, index))
  ) {
    return null
  }
  if (notes.length < 2 && sameClefChordEventCount(clefEvents, index) < 2) {
    return null
  }

  return Math.min(quarter, totalDivisions - start)
}

export function terminalHarmonicHalfSpan(clefEvents, index, totalDivisions) {
  const anchor = clefEvents[index]
  const start = anchor?.startDivision ?? 0
  const duration = anchor?.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
  const half = OMR_DURATION_DIVISIONS.half
  const sixteenthGridGap = OMR_DURATION_DIVISIONS.eighth + 1
  const remaining = totalDivisions - start
  if (
    index + 1 < clefEvents.length ||
    duration !== sixteenthGridGap ||
    remaining < half - 1 ||
    start < half ||
    hasBeamEvidenceForNotes(anchor?.notes) ||
    sameClefSubdivisionRun(clefEvents, index)
  ) {
    return null
  }
  return Math.min(half, remaining)
}

export function terminalSameClefChordQuarterSpan(clefEvents, index, totalDivisions) {
  const anchor = clefEvents[index]
  const start = anchor?.startDivision ?? 0
  const duration = anchor?.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
  const remaining = totalDivisions - start
  const notes = anchor?.notes ?? []
  const quarter = OMR_DIVISIONS_PER_QUARTER
  if (
    index + 1 < clefEvents.length ||
    duration !== OMR_DURATION_DIVISIONS.eighth ||
    start < quarter * 2 ||
    start % quarter !== 0 ||
    remaining < quarter ||
    notes.length < 2 ||
    hasBeamEvidenceForNotes(notes) ||
    sameClefSubdivisionRun(clefEvents, index)
  ) {
    return null
  }
  return Math.min(quarter, remaining)
}

export function applyTerminalSameClefChordQuarterDurations(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (!noteEvents.length) {
    return events
  }

  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }

  const durationByEvent = new Map()
  for (const clefEvents of byClef.values()) {
    const sorted = [...clefEvents].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    )
    for (let index = 0; index < sorted.length; index += 1) {
      const event = sorted[index]
      const duration = event.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
      const terminalQuarter = terminalSameClefChordQuarterSpan(sorted, index, totalDivisions)
      if (terminalQuarter != null && terminalQuarter > duration) {
        durationByEvent.set(event, terminalQuarter)
      }
    }
  }

  if (!durationByEvent.size) {
    return events
  }

  return sortVectorRhythmEvents(
    events.map((event) => {
      const durationDivisions = durationByEvent.get(event)
      if (durationDivisions == null) {
        return event
      }
      return {
        ...event,
        durationDivisions,
        ...durationMeta(durationDivisions, { allowDotted: hasDottedEvidence(event.notes) || event.dotted }),
        terminalSameClefChordQuarterAdjusted: true,
      }
    }),
  )
}

/**
 * Grand-staff voices sustain independently. Recompute each clef's durations from
 * the next onset on the same staff instead of the next mixed-clef onset.
 */
export function extendDurationsPerClefVoice(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (!noteEvents.length) {
    return events
  }

  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }

  const durationByEvent = new Map()
  const sortedAll = [...noteEvents].sort(
    (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
  )
  for (const clefEvents of byClef.values()) {
    const sorted = [...clefEvents].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    )
    for (let index = 0; index < sorted.length; index += 1) {
      const event = sorted[index]
      const clef = event.notes?.[0]?.clef ?? 'treble'
      const start = event.startDivision ?? 0
      const globalDuration = event.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
      const nextSameClefStart =
        index + 1 < sorted.length ? sorted[index + 1].startDivision ?? totalDivisions : null
      let duration = globalDuration
      if (nextSameClefStart != null) {
        const sameClefSpan = Math.max(1, nextSameClefStart - start)
        if (sameClefSpan > duration) {
          const foreignInterrupt = sortedAll.some((other) => {
            if (other === event) {
              return false
            }
            const otherStart = other.startDivision ?? 0
            const otherClef = other.notes?.[0]?.clef ?? 'treble'
            return (
              otherClef !== clef &&
              otherStart > start &&
              otherStart < start + sameClefSpan
            )
          })
          if (foreignInterrupt) {
            const extremeTrebleStretch =
              clef !== 'bass' &&
              globalDuration <= OMR_DURATION_DIVISIONS.eighth + 1 &&
              sameClefSpan > OMR_DIVISIONS_PER_QUARTER * 2
            if (!extremeTrebleStretch && !hasBeamEvidenceForNotes(event.notes)) {
              duration = sameClefSpan
            }
          }
          const overhangCap = unsupportedUpperChordOverhangCap(sorted, index, sameClefSpan)
          if (overhangCap != null && duration > overhangCap) {
            duration = overhangCap
          }
        }
        if (
          !followsDottedSubdivisionTail(sorted, index) &&
          hasConfidentQuarterInference(event.notes ?? [], globalDuration) &&
          !hasBeamEvidenceForNotes(event.notes) &&
          !sameClefSubdivisionRun(sorted, index) &&
          duration < OMR_DIVISIONS_PER_QUARTER
        ) {
          const quarterFloor = OMR_DIVISIONS_PER_QUARTER
          if (sameClefSpan >= quarterFloor) {
            duration = Math.min(quarterFloor, totalDivisions - start)
          } else if (
            sameClefSpan <= OMR_DURATION_DIVISIONS.eighth + 1 &&
            index + 1 < sorted.length &&
            !hasDottedEvidence(sorted[index + 1]?.notes) &&
            !sorted[index + 1]?.dotted &&
            !hasBeamEvidenceForNotes(sorted[index + 1].notes) &&
            countSameClefEventsInSpan(sorted, index, quarterFloor) <= 2 &&
            index + 2 < sorted.length
          ) {
            const extendedSpan = (sorted[index + 2].startDivision ?? totalDivisions) - start
            if (extendedSpan >= quarterFloor) {
              duration = Math.min(quarterFloor, extendedSpan, totalDivisions - start)
            }
          }
        }
        const beatQuarterFloor = sameClefBeatQuarterFloor(
          sorted,
          index,
          totalDivisions,
          duration,
        )
        if (beatQuarterFloor != null && beatQuarterFloor > duration) {
          duration = beatQuarterFloor
        }
        const harmonicHalf = sparseHarmonicHalfSpan(sorted, index, totalDivisions)
        if (harmonicHalf != null && harmonicHalf > duration) {
          duration = harmonicHalf
        }
        const openingChordHalf = openingBassChordSustainSpan(sorted, index, totalDivisions)
        if (openingChordHalf != null && openingChordHalf > duration) {
          duration = openingChordHalf
        }
      } else {
        const terminalQuarter = terminalSameClefChordQuarterSpan(sorted, index, totalDivisions)
        if (terminalQuarter != null && terminalQuarter > duration) {
          duration = terminalQuarter
        }
        const terminalHalf = terminalHarmonicHalfSpan(sorted, index, totalDivisions)
        if (terminalHalf != null && terminalHalf > duration) {
          duration = terminalHalf
        }
      }
      // Do not re-stretch whole/half glyphs past their codepoint value via gaps.
      const glyphCap = glyphAuthoritativeDurationDivisions(event.notes ?? [], {
        allowDotted: hasDottedEvidence(event.notes) || event.dotted,
      })
      if (glyphCap != null && duration > glyphCap) {
        duration = glyphCap
      }
      // Explicit dots on filled heads: do not stretch a dotted quarter into a
      // half via gaps. Prefer noteheadGlyph tags so ink hollow false-positives
      // do not block the cap.
      const hasOpenGlyph = (event.notes ?? []).some(
        (note) => note?.noteheadGlyph === 'whole' || note?.noteheadGlyph === 'half',
      )
      if (!hasOpenGlyph) {
        const dottedCap = dottedWrittenDurationDivisions(event.notes ?? [])
        if (dottedCap != null && duration > dottedCap) {
          duration = dottedCap
        }
        const filledCap = filledHeadWrittenDurationCap(event.notes ?? [])
        if (filledCap != null && duration > filledCap) {
          duration = filledCap
        }
      }
      duration = Math.min(duration, Math.max(1, totalDivisions - start))
      durationByEvent.set(event, duration)
    }
  }

  return sortVectorRhythmEvents(
    events.map((event) => {
      if (event.type !== 'note' || !durationByEvent.has(event)) {
        return event
      }
      const previous = event.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
      const durationDivisions = durationByEvent.get(event)
      if (durationDivisions === previous) {
        return event
      }
      const clef = event.notes?.[0]?.clef ?? 'treble'
      const capped =
        clef !== 'bass' &&
        previous <= OMR_DURATION_DIVISIONS.eighth + 1 &&
        durationDivisions === previous
      return {
        ...event,
        durationDivisions,
        ...durationMeta(durationDivisions, {
          allowDotted: hasDottedEvidence(event.notes) || event.dotted,
        }),
        perClefDurationAdjusted: !capped,
        ...(capped ? { perClefStretchCapped: true } : {}),
      }
    }),
  )
}

export function applySameClefBeatQuarterFloors(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (!noteEvents.length) {
    return events
  }

  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }

  const durationByEvent = new Map()
  for (const clefEvents of byClef.values()) {
    const sorted = [...clefEvents].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    )
    for (let index = 0; index < sorted.length; index += 1) {
      const event = sorted[index]
      const duration = event.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
      if (followsDottedSubdivisionTail(sorted, index)) {
        continue
      }
      const floor = sameClefBeatQuarterFloor(sorted, index, totalDivisions, duration)
      if (floor != null && floor > duration) {
        durationByEvent.set(event, floor)
      }
    }
  }

  if (!durationByEvent.size) {
    return events
  }

  return sortVectorRhythmEvents(
    events.map((event) => {
      const durationDivisions = durationByEvent.get(event)
      if (durationDivisions == null) {
        return event
      }
      return {
        ...event,
        durationDivisions,
        ...durationMeta(durationDivisions, { allowDotted: hasDottedEvidence(event.notes) || event.dotted }),
        sameClefBeatQuarterAdjusted: true,
      }
    }),
  )
}

/**
 * Cap gap-stretched events and floor gap-compressed events using beam evidence.
 * Flooring only lifts sixteenth gaps under a primary beam — it must not shorten
 * quarters (that is the cap's job, and only with real beam evidence).
 */
export function refineEventDurationsFromBeamEvidence(events, totalDivisions = 16) {
  return sortVectorRhythmEvents(
    events.map((event) => {
      if (event.type !== 'note') {
        return event
      }
      const start = event.startDivision ?? 0
      const beamCap = inferredBeamDurationCap(event.notes)
      const beamFloor = inferredBeamDurationFloor(event.notes)
      let duration = event.durationDivisions ?? 0
      let adjusted = false
      let floored = false
      // Floor first: beamed notes packed as sixteenth gaps → eighth.
      if (beamFloor != null && duration < beamFloor) {
        duration = beamFloor
        adjusted = true
        floored = true
      }
      // Cap only when duration still exceeds the beam unit after flooring.
      if (beamCap != null && duration > beamCap) {
        duration = beamCap
        adjusted = true
      }
      if (!adjusted) {
        return event
      }
      duration = Math.min(Math.max(1, duration), Math.max(1, totalDivisions - start))
      return {
        ...event,
        durationDivisions: duration,
        ...durationMeta(duration, { allowDotted: hasDottedEvidence(event.notes) || event.dotted }),
        beamDurationAdjusted: true,
        beamDurationFloored: floored || undefined,
      }
    }),
  )
}

/**
 * After flooring gap-compressed beamed notes to eighths, odd sixteenth onsets
 * are almost always packing artifacts. Snap those starts back to the eighth
 * grid so the previous-duration cascade does not keep reporting onset-mismatch.
 */
export function resnapFlooredBeamOnsets(events) {
  const eighth = OMR_DURATION_DIVISIONS.eighth
  return sortVectorRhythmEvents(
    events.map((event) => {
      if (event.type !== 'note' || !event.beamDurationFloored) {
        return event
      }
      const start = event.startDivision ?? 0
      if (start % eighth === 0) {
        return event
      }
      const snapped = Math.floor(start / eighth) * eighth
      return {
        ...event,
        startDivision: snapped,
        beamOnsetResnapped: true,
      }
    }),
  )
}

export function refineUnsupportedUpperChordOverhangs(events) {
  const noteEvents = events.filter((event) => event.type === 'note')
  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }

  const cappedByEvent = new Map()
  for (const clefEvents of byClef.values()) {
    const sorted = [...clefEvents].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    )
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const event = sorted[index]
      const sameClefSpan = (sorted[index + 1].startDivision ?? 0) - (event.startDivision ?? 0)
      const cap = unsupportedUpperChordOverhangCap(sorted, index, sameClefSpan)
      if (cap != null && (event.durationDivisions ?? 0) > cap) {
        cappedByEvent.set(event, cap)
      }
    }
  }

  if (!cappedByEvent.size) {
    return events
  }

  return sortVectorRhythmEvents(
    events.map((event) => {
      const durationDivisions = cappedByEvent.get(event)
      if (durationDivisions == null) {
        return event
      }
      return {
        ...event,
        durationDivisions,
        ...durationMeta(durationDivisions, { allowDotted: hasDottedEvidence(event.notes) || event.dotted }),
        unsupportedUpperChordOverhangAdjusted: true,
      }
    }),
  )
}

export function refineOpeningBassSubdivisionDurations(events, totalDivisions = 16) {
  const noteEvents = events.filter((event) => event.type === 'note')
  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }

  const cappedByEvent = new Map()
  for (const clefEvents of byClef.values()) {
    const sorted = [...clefEvents].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    )
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const cap = openingBassSubdivisionCap(sorted, index, totalDivisions)
      const event = sorted[index]
      if (cap != null && (event.durationDivisions ?? 0) > cap) {
        cappedByEvent.set(event, cap)
      }
    }
  }

  if (!cappedByEvent.size) {
    return events
  }

  return sortVectorRhythmEvents(
    events.map((event) => {
      const durationDivisions = cappedByEvent.get(event)
      if (durationDivisions == null) {
        return event
      }
      return {
        ...event,
        durationDivisions,
        ...durationMeta(durationDivisions, { allowDotted: hasDottedEvidence(event.notes) || event.dotted }),
        openingBassSubdivisionAdjusted: true,
      }
    }),
  )
}

const VECTOR_DURATION_LADDER = [
  { divisions: OMR_DIVISIONS_PER_QUARTER * 4, durationType: 'whole', dotted: false },
  { divisions: OMR_DIVISIONS_PER_QUARTER * 3, durationType: 'half', dotted: true },
  { divisions: OMR_DIVISIONS_PER_QUARTER * 2, durationType: 'half', dotted: false },
  { divisions: Math.round(OMR_DIVISIONS_PER_QUARTER * 1.5), durationType: 'quarter', dotted: true },
  { divisions: OMR_DIVISIONS_PER_QUARTER, durationType: 'quarter', dotted: false },
  { divisions: Math.round(OMR_DIVISIONS_PER_QUARTER * 0.75), durationType: 'eighth', dotted: true },
  { divisions: Math.round(OMR_DIVISIONS_PER_QUARTER / 2), durationType: 'eighth', dotted: false },
  { divisions: Math.max(1, Math.round(OMR_DIVISIONS_PER_QUARTER / 4)), durationType: 'sixteenth', dotted: false },
]

/**
 * Open notehead codepoints encode written value independently of X spacing.
 * Used on sparse measures so large whitespace cannot invent longer values and
 * packed false onsets cannot collapse wholes/halves to quarters.
 */
export function glyphAuthoritativeDurationDivisions(notes = [], { allowDotted = false } = {}) {
  const kinds = (notes ?? [])
    .map((note) => note?.noteheadGlyph)
    .filter((kind) => kind === 'whole' || kind === 'half')
  if (!kinds.length) {
    return null
  }
  const wholeCount = kinds.filter((kind) => kind === 'whole').length
  const halfCount = kinds.filter((kind) => kind === 'half').length
  // Chord tones should agree; require a clear majority of open heads.
  if (wholeCount >= halfCount && wholeCount >= Math.ceil(kinds.length / 2)) {
    const base = OMR_DURATION_DIVISIONS.whole
    return allowDotted ? Math.round(base * 1.5) : base
  }
  if (halfCount > 0 && halfCount >= wholeCount) {
    const base = OMR_DURATION_DIVISIONS.half
    return allowDotted ? Math.round(base * 1.5) : base
  }
  return null
}

/**
 * Explicit augmentation-dot evidence already encodes 1.5× the written base on
 * each note (see processVectorOmrPage enrich). Prefer that over X-gap on sparse
 * measures so large whitespace cannot promote dotted quarters to dotted halves.
 */
export function dottedWrittenDurationDivisions(notes = []) {
  const dottedNotes = (notes ?? []).filter((note) => note?.dotted === true)
  if (!dottedNotes.length) {
    return null
  }
  const values = dottedNotes
    .map((note) => note.durationDivisions)
    .filter((divisions) => Number.isFinite(divisions) && divisions > 0)
  if (!values.length) {
    return null
  }
  // Chord tones share one written duration — take the consistent (max) value.
  return Math.max(...values)
}

/**
 * Unbeamed filled (black) heads already carry a written enrich duration from
 * stem/flag inference. Gap stretch and foreign-clef sustains must not promote
 * those values to longer open-head lengths (quarter→half is the common failure).
 */
export function filledHeadWrittenDurationCap(notes = []) {
  const values = (notes ?? [])
    .filter((note) => {
      if (!note) {
        return false
      }
      if (note.noteheadGlyph === 'whole' || note.noteheadGlyph === 'half') {
        return false
      }
      if (note.dotted === true) {
        return false
      }
      if ((note.beams ?? 0) >= 1 || (note.beamStrength ?? 0) >= 8) {
        return false
      }
      if (!note.stem) {
        return false
      }
      return Number.isFinite(note.durationDivisions) && note.durationDivisions > 0
    })
    .map((note) => note.durationDivisions)
  if (!values.length) {
    return null
  }
  // Conservative: do not stretch past the shortest written enrich in the chord.
  return Math.min(...values)
}

/**
 * Snap a raw division span to the nearest standard note value.
 * Stem/flag/open-head glyphs also carry duration; gap inference is a fallback
 * (see buildNoteEventsFromGroups). Dotted ladder rungs require augmentation-dot
 * evidence — otherwise gap lengths like 6 invent false dotted quarters.
 */
export function durationMeta(durationDivisions, { allowDotted = false } = {}) {
  let best = VECTOR_DURATION_LADDER[VECTOR_DURATION_LADDER.length - 1]
  let bestDiff = Infinity
  for (const candidate of VECTOR_DURATION_LADDER) {
    if (!allowDotted && candidate.dotted) {
      continue
    }
    const diff = Math.abs(candidate.divisions - durationDivisions)
    if (diff < bestDiff || (diff === bestDiff && candidate.divisions < best.divisions)) {
      bestDiff = diff
      best = candidate
    }
  }
  return { durationType: best.durationType, dotted: best.dotted }
}

function medianNumber(values) {
  if (!values.length) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function vectorLaneHasExplicitDurationEvidence(events) {
  return events.some((event) => {
    const notes = event.notes ?? []
    return (
      hasDottedEvidence(notes) ||
      hasBeamEvidenceForNotes(notes) ||
      notes.some(
        (note) =>
          note.hollow === true ||
          note.hollowGlyph === true ||
          (note.durationDivisions ?? 0) >= OMR_DURATION_DIVISIONS.half,
      )
    )
  })
}

function spacingWeight(ratio) {
  if (ratio >= 0.75 && ratio <= 1.25) {
    return 1
  }
  // Engraving spacing is intentionally sub-linear: a quarter-to-eighth gap is
  // commonly about 1.5–2x, not a literal 2x.
  if (ratio >= 1.45 && ratio <= 2.25) {
    return 2
  }
  return null
}

/**
 * Repack a dense vector lane from relative column spacing when absolute measure
 * bounds introduce a left-margin offset.
 *
 * This is deliberately limited to complete, evidence-light lanes. Explicit
 * beams, dots, hollow heads, late openings, longer gaps, and non-binary grids
 * remain untouched. The common recovered shape is a quarter followed by four
 * eighths in 3/4: absolute positions produce [0,5,7,9,11], while the relative
 * spacing ratios prove [0,4,6,8,10].
 */
export function normalizeDenseVectorLaneSpacing(events, totalDivisions = 16) {
  // The verified failure is a complete 3/4 lane. In 4/4 polyphony, the same
  // visual spacing can describe a half-measure sixteenth passage with another
  // voice carrying the remainder, so repacking it would be unsafe.
  if (totalDivisions !== OMR_DIVISIONS_PER_QUARTER * 3) {
    return events
  }
  const noteEvents = events.filter((event) => event.type === 'note')
  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    const lane = byClef.get(clef) ?? []
    lane.push(event)
    byClef.set(clef, lane)
  }

  const replacementByEvent = new Map()
  const validUnits = new Set([
    OMR_DURATION_DIVISIONS.sixteenth,
    OMR_DURATION_DIVISIONS.eighth,
    OMR_DIVISIONS_PER_QUARTER,
  ])

  for (const lane of byClef.values()) {
    const sorted = [...lane].sort(
      (left, right) =>
        (left.cx ?? 0) - (right.cx ?? 0) ||
        (left.startDivision ?? 0) - (right.startDivision ?? 0),
    )
    if (
      sorted.length < 4 ||
      (sorted[0]?.startDivision ?? 0) !== 0 ||
      vectorLaneHasExplicitDurationEvidence(sorted)
    ) {
      continue
    }

    const gaps = []
    let distinctColumns = true
    for (let index = 1; index < sorted.length; index += 1) {
      const gap = (sorted[index].cx ?? NaN) - (sorted[index - 1].cx ?? NaN)
      if (!Number.isFinite(gap) || gap <= 2) {
        distinctColumns = false
        break
      }
      gaps.push(gap)
    }
    if (!distinctColumns) {
      continue
    }

    const shortestHalf = [...gaps]
      .sort((left, right) => left - right)
      .slice(0, Math.ceil(gaps.length / 2))
    const baseGap = medianNumber(shortestHalf)
    if (!(baseGap > 0)) {
      continue
    }
    const weights = gaps.map((gap) => spacingWeight(gap / baseGap))
    if (weights.some((weight) => weight == null)) {
      continue
    }
    const terminalWeight = medianNumber(
      weights.slice(-Math.min(3, weights.length)),
    )
    const totalWeight =
      weights.reduce((sum, weight) => sum + weight, 0) + terminalWeight
    const unit = totalDivisions / totalWeight
    if (!Number.isInteger(unit) || !validUnits.has(unit)) {
      continue
    }

    const proposedStarts = [0]
    for (const weight of weights) {
      proposedStarts.push(proposedStarts.at(-1) + weight * unit)
    }
    const proposedDurations = [...weights, terminalWeight].map(
      (weight) => weight * unit,
    )
    const startsChanged = sorted.some(
      (event, index) =>
        (event.startDivision ?? 0) !== proposedStarts[index],
    )
    if (!startsChanged) {
      continue
    }

    for (let index = 0; index < sorted.length; index += 1) {
      replacementByEvent.set(sorted[index], {
        startDivision: proposedStarts[index],
        durationDivisions: proposedDurations[index],
      })
    }
  }

  if (!replacementByEvent.size) {
    return events
  }
  return sortVectorRhythmEvents(
    events.map((event) => {
      const replacement = replacementByEvent.get(event)
      if (!replacement) {
        return event
      }
      return {
        ...event,
        ...replacement,
        ...durationMeta(replacement.durationDivisions),
        vectorLaneSpacingAdjusted: true,
      }
    }),
  )
}

/**
 * Grand-staff piano scores often hold a lone bass note across the first half of
 * the bar while treble chords enter later. A single sequential timeline assigns
 * the bass only the gap until the next combined onset; extend it through the
 * treble entry so MusicXML backup/forward can represent the overlap.
 */
export function extendCombinedGrandStaffOpening(events, totalDivisions) {
  if (events.length < 2) {
    return events
  }
  const first = events[0]
  const second = events[1]
  if (first.type !== 'note' || second.type !== 'note') {
    return events
  }
  const openingBass =
    first.notes?.length === 1 &&
    first.notes[0]?.clef === 'bass' &&
    (first.startDivision ?? 0) <= 1
  const trebleFollows = followsWithUpperStaffContent(second.notes, first.notes[0])
  if (!openingBass || !trebleFollows) {
    return events
  }
  if (
    (second.notes?.length ?? 0) > 2 &&
    (second.startDivision ?? 0) >= OMR_DIVISIONS_PER_QUARTER &&
    (second.notes ?? []).some((note) => note.clef === 'treble')
  ) {
    return events
  }
  const sameStart = (second.startDivision ?? 0) <= (first.startDivision ?? 0)
  const peerStart = sameStart
    ? OMR_DIVISIONS_PER_QUARTER
    : (second.startDivision ?? OMR_DIVISIONS_PER_QUARTER)
  // A sustained opening bass must be supported by the ink. When the vector
  // glyph proves a black notehead (hollowGlyph === false), the opening cannot
  // sustain past the next bass attack: simple scores repeat or walk the bass
  // in quarters, and neither reading survives a re-attack. A glyph-backed
  // hollow opening (e.g. a dotted half under same-staff chords) keeps the
  // full extension, as do notes without glyph evidence (raster path), where
  // baseline behavior is unchanged.
  const firstStart = first.startDivision ?? 0
  const provenBlackNotehead =
    first.notes[0]?.hollowGlyph === false && !hasLongToneEvidence(first.notes)
  const nextBassStart = provenBlackNotehead
    ? events.find(
        (event) =>
          event !== first &&
          event.type === 'note' &&
          noteClefFromNotes(event.notes ?? []) === 'bass' &&
          (event.startDivision ?? 0) > firstStart,
      )?.startDivision
    : null
  const extended = Math.min(
    totalDivisions,
    nextBassStart ?? totalDivisions,
    sameStart
      ? OMR_DURATION_DIVISIONS.half + OMR_DIVISIONS_PER_QUARTER
      : peerStart + OMR_DURATION_DIVISIONS.half,
  )
  if (extended <= first.durationDivisions) {
    return events
  }
  const updated = [
    {
      ...first,
      durationDivisions: extended,
      ...durationMeta(extended, {
        allowDotted:
          hasDottedEvidence(first.notes) ||
          first.dotted ||
          extended === OMR_DURATION_DIVISIONS.half + OMR_DIVISIONS_PER_QUARTER,
      }),
    },
  ]
  if (sameStart) {
    const trebleDuration = sameStartTrebleDuration(
      second.notes[0],
      first.notes[0],
      events,
      extended,
      totalDivisions,
    )
    updated.push({
      ...second,
      durationDivisions: trebleDuration,
      ...durationMeta(trebleDuration, {
        allowDotted:
          hasDottedEvidence(second.notes) ||
          second.dotted ||
          trebleDuration === OMR_DURATION_DIVISIONS.half + OMR_DIVISIONS_PER_QUARTER,
      }),
    })
    updated.push(...events.slice(2))
  } else {
    updated.push(...events.slice(1))
  }
  return updated
}

/**
 * When several voices share a beat one quarter before a lone closing note on the
 * penultimate beat, hold that beat for a half note and keep the closing figure
 * a quarter.
 */
export function extendPenultimateHalfBeforeFinalQuarter(events, timeSignature, totalDivisions) {
  if (events.length < 3) {
    return events
  }
  const last = events[events.length - 1]
  if (last.type !== 'note' || (last.notes?.length ?? 0) !== 1) {
    return events
  }
  const lastStart = last.startDivision ?? 0
  // "Lone closing note" means one voice closes alone. When another note event
  // starts on the same division (e.g. both staves close together in a simple
  // grand-staff score), the premise does not hold — leave durations alone.
  const closingPeers = events.some(
    (event) =>
      event !== last &&
      event.type === 'note' &&
      (event.startDivision ?? 0) === lastStart,
  )
  if (closingPeers) {
    return events
  }
  const sharedBeat = lastStart - OMR_DIVISIONS_PER_QUARTER
  if (sharedBeat < 0) {
    return events
  }
  const sharedEvents = events.filter(
    (event) => event.type === 'note' && event.startDivision === sharedBeat,
  )
  const denseSharedBeat =
    sharedEvents.length > 1 || (sharedEvents[0]?.notes?.length ?? 0) > 1
  if (!denseSharedBeat) {
    return events
  }
  const halfDivisions = OMR_DURATION_DIVISIONS.half
  if (
    sharedBeat + halfDivisions > totalDivisions ||
    lastStart + OMR_DIVISIONS_PER_QUARTER > totalDivisions
  ) {
    return events
  }
  const hasSharedBeatQuarter = sharedEvents.some(
    (event) => event.durationDivisions === OMR_DIVISIONS_PER_QUARTER,
  )
  if (!hasSharedBeatQuarter) {
    return events
  }

  let adjusted = events
  const peersAtBeat = sharedEvents.flatMap((event) => event.notes ?? [])
  const isolated = []
  for (const event of adjusted) {
    if (
      event.type !== 'note' ||
      event.startDivision !== sharedBeat ||
      (event.notes?.length ?? 0) <= 1
    ) {
      isolated.push(event)
      continue
    }
    const auxiliary = event.notes.filter((note) =>
      isAuxiliaryUpperVoice(note, peersAtBeat),
    )
    const core = event.notes.filter((note) => !auxiliary.includes(note))
    if (auxiliary.length && core.length) {
      isolated.push({ ...event, notes: core })
      for (const note of auxiliary) {
        isolated.push({ ...event, notes: [note] })
      }
      continue
    }
    isolated.push(event)
  }
  adjusted = sortVectorRhythmEvents(isolated)

  return adjusted.map((event, index) => {
    if (
      event.type === 'note' &&
      event.startDivision === sharedBeat &&
      event.durationDivisions === OMR_DIVISIONS_PER_QUARTER &&
      !(
        (event.notes?.length ?? 0) === 1 &&
        isAuxiliaryUpperVoice(event.notes[0], peersAtBeat)
      )
    ) {
      return {
        ...event,
        durationDivisions: halfDivisions,
        ...durationMeta(halfDivisions, {
          allowDotted: hasDottedEvidence(event.notes) || event.dotted,
        }),
      }
    }
    if (index === adjusted.length - 1) {
      return {
        ...event,
        durationDivisions: OMR_DIVISIONS_PER_QUARTER,
        ...durationMeta(OMR_DIVISIONS_PER_QUARTER, {
          allowDotted: hasDottedEvidence(event.notes) || event.dotted,
        }),
      }
    }
    return event
  })
}

function snapStartDivision(rawStart, totalDivisions) {
  const grid = Math.max(1, OMR_DIVISIONS_PER_QUARTER / 2)
  const clamped = Math.max(0, Math.min(totalDivisions - 1, rawStart))
  return Math.min(totalDivisions - 1, Math.round(clamped / grid) * grid)
}

function startDivisionFromPosition(
  positionInMeasure,
  totalDivisions,
  denseMeasure = false,
  notes = [],
) {
  if (!Number.isFinite(positionInMeasure)) {
    return 0
  }
  const raw = Math.round(positionInMeasure * totalDivisions)
  // Secondary beams prove a sixteenth grid; otherwise keep Sprint-1 snap rules.
  // Do not force primary-beamed notes onto an eighth grid here — false beam ink
  // on quarters (Sprint 2 regression) shortened gaps and capped Q→eighth.
  const hasDotted = (notes ?? []).some((note) => note.dotted === true)
  const hasSecondaryBeam = (notes ?? []).some((note) => (note.beams ?? 0) >= 2)
  if (!denseMeasure && !hasSecondaryBeam && !hasDotted) {
    return snapStartDivision(raw, totalDivisions)
  }
  if (hasDotted && !denseMeasure && raw >= totalDivisions * 0.45) {
    const quarterGrid = OMR_DIVISIONS_PER_QUARTER
    const clamped = Math.max(0, Math.min(totalDivisions - 1, raw))
    return Math.max(
      0,
      Math.min(totalDivisions - 1, Math.round(clamped / quarterGrid) * quarterGrid),
    )
  }
  const grid = Math.max(1, OMR_DIVISIONS_PER_QUARTER / 4)
  const clamped = Math.max(0, Math.min(totalDivisions - 1, raw))
  return Math.max(0, Math.min(totalDivisions - 1, Math.round(clamped / grid) * grid))
}

/**
 * When position packing snaps the first content column into the first beat but
 * not onto the barline, translate the onset grid left by that offset.
 * Recovered ledger tones already share their chord column; this keeps that
 * shared onset barline-aligned instead of delaying every chord member.
 *
 * Full-grid translation is limited to coarse eighth-aligned column packs and
 * chord-dominated packs whose opening landed on a dense sixteenth snap.
 * Monophonic sixteenth runs keep the legacy first-slot pull so subdivision
 * spacing is preserved.
 */
export function alignOpeningGroupStart(starts, groups, beats, usePositionStarts) {
  if (!usePositionStarts || !starts.length || !groups.length) {
    return starts
  }
  const firstStart = starts[0]
  if (!(firstStart > 0)) {
    return starts
  }
  const eighthGrid = Math.max(1, OMR_DIVISIONS_PER_QUARTER / 2)
  const openingFraction = 1 / Math.max(1, beats)
  const firstPosition =
    groups[0]?.positionInMeasure ?? groups[0]?.notes?.[0]?.positionInMeasure ?? null
  if (!Number.isFinite(firstPosition)) {
    return starts
  }
  if (!(firstStart <= OMR_DIVISIONS_PER_QUARTER && firstPosition < openingFraction)) {
    // Legacy: pull only the opening slot to the barline when it already sits on
    // the first eighth and the head is near the playable start.
    if (firstStart <= eighthGrid && firstPosition < openingFraction * 0.55) {
      return [0, ...starts.slice(1)]
    }
    return starts
  }

  const openingIsChord = (groups[0]?.notes?.length ?? 0) >= 2
  const multiNoteGroups = groups.filter((group) => (group.notes?.length ?? 0) >= 2).length
  // Eight evenly spaced dyad columns in 4/4 are ordinary eighth chords, not a
  // dense sixteenth texture. Allow the same opening translate used for sparse
  // chord packs so the whole grid is not left delayed by a dense-snap offset.
  const eighthDyadPack =
    groups.length === beats * 2 &&
    openingIsChord &&
    multiNoteGroups >= Math.ceil(groups.length * 0.75)
  // Dense tuplet / sixteenth textures (many attacks per bar) must keep their
  // relative grid. Only translate sparse chord-column packs where recovered
  // ledger tones share a handful of visual columns.
  const sparseChordPack = groups.length <= beats + 2 || eighthDyadPack
  const eighthAlignedCount = starts.filter((start) => start % eighthGrid === 0).length
  const mostlyEighthAligned = eighthAlignedCount >= Math.ceil(starts.length * 0.75)
  // Only translate whole grids for visual chord columns. Monophonic sixteenth /
  // tuplet runs keep legacy first-slot behavior so subdivision spacing survives.
  if (sparseChordPack && mostlyEighthAligned && openingIsChord) {
    return starts.map((start) => Math.max(0, start - firstStart))
  }
  if (eighthDyadPack) {
    // Noisy dense snap leaves irregular pairs (3,4,6,7…). Column count already
    // proves an eighth grid — rebuild from the barline rather than translating
    // residual sixteenth stutter.
    return groups.map((_, index) => index * eighthGrid)
  }

  // Dense snap can park a chord column on an odd sixteenth (e.g. 3). Translate
  // by the eighth floor so every tone of the visual chord moves together without
  // inventing a monophonic sixteenth grid shift. Require the opening group itself
  // to be a chord so lone recovered orphans are not force-pulled to the barline.
  const chordDominated =
    sparseChordPack &&
    openingIsChord &&
    multiNoteGroups >= Math.ceil(groups.length * 0.5)
  if (chordDominated) {
    const shift = Math.floor(firstStart / eighthGrid) * eighthGrid
    let next =
      shift > 0 ? starts.map((start) => Math.max(0, start - shift)) : [...starts]
    // Residual odd sixteenth on the opening column after the eighth translate is
    // still first-beat snap noise for chord packs — pull only that slot to 0.
    if (next[0] > 0 && next[0] < eighthGrid) {
      next = [0, ...next.slice(1)]
    }
    if (next.some((start, index) => start !== starts[index])) {
      return next
    }
  }

  // Legacy: pull only the opening slot to the barline when it already sits on
  // the first eighth and the head is near the playable start.
  if (firstStart <= eighthGrid && firstPosition < openingFraction * 0.55) {
    return [0, ...starts.slice(1)]
  }
  return starts
}

/**
 * When column count exactly matches an eighth (×2) or sixteenth (×4) pack and
 * geometry spans most of the measure, replace noisy dense-snap starts with a
 * uniform subdivision grid. Preserves intentional sparse/irregular packs.
 */
export function snapUniformSubdivisionStarts(
  starts,
  groups,
  beats,
  totalDivisions = Math.max(1, beats) * OMR_DIVISIONS_PER_QUARTER,
) {
  if (!starts?.length || !groups?.length || starts.length !== groups.length) {
    return starts
  }
  if (![2, 4].includes(groups.length / Math.max(1, beats))) {
    return starts
  }
  const positions = groups
    .map((group) => group.positionInMeasure ?? group.notes?.[0]?.positionInMeasure)
    .filter(Number.isFinite)
  if (positions.length !== groups.length) {
    return starts
  }
  const span = Math.max(...positions) - Math.min(...positions)
  if (span < 0.55) {
    return starts
  }
  const slot = totalDivisions / groups.length
  if (!(slot > 0)) {
    return starts
  }
  const uniform = groups.map((_, index) => index * slot)
  const irregular = starts.some(
    (start, index) => Math.abs(start - uniform[index]) > slot * 0.51,
  )
  if (!irregular && starts[0] === 0) {
    return starts
  }
  return uniform
}

/**
 * Re-apply opening barline alignment after beam onset resnap when the opening
 * attack is a multi-note chord column. Dense measures often snap to an odd
 * sixteenth, floor that opening to an eighth, then leave the whole chord grid
 * delayed by one eighth — recovered ledger tones amplify the mismatch count
 * without changing chord membership.
 */
export function alignOpeningEventStarts(events, beats = 4) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (noteEvents.length < 2) {
    return events
  }
  const sorted = [...noteEvents].sort(
    (left, right) =>
      (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
      (left.cx ?? 0) - (right.cx ?? 0),
  )
  if ((sorted[0]?.notes?.length ?? 0) < 2) {
    return events
  }
  if (sorted.length > beats + 2) {
    return events
  }
  const starts = sorted.map((event) => event.startDivision ?? 0)
  const groups = sorted.map((event) => ({
    positionInMeasure: event.positionInMeasure,
    notes: event.notes ?? [],
  }))
  const nextStarts = alignOpeningGroupStart(starts, groups, beats, true)
  if (nextStarts.every((start, index) => start === starts[index])) {
    return events
  }
  const startByEvent = new Map(sorted.map((event, index) => [event, nextStarts[index]]))
  return sortVectorRhythmEvents(
    events.map((event) => {
      if (!startByEvent.has(event)) {
        return event
      }
      return {
        ...event,
        startDivision: startByEvent.get(event),
        openingOnsetAligned: true,
      }
    }),
  )
}

/**
 * After a sparse chord pack is barline-aligned, an eighth-run prefix often leaves
 * the remaining columns compressed on the sixteenth grid. Expand that compressed
 * tail onto the next quarter beats so recovered ledger tones keep chord membership
 * without stealing later truth onsets.
 *
 * Applies only to the common "one extra column" chart shape (beats+1 attacks),
 * e.g. two opening eighths then quarters in 4/4 → [0,2,4,8,12].
 */
export function refineSparseChordColumnStarts(
  starts,
  beats,
  totalDivisions,
  { firstPosition = null } = {},
) {
  const eighth = OMR_DURATION_DIVISIONS.eighth
  const quarter = OMR_DIVISIONS_PER_QUARTER
  const openingInFirstBeat =
    Number.isFinite(firstPosition) && firstPosition < 1 / Math.max(1, beats)
  if (
    !Array.isArray(starts) ||
    starts.length !== beats + 1 ||
    totalDivisions < beats * quarter
  ) {
    return starts
  }
  if ((starts[0] ?? 0) !== 0 && !openingInFirstBeat) {
    return starts
  }
  const pickups = starts.length - beats
  const ideal = [0]
  for (let index = 1; index <= pickups; index += 1) {
    ideal.push(index * eighth)
  }
  while (ideal.length < starts.length) {
    if (ideal.length === pickups + 1) {
      ideal.push((pickups + 1) * eighth)
      continue
    }
    ideal.push(ideal[ideal.length - 1] + quarter)
  }
  if (ideal[ideal.length - 1] > totalDivisions - 1) {
    return starts
  }
  const compressed = starts.some((start, index) => start < ideal[index])
  if (!compressed) {
    return starts
  }
  if (openingInFirstBeat) {
    return ideal
  }
  // Do not rewrite grids that already overshoot the ideal (true late entries).
  if (starts.some((start, index) => start > ideal[index] + eighth)) {
    return starts
  }
  return ideal
}

export function refineSparseChordColumnOnsets(events, beats = 4, totalDivisions = 16) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (noteEvents.length < 4 || noteEvents.length > beats + 2) {
    return events
  }
  const sorted = [...noteEvents].sort(
    (left, right) =>
      (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
      (left.cx ?? 0) - (right.cx ?? 0),
  )
  if ((sorted[0]?.notes?.length ?? 0) < 2) {
    return events
  }
  const multiNote = sorted.filter((event) => (event.notes?.length ?? 0) >= 2).length
  if (multiNote < Math.ceil(sorted.length * 0.5)) {
    return events
  }
  const starts = sorted.map((event) => event.startDivision ?? 0)
  const firstPosition =
    sorted[0]?.positionInMeasure ?? sorted[0]?.notes?.[0]?.positionInMeasure ?? null
  const nextStarts = refineSparseChordColumnStarts(starts, beats, totalDivisions, {
    firstPosition,
  })
  if (nextStarts.every((start, index) => start === starts[index])) {
    return events
  }
  const startByEvent = new Map(sorted.map((event, index) => [event, nextStarts[index]]))
  const remapped = sortVectorRhythmEvents(
    events.map((event) => {
      if (!startByEvent.has(event)) {
        return event
      }
      return {
        ...event,
        startDivision: startByEvent.get(event),
        sparseChordColumnRefined: true,
      }
    }),
  )
  // Re-gap durations on the refined single-clef chord timeline.
  const refinedNotes = remapped
    .filter((event) => event.type === 'note')
    .sort(
      (left, right) =>
        (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
        (left.cx ?? 0) - (right.cx ?? 0),
    )
  for (let index = 0; index < refinedNotes.length; index += 1) {
    const event = refinedNotes[index]
    const start = event.startDivision ?? 0
    const nextStart =
      index + 1 < refinedNotes.length
        ? refinedNotes[index + 1].startDivision ?? totalDivisions
        : totalDivisions
    const duration = Math.max(1, Math.min(nextStart - start, totalDivisions - start))
    Object.assign(event, {
      durationDivisions: duration,
      ...durationMeta(duration, {
        allowDotted: hasDottedEvidence(event.notes) || event.dotted,
      }),
    })
  }
  return remapped
}

/**
 * Monophonic beats+1 pickup packs (e.g. two beamed eighths then quarters in 4/4).
 * Uses the same ideal grid as chord-column refine when the opening attack sits in
 * the first beat but dense snap left the grid delayed.
 */
export function refineSparsePickupColumnOnsets(events, beats = 4, totalDivisions = 16) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (noteEvents.length !== beats + 1) {
    return events
  }
  const sorted = [...noteEvents].sort(
    (left, right) =>
      (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
      (left.cx ?? 0) - (right.cx ?? 0),
  )
  const multiNote = sorted.filter((event) => (event.notes?.length ?? 0) >= 2).length
  if (multiNote >= Math.ceil(sorted.length * 0.5)) {
    return events
  }
  const firstPosition =
    sorted[0]?.positionInMeasure ?? sorted[0]?.notes?.[0]?.positionInMeasure ?? null
  const starts = sorted.map((event) => event.startDivision ?? 0)
  const nextStarts = refineSparseChordColumnStarts(starts, beats, totalDivisions, {
    firstPosition,
  })
  if (nextStarts.every((start, index) => start === starts[index])) {
    return events
  }
  const startByEvent = new Map(sorted.map((event, index) => [event, nextStarts[index]]))
  const remapped = sortVectorRhythmEvents(
    events.map((event) => {
      if (!startByEvent.has(event)) {
        return event
      }
      return {
        ...event,
        startDivision: startByEvent.get(event),
        sparsePickupColumnRefined: true,
      }
    }),
  )
  const refinedNotes = remapped
    .filter((event) => event.type === 'note')
    .sort(
      (left, right) =>
        (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
        (left.cx ?? 0) - (right.cx ?? 0),
    )
  for (let index = 0; index < refinedNotes.length; index += 1) {
    const event = refinedNotes[index]
    const start = event.startDivision ?? 0
    const nextStart =
      index + 1 < refinedNotes.length
        ? refinedNotes[index + 1].startDivision ?? totalDivisions
        : totalDivisions
    const duration = Math.max(1, Math.min(nextStart - start, totalDivisions - start))
    Object.assign(event, {
      durationDivisions: duration,
      ...durationMeta(duration, {
        allowDotted: hasDottedEvidence(event.notes) || event.dotted,
      }),
    })
  }
  return remapped
}

/**
 * When a sparse voice assigns quarter-grid onsets but a dotted predecessor
 * extends past the next attack, push later onsets to the written release and
 * re-gap durations on that voice.
 */
export function resolveWrittenDurationOverlaps(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (noteEvents.length < 2 || noteEvents.length > 5) {
    return events
  }
  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }
  const startByEvent = new Map()
  let changed = false
  for (const clefEvents of byClef.values()) {
    const sorted = [...clefEvents].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    )
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index]
      const next = sorted[index + 1]
      if (!hasDottedEvidence(current.notes) && !current.dotted) {
        continue
      }
      const start = startByEvent.get(current) ?? current.startDivision ?? 0
      // Prefer the event duration after dotted-eighth base recovery — note-level
      // enrich can still say dotted quarter and would undo the refine.
      const dottedWritten = current.dottedSubdivisionBaseRefined
        ? current.durationDivisions
        : dottedWrittenDurationDivisions(current.notes)
      const glyphCap = glyphAuthoritativeDurationDivisions(current.notes ?? [], {
        allowDotted: hasDottedEvidence(current.notes) || current.dotted,
      })
      const duration =
        dottedWritten ??
        glyphCap ??
        current.durationDivisions ??
        OMR_DIVISIONS_PER_QUARTER
      const writtenEnd = start + duration
      const nextStart = startByEvent.get(next) ?? next.startDivision ?? 0
      if (nextStart < writtenEnd) {
        startByEvent.set(next, writtenEnd)
        changed = true
      } else if (
        nextStart > writtenEnd &&
        nextStart <= writtenEnd + OMR_DURATION_DIVISIONS.eighth
      ) {
        startByEvent.set(next, writtenEnd)
        changed = true
      }
    }
  }
  if (!changed) {
    return events
  }
  const remapped = sortVectorRhythmEvents(
    events.map((event) => {
      if (!startByEvent.has(event)) {
        return event
      }
      return {
        ...event,
        startDivision: startByEvent.get(event),
        writtenOverlapResolved: true,
      }
    }),
  )
  for (const [clef, clefEvents] of byClef.entries()) {
    const sorted = remapped
      .filter(
        (event) =>
          event.type === 'note' && (event.notes?.[0]?.clef ?? 'treble') === clef,
      )
      .sort(
        (left, right) =>
          (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
          (left.cx ?? 0) - (right.cx ?? 0),
      )
    void clefEvents
    for (let index = 0; index < sorted.length; index += 1) {
      const event = sorted[index]
      const start = event.startDivision ?? 0
      const nextStart =
        index + 1 < sorted.length
          ? sorted[index + 1].startDivision ?? totalDivisions
          : totalDivisions
      const glyphCap = glyphAuthoritativeDurationDivisions(event.notes ?? [], {
        allowDotted: hasDottedEvidence(event.notes) || event.dotted,
      })
      const beamFloor = inferredBeamDurationFloor(event.notes)
      let duration = Math.max(1, Math.min(nextStart - start, totalDivisions - start))
      if (index > 0) {
        const previous = sorted[index - 1]
        const previousDotted =
          hasDottedEvidence(previous.notes) || previous.dotted === true
        const span = nextStart - start
        if (
          previousDotted &&
          span >= OMR_DIVISIONS_PER_QUARTER + OMR_DURATION_DIVISIONS.eighth
        ) {
          duration = Math.min(duration, OMR_DURATION_DIVISIONS.eighth)
        }
      }
      // Do not stretch short subdivision enrich values across whitespace after a
      // dotted-eighth recovery — that re-creates false quarters and eats rests.
      const writtenShort = Math.min(
        ...(event.notes ?? [])
          .map((note) => note.durationDivisions)
          .filter((value) => Number.isFinite(value) && value > 0),
        Infinity,
      )
      if (
        Number.isFinite(writtenShort) &&
        writtenShort <= OMR_DURATION_DIVISIONS.eighth &&
        duration > writtenShort &&
        !(hasDottedEvidence(event.notes) || event.dotted)
      ) {
        duration = writtenShort
      }
      if (beamFloor != null && duration < beamFloor) {
        duration = Math.min(beamFloor, totalDivisions - start)
      }
      if (glyphCap != null && duration > glyphCap) {
        duration = glyphCap
      }
      Object.assign(event, {
        durationDivisions: duration,
        ...durationMeta(duration, {
          allowDotted: hasDottedEvidence(event.notes) || event.dotted,
        }),
      })
    }
  }
  return remapped
}

/**
 * Filled heads with augmentation dots but no beam evidence default to quarter
 * bases during enrich. When the next attack sits a subdivision tail away, the
 * written value is a dotted eighth, not a dotted quarter.
 */
export function refineDottedSubdivisionBaseDurations(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (noteEvents.length < 2 || noteEvents.length > 6) {
    return events
  }
  const dottedQuarterDivisions = Math.round(OMR_DIVISIONS_PER_QUARTER * 1.5)
  const dottedEighthDivisions = Math.round(OMR_DURATION_DIVISIONS.eighth * 1.5)
  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }

  const durationByEvent = new Map()
  for (const clefEvents of byClef.values()) {
    const sorted = [...clefEvents].sort(
      (left, right) =>
        (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
        (left.cx ?? left.notes?.[0]?.cx ?? 0) - (right.cx ?? right.notes?.[0]?.cx ?? 0),
    )
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index]
      const next = sorted[index + 1]
      if (!hasDottedEvidence(current.notes) && !current.dotted) {
        continue
      }
      if (hasBeamEvidenceForNotes(current.notes)) {
        continue
      }
      const currentDuration = current.durationDivisions ?? 0
      if (currentDuration !== dottedQuarterDivisions) {
        continue
      }
      const currentPosition =
        current.positionInMeasure ?? current.notes?.[0]?.positionInMeasure ?? null
      const nextPosition =
        next.positionInMeasure ?? next.notes?.[0]?.positionInMeasure ?? null
      if (!Number.isFinite(currentPosition) || !Number.isFinite(nextPosition)) {
        continue
      }
      const positionGap = nextPosition - currentPosition
      if (positionGap <= 0 || positionGap > 0.22) {
        continue
      }
      durationByEvent.set(current, dottedEighthDivisions)
    }
  }

  if (!durationByEvent.size) {
    return events
  }

  return sortVectorRhythmEvents(
    events.map((event) => {
      const durationDivisions = durationByEvent.get(event)
      if (durationDivisions == null) {
        return event
      }
      const meta = durationMeta(durationDivisions, { allowDotted: true })
      return {
        ...event,
        durationDivisions,
        ...meta,
        dottedSubdivisionBaseRefined: true,
        // Keep note-level written values in sync so later overlap repair does not
        // re-read the pre-refine dotted-quarter enrich and undo this recovery.
        notes: (event.notes ?? []).map((note) => ({
          ...note,
          durationDivisions,
          durationType: meta.durationType,
          dotted: true,
        })),
      }
    }),
  )
}

/**
 * After a dotted-eighth base is recovered, the next attack often sits on the
 * written release rather than a later quarter-grid snap.
 */
export function alignSubdivisionFollowersAfterDottedEighth(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (noteEvents.length < 2 || noteEvents.length > 6) {
    return events
  }
  const dottedEighthDivisions = Math.round(OMR_DURATION_DIVISIONS.eighth * 1.5)
  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }

  const startByEvent = new Map()
  const durationByEvent = new Map()
  for (const clefEvents of byClef.values()) {
    const sorted = [...clefEvents].sort(
      (left, right) =>
        (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
        (left.cx ?? 0) - (right.cx ?? 0),
    )
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index]
      const next = sorted[index + 1]
      if (!current.dottedSubdivisionBaseRefined) {
        continue
      }
      const currentDuration = current.durationDivisions ?? 0
      if (currentDuration !== dottedEighthDivisions) {
        continue
      }
      const writtenEnd = (current.startDivision ?? 0) + currentDuration
      const nextStart = next.startDivision ?? 0
      const nextPosition =
        next.positionInMeasure ?? next.notes?.[0]?.positionInMeasure ?? null
      const currentPosition =
        current.positionInMeasure ?? current.notes?.[0]?.positionInMeasure ?? null
      if (
        !Number.isFinite(nextPosition) ||
        !Number.isFinite(currentPosition) ||
        nextPosition <= currentPosition
      ) {
        continue
      }
      if (
        nextStart > writtenEnd &&
        nextStart <= writtenEnd + OMR_DURATION_DIVISIONS.eighth + 1
      ) {
        startByEvent.set(next, writtenEnd)
      }
      // Pack immediately following attacks that sit in the same tight horizontal
      // cluster after the dotted-eighth tail (common: 16th then longer value).
      let cursor =
        (startByEvent.get(next) ?? next.startDivision ?? 0) +
        (next.durationDivisions ?? OMR_DURATION_DIVISIONS.sixteenth)
      let prevPosition = nextPosition
      let prevCx = next.cx ?? next.notes?.[0]?.cx ?? null
      for (let follow = index + 2; follow < sorted.length; follow += 1) {
        const later = sorted[follow]
        const laterPosition =
          later.positionInMeasure ?? later.notes?.[0]?.positionInMeasure ?? null
        const laterCx = later.cx ?? later.notes?.[0]?.cx ?? null
        const positionGap =
          Number.isFinite(laterPosition) && Number.isFinite(prevPosition)
            ? laterPosition - prevPosition
            : null
        const cxGap =
          Number.isFinite(laterCx) && Number.isFinite(prevCx) ? laterCx - prevCx : null
        // Prefer measure-fraction gap; fall back to ~1 staff-space in pixels when
        // positionInMeasure was overwritten by onset/totalDivisions.
        const closeInPosition =
          positionGap != null && positionGap > 0 && positionGap <= 0.12
        const closeInCx = cxGap != null && cxGap > 0 && cxGap <= 18
        if (!closeInPosition && !closeInCx) {
          break
        }
        const laterStart = later.startDivision ?? 0
        if (laterStart > cursor) {
          startByEvent.set(later, cursor)
        }
        const placedStart = startByEvent.get(later) ?? laterStart
        // Prefer stem/flag enrich duration over a prior crushed gap value so a
        // quarter after a 16th tail is not emitted as another 16th.
        const enrichDuration = Math.max(
          later.durationDivisions ?? 0,
          ...(later.notes ?? [])
            .filter((note) => (note.beams ?? 0) < 1)
            .map((note) => note.durationDivisions)
            .filter((value) => Number.isFinite(value) && value > 0),
          OMR_DURATION_DIVISIONS.sixteenth,
        )
        if (enrichDuration > (later.durationDivisions ?? 0)) {
          durationByEvent.set(later, enrichDuration)
        }
        cursor = placedStart + enrichDuration
        prevPosition = laterPosition
        prevCx = laterCx
      }
    }
  }

  if (!startByEvent.size && !durationByEvent.size) {
    return events
  }

  return sortVectorRhythmEvents(
    events.map((event) => {
      const startDivision = startByEvent.has(event)
        ? startByEvent.get(event)
        : event.startDivision
      const durationDivisions = durationByEvent.has(event)
        ? durationByEvent.get(event)
        : event.durationDivisions
      if (startDivision === event.startDivision && durationDivisions === event.durationDivisions) {
        return event
      }
      return {
        ...event,
        startDivision,
        durationDivisions,
        ...durationMeta(durationDivisions, {
          allowDotted: hasDottedEvidence(event.notes) || event.dotted,
        }),
        subdivisionFollowerAligned: startByEvent.has(event) || undefined,
      }
    }),
  )
}

/**
 * Position snap can collapse consecutive sixteenth attacks onto one onset.
 * Split same-start single-note events or two-note dyads when horizontal order
 * proves sequential subdivision rather than a harmonic stack.
 */
export function splitSnappedSequentialSixteenths(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (noteEvents.length < 1 || noteEvents.length > 6) {
    return events
  }
  const sixteenth = OMR_DURATION_DIVISIONS.sixteenth
  const output = []

  for (const event of events) {
    if (event.type !== 'note') {
      output.push(event)
      continue
    }

    const notes = event.notes ?? []
    if (notes.length === 2) {
      const sortedNotes = [...notes].sort((left, right) => (left.cx ?? 0) - (right.cx ?? 0))
      const dx = Math.abs((sortedNotes[1].cx ?? 0) - (sortedNotes[0].cx ?? 0))
      const start = event.startDivision ?? 0
      const duration = event.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
      const terminalTail =
        start >= totalDivisions - OMR_DIVISIONS_PER_QUARTER &&
        duration >= OMR_DIVISIONS_PER_QUARTER
      const leftPosition =
        sortedNotes[0]?.positionInMeasure ?? event.positionInMeasure ?? null
      const rightPosition =
        sortedNotes[1]?.positionInMeasure ?? event.positionInMeasure ?? null
      const positionGap =
        Number.isFinite(leftPosition) && Number.isFinite(rightPosition)
          ? rightPosition - leftPosition
          : 0
      const sequentialByPosition =
        positionGap >= 0.012 &&
        positionGap <= (OMR_DIVISIONS_PER_QUARTER / totalDivisions) * 0.55
      if (
        dx > 0 &&
        dx <= OMR_CHORD_MERGE_X &&
        start + sixteenth < totalDivisions &&
        (duration >= OMR_DIVISIONS_PER_QUARTER ||
          terminalTail ||
          (sequentialByPosition && duration >= sixteenth))
      ) {
        const leadingStart = terminalTail ? Math.max(0, start - sixteenth) : start
        const trailingStart = terminalTail ? start : start + sixteenth
        const trailingDuration = terminalTail
          ? duration
          : Math.max(sixteenth, duration - sixteenth)
        output.push({
          ...event,
          notes: [sortedNotes[0]],
          cx: sortedNotes[0].cx,
          startDivision: leadingStart,
          durationDivisions: sixteenth,
          ...durationMeta(sixteenth),
          snappedSequentialSixteenthSplit: true,
        })
        output.push({
          ...event,
          notes: [sortedNotes[1]],
          cx: sortedNotes[1].cx,
          startDivision: trailingStart,
          durationDivisions: trailingDuration,
          ...durationMeta(trailingDuration),
          snappedSequentialSixteenthSplit: true,
        })
        continue
      }
    }

    output.push(event)
  }

  const noteOnly = output.filter((event) => event.type === 'note')
  const byStartClef = new Map()
  for (const event of noteOnly) {
    const start = event.startDivision ?? 0
    const clef = event.notes?.[0]?.clef ?? 'treble'
    const key = `${clef}:${start}`
    if (!byStartClef.has(key)) {
      byStartClef.set(key, [])
    }
    byStartClef.get(key).push(event)
  }

  const startByEvent = new Map()
  for (const group of byStartClef.values()) {
    if (group.length !== 2) {
      continue
    }
    if (group.some((entry) => (entry.notes?.length ?? 0) !== 1)) {
      continue
    }
    const sorted = [...group].sort(
      (left, right) => (left.notes?.[0]?.cx ?? 0) - (right.notes?.[0]?.cx ?? 0),
    )
    const left = sorted[0]
    const right = sorted[1]
    const dx = Math.abs((right.notes?.[0]?.cx ?? 0) - (left.notes?.[0]?.cx ?? 0))
    if (dx <= 0 || dx > OMR_CHORD_MERGE_X) {
      continue
    }
    const start = left.startDivision ?? 0
    if (start + sixteenth >= totalDivisions) {
      continue
    }
    startByEvent.set(left, start)
    startByEvent.set(right, start + sixteenth)
  }

  if (!startByEvent.size) {
    return sortVectorRhythmEvents(output)
  }

  return sortVectorRhythmEvents(
    output.map((event) => {
      if (!startByEvent.has(event)) {
        return event
      }
      return {
        ...event,
        startDivision: startByEvent.get(event),
        snappedSequentialSixteenthSplit: true,
      }
    }),
  )
}

function dedupeNotesByMidi(notes = []) {
  return dedupeNoteheads(notes)
}

/**
 * Merge same-onset, same-clef fragments into one chord event.
 *
 * Duration is intentionally not part of the merge key: gap packing often assigns
 * different gap-derived durations to vertically stacked chord tones that share a
 * snapped onset. Distant same-onset attacks (dx above the chord window) stay
 * separate.
 */
export function coalesceSameOnsetChordEvents(events) {
  const rests = events.filter((event) => event.type === 'rest')
  const chordWindow = OMR_CHORD_MERGE_X
  const merged = []
  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    const start = event.startDivision ?? 0
    const clef = event.notes?.[0]?.clef ?? 'treble'
    const cx = average((event.notes ?? []).map((note) => note.cx))
    const match = merged.find((entry) => {
      if ((entry.startDivision ?? 0) !== start) {
        return false
      }
      if ((entry.notes?.[0]?.clef ?? 'treble') !== clef) {
        return false
      }
      const entryCx = average((entry.notes ?? []).map((note) => note.cx))
      if (!Number.isFinite(cx) || !Number.isFinite(entryCx)) {
        return false
      }
      return Math.abs(entryCx - cx) <= chordWindow
    })
    if (!match) {
      merged.push({
        ...event,
        notes: dedupeNotesByMidi(event.notes ?? []),
      })
      continue
    }
    match.notes = dedupeNotesByMidi([...(match.notes ?? []), ...(event.notes ?? [])])
    match.cx = average(match.notes.map((note) => note.cx))
    const nextDuration = Math.max(
      match.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER,
      event.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER,
    )
    if (nextDuration !== (match.durationDivisions ?? 0)) {
      match.durationDivisions = nextDuration
      Object.assign(
        match,
        durationMeta(nextDuration, {
          allowDotted: hasDottedEvidence(match.notes) || match.dotted || event.dotted,
        }),
      )
    }
  }
  return sortVectorRhythmEvents([...rests, ...merged])
}

/**
 * Dense multi-note attacks that land on odd sixteenth slots are usually
 * chord-column snap noise (engraved dense textures are eighth chords). Snap
 * those starts back to the eighth grid when the measure does not look like a
 * real secondary-beamed sixteenth texture, then re-gap durations per clef.
 */
export function resnapDenseChordOnsets(events, totalDivisions = 16) {
  const eighth = OMR_DURATION_DIVISIONS.eighth
  const noteEvents = events.filter((event) => event.type === 'note')
  if (noteEvents.length <= 5) {
    return events
  }
  const multiNote = noteEvents.filter((event) => (event.notes?.length ?? 0) >= 2)
  // Chord-dominated measures only. Sixteenth runs (tuplets) are mostly singles.
  if (multiNote.length < 4 || multiNote.length < noteEvents.length * 0.6) {
    return events
  }
  // Dense piano textures are grand-staff. Single-staff chord charts (guitar)
  // should not be forced onto an eighth grid.
  const clefs = new Set(
    noteEvents.flatMap((event) => (event.notes ?? []).map((note) => note.clef ?? 'treble')),
  )
  if (clefs.size < 2) {
    return events
  }
  const oddMulti = multiNote.filter((event) => (event.startDivision ?? 0) % eighth !== 0)
  if (oddMulti.length < 2) {
    return events
  }
  // Beamed eighth runs (common on tuplet/guitar textures) already sit near an
  // eighth grid; resnapping their odd leftovers destroys intentional 16ths.
  const primaryBeamedShare =
    multiNote.filter((event) =>
      (event.notes ?? []).some((note) => (note.beams ?? 0) === 1 || (note.beamStrength ?? 0) >= 8),
    ).length / multiNote.length
  if (primaryBeamedShare >= 0.45) {
    return events
  }
  // Real sixteenth textures carry secondary beams on a large share of attacks.
  const secondaryShare =
    multiNote.filter((event) => (event.notes ?? []).some((note) => (note.beams ?? 0) >= 2)).length /
    multiNote.length
  if (secondaryShare >= 0.5) {
    return events
  }

  const snapped = sortVectorRhythmEvents(
    events.map((event) => {
      if (event.type !== 'note' || (event.notes?.length ?? 0) < 2) {
        return event
      }
      const start = event.startDivision ?? 0
      if (start % eighth === 0) {
        return event
      }
      return {
        ...event,
        startDivision: Math.floor(start / eighth) * eighth,
        denseChordOnsetResnapped: true,
      }
    }),
  )

  const byClef = new Map()
  for (const event of snapped) {
    if (event.type !== 'note') {
      continue
    }
    const clef = event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }
  for (const clefEvents of byClef.values()) {
    clefEvents.sort((left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0))
    for (let index = 0; index < clefEvents.length; index += 1) {
      const event = clefEvents[index]
      const touched =
        event.denseChordOnsetResnapped ||
        (index + 1 < clefEvents.length && clefEvents[index + 1].denseChordOnsetResnapped)
      if (!touched) {
        continue
      }
      const start = event.startDivision ?? 0
      const nextStart =
        index + 1 < clefEvents.length ? clefEvents[index + 1].startDivision ?? totalDivisions : totalDivisions
      const duration = Math.max(1, Math.min(nextStart - start, totalDivisions - start))
      const allowDotted = hasDottedEvidence(event.notes) || event.dotted
      Object.assign(event, {
        durationDivisions: duration,
        ...durationMeta(duration, { allowDotted }),
      })
    }
  }
  return coalesceSameOnsetChordEvents(snapped)
}

export function clampMeasureEventDurations(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  const denseMeasure = noteEvents.length > 5
  const denseMaxDuration = Math.min(totalDivisions, OMR_DURATION_DIVISIONS.half)

  return events.map((event) => {
    const start = event.startDivision ?? 0
    const maxDuration = Math.max(1, totalDivisions - start)
    let duration = event.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
    if (denseMeasure && event.type === 'note' && duration > denseMaxDuration) {
      duration = denseMaxDuration
    }
    if (duration <= maxDuration) {
      return event
    }
    const clamped = maxDuration
    return {
      ...event,
      durationDivisions: clamped,
      ...durationMeta(clamped, { allowDotted: hasDottedEvidence(event.notes) || event.dotted }),
      durationClamped: true,
    }
  })
}

function buildNoteEventsFromGroups(
  groups,
  measureBox,
  timeSignature,
  totalDivisions,
  beats,
  provenance = null,
  { jointPacking = true } = {},
) {
  const usePositionStarts = shouldInferRhythmFromPositions(groups, beats)
  const denseMeasure = groups.length > beats

  function track(stage, functionName, run) {
    if (!provenance) {
      return run()
    }
    const before = events
    const next = run()
    provenance.recordStage(stage, functionName, before, next)
    return next
  }

  if (usePositionStarts) {
    const slotsPerMeasure = Math.max(4, beats * 4)
    const allNotes = groups.flatMap((group) => group.notes ?? [])
    const chordMergeX = vectorChordMergeXPx(allNotes, beats)
    const snappedClusters = []
    for (const group of groups) {
      const positionInMeasure = group.notes[0]?.positionInMeasure
      const startDivision = Number.isFinite(positionInMeasure)
        ? snapStartDivision(Math.round(positionInMeasure * totalDivisions), totalDivisions)
        : null
      if (startDivision == null) {
        continue
      }
      const cluster = snappedClusters.find(
        (entry) =>
          entry.startDivision === startDivision &&
          entry.groups.some((entryGroup) =>
            groupsShareBeatSlot(entryGroup, group, slotsPerMeasure, chordMergeX),
          ),
      )
      if (!cluster) {
        snappedClusters.push({ startDivision, groups: [group] })
        continue
      }
      cluster.groups.push(group)
    }
    groups = snappedClusters
      .flatMap((cluster) => mergeClusterGroups(cluster.groups, chordMergeX, slotsPerMeasure))
      .map((group) => {
        const clusterNotes = group.notes ?? []
        const positionInMeasure = groupAnchorPosition(group)
        return {
          startDivision: startDivisionFromPosition(
            positionInMeasure,
            totalDivisions,
            denseMeasure,
            clusterNotes,
          ),
          notes: clusterNotes,
          cx: average(clusterNotes.map((note) => note.cx)),
          positionInMeasure,
        }
      })
      .sort((left, right) => left.startDivision - right.startDivision)
    if (usePositionStarts && groups.length) {
      const firstPosition = groupAnchorPosition(groups[0])
      if (Number.isFinite(firstPosition) && firstPosition < 1 / Math.max(1, beats)) {
        groups[0].startDivision = 0
      }
    }
  }

  const rhythmStarts = groups.map((group, index) => {
    if (usePositionStarts && Number.isFinite(group.startDivision)) {
      return group.startDivision
    }
    if (groups.length <= beats) {
      return Math.min(totalDivisions - OMR_DIVISIONS_PER_QUARTER, index * OMR_DIVISIONS_PER_QUARTER)
    }
    return Math.min(
      totalDivisions - 1,
      Math.round((index / Math.max(1, groups.length)) * totalDivisions),
    )
  })
  const alignedStarts = snapUniformSubdivisionStarts(
    alignOpeningGroupStart(rhythmStarts, groups, beats, usePositionStarts),
    groups,
    beats,
    totalDivisions,
  )
  if (usePositionStarts && groups.length >= 2) {
    for (let index = 1; index < alignedStarts.length; index += 1) {
      const previousNotes = groups[index - 1]?.notes ?? []
      if (!hasDottedEvidence(previousNotes)) {
        continue
      }
      const previousStart = alignedStarts[index - 1]
      const previousDuration =
        dottedWrittenDurationDivisions(previousNotes) ??
        glyphAuthoritativeDurationDivisions(previousNotes, { allowDotted: true }) ??
        OMR_DIVISIONS_PER_QUARTER
      const writtenEnd = previousStart + previousDuration
      if (
        alignedStarts[index] > writtenEnd &&
        alignedStarts[index] <= writtenEnd + OMR_DURATION_DIVISIONS.eighth
      ) {
        alignedStarts[index] = writtenEnd
      }
    }
  }

  let events = splitMixedClefEvents(
    groups.map((group, index) => {
      const startDivision = alignedStarts[index]
      const nextAlignedStart =
        index + 1 < alignedStarts.length ? alignedStarts[index + 1] : totalDivisions
      const rhythmStart = rhythmStarts[index]
      const nextRhythmStart =
        index + 1 < rhythmStarts.length ? rhythmStarts[index + 1] : totalDivisions
      // When opening/subdivision alignment rewrites the onset grid, durations must
      // follow the aligned starts — not the pre-align residual gaps.
      let durationDivisions = Math.max(
        1,
        usePositionStarts ? nextAlignedStart - startDivision : nextRhythmStart - rhythmStart,
      )
      if (!usePositionStarts && groups.length <= beats) {
        if (groups.length < beats) {
          if (groups.length === 1) {
            durationDivisions = totalDivisions
          } else if (
            index === groups.length - 1 &&
            beats - groups.length <= 1
          ) {
            durationDivisions = Math.max(OMR_DIVISIONS_PER_QUARTER, totalDivisions - startDivision)
          } else {
            durationDivisions = OMR_DIVISIONS_PER_QUARTER
          }
        } else if (index + 1 < groups.length) {
          durationDivisions = OMR_DIVISIONS_PER_QUARTER
        } else {
          durationDivisions = Math.max(OMR_DIVISIONS_PER_QUARTER, totalDivisions - startDivision)
        }
      }
      const allowDotted = hasDottedEvidence(group.notes)
      let snappedDuration = allowDotted
        ? durationDivisions
        : VECTOR_DURATION_LADDER.filter((candidate) => !candidate.dotted).reduce(
            (best, candidate) =>
              Math.abs(candidate.divisions - durationDivisions) <
              Math.abs(best - durationDivisions)
                ? candidate.divisions
                : best,
            OMR_DIVISIONS_PER_QUARTER,
          )
      // Sparse measures: explicit whole/half glyphs outrank X-gap estimation.
      // Dense subdivision measures keep gap packing (beams/tuplets).
      if (!denseMeasure) {
        const measureRemaining = Math.max(1, totalDivisions - startDivision)
        const glyphDuration = glyphAuthoritativeDurationDivisions(group.notes, {
          allowDotted,
        })
        if (glyphDuration != null) {
          snappedDuration = Math.min(glyphDuration, measureRemaining)
        } else if (allowDotted) {
          // Prefer written dotted value only when the onset is filled-head
          // (no whole/half glyph). Open glyphs keep glyph/gap sustain behavior.
          const hasOpenGlyph = (group.notes ?? []).some(
            (note) => note?.noteheadGlyph === 'whole' || note?.noteheadGlyph === 'half',
          )
          if (!hasOpenGlyph) {
            const writtenDotted = dottedWrittenDurationDivisions(group.notes)
            if (writtenDotted != null) {
              snappedDuration = Math.min(writtenDotted, measureRemaining)
            }
          }
        }
        if (
          index > 0 &&
          hasDottedEvidence(groups[index - 1]?.notes) &&
          nextAlignedStart - startDivision >=
            OMR_DIVISIONS_PER_QUARTER + OMR_DURATION_DIVISIONS.eighth
        ) {
          snappedDuration = Math.min(
            snappedDuration,
            OMR_DURATION_DIVISIONS.eighth,
            measureRemaining,
          )
        }
      }
      const meta = durationMeta(snappedDuration, { allowDotted })
      const positionInMeasure =
        groupAnchorPosition(group) ?? startDivision / totalDivisions
      return {
        type: 'note',
        startDivision,
        durationDivisions: snappedDuration,
        ...meta,
        notes: group.notes,
        confidence: 0.9,
        measureNumber: measureBox.measureNumber,
        page: measureBox.page,
        positionInMeasure,
        cx: group.cx,
        vector: true,
      }
    }),
  )
  if (provenance) {
    events.forEach((event, index) => {
      provenance.recordInitialEvent(event, index, {
        gapType: event.durationType,
        gapConfidence: 0.6,
      })
    })
  }
  events = track('normalize-dense-lane', 'normalizeDenseVectorLaneSpacing', () =>
    normalizeDenseVectorLaneSpacing(events, totalDivisions),
  )
  events = track('extend-per-clef-voice', 'extendDurationsPerClefVoice', () =>
    extendDurationsPerClefVoice(events, totalDivisions),
  )
  // Beam floor/cap on dense (subdivision) measures where gap packing invents
  // sixteenth events. Avoid applying the cap to sparse/grand measures where
  // false tip-row beams would shorten true quarters.
  if (denseMeasure) {
    events = track('beam-refine', 'refineEventDurationsFromBeamEvidence', () =>
      refineEventDurationsFromBeamEvidence(events, totalDivisions),
    )
    events = track('beam-onset-resnap', 'resnapFlooredBeamOnsets', () =>
      resnapFlooredBeamOnsets(events),
    )
    // Beam flooring can leave an eighth-delayed chord grid that opening-group
    // align could not shift while the head still sat on an odd sixteenth.
    events = track('opening-onset-align', 'alignOpeningEventStarts', () =>
      alignOpeningEventStarts(events, beats),
    )
    events = track('sparse-pickup-column-refine', 'refineSparsePickupColumnOnsets', () =>
      refineSparsePickupColumnOnsets(events, beats, totalDivisions),
    )
    events = track('sparse-chord-column-refine', 'refineSparseChordColumnOnsets', () =>
      refineSparseChordColumnOnsets(events, beats, totalDivisions),
    )
  }
  if (!denseMeasure) {
    events = track('split-sequential-sixteenths', 'splitSnappedSequentialSixteenths', () =>
      splitSnappedSequentialSixteenths(events, totalDivisions),
    )
  }
  events = track('chord-coalesce', 'coalesceSameOnsetChordEvents', () =>
    coalesceSameOnsetChordEvents(events),
  )
  if (denseMeasure) {
    events = track('dense-chord-resnap', 'resnapDenseChordOnsets', () =>
      resnapDenseChordOnsets(events, totalDivisions),
    )
  }
  // Dotted-eighth recovery is geometry-based (augmentation dot + close follower).
  // Dense measures with 5 onsets (groups > beats) previously skipped this and
  // left dotted eighths classified as dotted quarters (tuplets m8).
  // Run after dense-chord-resnap so resnap cannot undo the refined onsets.
  events = track('dotted-subdivision-base', 'refineDottedSubdivisionBaseDurations', () =>
    refineDottedSubdivisionBaseDurations(events, totalDivisions),
  )
  events = track(
    'dotted-subdivision-follower',
    'alignSubdivisionFollowersAfterDottedEighth',
    () => alignSubdivisionFollowersAfterDottedEighth(events, totalDivisions),
  )
  events = track('grand-staff-opening', 'extendCombinedGrandStaffOpening', () =>
    extendCombinedGrandStaffOpening(events, totalDivisions),
  )
  events = track('penultimate-half', 'extendPenultimateHalfBeforeFinalQuarter', () =>
    extendPenultimateHalfBeforeFinalQuarter(events, timeSignature, totalDivisions),
  )
  events = track('upper-chord-overhang', 'refineUnsupportedUpperChordOverhangs', () =>
    refineUnsupportedUpperChordOverhangs(events),
  )
  events = track('opening-bass-subdivision', 'refineOpeningBassSubdivisionDurations', () =>
    refineOpeningBassSubdivisionDurations(events, totalDivisions),
  )
  events = track('musical-event-reconstruct', 'reconstructMusicalEvents', () =>
    reconstructMusicalEvents(events, { totalDivisions }),
  )
  events = track('same-clef-beat-quarter-floor', 'applySameClefBeatQuarterFloors', () =>
    applySameClefBeatQuarterFloors(events, totalDivisions),
  )
  // Re-gap after dotted-eighth recovery on both sparse and dense measures so
  // followers land on the written release and terminal rests keep capacity.
  events = track('written-overlap-resolve', 'resolveWrittenDurationOverlaps', () =>
    resolveWrittenDurationOverlaps(events, totalDivisions),
  )
  if (jointPacking) {
    events = track('joint-polyphonic-pack', 'packJointPolyphonicRhythm', () =>
      packJointPolyphonicRhythm(events, { totalDivisions }).events,
    )
  }
  events = track('written-overlap-finalize', 'resolveWrittenDurationOverlaps', () =>
    resolveWrittenDurationOverlaps(events, totalDivisions),
  )
  return track('clamp-measure', 'clampMeasureEventDurations', () =>
    clampMeasureEventDurations(events, totalDivisions),
  )
}

export function buildVectorEvents(
  notes,
  measureBox,
  timeSignature,
  { rests = [], provenance = null, deferJointPacking = false } = {},
) {
  const beats = timeSignature?.beats ?? 4
  const groups = mergeGroupsSharingBeat(groupVectorNoteheads(notes, { beats }), beats)
  const totalDivisions = Math.round(beats * OMR_DIVISIONS_PER_QUARTER * (4 / (timeSignature?.beatType ?? 4)))
  // Do not invent a whole-measure rest when neither notes nor rest glyphs exist.
  // Phantom empty-measure rests were a source of extra-rest on under-detected pages.
  if (!groups.length && !rests.length) {
    return []
  }

  if (!groups.length && rests.length) {
    return buildEmptyMeasureRestEvents(rests, measureBox, totalDivisions)
  }

  const noteEvents = buildNoteEventsFromGroups(
    groups,
    measureBox,
    timeSignature,
    totalDivisions,
    beats,
    provenance,
    { jointPacking: !deferJointPacking && !rests.length },
  )
  if (!rests.length) {
    return noteEvents
  }

  const events = insertMixedMeasureRests(noteEvents, rests, {
    measureBox,
    totalDivisions,
  }).events
  return packJointPolyphonicRhythm(events, { totalDivisions }).events
}

export function buildVectorMeasureRecord({
  glyphs,
  imageData,
  measureBox,
  keySignature,
  timeSignature,
  measurePlacement = {},
  orphanGlyphs = [],
  inkThreshold = 170,
  captureDetectorObservations = false,
  vectorAccidentalPaths = [],
  vectorAugmentationDotPaths = [],
  noteheadFallbackCalibration = null,
  accidentalPathCalibration = null,
  enableLocalTupletGroups = true,
}) {
  const {
    notes,
    vectorAccidentalDiagnostics,
    vectorStaccatoDiagnostics,
    vectorAccentDiagnostics,
    vectorNotationArticulationDiagnostics,
    augmentationDotDiagnostics,
  } = noteheadsForMeasure(
    glyphs,
    imageData,
    measureBox,
    keySignature,
    measurePlacement,
    orphanGlyphs,
    inkThreshold,
    vectorAccidentalPaths,
    vectorAugmentationDotPaths,
    noteheadFallbackCalibration,
    accidentalPathCalibration,
  )
  const rawDetectedRests = restsForMeasure(
    glyphs,
    imageData,
    measureBox,
    notes,
  )
  const restFermataResult = assignVectorFermatasToRests(
    glyphs,
    rawDetectedRests,
    measureBox,
    imageData,
  )
  const detectedRests = rawDetectedRests.map((rest, index) => {
    const fermata = restFermataResult.assignments.get(index)
    return fermata
      ? { ...rest, notationArticulations: [fermata] }
      : rest
  })
  const selectedRestFermataKeys = new Set(
    restFermataResult.selectedAttachments.map(
      (entry) =>
        `${entry.glyph.text}:${Math.round(entry.glyph.x)}:${Math.round(entry.glyph.y)}`,
    ),
  )
  const combinedVectorNotationArticulationDiagnostics = {
    ...vectorNotationArticulationDiagnostics,
    detectedByType: {
      ...vectorNotationArticulationDiagnostics.detectedByType,
      fermata: Math.max(
        vectorNotationArticulationDiagnostics.detectedByType?.fermata ?? 0,
        restFermataResult.detectedCandidates.length,
      ),
    },
    appliedByType: {
      ...vectorNotationArticulationDiagnostics.appliedByType,
      fermata:
        (vectorNotationArticulationDiagnostics.appliedByType?.fermata ?? 0) +
        restFermataResult.assignments.size,
    },
    selectedAttachments: [
      ...(vectorNotationArticulationDiagnostics.selectedAttachments ?? []),
      ...restFermataResult.selectedAttachments,
    ],
    rejectedCandidates: [
      ...(vectorNotationArticulationDiagnostics.rejectedCandidates ?? []).filter(
        (entry) =>
          !selectedRestFermataKeys.has(
            `${entry.glyph.text}:${Math.round(entry.glyph.x)}:${Math.round(entry.glyph.y)}`,
          ),
      ),
      ...restFermataResult.rejectedCandidates,
    ],
  }
  const beats = timeSignature?.beats ?? 4
  const totalDivisions = Math.round(
    beats * OMR_DIVISIONS_PER_QUARTER * (4 / (timeSignature?.beatType ?? 4)),
  )

  const provenance = createMeasureRhythmProvenance({
    measureNumber: measureBox.measureNumber,
    page: measureBox.page,
    systemIndex: measureBox.systemIndex,
  })
  if (provenance && augmentationDotDiagnostics) {
    provenance.addDotCandidates(augmentationDotDiagnostics)
  }

  let events
  let restApplyResult = { appliedCount: 0, skipped: [] }
  if (notes.length === 0) {
    events = buildVectorEvents(notes, measureBox, timeSignature, {
      rests: detectedRests,
      provenance,
    })
  } else if (!detectedRests.length) {
    events = buildVectorEvents(notes, measureBox, timeSignature, { provenance })
  } else {
    const noteEvents = buildVectorEvents(notes, measureBox, timeSignature, {
      rests: [],
      provenance,
      // Preserve the original note geometry until detected rests have had a
      // chance to claim their voice slots. Joint packing then sees both.
      deferJointPacking: true,
    })
    restApplyResult = insertMixedMeasureRests(noteEvents, detectedRests, {
      measureBox,
      totalDivisions,
    })
    events = packJointPolyphonicRhythm(restApplyResult.events, {
      totalDivisions,
    }).events
  }

  const tupletRecovery = recoverVectorTupletEvents(events, {
    glyphs,
    measureBox,
    imageData,
    beats,
    totalDivisions,
    enableLocalGroups: enableLocalTupletGroups,
  })
  if (tupletRecovery.recovered) {
    events = tupletRecovery.events
  }

  const noteCount = notes.length
  const restCount = detectedRests.length
  const uncertain = noteCount === 0 && restCount === 0
  const confidence =
    noteCount > 0 || restCount > 0
      ? measureConfidenceFromRhythm({ uncertain: false }, notes)
      : 0.45
  const confidenceBreakdown = measureConfidenceBreakdown({ uncertain }, notes)
  const initialBeamStemGraph = buildBeamStemGraph({
    notes,
    events,
    measureBox,
    imageData,
    inkThreshold,
  })
  const eventsBeforeBeamTopology = events
  events = applyVectorPrimaryBeamTopology(events, initialBeamStemGraph)
  if (provenance && events !== eventsBeforeBeamTopology) {
    provenance.recordStage(
      'beam-topology',
      'applyVectorPrimaryBeamTopology',
      eventsBeforeBeamTopology,
      events,
      { reason: 'primary-beam-topology' },
    )
  }
  const beamStemGraph =
    events === eventsBeforeBeamTopology
      ? initialBeamStemGraph
      : buildBeamStemGraph({
          notes,
          events,
          measureBox,
          imageData,
          inkThreshold,
        })
  const beamStemDiagnostics = summarizeBeamStemGraph(beamStemGraph)
  const vectorBeamTopologyDiagnostics =
    summarizeAppliedVectorBeamTopology(events)

  if (provenance) {
    const beamRows = []
    for (const note of notes ?? []) {
      const beams = note.beams ?? 0
      const strength = note.beamStrength ?? 0
      if (beams < 1 && strength < 8) {
        continue
      }
      beamRows.push({
        sourcePathId: note.sourcePathId ?? note.glyphId ?? null,
        geometryClassification:
          beams >= 2 ? 'secondary-or-thicker' : strength >= 8 ? 'primary-beam' : 'weak-tip',
        compatibleStems: note.stem
          ? [{ direction: note.stem.direction ?? note.stem, length: note.stem.length ?? null }]
          : [],
        attachmentScore: strength >= 8 ? Math.min(1, strength / 28) : 0,
        selectedBeamGroup: null,
        beamCount: beams,
        beamStrength: strength,
        beamDerivedType: beamTypeFromCount(beams),
        rejectionReason: beams < 1 ? 'strength-without-count' : null,
        durationOverwrittenLater: false,
        noteMidi: note.midi ?? null,
        cx: note.cx,
        cy: note.cy,
      })
    }
    for (const ownership of beamStemGraph?.eventOwnership ?? []) {
      const conf = Number(ownership?.beamConfidence ?? ownership?.confidence ?? 0)
      beamRows.push({
        sourcePathId: ownership?.attachedBeamIds?.[0] ?? ownership?.beamGroupId ?? null,
        geometryClassification: 'beam-stem-graph',
        compatibleStems: ownership?.attachedStemIds ?? [],
        attachmentScore: conf,
        selectedBeamGroup: ownership?.beamGroupId ?? null,
        beamCount: ownership?.beamCount ?? null,
        beamConfidence: conf,
        rejectionReason:
          conf > 0 && conf < 0.7
            ? 'below-beam-confidence-gate'
            : (ownership?.attachedBeamIds?.length ?? 0) === 0
              ? 'no-attached-beams'
              : null,
        durationOverwrittenLater: false,
      })
    }
    provenance.addBeamCandidates(beamRows)
  }

  const vectorNoteMatching = summarizeMeasureNoteMatching({
    measureNumber: measureBox.measureNumber,
    page: measureBox.page,
    vectorNoteCount: noteCount,
    events,
  })
  const vectorChordDiagnostics = summarizeVectorChordGrouping(events)
  const adjacentSlotChordGroupingDiagnostics = takeAdjacentSlotDiagnostics()
  const vectorRhythmDiagnostics = summarizeVectorRhythmDiagnostics(
    events,
    notes,
    totalDivisions,
  )
  const musicalEventReconstructionDiagnostics =
    summarizeMusicalEventReconstruction(events)
  const noteheadFallbackCalibrationDiagnostics = {
    appliedCount: notes.filter(
      (note) =>
        note.noteheadAnchor?.source === 'self-calibrated-glyph-fallback',
    ).length,
    byInkRejectionReason: notes.reduce((counts, note) => {
      if (note.noteheadAnchor?.source !== 'self-calibrated-glyph-fallback') {
        return counts
      }
      const reason = note.noteheadAnchor.inkRejectedReason ?? 'unknown'
      counts[reason] = (counts[reason] ?? 0) + 1
      return counts
    }, {}),
  }
  let rhythmProvenance = null
  if (provenance) {
    rhythmProvenance = provenance.finalize()
    for (const note of rhythmProvenance.noteDurations ?? []) {
      if (!note.beamDurationOverwrittenLater) {
        continue
      }
      for (const beam of rhythmProvenance.beamCandidates ?? []) {
        if (beam.noteMidi != null && note.midis?.includes(beam.noteMidi)) {
          beam.durationOverwrittenLater = true
        }
      }
    }
  }
  return {
    measureNumber: measureBox.measureNumber,
    page: measureBox.page,
    systemIndex: measureBox.systemIndex,
    events,
    uncertain,
    confidence,
    pitchConfidence: confidenceBreakdown.pitchConfidence,
    rhythmConfidence: confidenceBreakdown.rhythmConfidence,
    vectorNoteCount: noteCount,
    vectorRestGlyphCount: restCount,
    vectorRestDiagnostics: {
      appliedCount:
        notes.length === 0
          ? events.filter((event) => event.type === 'rest' && event.source === 'vector-glyph').length
          : restApplyResult.appliedCount,
      skipped: restApplyResult.skipped,
    },
    vectorStaccatoDiagnostics,
    vectorAccidentalDiagnostics,
    vectorAccentDiagnostics,
    vectorNotationArticulationDiagnostics:
      combinedVectorNotationArticulationDiagnostics,
    noteheadFallbackCalibrationDiagnostics,
    vectorNoteMatching,
    vectorChordDiagnostics,
    adjacentSlotChordGroupingDiagnostics,
    vectorRhythmDiagnostics,
    musicalEventReconstructionDiagnostics,
    beamStemGraph,
    beamStemDiagnostics,
    vectorBeamTopologyDiagnostics,
    ...(rhythmProvenance ? { rhythmProvenance } : {}),
    ...(captureDetectorObservations
      ? { detectorObservations: { noteheads: notes, rests: detectedRests } }
      : {}),
  }
}

function directAccidentalPathCandidateId(candidate) {
  const candidateId = candidate?.candidateId ?? candidate?.pathCandidateId
  if (
    candidate?.source !== 'vector-path' ||
    typeof candidateId !== 'string' ||
    !/(?:^|-)op\d+$/i.test(candidateId) ||
    /cluster/i.test(candidateId) ||
    /cluster/i.test(candidate?.reason ?? '') ||
    Number(candidate?.confidence) <
      ACCIDENTAL_PATH_CALIBRATION_LIMITS.minConfidence
  ) {
    return null
  }
  return candidateId
}

function distinctDirectAccidentalPathCount(pathCandidates = []) {
  return new Set(
    pathCandidates.map(directAccidentalPathCandidateId).filter(Boolean),
  ).size
}

/**
 * Learn page/type engraving distance using only direct vector accidentals and
 * independently trusted notehead anchors. Expected notes and evaluator output
 * never enter this pass.
 */
export function buildPageAccidentalPathCalibration({
  vectorAccidentalPaths = [],
  imageData,
  measureRecordsBySystem = [],
  measureBoxByNumber = new Map(),
  placementByMeasure = new Map(),
} = {}) {
  const samples = []
  const directCandidateCount = distinctDirectAccidentalPathCount(
    vectorAccidentalPaths,
  )

  for (const record of measureRecordsBySystem.flat()) {
    const measureBox = measureBoxByNumber.get(record.measureNumber)
    if (!measureBox) {
      continue
    }
    const placement = placementByMeasure.get(record.measureNumber) ?? {}
    const playableStart =
      (measureBox.playableX0 ?? measureBox.x0) * imageData.width
    const paths = vectorAccidentalPaths.filter(
      (candidate) =>
        directAccidentalPathCandidateId(candidate) &&
        candidate.x >= playableStart - 2 &&
        vectorGlyphInMeasure(candidate, measureBox, imageData, placement),
    )
    const notes = record.detectorObservations?.noteheads ?? []
    for (const candidate of paths) {
      for (const note of notes) {
        const lineYs =
          note.clef === 'treble'
            ? measureBox.staffLines?.treble
            : measureBox.staffLines?.bass
        const gapNorm = staffLineGap(lineYs ?? [])
        const staffGap = gapNorm * imageData.height
        if (!(staffGap > 0)) {
          continue
        }
        const sample = createAccidentalPathCalibrationSample({
          glyph: {
            ...candidate,
            pathCandidateId:
              candidate.pathCandidateId ?? candidate.candidateId,
          },
          note,
          type: candidate.type,
          staffGap,
          imageData,
          measureId: record.measureNumber,
        })
        if (sample) {
          samples.push(sample)
        }
      }
    }
  }

  const calibration = buildAccidentalPathCalibrations(samples)
  return {
    ...calibration,
    diagnostics: {
      scope: 'page-vector-path-type',
      directCandidateCount,
      rawSampleCount: samples.length,
      eligibleSampleCount: calibration.eligibleSampleCount,
      accepted: calibration.accepted,
      rejected: calibration.rejected,
    },
  }
}

export function processVectorPageSystems({
  imageData,
  pageText,
  vectorCurves = [],
  vectorAccidentalPaths = [],
  vectorAugmentationDotPaths = [],
  systems,
  systemMeasureBoxes,
  inheritedKeySignature = null,
  inheritedTimeSignature = null,
  inkThreshold = 170,
  captureDetectorObservations = false,
  enableLocalTupletGroups = true,
}) {
  const glyphs = textGlyphsToImage(pageText, imageData)
  const firstSystemBoxes = systemMeasureBoxes[0] ?? []
  const detectedKeySignature = detectVectorKeySignature(glyphs, imageData, firstSystemBoxes)
  const detectedTimeSignature = detectVectorTimeSignature(glyphs, imageData, firstSystemBoxes)
  const keySignature =
    (detectedKeySignature.confidence ?? 0) > 0
      ? detectedKeySignature
      : inheritedKeySignature ?? detectedKeySignature
  const timeSignature =
    (detectedTimeSignature.confidence ?? 0) > 0
      ? detectedTimeSignature
      : inheritedTimeSignature ?? detectedTimeSignature
  let measureRecordsBySystem = []
  const staffClefsBySystem = new Map()
  const placementByMeasure = new Map()
  const measureBoxByNumber = new Map()
  let noteCount = 0

  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const boxes = systemMeasureBoxes[systemIndex] ?? []
    const staffClefs = detectStaffClefsFromGlyphs(glyphs, imageData, boxes[0]?.staffLines)
    staffClefsBySystem.set(systemIndex, staffClefs)
  }

  const noteheadFallbackCalibration = buildPageNoteheadFallbackCalibration({
    glyphs,
    imageData,
    systems,
    systemMeasureBoxes,
    staffClefsBySystem,
    inkThreshold,
  })
  const directAccidentalPathCount = distinctDirectAccidentalPathCount(
    vectorAccidentalPaths,
  )
  const shouldAttemptAccidentalPathCalibration =
    directAccidentalPathCount >=
    ACCIDENTAL_PATH_CALIBRATION_LIMITS.minDistinctPaths
  const internalCaptureDetectorObservations =
    captureDetectorObservations || shouldAttemptAccidentalPathCalibration

  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const boxes = systemMeasureBoxes[systemIndex] ?? []
    const staffClefs = staffClefsBySystem.get(systemIndex)
    const measures = boxes.map((measureBox, measureIndex) => {
      const measurePlacement = {
        isLastInSystem: measureIndex === boxes.length - 1,
      }
      const enrichedBox = { ...measureBox, staffClefs }
      placementByMeasure.set(measureBox.measureNumber, measurePlacement)
      measureBoxByNumber.set(measureBox.measureNumber, enrichedBox)
      const record = buildVectorMeasureRecord({
        glyphs,
        imageData,
        measureBox: enrichedBox,
        keySignature,
        timeSignature,
        measurePlacement,
        inkThreshold,
        captureDetectorObservations: internalCaptureDetectorObservations,
        vectorAccidentalPaths,
        vectorAugmentationDotPaths,
        noteheadFallbackCalibration,
        enableLocalTupletGroups,
      })
      noteCount += record.vectorNoteCount ?? 0
      return record
    })
    measureRecordsBySystem.push(measures)
  }

  const orphanResult = assignVectorOrphanNoteheads({
    glyphs,
    imageData,
    systemMeasureBoxes,
    staffClefsBySystem,
  })

  for (const [measureNumber, orphanEntries] of orphanResult.assignments) {
    const orphanGlyphs = orphanEntries.map((entry) => entry.glyph)
    const measureBox = measureBoxByNumber.get(measureNumber)
    const measurePlacement = placementByMeasure.get(measureNumber) ?? {}
    if (!measureBox || !orphanGlyphs.length) {
      continue
    }
    for (let systemIndex = 0; systemIndex < measureRecordsBySystem.length; systemIndex += 1) {
      const measureIndex = measureRecordsBySystem[systemIndex].findIndex(
        (record) => record.measureNumber === measureNumber,
      )
      if (measureIndex < 0) {
        continue
      }
      const previous = measureRecordsBySystem[systemIndex][measureIndex]
      const rebuilt = buildVectorMeasureRecord({
        glyphs,
        imageData,
        measureBox,
        keySignature,
        timeSignature,
        measurePlacement,
        orphanGlyphs,
        inkThreshold,
        captureDetectorObservations: internalCaptureDetectorObservations,
        vectorAccidentalPaths,
        vectorAugmentationDotPaths,
        noteheadFallbackCalibration,
        enableLocalTupletGroups,
      })
      noteCount += (rebuilt.vectorNoteCount ?? 0) - (previous.vectorNoteCount ?? 0)
      measureRecordsBySystem[systemIndex][measureIndex] = rebuilt
      break
    }
  }

  let accidentalPathCalibration = {
    models: new Map(),
    eligibleSampleCount: 0,
    accepted: [],
    rejected: [],
    diagnostics: {
      scope: 'page-vector-path-type',
      attempted: false,
      directCandidateCount: directAccidentalPathCount,
      rawSampleCount: 0,
      eligibleSampleCount: 0,
      accepted: [],
      rejected: [],
    },
  }
  if (shouldAttemptAccidentalPathCalibration) {
    accidentalPathCalibration = buildPageAccidentalPathCalibration({
      vectorAccidentalPaths,
      imageData,
      measureRecordsBySystem,
      measureBoxByNumber,
      placementByMeasure,
    })
    accidentalPathCalibration.diagnostics.attempted = true
  }

  if (accidentalPathCalibration.models.size > 0) {
    noteCount = 0
    measureRecordsBySystem = systemMeasureBoxes.map((boxes) =>
      boxes.map((measureBox) => {
        const enrichedBox = measureBoxByNumber.get(measureBox.measureNumber)
        const measurePlacement =
          placementByMeasure.get(measureBox.measureNumber) ?? {}
        const orphanGlyphs =
          orphanResult.assignments
            .get(measureBox.measureNumber)
            ?.map((entry) => entry.glyph) ?? []
        const record = buildVectorMeasureRecord({
          glyphs,
          imageData,
          measureBox: enrichedBox,
          keySignature,
          timeSignature,
          measurePlacement,
          orphanGlyphs,
          inkThreshold,
          captureDetectorObservations,
          vectorAccidentalPaths,
          vectorAugmentationDotPaths,
          noteheadFallbackCalibration,
          accidentalPathCalibration,
          enableLocalTupletGroups,
        })
        noteCount += record.vectorNoteCount ?? 0
        return record
      }),
    )
  } else if (!captureDetectorObservations) {
    for (const record of measureRecordsBySystem.flat()) {
      delete record.detectorObservations
    }
  }

  const flatRecords = measureRecordsBySystem.flat()
  const orphanDiagnostics = orphanResult.diagnostics
  const measureBoxByNumberForTies = new Map(
    systemMeasureBoxes.flat().map((measureBox) => [measureBox.measureNumber, measureBox]),
  )
  const tieResult = applyVectorPageTies({
    measureRecords: flatRecords,
    measureBoxByNumber: measureBoxByNumberForTies,
    glyphs,
    vectorCurves,
    imageData,
    inkThreshold,
  })

  return {
    measureRecordsBySystem,
    keySignature,
    timeSignature,
    noteCount,
    source: 'vector-glyphs',
    orphanDiagnostics,
    tieDiagnostics: tieResult.diagnostics,
    restDiagnostics: summarizeVectorRestDiagnostics(flatRecords),
    staccatoDiagnostics: summarizeVectorStaccatoDiagnostics(flatRecords),
    accentDiagnostics: summarizeVectorAccentDiagnostics(flatRecords),
    notationArticulationDiagnostics:
      summarizeVectorNotationArticulationDiagnostics(flatRecords),
    noteheadFallbackCalibrationDiagnostics: {
      ...noteheadFallbackCalibration.diagnostics,
      appliedCount: flatRecords.reduce(
        (sum, record) =>
          sum +
          (record.noteheadFallbackCalibrationDiagnostics?.appliedCount ?? 0),
        0,
      ),
      byInkRejectionReason: flatRecords.reduce((counts, record) => {
        for (const [reason, count] of Object.entries(
          record.noteheadFallbackCalibrationDiagnostics
            ?.byInkRejectionReason ?? {},
        )) {
          counts[reason] = (counts[reason] ?? 0) + count
        }
        return counts
      }, {}),
    },
    accidentalPathCalibrationDiagnostics: {
      ...accidentalPathCalibration.diagnostics,
      appliedCount: flatRecords.reduce(
        (sum, record) =>
          sum +
          (record.vectorAccidentalDiagnostics?.selectedAttachments ?? []).filter(
            (attachment) => attachment.pathCalibration,
          ).length,
        0,
      ),
    },
  }
}

export { systemConfidenceFromMeasures }
