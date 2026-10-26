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

const MAX_PITCH_DELTA = 24
const MAX_TIME_DELTA_BEATS = 16

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sanitizeEdit(edit) {
  if (!edit || typeof edit !== 'object') return null
  const clean = {}
  const pitchDelta = finiteOrNull(edit.pitchDelta)
  if (pitchDelta != null) {
    const bounded = Math.max(-MAX_PITCH_DELTA, Math.min(MAX_PITCH_DELTA, Math.round(pitchDelta)))
    if (bounded !== 0) clean.pitchDelta = bounded
  }
  const onsetDeltaBeats = finiteOrNull(edit.onsetDeltaBeats)
  if (onsetDeltaBeats != null) {
    const bounded = Math.max(-MAX_TIME_DELTA_BEATS, Math.min(MAX_TIME_DELTA_BEATS, onsetDeltaBeats))
    if (bounded !== 0) clean.onsetDeltaBeats = Math.round(bounded * 1000) / 1000
  }
  const durationDeltaBeats = finiteOrNull(edit.durationDeltaBeats)
  if (durationDeltaBeats != null) {
    const bounded = Math.max(-MAX_TIME_DELTA_BEATS, Math.min(MAX_TIME_DELTA_BEATS, durationDeltaBeats))
    if (bounded !== 0) clean.durationDeltaBeats = Math.round(bounded * 1000) / 1000
  }
  return Object.keys(clean).length ? clean : null
}

function sanitizeAdded(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const entry of list) {
    const midi = finiteOrNull(entry?.midi)
    const startBeat = finiteOrNull(entry?.startBeat)
    const durBeats = finiteOrNull(entry?.durBeats)
    if (midi == null || startBeat == null || durBeats == null) continue
    const id = typeof entry?.id === 'string' && entry.id.length ? entry.id : `user-${out.length + 1}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      midi: Math.max(21, Math.min(108, Math.round(midi))),
      startBeat: Math.max(0, startBeat),
      durBeats: Math.max(0.05, durBeats),
      hand: entry?.hand === 'LH' ? 'LH' : 'RH',
      role: typeof entry?.role === 'string' ? entry.role : 'user',
    })
  }
  return out
}

export function createNoteCorrections(initial = null) {
  const removed = Array.isArray(initial?.removed)
    ? initial.removed.filter((key) => typeof key === 'string' && key.length > 0)
    : []
  // Version 3 adds per-note edits (pitch/onset/duration deltas) and
  // musician-added notes. A version 1 or 2 record loads as removals only.
  const notes = {}
  if (initial?.notes && typeof initial.notes === 'object') {
    for (const [key, edit] of Object.entries(initial.notes)) {
      if (typeof key !== 'string' || !key.length) continue
      const clean = sanitizeEdit(edit)
      if (clean) notes[key] = clean
    }
  }
  return {
    version: 3,
    removed: [...new Set(removed)],
    notes,
    added: sanitizeAdded(initial?.added),
  }
}

/** Set (or clear) one note's edits. Returns a NEW corrections object. */
export function setNoteEdit(corrections, key, edit) {
  const next = createNoteCorrections(corrections)
  if (!key) return next
  if (edit === null) {
    delete next.notes[key]
    return next
  }
  const clean = sanitizeEdit({ ...(next.notes[key] ?? {}), ...(edit ?? {}) })
  if (clean) next.notes[key] = clean
  else delete next.notes[key]
  return next
}

/** The edits recorded for one note (empty object when none). */
export function noteEdit(corrections, key) {
  return { ...(corrections?.notes?.[key] ?? {}) }
}

/** Add a musician-created note. Returns a NEW corrections object. */
export function addUserNote(corrections, note) {
  const next = createNoteCorrections(corrections)
  const id = `user-${Date.now().toString(36)}-${next.added.length + 1}`
  const [clean] = sanitizeAdded([{ ...note, id: note?.id ?? id }])
  if (clean) next.added.push(clean)
  return next
}

export function removeUserNote(corrections, id) {
  const next = createNoteCorrections(corrections)
  next.added = next.added.filter((note) => note.id !== id)
  return next
}

/** Undo the most recent edit of any kind (removals last-in-first-out). */
export function undoLastEdit(corrections) {
  const next = createNoteCorrections(corrections)
  const addedKeys = Object.keys(next.notes)
  if (addedKeys.length) {
    delete next.notes[addedKeys[addedKeys.length - 1]]
    return next
  }
  if (next.added.length) {
    next.added.pop()
    return next
  }
  next.removed.pop()
  return next
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

/** Clear every kind of correction. The review UI's "Clear all" action. */
export function clearAllCorrections() {
  return createNoteCorrections()
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
  const edits = corrections?.notes ?? {}
  const addedNotes = corrections?.added ?? []
  const addedIdsRemoved = new Set(addedNotes.filter((n) => removed.has(`user:${n.id}`)).map((n) => n.id))

  // 1. removals (they win over every other edit)
  const removedEvents = []
  let kept = []
  for (const event of annotated) {
    if (event.correctionKey && removed.has(event.correctionKey)) {
      removedEvents.push(event)
      continue
    }
    kept.push(event)
  }

  // 2. pitch, 3. onset, 4. duration - only on notes that survived, and only
  //    the fields the musician actually changed.
  let editedCount = 0
  kept = kept.map((event) => {
    const edit = event.correctionKey ? edits[event.correctionKey] : null
    if (!edit) return event
    const next = { ...event }
    if (edit.pitchDelta) next.midi = Math.max(21, Math.min(108, Math.round(event.midi) + edit.pitchDelta))
    if (edit.onsetDeltaBeats) {
      const startBeat = (event.startBeat ?? 0) + edit.onsetDeltaBeats
      next.startBeat = Math.max(0, Math.round(startBeat * 1000) / 1000)
    }
    if (edit.durationDeltaBeats) {
      next.durBeats = Math.max(0.05, Math.round(((event.durBeats ?? 0.25) + edit.durationDeltaBeats) * 1000) / 1000)
    }
    editedCount += 1
    return next
  })

  // 5. added notes. A note the musician adds is never allowed to duplicate an
  //    existing (pitch, onset) - that would create two identical practice
  //    targets and an invalid-looking chord - it is skipped and reported.
  const skippedAdditions = []
  const added = []
  for (const note of addedNotes) {
    if (addedIdsRemoved.has(note.id)) continue
    const duplicate = kept.some((event) =>
      Math.round(event.midi) === note.midi && Math.abs((event.startBeat ?? 0) - note.startBeat) <= 0.01)
    if (duplicate) { skippedAdditions.push(note.id); continue }
    added.push({
      midi: note.midi,
      startBeat: note.startBeat,
      durBeats: note.durBeats,
      hand: note.hand,
      role: note.role,
      provenance: 'user',
      correctionKey: `user:${note.id}`,
      isUserAdded: true,
    })
  }
  // The surviving events keep their incoming order (the arranger emits them
  // deterministically, and the score writer groups by measure itself); added
  // notes are appended in time order. Reordering here would change unrelated
  // notation, which the correction layer must never do.
  added.sort((a, b) => (a.startBeat ?? 0) - (b.startBeat ?? 0) || a.midi - b.midi)
  const finalEvents = [...kept, ...added]
  const removedAddedNotes = addedNotes
    .filter((note) => addedIdsRemoved.has(note.id))
    .map((note) => ({
      midi: note.midi,
      startBeat: note.startBeat,
      durBeats: note.durBeats,
      hand: note.hand,
      role: note.role,
      provenance: 'user',
      correctionKey: `user:${note.id}`,
      isUserAdded: true,
    }))
  return {
    events: finalEvents,
    removedEvents,
    removedAddedNotes,
    removedCount: removedEvents.length + removedAddedNotes.length,
    editedCount,
    addedCount: added.length,
    skippedAdditions,
  }
}

/**
 * Which corrections still match something in this transcription (no drift).
 * Removals of user-added notes are matched against the added-note ids, not the
 * transcription keys; edits that no longer match a transcription key are stale
 * rather than silently applying to a different note.
 */
export function resolveCorrections(events, corrections, { timeOf } = {}) {
  const annotated = annotateNoteKeys(events, { timeOf })
  const keys = new Set(annotated.map((event) => event.correctionKey).filter(Boolean))
  const addedKeys = new Set((corrections?.added ?? []).map((note) => `user:${note.id}`))
  const removed = corrections?.removed ?? []
  const transcriptionRemovals = removed.filter((key) => !key.startsWith('user:'))
  const userRemovals = removed.filter((key) => key.startsWith('user:'))
  const applied = [
    ...transcriptionRemovals.filter((key) => keys.has(key)),
    ...userRemovals.filter((key) => addedKeys.has(key)),
  ]
  const staleEdits = Object.keys(corrections?.notes ?? {}).filter((key) => !keys.has(key))
  const stale = [
    ...transcriptionRemovals.filter((key) => !keys.has(key)),
    ...userRemovals.filter((key) => !addedKeys.has(key)),
    ...staleEdits,
  ]
  return { applied, stale: [...new Set(stale)] }
}

/** Persistence: a plain JSON object, versioned, safe to store with a take. */
export function serializeNoteCorrections(corrections) {
  const clean = createNoteCorrections(corrections)
  return { version: 3, removed: clean.removed, notes: clean.notes, added: clean.added }
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
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) return createNoteCorrections()
  // v1/v2 records carry removals only; v3 adds note edits and added notes.
  return createNoteCorrections({ removed: raw.removed, notes: raw.notes, added: raw.added })
}
