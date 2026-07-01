import { measureConfidenceFromRhythm, systemConfidenceFromMeasures } from './buildOmrDiagnostics.js'
import { restsForMeasure, summarizeVectorRestDiagnostics, insertMixedMeasureRests, buildEmptyMeasureRestEvents } from './detectVectorRests.js'
import { assignVectorStaccato, summarizeVectorStaccatoDiagnostics } from './detectVectorStaccato.js'
import { assignVectorAccent, summarizeVectorAccentDiagnostics } from './detectVectorAccent.js'
import { applyVectorPageTies } from './detectVectorTies.js'
import {
  OMR_CHORD_MERGE_X,
  OMR_DIVISIONS_PER_QUARTER,
  OMR_DURATION_DIVISIONS,
} from './omrRhythmConstants.js'
import {
  detectStaffClefsFromGlyphs,
  midiToWrittenPitch,
  resolveNoteheadYNorm,
  resolvePitchFromGrandStaff,
} from './pitchFromStaffPosition.js'
import {
  accidentalStateKey,
  assignLocalAccidentals,
  resolveNotePitchWithMeasureState,
} from './omrPitchAlteration.js'
import { dedupeNoteheads } from './omrNoteDedupe.js'
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
  reconstructMusicalEvents,
  summarizeMusicalEventReconstruction,
} from './reconstructMusicalEvents.js'
import {
  buildBeamStemGraph,
  summarizeBeamStemGraph,
} from './beamStemReconstructionDiagnostics.js'

const NOTEHEAD_GLYPHS = new Set(['\ue0a3', '\ue0a4'])
const SHARP_GLYPH = '\ue262'
const NATURAL_GLYPH = '\ue261'
const FLAT_GLYPH = '\ue260'
const ACCIDENTAL_GLYPHS = new Map([
  [SHARP_GLYPH, { alter: 1, type: 'sharp' }],
  [NATURAL_GLYPH, { alter: 0, type: 'natural' }],
  [FLAT_GLYPH, { alter: -1, type: 'flat' }],
])
const TIME_DIGIT_GLYPHS = {
  '\ue083': 3,
  '\ue084': 4,
}
const VECTOR_MIN_NOTEHEADS = 12

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
    for (let index = 0; index < text.length; index += 1) {
      const textX = item.x + charWidth * (index + 0.5)
      glyphs.push({
        text: text[index],
        x: textX * scaleX,
        y: imageData.height - item.y * scaleY,
        width: charWidth * scaleX,
        height: (item.height ?? 0) * scaleY,
        fontName: item.fontName ?? '',
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
    const yNorm =
      resolveNoteheadYNorm(glyph, imageData, roughMapping.lineYs) ?? yRough
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
      cx: glyph.x,
      cy: glyph.y,
      xNorm,
      yNorm,
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
  const localAccidentals = assignLocalAccidentals(
    measureAccidentalGlyphs,
    imageData,
    measureBox,
    sortedNotes,
    ACCIDENTAL_GLYPHS,
  )
  const staccatoResult = assignVectorStaccato(glyphs, sortedNotes, measureBox, imageData)
  const accentResult = assignVectorAccent(glyphs, sortedNotes, measureBox, imageData)
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
      const resolved = resolveNotePitchWithMeasureState({
        naturalMidi: note.naturalMidi,
        keySignature,
        localAccidental,
        carriedAlter: accidentalState.has(stateKey) ? accidentalState.get(stateKey) : null,
      })
      if (resolved.measureAccidentalState != null) {
        accidentalState.set(stateKey, resolved.measureAccidentalState)
      }

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
            }
          : null,
        articulation: staccatoResult.assignments.get(index) ?? null,
        accentArticulation: accentResult.assignments.get(index) ?? null,
      }
      return imageData?.data?.length
        ? enrichNoteheadRhythm(imageData, withPitch, measureBox, inkThreshold, rhythmBounds)
        : withPitch
    })
  return {
    notes: mappedNotes,
    vectorStaccatoDiagnostics: {
      detectedStaccatoCount: staccatoResult.detectedStaccatoCount,
      appliedStaccatoCount: staccatoResult.appliedStaccatoCount,
    },
    vectorAccentDiagnostics: {
      detectedAccentCount: accentResult.detectedAccentCount,
      appliedAccentCount: accentResult.appliedAccentCount,
    },
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
  return Math.max(OMR_CHORD_MERGE_X, Math.min(28, slotWidthPx * 2.2))
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
        return false
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

function sameStartTrebleDuration(trebleNote, bassNote, events, extended, totalDivisions) {
  if (hasPenultimateClosingFigure(events)) {
    const closingNote = events[events.length - 1]?.notes?.[0]
    if (
      closesOnFinalBeat(events, totalDivisions) &&
      closingNote &&
      writtenStep(closingNote.midi) === writtenStep(trebleNote.midi)
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

function groupIncludesClef(group, clef) {
  return (group.notes ?? []).some((note) => (note.clef ?? 'treble') === clef)
}

function nextSameClefRhythmStart(groups, index, rhythmStarts, totalDivisions) {
  const clef = noteClefFromNotes(groups[index]?.notes)
  for (let offset = index + 1; offset < groups.length; offset += 1) {
    if (groupIncludesClef(groups[offset], clef)) {
      return rhythmStarts[offset]
    }
  }
  return totalDivisions
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
  if (globalDuration <= OMR_DURATION_DIVISIONS.eighth + 1) {
    return false
  }
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
  if (!hasBeamEvidenceForNotes(notes)) {
    return null
  }
  let cap = OMR_DIVISIONS_PER_QUARTER
  for (const note of notes ?? []) {
    if ((note.beamStrength ?? 0) >= 14) {
      cap = Math.min(cap, OMR_DURATION_DIVISIONS.sixteenth)
    } else if ((note.beams ?? 0) >= 1 || (note.beamStrength ?? 0) >= 8) {
      cap = Math.min(cap, OMR_DURATION_DIVISIONS.eighth)
    }
  }
  return cap
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
        ...durationMeta(durationDivisions),
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
        ...durationMeta(durationDivisions),
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
        ...durationMeta(durationDivisions),
        sameClefBeatQuarterAdjusted: true,
      }
    }),
  )
}

/**
 * Cap gap-stretched events when ink evidence shows a beamed subdivision.
 */
export function refineEventDurationsFromBeamEvidence(events, totalDivisions = 16) {
  return sortVectorRhythmEvents(
    events.map((event) => {
      if (event.type !== 'note') {
        return event
      }
      const start = event.startDivision ?? 0
      const beamCap = inferredBeamDurationCap(event.notes)
      if (beamCap == null || (event.durationDivisions ?? 0) <= beamCap) {
        return event
      }
      const duration = Math.min(beamCap, Math.max(1, totalDivisions - start))
      return {
        ...event,
        durationDivisions: duration,
        ...durationMeta(duration),
        beamDurationAdjusted: true,
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
        ...durationMeta(durationDivisions),
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
        ...durationMeta(durationDivisions),
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
 * Snap a raw division span to the nearest standard note value. Vector glyphs
 * carry no stem/flag information, so duration is inferred from the horizontal
 * gap to the next onset (see buildVectorEvents) and then quantised here.
 */
export function durationMeta(durationDivisions) {
  let best = VECTOR_DURATION_LADDER[VECTOR_DURATION_LADDER.length - 1]
  let bestDiff = Infinity
  for (const candidate of VECTOR_DURATION_LADDER) {
    const diff = Math.abs(candidate.divisions - durationDivisions)
    if (diff < bestDiff || (diff === bestDiff && candidate.divisions < best.divisions)) {
      bestDiff = diff
      best = candidate
    }
  }
  return { durationType: best.durationType, dotted: best.dotted }
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
  const extended = Math.min(
    totalDivisions,
    sameStart
      ? OMR_DURATION_DIVISIONS.half + OMR_DIVISIONS_PER_QUARTER
      : peerStart + OMR_DURATION_DIVISIONS.half,
  )
  if (extended <= first.durationDivisions) {
    return events
  }
  const updated = [
    { ...first, durationDivisions: extended, ...durationMeta(extended) },
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
      ...durationMeta(trebleDuration),
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
        ...durationMeta(halfDivisions),
      }
    }
    if (index === adjusted.length - 1) {
      return {
        ...event,
        durationDivisions: OMR_DIVISIONS_PER_QUARTER,
        ...durationMeta(OMR_DIVISIONS_PER_QUARTER),
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
  if (!denseMeasure) {
    return snapStartDivision(raw, totalDivisions)
  }
  const grid = Math.max(1, OMR_DIVISIONS_PER_QUARTER / 4)
  const clamped = Math.max(0, Math.min(totalDivisions - 1, raw))
  return Math.max(0, Math.min(totalDivisions - 1, Math.round(clamped / grid) * grid))
}

function alignOpeningGroupStart(starts, groups, beats, usePositionStarts) {
  if (!usePositionStarts || !starts.length || !groups.length) {
    return starts
  }
  const grid = Math.max(1, OMR_DIVISIONS_PER_QUARTER / 2)
  const openingFraction = 1 / Math.max(1, beats)
  const firstPosition =
    groups[0]?.positionInMeasure ?? groups[0]?.notes?.[0]?.positionInMeasure ?? null
  if (
    starts[0] > 0 &&
    starts[0] <= grid &&
    Number.isFinite(firstPosition) &&
    firstPosition < openingFraction * 0.55
  ) {
    return [0, ...starts.slice(1)]
  }
  return starts
}

function dedupeNotesByMidi(notes = []) {
  return dedupeNoteheads(notes)
}

/**
 * Merge same-onset, same-clef fragments that share duration into one chord event.
 */
export function coalesceSameOnsetChordEvents(events) {
  const rests = events.filter((event) => event.type === 'rest')
  const buckets = new Map()
  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    const start = event.startDivision ?? 0
    const clef = event.notes?.[0]?.clef ?? 'treble'
    const duration = event.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER
    const cxBucket = Math.round(average((event.notes ?? []).map((note) => note.cx)) / 20)
    const key = `${start}:${clef}:${duration}:${cxBucket}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        ...event,
        notes: dedupeNotesByMidi(event.notes ?? []),
      })
      continue
    }
    const bucket = buckets.get(key)
    bucket.notes = dedupeNotesByMidi([...(bucket.notes ?? []), ...(event.notes ?? [])])
    bucket.cx = average(bucket.notes.map((note) => note.cx))
  }
  return sortVectorRhythmEvents([...rests, ...buckets.values()])
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
      ...durationMeta(clamped),
      durationClamped: true,
    }
  })
}

function buildNoteEventsFromGroups(groups, measureBox, timeSignature, totalDivisions, beats) {
  const usePositionStarts = shouldInferRhythmFromPositions(groups, beats)
  const denseMeasure = groups.length > beats

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
  const starts = alignOpeningGroupStart(rhythmStarts, groups, beats, usePositionStarts)

  let events = splitMixedClefEvents(
    groups.map((group, index) => {
      const startDivision = starts[index]
      const rhythmStart = rhythmStarts[index]
      const nextRhythmStart =
        index + 1 < rhythmStarts.length ? rhythmStarts[index + 1] : totalDivisions
      let durationDivisions = Math.max(1, nextRhythmStart - rhythmStart)
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
      const meta = durationMeta(durationDivisions)
      const positionInMeasure =
        groupAnchorPosition(group) ?? startDivision / totalDivisions
      return {
        type: 'note',
        startDivision,
        durationDivisions,
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
  events = extendDurationsPerClefVoice(events, totalDivisions)
  if (denseMeasure) {
    events = refineEventDurationsFromBeamEvidence(events, totalDivisions)
  }
  events = coalesceSameOnsetChordEvents(events)
  events = extendCombinedGrandStaffOpening(events, totalDivisions)
  events = extendPenultimateHalfBeforeFinalQuarter(events, timeSignature, totalDivisions)
  events = refineUnsupportedUpperChordOverhangs(events)
  events = refineOpeningBassSubdivisionDurations(events, totalDivisions)
  events = reconstructMusicalEvents(events, { totalDivisions })
  events = applySameClefBeatQuarterFloors(events, totalDivisions)
  return clampMeasureEventDurations(events, totalDivisions)
}

export function buildVectorEvents(notes, measureBox, timeSignature, { rests = [] } = {}) {
  const beats = timeSignature?.beats ?? 4
  const groups = mergeGroupsSharingBeat(groupVectorNoteheads(notes, { beats }), beats)
  const totalDivisions = Math.round(beats * OMR_DIVISIONS_PER_QUARTER * (4 / (timeSignature?.beatType ?? 4)))
  if (!groups.length && !rests.length) {
    return [
      {
        type: 'rest',
        startDivision: 0,
        durationDivisions: totalDivisions,
        durationType: beats === 3 ? 'half' : 'whole',
        dotted: beats === 3,
        confidence: 0.5,
        uncertain: true,
        measureNumber: measureBox.measureNumber,
        page: measureBox.page,
      },
    ]
  }

  if (!groups.length && rests.length) {
    return buildEmptyMeasureRestEvents(rests, measureBox, totalDivisions)
  }

  const noteEvents = buildNoteEventsFromGroups(groups, measureBox, timeSignature, totalDivisions, beats)
  if (!rests.length) {
    return noteEvents
  }

  return insertMixedMeasureRests(noteEvents, rests, { measureBox, totalDivisions }).events
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
}) {
  const { notes, vectorStaccatoDiagnostics, vectorAccentDiagnostics } = noteheadsForMeasure(
    glyphs,
    imageData,
    measureBox,
    keySignature,
    measurePlacement,
    orphanGlyphs,
    inkThreshold,
  )
  const detectedRests = restsForMeasure(glyphs, imageData, measureBox, notes)
  const beats = timeSignature?.beats ?? 4
  const totalDivisions = Math.round(
    beats * OMR_DIVISIONS_PER_QUARTER * (4 / (timeSignature?.beatType ?? 4)),
  )

  let events
  let restApplyResult = { appliedCount: 0, skipped: [] }
  if (notes.length === 0) {
    events = buildVectorEvents(notes, measureBox, timeSignature, { rests: detectedRests })
  } else if (!detectedRests.length) {
    events = buildVectorEvents(notes, measureBox, timeSignature)
  } else {
    const noteEvents = buildVectorEvents(notes, measureBox, timeSignature, { rests: [] })
    restApplyResult = insertMixedMeasureRests(noteEvents, detectedRests, {
      measureBox,
      totalDivisions,
    })
    events = restApplyResult.events
  }

  const noteCount = notes.length
  const restCount = detectedRests.length
  const uncertain = noteCount === 0 && restCount === 0
  const confidence =
    noteCount > 0 || restCount > 0
      ? measureConfidenceFromRhythm({ uncertain: false }, notes)
      : 0.45
  const vectorNoteMatching = summarizeMeasureNoteMatching({
    measureNumber: measureBox.measureNumber,
    page: measureBox.page,
    vectorNoteCount: noteCount,
    events,
  })
  const vectorChordDiagnostics = summarizeVectorChordGrouping(events)
  const vectorRhythmDiagnostics = summarizeVectorRhythmDiagnostics(events, notes, totalDivisions)
  const musicalEventReconstructionDiagnostics = summarizeMusicalEventReconstruction(events)
  const beamStemGraph = buildBeamStemGraph({
    notes,
    events,
    measureBox,
    imageData,
    inkThreshold,
  })
  const beamStemDiagnostics = summarizeBeamStemGraph(beamStemGraph)
  return {
    measureNumber: measureBox.measureNumber,
    page: measureBox.page,
    systemIndex: measureBox.systemIndex,
    events,
    uncertain,
    confidence,
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
    vectorAccentDiagnostics,
    vectorNoteMatching,
    vectorChordDiagnostics,
    vectorRhythmDiagnostics,
    musicalEventReconstructionDiagnostics,
    beamStemGraph,
    beamStemDiagnostics,
  }
}

export function processVectorPageSystems({
  imageData,
  pageText,
  systems,
  systemMeasureBoxes,
  inheritedKeySignature = null,
  inheritedTimeSignature = null,
  inkThreshold = 170,
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
  const measureRecordsBySystem = []
  const staffClefsBySystem = new Map()
  const placementByMeasure = new Map()
  const measureBoxByNumber = new Map()
  let noteCount = 0

  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const boxes = systemMeasureBoxes[systemIndex] ?? []
    const staffClefs = detectStaffClefsFromGlyphs(glyphs, imageData, boxes[0]?.staffLines)
    staffClefsBySystem.set(systemIndex, staffClefs)
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
      })
      noteCount += (rebuilt.vectorNoteCount ?? 0) - (previous.vectorNoteCount ?? 0)
      measureRecordsBySystem[systemIndex][measureIndex] = rebuilt
      break
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
  }
}

export { systemConfidenceFromMeasures }
