/**
 * DEV-only rhythm provenance collectors (duration / dot / beam decision chains).
 *
 * Gated by `scoreflow:omr-provenance` (default OFF). When disabled, factory
 * returns null and call sites use optional chaining — no allocations.
 */

import { isOmrProvenanceEnabled } from './omrDiagnosticFlags.js'
import { OMR_DURATION_DIVISIONS } from './omrRhythmConstants.js'

function typeFromDivisions(durationDivisions, dotted = false) {
  const base = Number(durationDivisions)
  if (!Number.isFinite(base)) {
    return null
  }
  const undotted = dotted ? base / 1.5 : base
  let best = 'quarter'
  let bestDiff = Infinity
  for (const [type, divisions] of Object.entries(OMR_DURATION_DIVISIONS)) {
    const diff = Math.abs(divisions - undotted)
    if (diff < bestDiff) {
      bestDiff = diff
      best = type
    }
  }
  return dotted ? `${best}.` : best
}

function eventKey(event, index = 0) {
  const clef = event?.notes?.[0]?.clef ?? '?'
  const midis = (event?.notes ?? [])
    .map((note) => note?.midi)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .join(',')
  return `s${event?.startDivision ?? '?'}|${clef}|${midis || index}`
}

function snapshotEventDurations(events = []) {
  const map = new Map()
  events.forEach((event, index) => {
    if (event?.type !== 'note') {
      return
    }
    map.set(eventKey(event, index), {
      durationDivisions: event.durationDivisions ?? null,
      durationType: event.durationType ?? null,
      dotted: Boolean(event.dotted),
      flags: {
        beamDurationAdjusted: Boolean(event.beamDurationAdjusted),
        beamTopologyApplied: Boolean(event.beamTopologyApplied),
        perClefDurationAdjusted: Boolean(event.perClefDurationAdjusted),
        sameClefBeatQuarterAdjusted: Boolean(event.sameClefBeatQuarterAdjusted),
        musicalEventReconstructionAdjusted: Boolean(
          event.musicalEventReconstructionAdjusted,
        ),
        durationClamped: Boolean(event.durationClamped),
      },
    })
  })
  return map
}

function sourcesFromNotes(notes = []) {
  const glyphTypes = []
  const stemTypes = []
  const beamTypes = []
  let dotted = false
  let maxBeams = 0
  let maxBeamStrength = 0
  let stemCount = 0
  for (const note of notes) {
    if (note?.dotted) {
      dotted = true
    }
    if (note?.noteheadGlyph === 'whole' || note?.noteheadGlyph === 'half') {
      glyphTypes.push({
        type: note.noteheadGlyph,
        confidence: note.noteheadGlyph === 'whole' ? 0.9 : 0.88,
        source: 'noteheadGlyph',
      })
    } else if (note?.hollow || note?.hollowGlyph) {
      glyphTypes.push({
        type: note.stem ? 'half' : 'whole',
        confidence: 0.74,
        source: 'hollowInk',
      })
    }
    if (note?.stem) {
      stemCount += 1
      stemTypes.push({
        type: note.durationType ?? (note.hollow ? 'half' : 'quarter'),
        confidence: 0.7,
        direction: note.stem?.direction ?? note.stem,
        length: note.stem?.length ?? null,
      })
    }
    const beams = note?.beams ?? 0
    const strength = note?.beamStrength ?? 0
    maxBeams = Math.max(maxBeams, beams)
    maxBeamStrength = Math.max(maxBeamStrength, strength)
    if (beams >= 2) {
      beamTypes.push({ type: 'sixteenth', confidence: 0.85, beams, strength })
    } else if (beams >= 1) {
      beamTypes.push({ type: 'eighth', confidence: 0.82, beams, strength })
    }
  }
  return {
    glyphDerivedType: glyphTypes[0]?.type ?? null,
    glyphConfidence: glyphTypes[0]?.confidence ?? null,
    stemDerivedType: stemCount ? stemTypes[0]?.type ?? 'quarter' : null,
    stemConfidence: stemCount ? 0.7 : null,
    beamDerivedType:
      maxBeams >= 2 ? 'sixteenth' : maxBeams >= 1 ? 'eighth' : null,
    beamConfidence: maxBeams >= 1 ? (maxBeams >= 2 ? 0.85 : 0.82) : null,
    beamCount: maxBeams,
    beamStrength: maxBeamStrength,
    dotDerivedModifier: dotted ? 'augmentation-dot' : null,
    dotConfidence: dotted ? 0.9 : null,
  }
}

/**
 * @returns {null | {
 *   enabled: true,
 *   measureNumber: number,
 *   page: number,
 *   recordInitialEvent: Function,
 *   recordStage: Function,
 *   addDotCandidates: Function,
 *   addBeamCandidates: Function,
 *   finalize: Function,
 * }}
 */
export function createMeasureRhythmProvenance({
  measureNumber = null,
  page = null,
  systemIndex = null,
} = {}) {
  if (!isOmrProvenanceEnabled()) {
    return null
  }

  const noteEvents = new Map()
  const dotCandidates = []
  const beamCandidates = []

  return {
    enabled: true,
    measureNumber,
    page,
    systemIndex,

    recordInitialEvent(event, index = 0, { gapType = null, gapConfidence = null } = {}) {
      if (event?.type !== 'note') {
        return
      }
      const key = eventKey(event, index)
      const fromNotes = sourcesFromNotes(event.notes)
      noteEvents.set(key, {
        key,
        measureNumber,
        page,
        systemIndex,
        startDivision: event.startDivision ?? null,
        noteCount: event.notes?.length ?? 0,
        midis: (event.notes ?? []).map((note) => note?.midi).filter(Number.isFinite),
        clef: event.notes?.[0]?.clef ?? null,
        originalGlyphDerivedType: fromNotes.glyphDerivedType,
        stemDerivedType: fromNotes.stemDerivedType,
        beamDerivedType: fromNotes.beamDerivedType,
        dotDerivedModifier: fromNotes.dotDerivedModifier,
        gapDerivedType: gapType ?? event.durationType ?? null,
        sources: {
          glyph: {
            type: fromNotes.glyphDerivedType,
            confidence: fromNotes.glyphConfidence,
          },
          stem: {
            type: fromNotes.stemDerivedType,
            confidence: fromNotes.stemConfidence,
          },
          beam: {
            type: fromNotes.beamDerivedType,
            confidence: fromNotes.beamConfidence,
            beams: fromNotes.beamCount,
            strength: fromNotes.beamStrength,
          },
          dot: {
            modifier: fromNotes.dotDerivedModifier,
            confidence: fromNotes.dotConfidence,
          },
          gap: {
            type: gapType ?? event.durationType ?? null,
            confidence: gapConfidence,
            durationDivisions: event.durationDivisions ?? null,
          },
        },
        decisionChain: [
          {
            stage: 'initial-event',
            function: 'buildNoteEventsFromGroups',
            durationType: event.durationType ?? null,
            durationDivisions: event.durationDivisions ?? null,
            dotted: Boolean(event.dotted),
            confidence: gapConfidence ?? 0.6,
            reason: 'gap-or-glyph-initial',
          },
        ],
        finalSelectedType: event.durationType ?? null,
        finalDurationDivisions: event.durationDivisions ?? null,
        finalDotted: Boolean(event.dotted),
        chordCoalesceOverride: null,
        measurePackingOverride: null,
        beamDurationOverwrittenLater: false,
      })
    },

    recordStage(stage, functionName, beforeEvents, afterEvents, { reason = null } = {}) {
      const before = snapshotEventDurations(beforeEvents)
      const after = snapshotEventDurations(afterEvents)
      for (const [key, next] of after) {
        const prev = before.get(key)
        const entry = noteEvents.get(key)
        if (!entry) {
          continue
        }
        const changed =
          !prev ||
          prev.durationDivisions !== next.durationDivisions ||
          prev.durationType !== next.durationType ||
          prev.dotted !== next.dotted
        if (!changed) {
          continue
        }
        const hadBeamDerived =
          entry.beamDerivedType != null ||
          entry.decisionChain.some(
            (step) =>
              step.stage?.includes('beam') ||
              step.function?.includes('Beam') ||
              step.function?.includes('beam'),
          )
        entry.decisionChain.push({
          stage,
          function: functionName,
          previousType: prev?.durationType ?? null,
          previousDivisions: prev?.durationDivisions ?? null,
          durationType: next.durationType,
          durationDivisions: next.durationDivisions,
          dotted: next.dotted,
          confidence: 0.75,
          reason:
            reason ??
            (stage.includes('coalesce')
              ? 'chord-coalesce'
              : stage.includes('beam')
                ? 'beam-refine'
                : 'duration-override'),
          flags: next.flags,
        })
        entry.finalSelectedType = next.durationType
        entry.finalDurationDivisions = next.durationDivisions
        entry.finalDotted = next.dotted
        if (stage.includes('coalesce') || functionName.includes('coalesce')) {
          entry.chordCoalesceOverride = {
            from: prev?.durationType ?? null,
            to: next.durationType,
            function: functionName,
          }
        }
        if (
          stage.includes('pack') ||
          stage.includes('extend') ||
          stage.includes('clamp') ||
          stage.includes('floor') ||
          stage.includes('reconstruct')
        ) {
          entry.measurePackingOverride = {
            from: prev?.durationType ?? null,
            to: next.durationType,
            function: functionName,
          }
        }
        if (
          hadBeamDerived &&
          entry.beamDerivedType &&
          next.durationType &&
          next.durationType !== entry.beamDerivedType &&
          !stage.includes('beam')
        ) {
          entry.beamDurationOverwrittenLater = true
        }
      }
    },

    addDotCandidates(candidates = []) {
      for (const candidate of candidates) {
        dotCandidates.push({
          measureNumber,
          page,
          systemIndex,
          ...candidate,
        })
      }
    },

    addBeamCandidates(candidates = []) {
      for (const candidate of candidates) {
        beamCandidates.push({
          measureNumber,
          page,
          systemIndex,
          ...candidate,
        })
      }
    },

    finalize() {
      return {
        measureNumber,
        page,
        systemIndex,
        noteDurations: [...noteEvents.values()],
        dotCandidates,
        beamCandidates,
      }
    },
  }
}

export function beamTypeFromCount(beams) {
  if ((beams ?? 0) >= 2) {
    return 'sixteenth'
  }
  if ((beams ?? 0) >= 1) {
    return 'eighth'
  }
  return null
}

export function summarizeRhythmProvenance(measureProvenances = []) {
  const notes = []
  const dots = []
  const beams = []
  for (const measure of measureProvenances) {
    if (!measure) {
      continue
    }
    notes.push(...(measure.noteDurations ?? []))
    dots.push(...(measure.dotCandidates ?? []))
    beams.push(...(measure.beamCandidates ?? []))
  }
  return {
    version: 1,
    noteDurationCount: notes.length,
    dotCandidateCount: dots.length,
    beamCandidateCount: beams.length,
    beamDurationOverwrittenLater: notes.filter(
      (note) => note.beamDurationOverwrittenLater,
    ).length,
    chordCoalesceOverrides: notes.filter((note) => note.chordCoalesceOverride)
      .length,
    unassignedDots: dots.filter((dot) => !dot.finalOwner).length,
    rejectedBeams: beams.filter((beam) => beam.rejectionReason).length,
    noteDurations: notes,
    dotCandidates: dots,
    beamCandidates: beams,
  }
}

export { typeFromDivisions, eventKey, sourcesFromNotes }
