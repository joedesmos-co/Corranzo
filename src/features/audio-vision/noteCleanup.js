/**
 * Transcription cleanup: re-detections of a note that is already ringing.
 *
 * The pitch model reports note FRAMES, so a sustained note can be reported
 * again while it is still sounding (the frames re-cross the threshold). The
 * result is a second event at the same pitch, in the middle of the first
 * note's sustain.
 *
 * Measured on the independent synthesized reference (51 truth notes):
 * the model reported 104 notes - every truth note was found, but 58 were
 * invented, and most of the invented ones were exactly this pattern: the
 * chord of 2.4 s was re-detected at 3.6 s, 5.4 s, and so on, each time with
 * a fresh, shorter duration.
 *
 * The evidence that separates a re-detection from a genuine repeat:
 *   - a re-detection's pitch is ALREADY SOUNDING (an earlier note of the
 *     same pitch has not ended yet);
 *   - a genuine repeat happens after the previous note has ENDED.
 *
 * A genuine repeat is therefore never touched, and a held chord is not
 * chopped into a run of staccato notes.
 */

/**
 * Drop the re-detections, keeping the first (longest) occurrence of a pitch
 * that is still ringing.
 *
 * `notes` are model notes with `startSeconds` / `endSeconds` / `midi` and
 * optionally `amplitude`.
 */
export function dropRingingRedetections(notes, {
  enabled = true,
  onsetTimes = null,
  onsetTolerance = 0.07,
  maxGapSeconds = 0.12,
  adjacentSeconds = 0.05,
  amplitudeRatio = 0,
} = {}) {
  if (!enabled || !Array.isArray(notes) || notes.length < 2) {
    return { notes: Array.isArray(notes) ? notes : [], removed: 0, reason: 'disabled' }
  }
  const onsets = Array.isArray(onsetTimes)
    ? onsetTimes.filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
    : null
  const hasOwnOnset = (start) => {
    if (!onsets) return true
    for (const onset of onsets) {
      const delta = Math.abs(onset - start)
      if (delta <= onsetTolerance) return true
      if (onset > start + onsetTolerance) break
    }
    return false
  }
  const sorted = [...notes].sort((a, b) => (a.startSeconds ?? 0) - (b.startSeconds ?? 0))
  const kept = []
  const removed = []
  for (const note of sorted) {
    const start = note.startSeconds ?? 0
    const end = note.endSeconds ?? start
    // The same pitch was sounding (or had just stopped) before this event.
    const ringing = kept.find((other) =>
      other.midi === note.midi &&
      (other.endSeconds ?? other.startSeconds ?? 0) > start - maxGapSeconds)
    if (!ringing) {
      kept.push(note)
      continue
    }
    // ADJACENT evidence: the previous note of this pitch ended right where
    // this one starts - no release, no gap. A genuine repeat has a gap (the
    // note was lifted); a split sustain does not. This is the evidence that
    // separates the two without relying on the attack detector.
    const earlierEnd = ringing.endSeconds ?? ringing.startSeconds ?? 0
    const adjacent = Math.abs(earlierEnd - start) <= adjacentSeconds
    if (!adjacent && onsets) {
      // Not adjacent: only the attack evidence can decide, and a note with an
      // attack of its own is a genuine repeat.
      if (hasOwnOnset(start)) {
        kept.push(note)
        continue
      }
    } else if (!adjacent) {
      kept.push(note)
      continue
    }
    // ADJACENT is not enough on its own: a guitarist strums the same pitch
    // again straight after, and that is a REAL note (measured on GuitarSet:
    // removing adjacent same-pitch notes cost 0.10 event F1 on real
    // performances). What separates a re-detection from a re-strike is the
    // model's own strength: a sustain that gets re-reported is weaker (the
    // frame probability dips where the note was split), while a re-struck
    // note is struck just as hard.
    if (amplitudeRatio > 0) {
      const earlierAmplitude = ringing.amplitude
      const amplitude = note.amplitude
      if (
        Number.isFinite(earlierAmplitude) &&
        Number.isFinite(amplitude) &&
        amplitude >= earlierAmplitude * amplitudeRatio
      ) {
        kept.push(note)
        continue
      }
    }
    const earlierLength = earlierEnd - (ringing.startSeconds ?? 0)
    const newLength = end - start
    if (newLength > earlierLength + 0.05) {
      // The new event covers more time: it is the better claim.
      kept.splice(kept.indexOf(ringing), 1)
      kept.push(note)
      removed.push({ ...ringing, droppedBecause: 'shorter-than-claim' })
    } else {
      removed.push({ ...note, droppedBecause: 'pitch-already-ringing' })
    }
  }
  kept.sort((a, b) => (a.startSeconds ?? 0) - (b.startSeconds ?? 0))
  return { notes: kept, removed: removed.length, dropped: removed }
}
