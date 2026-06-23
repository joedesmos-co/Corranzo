/**
 * Sustain pedal (MIDI CC64) support for playback realism.
 *
 * Pure helpers: extract pedal down→up spans from CC64 events and lengthen a
 * note so it rings until the pedal lifts, exactly like a real piano. Onsets are
 * never changed — only the note's effective release — so this is safe to apply
 * before the MIDI→score timing mapping without affecting alignment.
 *
 * When no pedal data exists, notes keep their natural duration (the sampled
 * piano's own release tail handles the gentle decay — no over-holding).
 */

/** CC value at/above this (≈64/127) counts as "pedal down". */
const PEDAL_DOWN_THRESHOLD = 0.5

/**
 * Down→up pedal spans (seconds) from a list of CC64 events ({ time, value }).
 * A dangling pedal-down with no matching release is closed at `endFallback`
 * (default Infinity) so callers can decide whether to honour it.
 */
export function extractSustainSpans(controlChanges = [], { endFallback = Infinity } = {}) {
  if (!controlChanges?.length) {
    return []
  }
  const sorted = [...controlChanges]
    .filter((cc) => cc && Number.isFinite(cc.time))
    .sort((a, b) => a.time - b.time)

  const spans = []
  let downAt = null
  for (const cc of sorted) {
    const isDown = (cc.value ?? 0) >= PEDAL_DOWN_THRESHOLD
    if (isDown && downAt == null) {
      downAt = cc.time
    } else if (!isDown && downAt != null) {
      if (cc.time > downAt) {
        spans.push({ start: downAt, end: cc.time })
      }
      downAt = null
    }
  }
  if (downAt != null && endFallback > downAt) {
    // Record the dangling span (possibly Infinity). sustainedDuration ignores
    // infinite-end spans, so this is honest data without any over-hold.
    spans.push({ start: downAt, end: endFallback })
  }
  return spans
}

/**
 * Note duration extended by the pedal: if a pedal span is still down at the
 * note's natural end, hold the note to that span's release. Returns the
 * original duration when no finite span applies (no over-holding).
 */
export function sustainedDuration(noteTime, noteDuration, spans) {
  if (!spans?.length || !Number.isFinite(noteTime) || !Number.isFinite(noteDuration)) {
    return noteDuration
  }
  const noteEnd = noteTime + noteDuration
  let best = noteDuration
  for (const span of spans) {
    if (!Number.isFinite(span.end) || span.end <= noteEnd) {
      continue
    }
    // Pedal is down across the note's natural end → ring until pedal release.
    if (span.start <= noteEnd) {
      best = Math.max(best, span.end - noteTime)
    }
  }
  return best
}

/** Apply sustain to a list of `{ time, duration, ... }` notes (pure, new array). */
export function applySustainToNotes(notes, spans) {
  if (!spans?.length || !notes?.length) {
    return notes
  }
  return notes.map((note) => ({
    ...note,
    duration: sustainedDuration(note.time, note.duration, spans),
  }))
}

/** Collect CC64 events across all MIDI tracks into one global pedal timeline. */
export function collectSustainEvents(midi) {
  const tracks = midi?.tracks ?? []
  const all = []
  for (const track of tracks) {
    const cc = track?.controlChanges
    const sustain = cc?.[64] ?? cc?.sustain ?? null
    if (Array.isArray(sustain)) {
      for (const event of sustain) {
        all.push({ time: event.time, value: event.value })
      }
    }
  }
  return all
}
