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
 * A correction is a CONTENT key, not an array index: `pitch@time`. An index
 * would break the moment the transcription is regenerated (the same audio,
 * a new model run, a new difficulty), because the notes move; a content key
 * still identifies the same musical event. If a later transcription no
 * longer contains that event the correction is simply inert - it never
 * starts deleting something else.
 *
 * What this buys, in the product: the review can show what the model heard,
 * let the musician remove a wrong note, and then regenerate the score with
 * exactly the same notes minus that one. Nothing else changes, and the edit
 * survives the regeneration because it is stored beside the audio rather
 * than inside the score.
 */

const KEY_PRECISION = 2 // 10 ms - far below any audible note boundary

function round(value) {
  const factor = 10 ** KEY_PRECISION
  return Math.round((Number(value) || 0) * factor) / factor
}

/** A stable identity for a note: its pitch and the moment it sounds. */
export function noteKey(note, { timeSeconds = null } = {}) {
  const midi = Math.round(Number(note?.midi))
  const time = timeSeconds ?? note?.seconds ?? note?.startSeconds ?? note?.timeSeconds ?? 0
  if (!Number.isFinite(midi)) return null
  return `${midi}@${round(time).toFixed(KEY_PRECISION)}`
}

export function createNoteCorrections(initial = null) {
  const removed = Array.isArray(initial?.removed) ? initial.removed.filter((k) => typeof k === 'string') : []
  return { version: 1, removed: [...new Set(removed)] }
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
  next.removed = next.removed.filter((k) => k !== key)
  return next
}

export function clearRemovals(corrections) {
  return createNoteCorrections({ ...corrections, removed: [] })
}

/**
 * Apply the corrections to a list of events.
 *
 * `timeOf(event)` must return the event's time in SECONDS on the same clock
 * the transcription used. The caller supplies it because the arrangement
 * works in beats and the transcription in seconds - the conversion is the
 * pipeline's business, not this module's.
 *
 * Returns the surviving events (fresh array, original objects untouched) and
 * a count, so a caller can report what the musician changed.
 */
export function applyNoteCorrections(events, corrections, { timeOf }) {
  const list = Array.isArray(events) ? events : []
  const removed = new Set(corrections?.removed ?? [])
  if (!removed.size) return { events: [...list], removedCount: 0 }
  const kept = []
  let removedCount = 0
  for (const event of list) {
    const key = noteKey(event, { timeSeconds: timeOf ? timeOf(event) : undefined })
    if (key && removed.has(key)) {
      removedCount += 1
      continue
    }
    kept.push(event)
  }
  return { events: kept, removedCount }
}

/** Which corrections still match something in this transcription (no drift). */
export function resolveCorrections(events, corrections, { timeOf }) {
  const keys = new Set(events.map((e) => noteKey(e, { timeSeconds: timeOf ? timeOf(e) : undefined })).filter(Boolean))
  const removed = corrections?.removed ?? []
  return {
    applied: removed.filter((k) => keys.has(k)),
    stale: removed.filter((k) => !keys.has(k)),
  }
}

/** Persistence: a plain JSON object, versioned, safe to store with a take. */
export function serializeNoteCorrections(corrections) {
  return { version: 1, removed: [...new Set(corrections?.removed ?? [])] }
}

export function parseNoteCorrections(raw) {
  if (!raw || typeof raw !== 'object') return createNoteCorrections()
  if (raw.version !== 1) return createNoteCorrections()
  return createNoteCorrections({ removed: raw.removed })
}
