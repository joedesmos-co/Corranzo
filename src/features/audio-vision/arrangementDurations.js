/**
 * Arrangement note durations: a note sounds until the next note in its own
 * part replaces it.
 *
 * The pitch model reports a note's DURATION from its frame probabilities, and
 * that duration is systematically too short: measured on the independent
 * synthesized reference, the model's durations are 348 ms off on average
 * (a quarter note comes out as a sixteenth), and the arrangement inherited
 * 168 ms of that error. The result is the "awkward short note values" a
 * musician hears: staccato chords and clipped melody notes.
 *
 * A musician writes a note's length by when the NEXT note in that part
 * arrives, not by how long the sound detector thought the key was held. The
 * onsets are the reliable evidence (they are accurate: 5 ms MAE), so the
 * duration is derived from them:
 *
 *   duration = the gap until the next onset in the same hand (or the same
 *              voice for a single-part instrument), capped so a note cannot
 *              ring on forever.
 *
 * This changes HOW LONG a note is written, never WHICH notes are written:
 * no note is deleted, none is transposed, and the onsets (the rhythm) are
 * untouched.
 */

/**
 * @param events  arrangement events with `startBeat`, `durBeats` and
 *                optionally `hand` ('RH' / 'LH') or `voice`.
 * @param options `maxBeats` caps a single note's length; `minBeats` keeps a
 *                note from vanishing.
 */
export function holdNotesUntilNextOnset(events, { maxBeats = 8, minBeats = 0.25, enabled = true } = {}) {
  if (!enabled || !Array.isArray(events) || events.length < 2) {
    return { events: Array.isArray(events) ? events : [], changed: 0 }
  }
  // Group by the part the note belongs to: the right hand, the left hand, or
  // (for a single-voice instrument) the one voice.
  const groups = new Map()
  for (const event of events) {
    const key = event.hand ?? event.voice ?? 'V1'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(event)
  }
  let changed = 0
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => (a.startBeat ?? 0) - (b.startBeat ?? 0))
    for (let i = 0; i < sorted.length; i += 1) {
      const event = sorted[i]
      const next = sorted[i + 1]
      const start = event.startBeat ?? 0
      if (!next) {
        // The last note of the part keeps the model's length.
        continue
      }
      const gap = (next.startBeat ?? start) - start
      if (gap <= 0) continue
      const held = Math.min(gap, maxBeats)
      if (held <= (event.durBeats ?? 0) + 1e-6) continue
      event.durBeats = Math.max(minBeats, Math.round(held * 100) / 100)
      changed += 1
    }
  }
  return { events, changed }
}
