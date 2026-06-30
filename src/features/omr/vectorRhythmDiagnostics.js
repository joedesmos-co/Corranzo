/**
 * Rhythm / voice diagnostics for vector OMR measures.
 */

import { summarizeMeasureSerialization } from './omrChordGroupingDiagnostics.js'
import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'

function voiceForClef(clef) {
  return clef === 'bass' ? 2 : 1
}

function beamEvidenceForNotes(notes = []) {
  const beams = notes.map((note) => note.beams ?? 0).filter(Number.isFinite)
  const strengths = notes.map((note) => note.beamStrength ?? 0).filter(Number.isFinite)
  return {
    maxBeams: beams.length ? Math.max(...beams) : 0,
    maxBeamStrength: strengths.length ? Math.max(...strengths) : 0,
    flaggedCount: notes.filter((note) => (note.beams ?? 0) > 0 || (note.beamStrength ?? 0) >= 8).length,
    stemCount: notes.filter((note) => note.stem).length,
  }
}

export function summarizeOverlappingDurationGroups(events = [], totalDivisions = 16) {
  const noteEvents = events.filter((event) => event.type === 'note')
  const overlaps = []
  for (let leftIndex = 0; leftIndex < noteEvents.length; leftIndex += 1) {
    const left = noteEvents[leftIndex]
    const leftStart = left.startDivision ?? 0
    const leftEnd = leftStart + (left.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER)
    const leftClef = left.notes?.[0]?.clef ?? 'treble'
    for (let rightIndex = leftIndex + 1; rightIndex < noteEvents.length; rightIndex += 1) {
      const right = noteEvents[rightIndex]
      const rightStart = right.startDivision ?? 0
      const rightEnd = rightStart + (right.durationDivisions ?? OMR_DIVISIONS_PER_QUARTER)
      const rightClef = right.notes?.[0]?.clef ?? 'treble'
      if (leftClef === rightClef) {
        continue
      }
      if (leftStart < rightEnd && rightStart < leftEnd) {
        overlaps.push({
          leftClef,
          rightClef,
          leftStart,
          rightStart,
          leftDuration: left.durationDivisions ?? 0,
          rightDuration: right.durationDivisions ?? 0,
          overlapDivisions: Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart),
        })
      }
    }
  }
  return {
    overlapCount: overlaps.length,
    overlaps: overlaps.slice(0, 12),
    measureEndDivision: totalDivisions,
  }
}

export function summarizeVectorRhythmDiagnostics(events = [], notes = [], totalDivisions = 16) {
  const noteEvents = events.filter((event) => event.type === 'note')
  const serialization = summarizeMeasureSerialization(events)
  const voiceAssignments = noteEvents.map((event) => {
    const clef = event.notes?.[0]?.clef ?? 'treble'
    return {
      startDivision: event.startDivision ?? 0,
      durationDivisions: event.durationDivisions ?? 0,
      clef,
      voice: voiceForClef(clef),
      noteCount: event.notes?.length ?? 0,
      perClefDurationAdjusted: event.perClefDurationAdjusted === true,
      beam: beamEvidenceForNotes(event.notes ?? []),
    }
  })

  const noteheadRhythm = notes.map((note) => ({
    midi: note.midi,
    clef: note.clef,
    beams: note.beams ?? 0,
    beamStrength: note.beamStrength ?? 0,
    durationType: note.durationType ?? null,
    durationDivisions: note.durationDivisions ?? null,
    stem: Boolean(note.stem),
    dotted: Boolean(note.dotted),
  }))

  const quarterCollapsedCount = noteEvents.filter(
    (event) =>
      event.durationDivisions === OMR_DIVISIONS_PER_QUARTER &&
      (event.notes ?? []).some((note) => (note.beams ?? 0) > 0 || (note.beamStrength ?? 0) >= 8),
  ).length

  return {
    noteEventCount: noteEvents.length,
    voiceAssignments,
    overlappingGroups: summarizeOverlappingDurationGroups(events, totalDivisions),
    serializationSequence: serialization.sequence,
    forwardCount: serialization.forwardCount,
    backupCount: serialization.backupCount,
    noteheadRhythm,
    quarterCollapsedDespiteBeamsCount: quarterCollapsedCount,
    perClefAdjustedCount: noteEvents.filter((event) => event.perClefDurationAdjusted).length,
    perClefStretchCappedCount: noteEvents.filter((event) => event.perClefStretchCapped).length,
  }
}
