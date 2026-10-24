/**
 * Note corrections: the musician's edits, kept separate from the machine's
 * transcription and from the arrangement that is written to the score.
 *
 * Three layers, never mixed:
 *
 *   transcription   the notes the model heard        (immutable evidence)
 *   corrections     the notes the musician removed  (this module)
 *   arrangement     what is written to MusicXML     (derived)
 *
 * A correction is a CONTENT key, not an array index. An index would break the
 * moment the transcription is regenerated (the same audio, a new model run, a
 * new difficulty), because the notes move; a content key still identifies the
 * same musical event. If a later transcription no longer contains that event
 * the correction is simply inert - it never starts deleting something else.
 *
 * The key is `pitch@musical-time#occurrence`. The occurrence is required:
 * repeated notes at different times are already distinct, but two simultaneous
 * unisons (or duplicate transcriptions of one attack) would otherwise share a
 * `pitch@time` key and one Remove would delete both. `annotateNoteKeys`
 * assigns the occurrence deterministically from the notes' own content, so the
 * same set always receives the same keys regardless of array order.
 *
 * Times are musical beats supplied by the caller (`timeOf`), not wall-clock
 * seconds: a tempo correction re-runs the same beat grid, so the key still
 * identifies the same written note. The unit is deliberately opaque here.
 */

const KEY_PRECISION = 4 // 0.1 ms at 120 BPM - far below any note boundary

function round(value) {
  const factor = 10 ** KEY_PRECISION
  return Math.round((Number(value) || 0) * factor) / factor
}

function midiOf(note) {
  const midi = Math.round(Number(note?.midi))
  return Number.isFinite(midi) ? midi : null
}

function timeOfNote(note, timeSeconds) {
  return timeSeconds ?? note?.seconds ?? note?.startSeconds ?? note?.timeSeconds ?? 0
}

/** A stable identity for a single note (occurrence defaults to the first). */
export function noteKey(note, { timeSeconds = null, occurrence = 1 } = {}) {
  const midi = midiOf(note)
  if (midi == null) return null
  const time = round(timeOfNote(note, timeSeconds))
  const ordinal = Math.max(1, Math.round(Number(occurrence) || 1))
  return `${midi}@${time.toFixed(KEY_PRECISION)}#${ordinal}`
}

/** Legacy key without the occurrence suffix (kept for diagnostics/import). */
export function noteBaseKey(note, { timeSeconds = null } = {}) {
  const midi = midiOf(note)
  if (midi == null) return null
  return `${midi}@${round(timeOfNote(note, timeSeconds)).toFixed(KEY_PRECISION)}`
}

function duplicateSignature(note) {
  return [
    Number(note?.durBeats ?? note?.durationBeats ?? 0).toFixed(4),
    String(note?.hand ?? ''),
    String(note?.role ?? ''),
    String(note?.string ?? ''),
    String(note?.fret ?? ''),
    String(note?.voice ?? ''),
  ].join('|')
}

/**
 * Attach a unique `correctionKey` to every event.
 *
 * Returns fresh objects; the input array and its objects are never mutated.
 * Duplicate pitch+time events are ordered by their own musical content
 * (duration, hand, role, string, fret, voice) so re-annotating the same set -
 * even after the array is reordered - produces the same key for the same note.
 * Truly identical duplicates are interchangeable by definition.
 */
export function annotateNoteKeys(events, { timeOf } = {}) {
  const list = Array.isArray(events) ? events : []
  const records = list.map((event, index) => ({
    event,
    index,
    base: noteBaseKey(event, { timeSeconds: timeOf ? timeOf(event) : undefined }),
    occurrence: 1,
  }))
  const groups = new Map()
  for (const record of records) {
    if (!record.base) continue
    if (!groups.has(record.base)) groups.set(record.base, [])
    groups.get(record.base).push(record)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort((a, b) => {
      const byContent = duplicateSignature(a.event).localeCompare(duplicateSignature(b.event))
      return byContent !== 0 ? byContent : a.index - b.index
    })
    ordered.forEach((record, position) => {
      record.occurrence = position + 1
    })
  }
  return records.map((record) =>
    record.base == null
      ? { ...record.event }
      : { ...record.event, correctionKey: `${record.base}#${record.occurrence}` },
  )
}

export function createNoteCorrections(initial = null) {
  const removed = Array.isArray(initial?.removed)
    ? initial.removed.filter((key) => typeof key === 'string' && key.length > 0)
    : []
  return { version: 2, removed: [...new Set(removed)] }
}

export function hasRemoval(corrections, key) {
  return Boolean(key) && (corrections?.removed ?? []).includes(key)
}

/** Add a removal. Returns a NEW corrections object (never mutates). */
export function addRemoval(corrections, key) {
  if (!key) return createNoteCorrections(corrections)
  const next = createNoteCorrections(corrections)
  if (!next.removed.includes(key)) next.removed.push(key)
  return next
}

/** Undo a removal. Returns a NEW corrections object. */
export function undoRemoval(corrections, key) {
  const next = createNoteCorrections(corrections)
  next.removed = next.removed.filter((candidate) => candidate !== key)
  return next
}

export function undoLastRemoval(corrections) {
  const next = createNoteCorrections(corrections)
  next.removed.pop()
  return next
}

export function clearRemovals(corrections) {
  return createNoteCorrections({ ...corrections, removed: [] })
}

/**
 * Apply the corrections to a list of events.
 *
 * `timeOf(event)` must return the event's musical position on the same clock
 * the transcription used. Keys are annotated here with the same deterministic
 * rule the review UI uses, so a caller can pass raw arrangement events.
 *
 * Returns the surviving events (fresh array), the events removed (so the UI can
 * offer a precise Undo), and a count. Original objects are untouched.
 */
export function applyNoteCorrections(events, corrections, { timeOf } = {}) {
  const annotated = annotateNoteKeys(events, { timeOf })
  const removed = new Set(corrections?.removed ?? [])
  if (!removed.size) {
    return { events: annotated, removedEvents: [], removedCount: 0 }
  }
  const kept = []
  const removedEvents = []
  for (const event of annotated) {
    if (event.correctionKey && removed.has(event.correctionKey)) {
      removedEvents.push(event)
      continue
    }
    kept.push(event)
  }
  return { events: kept, removedEvents, removedCount: removedEvents.length }
}

/** Which corrections still match something in this transcription (no drift). */
export function resolveCorrections(events, corrections, { timeOf } = {}) {
  const annotated = annotateNoteKeys(events, { timeOf })
  const keys = new Set(annotated.map((event) => event.correctionKey).filter(Boolean))
  const removed = corrections?.removed ?? []
  return {
    applied: removed.filter((key) => keys.has(key)),
    stale: removed.filter((key) => !keys.has(key)),
  }
}

/** Persistence: a plain JSON object, versioned, safe to store with a take. */
export function serializeNoteCorrections(corrections) {
  return { version: 2, removed: [...new Set(corrections?.removed ?? [])] }
}

/**
 * Parse a stored correction record.
 *
 * Version 1 (research build) used keys without an occurrence suffix. Those
 * keys are retained but can never match a v2 key, so an imported v1 record is
 * inert rather than deleting every duplicate. Version 2 is the current shape.
 */
export function parseNoteCorrections(raw) {
  if (!raw || typeof raw !== 'object') return createNoteCorrections()
  if (raw.version !== 1 && raw.version !== 2) return createNoteCorrections()
  return createNoteCorrections({ removed: raw.removed })
}
