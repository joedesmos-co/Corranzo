import { INSTRUMENT_IDS } from '../instruments/instruments.js'

/**
 * Guitar chord checkpoints: vertical fret stacks treated as one shape target,
 * not a piano-style pitch list. Pure helpers — no React, no audio APIs.
 */

export function minimumGuitarChordTonesRequired(toneCount) {
  const count = Number(toneCount) || 0
  if (count <= 2) {
    return count
  }
  if (count === 3) {
    return 2
  }
  if (count === 4) {
    return 3
  }
  if (count <= 6) {
    return 3
  }
  return Math.max(3, Math.ceil(count * 0.66))
}

export function guitarShapeTargetLabel(toneCount) {
  const count = Number(toneCount) || 0
  if (count === 2) {
    return 'Play this double-stop'
  }
  if (count >= 3) {
    return 'Play this chord'
  }
  return 'Play this shape'
}

export function resolveGuitarShapePositions(checkpoint, tabPositions = null) {
  const positions = []
  const seenStrings = new Set()
  for (const note of checkpoint?.notes ?? []) {
    if (note?.midi == null) {
      continue
    }
    const explicit =
      note.string != null && note.fret != null
        ? { string: note.string, fret: note.fret }
        : null
    const position = explicit ?? tabPositions?.get(note.id) ?? null
    if (!position || seenStrings.has(position.string)) {
      continue
    }
    seenStrings.add(position.string)
    positions.push({
      string: position.string,
      fret: position.fret,
      midi: note.midi,
      noteId: note.id ?? null,
    })
  }
  return positions.sort((left, right) => left.string - right.string)
}

export function isGuitarChordShapeCandidate(checkpoint, { instrumentId = null } = {}) {
  return (
    instrumentId === INSTRUMENT_IDS.GUITAR &&
    Boolean(checkpoint?.isChord) &&
    (checkpoint?.notes?.length ?? 0) > 1
  )
}

function dominantFret(positions) {
  const fretted = positions.filter((entry) => Number(entry.fret) > 0)
  if (!fretted.length) {
    return null
  }
  const counts = new Map()
  for (const entry of fretted) {
    const fret = Math.round(Number(entry.fret))
    counts.set(fret, (counts.get(fret) ?? 0) + 1)
  }
  let bestFret = null
  let bestCount = 0
  for (const [fret, count] of counts.entries()) {
    if (count > bestCount) {
      bestFret = fret
      bestCount = count
    }
  }
  return bestFret
}

export function buildGuitarChordShape(checkpoint, tabPositions = null) {
  const positions = resolveGuitarShapePositions(checkpoint, tabPositions)
  if (positions.length < 2) {
    return null
  }
  const fretted = positions.filter((entry) => Number(entry.fret) > 0)
  const uniqueFrets = new Set(fretted.map((entry) => Math.round(Number(entry.fret))))
  const dominant = dominantFret(positions)
  return {
    positions,
    stringCount: positions.length,
    dominantFret: dominant,
    uniformFret: uniqueFrets.size === 1 ? [...uniqueFrets][0] : null,
    chordSymbol: checkpoint?.chordSymbol ?? null,
  }
}

export function guitarChordDisplayLabel(checkpoint, shape) {
  const toneCount = shape?.positions?.length ?? checkpoint?.expectedMidis?.length ?? 0
  return guitarShapeTargetLabel(toneCount)
}

export function enrichGuitarChordCheckpoint(checkpoint, { instrumentId = null, tabPositions = null } = {}) {
  if (!checkpoint || !isGuitarChordShapeCandidate(checkpoint, { instrumentId })) {
    return checkpoint
  }
  const shape = buildGuitarChordShape(checkpoint, tabPositions)
  if (!shape) {
    return checkpoint
  }
  const toneCount = checkpoint.expectedMidis?.length ?? shape.positions.length
  const displayLabel = guitarChordDisplayLabel(checkpoint, shape)
  return {
    ...checkpoint,
    isGuitarChordShape: true,
    guitarChordShape: shape,
    displayLabel,
    minimumChordTonesRequired: minimumGuitarChordTonesRequired(toneCount),
    label: displayLabel,
  }
}

export function resolveGroupChordSymbol(group, harmonyEvents = []) {
  const fromNote = group.notes.find((note) => note?.chordSymbol)?.chordSymbol
  if (fromNote) {
    return fromNote
  }
  const measureNumber = group.notes[0]?.measureNumber
  const timeSeconds = group.timeSeconds
  let bestSymbol = null
  let bestDelta = Infinity
  for (const event of harmonyEvents) {
    if (event.measureNumber !== measureNumber) {
      continue
    }
    const delta = timeSeconds - (event.timeSeconds ?? 0)
    if (delta >= -0.02 && delta < bestDelta) {
      bestDelta = delta
      bestSymbol = event.symbol ?? null
    }
  }
  if (bestSymbol) {
    return bestSymbol
  }
  if (group.notes.length === 1) {
    return group.notes[0]?.chordSymbol ?? null
  }
  return null
}
