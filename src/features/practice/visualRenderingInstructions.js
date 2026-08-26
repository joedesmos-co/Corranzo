import { getSourceVisualAnchorIndex } from '../omr/omrSourceVisualMap.js'
import { getPlayAlongVisualEvents } from './playAlongVisualTarget.js'
import { buildVisualNoteMarkings } from './visualNotationMarkings.js'
import {
  buildVisualEventLayout,
  buildVisualMeasureLayoutIndex,
  buildVisualObjectLayout,
} from './sourceFidelityLayout.js'

const LOOP_EPSILON_SECONDS = 0.001

function finite(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value))
}

function availableRepresentations(anchor) {
  if (!anchor) return []
  return [
    anchor.representation,
    ...(anchor.alternates ?? []).map((alternate) => alternate.representation),
  ].filter((value, index, values) => value && values.indexOf(value) === index)
}

/**
 * Source ownership metadata for a semantic note. The ownership record stays
 * coordinate-free; buildVisualObjectLayout separately converts trustworthy
 * source evidence into renderer-safe normalized geometry.
 */
export function buildVisualSourceOwnership(
  note,
  sourceAnchorIndex,
  preferredRepresentation = null,
) {
  const sourceNoteheadId = note?.sourceNoteheadId ?? null
  const anchor = sourceNoteheadId ? sourceAnchorIndex?.get(sourceNoteheadId) : null
  if (!anchor) {
    return sourceNoteheadId
      ? {
          sourceNoteheadId,
          provenanceStatus: 'unmapped',
          selectedRepresentation: null,
          availableRepresentations: [],
        }
      : null
  }

  const representations = availableRepresentations(anchor)
  const selectedRepresentation = representations.includes(preferredRepresentation)
    ? preferredRepresentation
    : anchor.representation
  const semanticAgreement = {
    midi: !finite(anchor.midi) || Number(anchor.midi) === Number(note.midi),
    measure:
      !finite(anchor.measureNumber) ||
      Number(anchor.measureNumber) === Number(note.measureNumber),
    staff:
      !finite(anchor.staffIndex) ||
      !finite(note.staff) ||
      Number(anchor.staffIndex) + 1 === Number(note.staff),
    voice:
      !finite(anchor.voice) ||
      !finite(note.voice) ||
      Number(anchor.voice) === Number(note.voice),
  }
  const matchesSemantic = Object.values(semanticAgreement).every(Boolean)

  return {
    sourceNoteheadId,
    sourceEventId: anchor.sourceEventId ?? null,
    sourceEventIds: [...(anchor.sourceEventIds ?? [])],
    page: anchor.page ?? null,
    systemIndex: anchor.systemIndex ?? null,
    staffIndex: anchor.staffIndex ?? null,
    measureIndex: anchor.measureIndex ?? null,
    measureNumber: anchor.measureNumber ?? null,
    confidence: anchor.confidence ?? null,
    selectedRepresentation,
    availableRepresentations: representations,
    semanticAgreement,
    provenanceStatus: matchesSemantic ? 'matched' : 'mismatch',
  }
}

function visualNoteInstruction(note, event, noteIndex, sourceAnchorIndex, options) {
  const visualNoteId = `${event.id}-n${noteIndex}-${note.id ?? note.midi ?? 'note'}`
  const semantic = {
    id: note.id ?? visualNoteId,
    visualNoteId,
    sourceNoteId: note.id ?? null,
    sourceNoteheadId: note.sourceNoteheadId ?? null,
    partId: note.partId ?? null,
    voice: note.voice ?? 1,
    midi: note.midi,
    label: note.label ?? null,
    writtenPitch: note.writtenPitch ?? null,
    accidental: note.accidental ?? null,
    keySignature: note.keySignature ?? null,
    staff: note.staff ?? null,
    timeSeconds: event.timeSeconds,
    quarterTime: note.quarterTime ?? null,
    measureNumber: note.measureNumber ?? event.measureNumber,
    repeatPass: event.repeatPass,
    durationSeconds: note.durationSeconds ?? null,
    durationQuarters: note.durationQuarters ?? null,
    durationDivisions: note.durationDivisions ?? null,
    noteType: note.noteType ?? null,
    stemDirection: note.stemDirection ?? null,
    dots: Math.max(0, Math.round(Number(note.dots) || 0)),
    beams: note.beams ?? [],
    tieStart: Boolean(note.tieStart),
    tieStop: Boolean(note.tieStop),
    tiePlacement: note.tiePlacement ?? null,
    suppressPlaybackAttack: Boolean(note.suppressPlaybackAttack),
    staccato: Boolean(note.staccato),
    accent: Boolean(note.accent),
    tenuto: Boolean(note.tenuto),
    marcato: Boolean(note.marcato),
    fermata: Boolean(note.fermata),
    articulationPlacements: note.articulationPlacements ?? {},
    slurs: note.slurs ?? [],
    guitarTechniques: note.guitarTechniques ?? [],
    timeModification: note.timeModification ?? null,
    string: note.string ?? null,
    fret: note.fret ?? null,
    chordSymbol: note.chordSymbol ?? null,
    isChord: Boolean(note.isChord),
  }
  const sourceOwnership = buildVisualSourceOwnership(
    semantic,
    sourceAnchorIndex,
    options.preferredRepresentation,
  )
  return {
    ...semantic,
    sourceOwnership,
    sourceLayout: buildVisualObjectLayout({
      note,
      measureLayout: options.measureLayoutIndex?.get(semantic.measureNumber) ?? null,
      sourceOwnership,
      sourceAnchorIndex,
      preferredRepresentation: options.preferredRepresentation,
    }),
    markings: buildVisualNoteMarkings(semantic, { groupId: event.id }),
  }
}

function visualRestInstruction(rest, event, restIndex, options) {
  const visualRestId = `${event.id}-r${restIndex}-${rest.id ?? 'rest'}`
  const semantic = {
    id: rest.id ?? visualRestId,
    visualRestId,
    sourceNoteId: rest.id ?? null,
    partId: rest.partId ?? null,
    voice: rest.voice ?? 1,
    staff: rest.staff ?? null,
    timeSeconds: event.timeSeconds,
    quarterTime: rest.quarterTime ?? null,
    measureNumber: rest.measureNumber ?? event.measureNumber,
    repeatPass: event.repeatPass,
    durationSeconds: rest.durationSeconds ?? null,
    durationQuarters: rest.durationQuarters ?? null,
    durationDivisions: rest.durationDivisions ?? null,
    noteType: rest.noteType ?? null,
    isRest: true,
    dots: Math.max(0, Math.round(Number(rest.dots) || 0)),
  }
  return {
    ...semantic,
    sourceLayout: buildVisualObjectLayout({
      note: rest,
      measureLayout: options.measureLayoutIndex?.get(semantic.measureNumber) ?? null,
    }),
  }
}

function eventInsideLoop(event, loopRegion) {
  if (!loopRegion?.isValid) return true
  return (
    event.timeSeconds >= loopRegion.startTimeSeconds - LOOP_EPSILON_SECONDS &&
    event.timeSeconds < loopRegion.endTimeSeconds
  )
}

/**
 * Canonical reconstructed-notation input.
 *
 * Timing/MusicXML supplies exact musical semantics. sourceVisualMap joins the
 * corresponding source-owned noteheads and representation, while normalized
 * source layout evidence guides reconstructed SVG placement. No PDF pixels or
 * crop data crosses this boundary. The returned objects are the only data
 * StaffVisualLane/TabVisualLane need to draw the clean Visual surface.
 */
export function buildVisualRenderingInstructions(
  timingMap,
  sourceVisualMap = null,
  options = {},
) {
  if (!timingMap) return []
  const sourceAnchorIndex = getSourceVisualAnchorIndex(sourceVisualMap)
  const measureLayoutIndex = buildVisualMeasureLayoutIndex(timingMap)
  const layoutOptions = { ...options, measureLayoutIndex }
  const events = getPlayAlongVisualEvents(timingMap, options.practiceScope)
    .filter((event) => eventInsideLoop(event, options.loopRegion))

  return events.map((event) => {
    const notes = (event.notes ?? []).map((note, noteIndex) =>
      visualNoteInstruction(note, event, noteIndex, sourceAnchorIndex, layoutOptions),
    )
    const rests = (event.rests ?? []).map((rest, restIndex) =>
      visualRestInstruction(rest, event, restIndex, layoutOptions),
    )
    const ownership = notes.map((note) => note.sourceOwnership).filter(Boolean)
    const measureLayout = measureLayoutIndex.get(event.measureNumber) ?? null
    return {
      id: `visual-${event.id}`,
      semanticEventId: event.id,
      kind: event.kind,
      timeSeconds: event.timeSeconds,
      endTimeSeconds: event.endTimeSeconds,
      measureNumber: event.measureNumber,
      repeatPass: event.repeatPass,
      midis: [...event.expectedMidis],
      expectedMidis: [...event.expectedMidis],
      isChord: event.isChord,
      isRest: event.isRest,
      isTiedContinuation: event.isTiedContinuation,
      notes,
      rests,
      sourceLayout: buildVisualEventLayout([...notes, ...rests], measureLayout),
      sourceOwnership: ownership,
      sourceOwned: ownership.length > 0,
      sourceSemanticAgreement: ownership.every(
        (entry) => entry.provenanceStatus !== 'mismatch',
      ),
    }
  })
}

function comparableNote(note) {
  return {
    midi: finite(note.midi) ? Number(note.midi) : null,
    staff: finite(note.staff) ? Number(note.staff) : null,
    voice: finite(note.voice) ? Number(note.voice) : 1,
    durationQuarters: finite(note.durationQuarters)
      ? Number(note.durationQuarters)
      : null,
    durationSeconds: finite(note.durationSeconds)
      ? Number(Number(note.durationSeconds).toFixed(6))
      : null,
    noteType: note.noteType ?? null,
    dots: Math.max(0, Math.round(Number(note.dots) || 0)),
    accidental: note.accidental?.type ?? null,
    tieStart: Boolean(note.tieStart),
    tieStop: Boolean(note.tieStop),
    isRest: Boolean(note.isRest),
    measureNumber: finite(note.measureNumber) ? Number(note.measureNumber) : null,
    string: finite(note.string) ? Number(note.string) : null,
    fret: finite(note.fret) ? Number(note.fret) : null,
  }
}

function comparableNotes(notes) {
  return (notes ?? [])
    .map(comparableNote)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

/**
 * Permanent Score-source ↔ Visual instruction comparison harness. It compares
 * every performed onset, including repeats and rests, and reports provenance
 * disagreement separately from semantic rendering disagreement.
 */
export function compareVisualRenderingInstructions(
  timingMap,
  instructions,
  options = {},
) {
  const expected = getPlayAlongVisualEvents(timingMap, options.practiceScope)
    .filter((event) => eventInsideLoop(event, options.loopRegion))
  const actual = instructions ?? []
  const mismatches = []

  if (expected.length !== actual.length) {
    mismatches.push({
      kind: 'event-count',
      expected: expected.length,
      actual: actual.length,
    })
  }

  const count = Math.max(expected.length, actual.length)
  for (let index = 0; index < count; index += 1) {
    const sourceEvent = expected[index]
    const visualEvent = actual[index]
    if (!sourceEvent || !visualEvent) continue
    const expectedEvent = {
      timeSeconds: Number(sourceEvent.timeSeconds.toFixed(6)),
      measureNumber: sourceEvent.measureNumber,
      repeatPass: sourceEvent.repeatPass,
      expectedMidis: [...sourceEvent.expectedMidis].sort((a, b) => a - b),
      isRest: sourceEvent.isRest,
      notes: comparableNotes(sourceEvent.notes),
      rests: comparableNotes(sourceEvent.rests),
    }
    const actualEvent = {
      timeSeconds: Number(visualEvent.timeSeconds.toFixed(6)),
      measureNumber: visualEvent.measureNumber,
      repeatPass: visualEvent.repeatPass,
      expectedMidis: [...(visualEvent.expectedMidis ?? visualEvent.midis ?? [])]
        .sort((a, b) => a - b),
      isRest: visualEvent.isRest,
      notes: comparableNotes(visualEvent.notes),
      rests: comparableNotes(visualEvent.rests),
    }
    if (JSON.stringify(expectedEvent) !== JSON.stringify(actualEvent)) {
      mismatches.push({ kind: 'semantic-event', index, expected: expectedEvent, actual: actualEvent })
    }
    if (visualEvent.sourceSemanticAgreement === false) {
      mismatches.push({ kind: 'source-provenance', index })
    }
  }

  return {
    passed: mismatches.length === 0,
    expectedEventCount: expected.length,
    actualEventCount: actual.length,
    mismatchCount: mismatches.length,
    mismatches,
  }
}
