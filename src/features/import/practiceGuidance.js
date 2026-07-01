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
      'In Library, add a timing file — export MusicXML or MXL from MuseScore for best accuracy today.',
    )
    steps.push('That unlocks measure numbers, loops, Wait For You, and the score cursor.')
    return steps.slice(0, 3)
  }

  if (timingReady) {
    if (isDemoPiece) {
      steps.push('Press Play (Space) to hear the minuet and watch the cursor on the score.')
      steps.push('Switch to Wait For You, then pick MIDI or microphone to play along.')
      steps.push('Mute left or right hand under Tracks / hands to focus on one hand.')
    } else {
      steps.push(
        'The score cursor may need a quick setup pass — mark a few measures if it looks off.',
      )
      steps.push('Press Play (Space) to hear the score and move through measures with the cursor.')
      steps.push('Wait For You: Manual continue always works; MIDI and microphone are optional.')
    }
  }

  if (midiError) {
    steps.push('Your sound file did not load — try uploading it again from Library.')
  } else if (!hasMidi && timingReady) {
    steps.push('Optional: add a MIDI sound file in Library for alternate backing audio.')
  } else if (hasMidi && !midiPlayable) {
    steps.push('Your sound file has no notes — you can still practice with Wait For You.')
  }

  return steps.slice(0, 3)
}
