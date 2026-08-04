import { applyAlterToMidi, distanceToNearestStaffLine, midiToWrittenPitch } from './pitchFromStaffPosition.js'
import {
  accidentalPathHorizontalResidual,
  lookupAccidentalPathCalibration,
} from './accidentalPathCalibration.js'

const SHARP_STEPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_STEPS = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

export function applyKeySignature(midi, fifths) {
  if (!Number.isFinite(midi) || !Number.isFinite(fifths) || fifths === 0) {
    return { midi, alter: null, source: 'none' }
  }
  const pitch = midiToWrittenPitch(midi)
  if (fifths > 0 && SHARP_STEPS.slice(0, fifths).includes(pitch.step)) {
    return { midi: applyAlterToMidi(midi, 1), alter: 1, source: 'key-signature' }
  }
  if (fifths < 0 && FLAT_STEPS.slice(0, Math.abs(fifths)).includes(pitch.step)) {
    return { midi: applyAlterToMidi(midi, -1), alter: -1, source: 'key-signature' }
  }
  return { midi, alter: null, source: 'none' }
}

export function accidentalStateKey(note) {
  const pitch = midiToWrittenPitch(note.naturalMidi)
  return `${note.clef}:${pitch.step}${pitch.octave}`
}

/**
 * Resolve written pitch with key signature, local accidentals, and measure carry.
 * Sharps/flats apply relative to the key-default pitch at that staff step.
 */
export function resolveMeasureNotePitch({
  naturalMidi,
  keySignature = null,
  localAccidental = null,
  carriedState = null,
}) {
  const fifths = keySignature?.fifths ?? 0
  const keyed = applyKeySignature(naturalMidi, fifths)
  const written = midiToWrittenPitch(naturalMidi)

  if (localAccidental) {
    if (localAccidental.alter === 0) {
      return {
        midi: naturalMidi,
        alter: null,
        pitchAlteration: {
          writtenPitch: written,
          naturalMidi,
          keySignatureFifths: fifths,
          keyAlteration: keyed.source === 'key-signature' ? keyed.alter : null,
          localAccidental: localAccidental.type ?? 'natural',
          localAccidentalAlter: 0,
          accidentalSource:
            localAccidental.glyph?.source === 'vector-path' ||
            localAccidental.glyph?.source === 'vector-ink'
              ? localAccidental.glyph.source
              : localAccidental.glyph
                ? 'vector-glyph'
                : 'explicit',
          measureAccidentalState: { mode: 'natural' },
        },
        accidentalState: { mode: 'natural' },
      }
    }
    const midi = applyAlterToMidi(keyed.midi, localAccidental.alter)
    return {
      midi,
      alter: localAccidental.alter,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyDefaultMidi: keyed.midi,
        keyAlteration: keyed.source === 'key-signature' ? keyed.alter : null,
        localAccidental: localAccidental.type ?? (localAccidental.alter > 0 ? 'sharp' : 'flat'),
        localAccidentalAlter: localAccidental.alter,
        accidentalSource:
          localAccidental.glyph?.source === 'vector-path' ||
          localAccidental.glyph?.source === 'vector-ink'
            ? localAccidental.glyph.source
            : localAccidental.glyph
              ? 'vector-glyph'
              : 'explicit',
        measureAccidentalState: { mode: 'explicit', alter: localAccidental.alter },
      },
      accidentalState: { mode: 'explicit', alter: localAccidental.alter },
    }
  }

  if (carriedState?.mode === 'natural') {
    return {
      midi: naturalMidi,
      alter: null,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyAlteration: null,
        localAccidental: null,
        measureAccidentalState: carriedState,
      },
      accidentalState: carriedState,
    }
  }

  if (carriedState?.mode === 'explicit') {
    const midi = applyAlterToMidi(keyed.midi, carriedState.alter)
    return {
      midi,
      alter: carriedState.alter,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyDefaultMidi: keyed.midi,
        keyAlteration: keyed.source === 'key-signature' ? keyed.alter : null,
        localAccidental: null,
        measureAccidentalState: carriedState,
      },
      accidentalState: carriedState,
    }
  }

  return {
    midi: keyed.midi,
    alter: keyed.alter,
    pitchAlteration: {
      writtenPitch: written,
      naturalMidi,
      keySignatureFifths: fifths,
      keyAlteration: keyed.source === 'key-signature' ? keyed.alter : null,
      localAccidental: null,
      measureAccidentalState: null,
    },
    accidentalState: null,
  }
}

/**
 * Resolve pitch with key signature, local glyph accidentals, and measure carry.
 * Local accidentals apply to the written natural pitch; carried accidentals apply
 * relative to the key-default pitch so repeated chromatic spellings stay correct.
 */
export function resolveNotePitchWithMeasureState({
  naturalMidi,
  keySignature = null,
  localAccidental = null,
  carriedAlter = null,
}) {
  const fifths = keySignature?.fifths ?? 0
  const keyedDefault = applyKeySignature(naturalMidi, fifths)
  const written = midiToWrittenPitch(naturalMidi)

  if (localAccidental) {
    if (localAccidental.alter === 0) {
      return {
        midi: naturalMidi,
        alter: null,
        measureAccidentalState: 0,
        pitchAlteration: {
          writtenPitch: written,
          naturalMidi,
          keySignatureFifths: fifths,
          keyDefaultMidi: keyedDefault.midi,
          keyAlteration: keyedDefault.alter,
          localAccidental: localAccidental.type ?? 'natural',
          localAccidentalAlter: 0,
          accidentalSource:
            localAccidental.glyph?.source === 'vector-path' ||
            localAccidental.glyph?.source === 'vector-ink'
              ? localAccidental.glyph.source
              : localAccidental.glyph
                ? 'vector-glyph'
                : 'explicit',
          measureAccidentalState: 0,
        },
      }
    }
    return {
      midi: applyAlterToMidi(naturalMidi, localAccidental.alter),
      alter: localAccidental.alter,
      measureAccidentalState: localAccidental.alter,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyDefaultMidi: keyedDefault.midi,
        keyAlteration: keyedDefault.alter,
        localAccidental: localAccidental.type ?? (localAccidental.alter > 0 ? 'sharp' : 'flat'),
        localAccidentalAlter: localAccidental.alter,
        accidentalSource:
          localAccidental.glyph?.source === 'vector-path' ||
          localAccidental.glyph?.source === 'vector-ink'
            ? localAccidental.glyph.source
            : localAccidental.glyph
              ? 'vector-glyph'
              : 'explicit',
        measureAccidentalState: localAccidental.alter,
      },
    }
  }

  if (carriedAlter != null) {
    if (carriedAlter === 0) {
      return {
        midi: naturalMidi,
        alter: null,
        measureAccidentalState: 0,
        pitchAlteration: {
          writtenPitch: written,
          naturalMidi,
          keySignatureFifths: fifths,
          keyDefaultMidi: keyedDefault.midi,
          keyAlteration: null,
          localAccidental: null,
          measureAccidentalState: 0,
        },
      }
    }
    return {
      midi: applyAlterToMidi(keyedDefault.midi, carriedAlter),
      alter: carriedAlter,
      measureAccidentalState: carriedAlter,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyDefaultMidi: keyedDefault.midi,
        keyAlteration: keyedDefault.alter,
        localAccidental: null,
        measureAccidentalState: carriedAlter,
      },
    }
  }

  return {
    midi: keyedDefault.midi,
    alter: keyedDefault.alter,
    measureAccidentalState: null,
    pitchAlteration: {
      writtenPitch: written,
      naturalMidi,
      keySignatureFifths: fifths,
      keyDefaultMidi: keyedDefault.midi,
      keyAlteration: keyedDefault.alter,
      localAccidental: null,
      measureAccidentalState: null,
    },
  }
}

function staffGapPixels(lineYs, imageData) {
  if (!lineYs?.length || !imageData?.height) {
    return 10
  }
  const sorted = [...lineYs].sort((a, b) => a - b)
  return Math.max(4, ((sorted[sorted.length - 1] - sorted[0]) / 4) * imageData.height)
}

const TRUSTED_OPTICAL_NOTEHEAD_SOURCES = new Set([
  'ink-notehead-geometry',
  'ledger-masked-ink-notehead-geometry',
  'self-calibrated-glyph-fallback',
])
const MIN_TRUSTED_OPTICAL_NOTEHEAD_CONFIDENCE = 0.8

function trustedOpticalNoteheadAnchor(note) {
  const anchor = note?.noteheadAnchor
  if (!Number.isFinite(note?.yNorm)) {
    return null
  }
  if (anchor?.calibration) {
    return {
      source: anchor.source ?? 'self-calibrated-glyph-fallback',
      confidence: Number(anchor.confidence ?? anchor.calibration.confidence ?? 1),
    }
  }
  if (
    !TRUSTED_OPTICAL_NOTEHEAD_SOURCES.has(anchor?.source) ||
    Number(anchor?.confidence) < MIN_TRUSTED_OPTICAL_NOTEHEAD_CONFIDENCE
  ) {
    return null
  }
  return {
    source: anchor.source,
    confidence: Number(anchor.confidence),
  }
}

function accidentalAnchorDetails(
  note,
  imageData,
  { useTrustedOptical = false } = {},
) {
  const trustedAnchor = trustedOpticalNoteheadAnchor(note)
  const hasCalibratedAnchor = Boolean(note?.noteheadAnchor?.calibration)
  const usesOpticalAnchor =
    hasCalibratedAnchor || (useTrustedOptical && Boolean(trustedAnchor))
  return {
    y:
      usesOpticalAnchor && Number.isFinite(note?.yNorm)
        ? note.yNorm * imageData.height
        : note?.cy,
    source: usesOpticalAnchor
      ? trustedAnchor?.source ?? 'self-calibrated-glyph-fallback'
      : 'glyph-origin',
    confidence: usesOpticalAnchor ? trustedAnchor?.confidence ?? null : null,
    usesOpticalAnchor,
  }
}

function directVectorPathAccidental(glyph) {
  const pathId = glyph?.pathCandidateId ?? glyph?.candidateId
  return Boolean(
    glyph?.source === 'vector-path' &&
      typeof pathId === 'string' &&
      /(?:^|-)op\d+$/i.test(pathId) &&
      !/cluster/i.test(pathId) &&
      !/cluster/i.test(glyph?.reason ?? ''),
  )
}

export function accidentalMatchWindow(measureBox, lineYs, imageData) {
  const staffGap = staffGapPixels(lineYs, imageData)
  const maxDx = Math.max(24, staffGap * 3.2)
  const playableStart = (measureBox.playableX0 ?? measureBox.x0) * imageData.width
  return {
    maxDx,
    maxDy: Math.max(10, staffGap * 2.4),
    minX: Math.max(measureBox.x0 * imageData.width, playableStart - maxDx),
  }
}

function accidentalMatchResult(
  note,
  glyph,
  window,
  lineYs,
  imageData,
  {
    accidentalPathCalibration = null,
    accidentalType = glyph?.accidentalType ?? null,
  } = {},
) {
  const dx = note.cx - glyph.x
  if (dx <= 0 || dx > window.maxDx) {
    return null
  }
  const staffGap = staffGapPixels(lineYs, imageData)
  const pathModel =
    directVectorPathAccidental(glyph) && trustedOpticalNoteheadAnchor(note)
    ? lookupAccidentalPathCalibration(
        accidentalPathCalibration,
        accidentalType,
      )
    : null
  const anchorDetails = accidentalAnchorDetails(note, imageData, {
    useTrustedOptical: true,
  })
  const noteAnchorY = anchorDetails.y
  const dy = Math.abs(noteAnchorY - glyph.y)
  if (dy > window.maxDy) {
    return null
  }
  const noteLineDist = distanceToNearestStaffLine(note.yNorm, lineYs) * imageData.height
  const glyphLineDist =
    distanceToNearestStaffLine(glyph.y / imageData.height, lineYs) * imageData.height
  const lineMismatch = Math.abs(noteLineDist - glyphLineDist)

  if (pathModel) {
    const boundsX1 = Number(glyph?.bounds?.x1)
    const horizontal = accidentalPathHorizontalResidual({
      noteX: note.cx,
      glyphX: glyph.x,
      staffGap,
      type: accidentalType,
      calibration: accidentalPathCalibration,
    })
    if (
      !Number.isFinite(boundsX1) ||
      boundsX1 >= note.cx ||
      dy > staffGap * 0.32 ||
      !horizontal ||
      horizontal.residualSpaces > 0.35
    ) {
      return null
    }
    return {
      score:
        pathModel.preferredDxSpaces * staffGap +
        horizontal.residualPixels +
        dy * 2.5 +
        lineMismatch * 5,
      pathCalibration: {
        source: 'page-vector-path-offset',
        type: accidentalType,
        preferredDxSpaces: pathModel.preferredDxSpaces,
        observedDxSpaces: horizontal.dxSpaces,
        residualSpaces: horizontal.residualSpaces,
        confidence: pathModel.confidence,
      },
      noteAnchorY,
      noteAnchorSource: anchorDetails.source,
      noteAnchorConfidence: anchorDetails.confidence,
      verticalResidualPixels: dy,
    }
  }

  return {
    score: dx + dy * 2.5 + lineMismatch * 5,
    pathCalibration: null,
    noteAnchorY,
    noteAnchorSource: anchorDetails.source,
    noteAnchorConfidence: anchorDetails.confidence,
    verticalResidualPixels: dy,
  }
}

export function accidentalMatchScore(
  note,
  glyph,
  window,
  lineYs,
  imageData,
  options = {},
) {
  return accidentalMatchResult(
    note,
    glyph,
    window,
    lineYs,
    imageData,
    options,
  )?.score ?? null
}

export function assignLocalAccidentals(
  glyphs,
  imageData,
  measureBox,
  notes,
  accidentalGlyphs,
  { accidentalPathCalibration = null } = {},
) {
  const candidates = []

  for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
    const glyph = glyphs[glyphIndex]
    const accidental = accidentalGlyphs.get(glyph.text)
    if (!accidental) {
      continue
    }

    for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
      const note = notes[noteIndex]
      const lineYs =
        note.clef === 'treble' ? measureBox.staffLines.treble : measureBox.staffLines.bass
      const window = accidentalMatchWindow(measureBox, lineYs, imageData)
      if (glyph.x < window.minX) {
        continue
      }
      const match = accidentalMatchResult(
        note,
        glyph,
        window,
        lineYs,
        imageData,
        {
          accidentalPathCalibration,
          accidentalType: accidental.type,
        },
      )
      if (!match) {
        continue
      }
      candidates.push({
        glyphIndex,
        noteIndex,
        score: match.score,
        pathCalibration: match.pathCalibration,
        noteAnchorY: match.noteAnchorY,
        noteAnchorSource: match.noteAnchorSource,
        noteAnchorConfidence: match.noteAnchorConfidence,
        verticalResidualPixels: match.verticalResidualPixels,
        accidental,
        glyph,
      })
    }
  }

  candidates.sort((left, right) => left.score - right.score)
  const assignments = new Map()
  const usedGlyphs = new Set()
  const usedNotes = new Set()

  for (const candidate of candidates) {
    if (usedGlyphs.has(candidate.glyphIndex) || usedNotes.has(candidate.noteIndex)) {
      continue
    }
    usedGlyphs.add(candidate.glyphIndex)
    usedNotes.add(candidate.noteIndex)
    assignments.set(candidate.noteIndex, {
      ...candidate.accidental,
      glyph: candidate.glyph,
      score: candidate.score,
      confidence: 0.9,
      pathCalibration: candidate.pathCalibration,
      noteAnchorY: candidate.noteAnchorY,
      noteAnchorSource: candidate.noteAnchorSource,
      noteAnchorConfidence: candidate.noteAnchorConfidence,
      verticalResidualPixels: candidate.verticalResidualPixels,
    })
  }

  assignments.diagnostics = {
    detectedCandidates: candidates.map((candidate) => ({
      glyphIndex: candidate.glyphIndex,
      noteIndex: candidate.noteIndex,
      score: Number(candidate.score.toFixed(2)),
      type: candidate.accidental.type,
      alter: candidate.accidental.alter,
      pathCalibration: candidate.pathCalibration,
      verticalResidualPixels: candidate.verticalResidualPixels,
      glyph: {
        text: candidate.glyph.text,
        x: candidate.glyph.x,
        y: candidate.glyph.y,
        fontName: candidate.glyph.fontName ?? null,
        source: candidate.glyph.source ?? null,
        candidateId:
          candidate.glyph.pathCandidateId ?? candidate.glyph.candidateId ?? null,
        reason: candidate.glyph.reason ?? null,
        bounds: candidate.glyph.bounds ?? null,
      },
      note: {
        measureNumber: notes[candidate.noteIndex]?.measureNumber ?? null,
        clef: notes[candidate.noteIndex]?.clef ?? null,
        naturalMidi: notes[candidate.noteIndex]?.naturalMidi ?? null,
        cx: notes[candidate.noteIndex]?.cx ?? null,
        cy: notes[candidate.noteIndex]?.cy ?? null,
        anchorY: candidate.noteAnchorY ?? null,
        anchorSource: candidate.noteAnchorSource,
        anchorConfidence: candidate.noteAnchorConfidence,
      },
    })),
    selectedAttachments: [...assignments.entries()].map(
      ([noteIndex, accidental]) => ({
        noteIndex,
        type: accidental.type,
        alter: accidental.alter,
        score: Number(accidental.score.toFixed(2)),
        pathCalibration: accidental.pathCalibration,
        verticalResidualPixels: accidental.verticalResidualPixels,
        glyph: {
          text: accidental.glyph.text,
          x: accidental.glyph.x,
          y: accidental.glyph.y,
          source: accidental.glyph.source ?? null,
          candidateId:
            accidental.glyph.pathCandidateId ??
            accidental.glyph.candidateId ??
            null,
          reason: accidental.glyph.reason ?? null,
          bounds: accidental.glyph.bounds ?? null,
        },
        note: {
          measureNumber: notes[noteIndex]?.measureNumber ?? null,
          clef: notes[noteIndex]?.clef ?? null,
          naturalMidi: notes[noteIndex]?.naturalMidi ?? null,
          cx: notes[noteIndex]?.cx ?? null,
          cy: notes[noteIndex]?.cy ?? null,
          anchorY: accidental.noteAnchorY ?? null,
          anchorSource: accidental.noteAnchorSource,
          anchorConfidence: accidental.noteAnchorConfidence,
        },
      }),
    ),
    rejectedGlyphCount:
      new Set(candidates.map((candidate) => candidate.glyphIndex)).size -
      usedGlyphs.size,
  }

  return assignments
}
