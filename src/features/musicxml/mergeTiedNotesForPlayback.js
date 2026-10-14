/**
 * Tie-chain pairing test. `<voice>` is optional in MusicXML, so a tie-stop
 * whose voice was OMITTED in the source (`voiceDefaulted`) still continues an
 * open same-pitch chain in the same part even when the head lives in another
 * voice — voice-less notes carry no voice evidence to contradict it.
 */
function sameTieChain(left, right) {
  if (left.partId !== right.partId || left.midi !== right.midi) {
    return false
  }
  if (left.voice === right.voice) {
    return true
  }
  return Boolean(right.voiceDefaulted) || Boolean(left.voiceDefaulted)
}

/**
 * Merge tied note durations and mark continuation notes so playback does not
 * re-attack. Mutates the note objects in place.
 *
 * Tie semantics (one chain = one sounding note):
 * - the chain head keeps ONE attack; `durationQuarters` / `durationDivisions`
 *   become the SOUNDING duration (written head + every continuation)
 * - continuations get `suppressPlaybackAttack: true` and fold into the head
 * - chain bookkeeping is explicit and idempotent so consumers can tell
 *   "already merged" from "not merged" and never add a continuation twice:
 *     `writtenDurationQuarters`   the head's own written duration
 *     `tiedChainDurationQuarters` the sounding duration after merging
 *     `tieChainNoteCount`         notes in the chain (head + continuations)
 *     `tieChainSerial`            monotonic chain creation order
 * - a note with BOTH tie start and stop (middle of a chain) absorbs into the
 *   head and stays suppressed; the head stays open for the next continuation
 * - `tieChainId` identifies the chain so consumers never match a same-pitch
 *   note from a different chain (repeated tied notes are common)
 *
 * Voice handling: MusicXML `<voice>` is OPTIONAL. A voice-less tie-stop would
 * otherwise default to voice 1 and never find its voice-2 start, leaving an
 * un-merged re-attack. Pairing therefore prefers the exact voice, then falls
 * back to the most recently opened same-pitch chain in the same part — pitch
 * continuity is the strongest evidence the file provides, and it never
 * invents a voice that the source does not imply.
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

  /** Exact-voice chain first, then the most recent same-pitch chain in the part. */
  const openChainFor = (partId, midi, voice) => {
    const exactKey = `${partId}:${voice}:${midi}`
    const exact = chainByKey.get(exactKey)
    if (exact) {
      return { key: exactKey, head: exact }
    }
    let bestKey = null
    let best = null
    for (const [key, head] of chainByKey) {
      if (head.partId !== partId || head.midi !== midi) {
        continue
      }
      if (!best || (head.tieChainSerial ?? 0) > (best.tieChainSerial ?? 0)) {
        best = head
        bestKey = key
      }
    }
    return best ? { key: bestKey, head: best } : null
  }

  for (const note of playable) {
    note.suppressPlaybackAttack = false
    const key = `${note.partId}:${note.voice}:${note.midi}`

    if (!note.tieStart && !note.tieStop) {
      continue
    }

    if (note.tieStart) {
      const open = openChainFor(note.partId, note.midi, note.voice)
      if (open && note.tieStop && open.head !== note && sameTieChain(open.head, note)) {
        // Middle of a multi-note chain: absorb into the head and keep the head open.
        open.head.durationQuarters += note.durationQuarters
        open.head.durationDivisions += note.durationDivisions
        open.head.tiedChainDurationQuarters = open.head.durationQuarters
        open.head.tiedChainDurationDivisions = open.head.durationDivisions
        open.head.tieChainNoteCount =
          (Number.isFinite(open.head.tieChainNoteCount) ? open.head.tieChainNoteCount : 1) + 1
        note.suppressPlaybackAttack = true
        note.tieChainId = open.head.tieChainId
        continue
      }
      if (!note.tieChainId) {
        chainSerial += 1
        note.tieChainId = `tie-${chainSerial}`
        note.tieChainSerial = chainSerial
      }
      chainByKey.set(key, note)
      // Record the head's own written duration BEFORE any merge so the
      // chain total is always recomputable and never double-counted.
      if (!Number.isFinite(note.writtenDurationQuarters)) {
        note.writtenDurationQuarters = note.durationQuarters
        note.writtenDurationDivisions = note.durationDivisions
        note.tieChainNoteCount = 1
      }
      note.tieChainSerial = note.tieChainSerial ?? chainSerial
      note.tiedChainDurationQuarters = note.durationQuarters
      note.tiedChainDurationDivisions = note.durationDivisions
      if (!note.tieStop) {
        continue
      }
    }

    const open = openChainFor(note.partId, note.midi, note.voice)
    if (open && open.head !== note && note.tieStop && sameTieChain(open.head, note)) {
      open.head.durationQuarters += note.durationQuarters
      open.head.durationDivisions += note.durationDivisions
      open.head.tiedChainDurationQuarters = open.head.durationQuarters
      open.head.tiedChainDurationDivisions = open.head.durationDivisions
      open.head.tieChainNoteCount =
        (Number.isFinite(open.head.tieChainNoteCount) ? open.head.tieChainNoteCount : 1) + 1
      // Do not mutate written tieStart/tieStop on the chain head. Playback
      // sustain is expressed via duration merge + suppressPlaybackAttack only.
      // Overwriting tieStop on the head falsely doubles stop counts in notation
      // summaries and semantic sustain comparisons.
      note.suppressPlaybackAttack = true
      note.tieChainId = open.head.tieChainId
      if (!note.tieStart) {
        chainByKey.delete(open.key)
      }
    }
  }
}
