function sameTieVoice(left, right) {
  return (
    left.partId === right.partId &&
    left.voice === right.voice &&
    left.midi === right.midi
  )
}

/**
 * Merge tied note durations and mark continuation notes so playback does not
 * re-attack. Mutates the note objects in place.
 */
export function applyTieSustainToNotes(notes) {
  const playable = notes
    .filter((note) => !note.isRest && note.midi != null)
    .sort(
      (left, right) =>
        left.quarterTime - right.quarterTime ||
        left.voice - right.voice ||
        left.midi - right.midi,
    )

  let chainHead = null
  for (const note of playable) {
    note.suppressPlaybackAttack = false

    if (!note.tieStart && !note.tieStop) {
      chainHead = null
      continue
    }

    if (note.tieStart && !chainHead) {
      chainHead = note
      if (!note.tieStop) {
        continue
      }
    }

    if (chainHead && note !== chainHead && note.tieStop && sameTieVoice(chainHead, note)) {
      chainHead.durationQuarters += note.durationQuarters
      chainHead.durationDivisions += note.durationDivisions
      chainHead.tieStop = !note.tieStart || note.tieStop
      note.suppressPlaybackAttack = true
      if (!note.tieStart) {
        chainHead = null
      }
    }
  }
}
