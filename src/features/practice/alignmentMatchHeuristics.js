/**
 * Heuristics for comparing MIDI playback vs MusicXML timing exports.
 */

export function computePitchOnsetOverlapAtOffset(
  midiNotes,
  musicXmlNotes,
  toleranceSeconds,
  midiTimeOffsetSeconds = 0,
) {
  if (midiNotes.length === 0 && musicXmlNotes.length === 0) {
    return 100
  }
  if (midiNotes.length === 0 || musicXmlNotes.length === 0) {
    return 0
  }

  const usedMidiIndices = new Set()
  let matched = 0

  for (const xmlNote of musicXmlNotes) {
    const matchIndex = midiNotes.findIndex(
      (midiNote, index) =>
        !usedMidiIndices.has(index) &&
        midiNote.midi === xmlNote.midi &&
        Math.abs(midiNote.timeSeconds + midiTimeOffsetSeconds - xmlNote.timeSeconds) <=
          toleranceSeconds,
    )

    if (matchIndex >= 0) {
      usedMidiIndices.add(matchIndex)
      matched += 1
    }
  }

  const denominator = Math.max(midiNotes.length, musicXmlNotes.length)
  return Math.round((matched / denominator) * 100)
}

export function computeBestPitchOverlap(midiNotes, musicXmlNotes, toleranceSeconds, maxShift = 4) {
  let best = 0
  for (let shift = -maxShift; shift <= maxShift; shift += 0.5) {
    best = Math.max(
      best,
      computePitchOnsetOverlapAtOffset(midiNotes, musicXmlNotes, toleranceSeconds, shift),
    )
  }
  return best
}

export function isLikelyRepeatOrEndingDifference({
  pitchOverlapPercent,
  durationDeltaSeconds,
  midiDurationSeconds,
  musicXmlDurationSeconds,
  midiNoteCount,
  musicXmlNoteCount,
}) {
  const pitch = pitchOverlapPercent ?? 0
  if (pitch < 40) {
    return false
  }

  const midiDur = midiDurationSeconds ?? 0
  const xmlDur = musicXmlDurationSeconds ?? 0
  if (midiDur > 0 && xmlDur > 0) {
    const ratio = midiDur / xmlDur
    if (pitch >= 45 && ratio >= 1.35 && ratio <= 2.75) {
      return true
    }
    if (pitch >= 45 && ratio >= 0.36 && ratio <= 0.74) {
      return true
    }
  }

  const xmlCount = Math.max(musicXmlNoteCount, 1)
  const noteRatio = midiNoteCount / xmlCount
  if (pitch >= 45 && noteRatio >= 1.4 && noteRatio <= 2.6) {
    return true
  }

  const absDuration = Math.abs(durationDeltaSeconds ?? 0)
  if (pitch >= 60 && absDuration >= 20 && absDuration / Math.min(midiDur, xmlDur) > 0.35) {
    return true
  }

  return false
}
