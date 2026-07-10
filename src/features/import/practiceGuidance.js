/**
 * Short “what to do next” steps after files load (non-alarming).
 */
export function buildPracticeGuidance({
  hasPdf,
  hasMidi,
  hasMusicXml,
  timingReady,
  timingError,
  midiError,
  midiPlayable = true,
  isDemoPiece = false,
}) {
  const steps = []

  if (!hasPdf) {
    steps.push('In Library, upload your sheet music PDF — it appears here in Practice.')
    return steps
  }

  if (timingError) {
    steps.push('Re-upload your timing file in Library, then return to Practice.')
    return steps
  }

  if (!hasMusicXml) {
    steps.push(
      'Add a timing file in Library — MusicXML or MXL from MuseScore works best.',
    )
    steps.push('Unlocks measure numbers, loops, Wait For You, and the score cursor.')
    return steps.slice(0, 3)
  }

  if (timingReady) {
    if (isDemoPiece) {
      steps.push('Press Play (Space) to hear the piece and follow the score cursor.')
      steps.push('Switch to Wait For You and pick MIDI or microphone to play along.')
      steps.push('Open Visual view for larger note targets.')
    } else {
      steps.push(
        'Score cursor may need a quick setup — mark a few measures if it looks off.',
      )
      steps.push('Press Play (Space) to hear the score and move through measures.')
      steps.push('Wait For You: Continue always works; MIDI and mic are optional.')
    }
  }

  if (midiError) {
    steps.push('Sound file did not load — try uploading again from Library.')
  } else if (!hasMidi && timingReady) {
    steps.push('Optional: add a MIDI sound file in Library for backing audio.')
  } else if (hasMidi && !midiPlayable) {
    steps.push('Sound file has no notes — Wait For You still works.')
  }

  return steps.slice(0, 3)
}
