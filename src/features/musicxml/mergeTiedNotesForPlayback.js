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

  // Track one open chain head per part/voice/midi so untied chord mates
  // (same onset, different pitch) do not clear a sibling's in-progress tie.
  const chainByKey = new Map()
  let chainSerial = 0
  for (const note of playable) {
    note.suppressPlaybackAttack = false
    const key = `${note.partId}:${note.voice}:${note.midi}`

    if (!note.tieStart && !note.tieStop) {
      continue
    }

    if (note.tieStart) {
      const existing = chainByKey.get(key)
      if (
        existing &&
        note.tieStop &&
        note !== existing &&
        sameTieVoice(existing, note)
      ) {
        // Middle of a multi-note chain: absorb into the head and keep the head open.
        existing.durationQuarters += note.durationQuarters
        existing.durationDivisions += note.durationDivisions
        note.suppressPlaybackAttack = true
        note.tieChainId = existing.tieChainId
        continue
      }
      if (!note.tieChainId) {
        chainSerial += 1
        note.tieChainId = `tie-${chainSerial}`
      }
      chainByKey.set(key, note)
      if (!note.tieStop) {
        continue
      }
    }

    const chainHead = chainByKey.get(key)
    if (chainHead && note !== chainHead && note.tieStop && sameTieVoice(chainHead, note)) {
      chainHead.durationQuarters += note.durationQuarters
      chainHead.durationDivisions += note.durationDivisions
      chainHead.tieStop = !note.tieStart || note.tieStop
      note.suppressPlaybackAttack = true
      note.tieChainId = chainHead.tieChainId
      if (!note.tieStart) {
        chainByKey.delete(key)
      } else if (!note.tieChainId) {
        note.tieChainId = chainHead.tieChainId
        chainByKey.set(key, note)
      }
    }
  }
}
