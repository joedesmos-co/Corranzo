import { OMR_DURATION_DIVISIONS } from './omrRhythmConstants.js'

const FLAG_GLYPH_START = 0xe240
const FLAG_GLYPH_END = 0xe24f

function flagGlyphInfo(text) {
  const codePoint = text?.codePointAt?.(0)
  if (
    !Number.isInteger(codePoint) ||
    codePoint < FLAG_GLYPH_START ||
    codePoint > FLAG_GLYPH_END
  ) {
    return null
  }
  const offset = codePoint - FLAG_GLYPH_START
  return {
    level: Math.floor(offset / 2) + 1,
    direction: offset % 2 === 0 ? 'up' : 'down',
    codePoint: `U+${codePoint.toString(16).toUpperCase()}`,
  }
}

function noteStaffSpacePx(note, imageData) {
  const lines = [...(note?.pitchMapping?.lineYs ?? [])]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (lines.length < 2) {
    return 8
  }
  const normalized = lines.at(-1) <= 1
  const span = (lines.at(-1) - lines[0]) * (normalized ? imageData.height : 1)
  return Math.max(3, span / (lines.length - 1))
}

function candidateScore(glyph, flag, note, imageData) {
  if (flag.level > 2) {
    return null
  }
  const stem = note?.stem
  if (
    !stem ||
    stem.direction !== flag.direction ||
    !Number.isFinite(stem.x) ||
    !Number.isFinite(stem.tipY)
  ) {
    return null
  }
  const staffSpace = noteStaffSpacePx(note, imageData)
  const glyphBox = note?.glyphBBox
  if (
    Number.isFinite(glyphBox?.width) &&
    Number.isFinite(glyphBox?.height) &&
    glyphBox.width < staffSpace * 0.95 &&
    glyphBox.height < staffSpace * 2.05
  ) {
    // Small-note flags need grace/cue semantics, not a sounding duration in
    // the ordinary measure lane. Leave them for the dedicated grace path.
    return null
  }
  const dx = glyph.x - stem.x
  const dy = glyph.y - stem.tipY
  const correctSide =
    flag.direction === 'up'
      ? dx >= -staffSpace * 0.25 && dx <= staffSpace * 1.1
      : dx <= staffSpace * 0.25 && dx >= -staffSpace * 1.1
  if (!correctSide || Math.abs(dy) > staffSpace * 0.8) {
    return null
  }
  return {
    distance: Math.hypot(dx, dy),
    dx,
    dy,
    staffSpace,
  }
}

function glyphBelongsToMeasure(glyph, measureBox, imageData) {
  if (!measureBox) {
    return true
  }
  const xNorm = glyph.x / imageData.width
  const yNorm = glyph.y / imageData.height
  return (
    xNorm >= (measureBox.x0 ?? 0) - 0.005 &&
    xNorm <= (measureBox.x1 ?? 1) + 0.005 &&
    yNorm >= (measureBox.y0 ?? 0) - 0.035 &&
    yNorm <= (measureBox.y1 ?? 1) + 0.035
  )
}

function sharesStem(left, right, staffSpace) {
  return Boolean(
    left?.stem &&
      right?.stem &&
      left.stem.direction === right.stem.direction &&
      Math.abs(left.stem.x - right.stem.x) <= staffSpace * 0.35 &&
      Math.abs(left.stem.tipY - right.stem.tipY) <= staffSpace * 0.8,
  )
}

function applyFlagWrittenValue(note, flag, glyph) {
  const level = Math.max(Number(note.flags ?? 0), flag.level)
  const durationType = level >= 2 ? 'sixteenth' : 'eighth'
  const baseDivisions = OMR_DURATION_DIVISIONS[durationType]
  note.flags = level
  note.flagDirection = flag.direction
  note.flagGlyphCodePoint = flag.codePoint
  note.flagSource = 'smufl-vector-glyph'
  note.flagUnsupportedLevel = null
  note.durationType = durationType
  note.durationDivisions = note.dotted
    ? Math.round(baseDivisions * 1.5)
    : baseDivisions
  note.confidence = Math.max(Number(note.confidence ?? 0), 0.96)
  note.flagGlyph = {
    text: glyph.text,
    x: glyph.x,
    y: glyph.y,
    codePoint: flag.codePoint,
  }
}

/**
 * Attach explicit SMuFL flag glyphs to their source-connected stems.
 *
 * The flag glyph origin is engraved at the stem tip. Direction, staff-scaled
 * proximity, and one-to-one source ownership make this stronger evidence than
 * a raster hook probe. Chord heads sharing that stem inherit the same value.
 */
export function assignVectorFlagsToNoteheads({
  glyphs = [],
  notes = [],
  imageData,
  measureBox = null,
} = {}) {
  const candidates = []
  const selectedAttachments = []
  const usedNotes = new Set()

  for (const glyph of glyphs) {
    const flag = flagGlyphInfo(glyph?.text)
    if (
      !flag ||
      !Number.isFinite(glyph?.x) ||
      !Number.isFinite(glyph?.y) ||
      !glyphBelongsToMeasure(glyph, measureBox, imageData)
    ) {
      continue
    }
    const matches = notes
      .map((note, noteIndex) => ({
        note,
        noteIndex,
        score: candidateScore(glyph, flag, note, imageData),
      }))
      .filter((entry) => entry.score)
      .sort((left, right) => left.score.distance - right.score.distance)
    candidates.push({
      glyph: { text: glyph.text, x: glyph.x, y: glyph.y },
      ...flag,
      matchCount: matches.length,
      nearestDistance: matches[0]?.score.distance ?? null,
    })
    const best = matches.find((entry) => !usedNotes.has(entry.noteIndex))
    if (!best) {
      continue
    }
    const attachedNoteIndices = []
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
      if (
        noteIndex !== best.noteIndex &&
        !sharesStem(best.note, notes[noteIndex], best.score.staffSpace)
      ) {
        continue
      }
      applyFlagWrittenValue(notes[noteIndex], flag, glyph)
      usedNotes.add(noteIndex)
      attachedNoteIndices.push(noteIndex)
    }
    selectedAttachments.push({
      codePoint: flag.codePoint,
      level: flag.level,
      direction: flag.direction,
      glyphX: glyph.x,
      glyphY: glyph.y,
      stemX: best.note.stem.x,
      stemTipY: best.note.stem.tipY,
      distance: best.score.distance,
      attachedNoteIndices,
    })
  }

  return {
    detectedFlagGlyphCount: candidates.length,
    appliedFlagGlyphCount: selectedAttachments.length,
    appliedNoteCount: selectedAttachments.reduce(
      (sum, attachment) => sum + attachment.attachedNoteIndices.length,
      0,
    ),
    unsupportedFlagGlyphCount: candidates.filter(
      (candidate) => candidate.level > 2,
    ).length,
    candidates,
    selectedAttachments,
  }
}

/**
 * Preserve a source-owned flag on its event after measure-level geometry has
 * been reconstructed. This changes only the event whose complete chord owns
 * the same explicit flag; it deliberately does not repack neighboring stems.
 */
export function applyVectorFlagDurationsToEvents(events = []) {
  let appliedCount = 0
  const nextEvents = events.map((event) => {
    if (event?.type !== 'note' || !(event.notes?.length > 0)) {
      return event
    }
    const flaggedNotes = event.notes.filter(
      (note) =>
        note?.flagSource === 'smufl-vector-glyph' &&
        Number.isFinite(note?.durationDivisions) &&
        typeof note?.durationType === 'string',
    )
    if (
      flaggedNotes.length !== event.notes.length ||
      new Set(flaggedNotes.map((note) => note.durationDivisions)).size !== 1 ||
      new Set(flaggedNotes.map((note) => note.durationType)).size !== 1
    ) {
      return event
    }
    const durationDivisions = flaggedNotes[0].durationDivisions
    const durationType = flaggedNotes[0].durationType
    if (
      event.durationDivisions === durationDivisions &&
      event.durationType === durationType
    ) {
      return event
    }
    appliedCount += 1
    return {
      ...event,
      durationDivisions,
      durationType,
      dotted: flaggedNotes.every((note) => note.dotted === true),
      vectorFlagDurationApplied: true,
      vectorFlagDurationSource: 'smufl-vector-glyph',
    }
  })
  return { events: appliedCount ? nextEvents : events, appliedCount }
}
