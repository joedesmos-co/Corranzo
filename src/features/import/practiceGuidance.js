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
    steps.push('Re-upload your score timing file in Library, then return to Practice.')
    return steps
  }

  if (!hasMusicXml) {
    steps.push(
      'In Library, add score timing — export MusicXML or MXL from MuseScore (best accuracy today). PDF alone cannot provide exact timing.',
    )
    steps.push('That unlocks measure numbers, loops, Wait For You, and score follow.')
    return steps.slice(0, 3)
  }

  if (timingReady) {
    if (isDemoPiece) {
      steps.push('Press Play (Space) to hear the minuet and watch the cursor on the score.')
      steps.push('Switch to Wait For You, then pick MIDI or microphone to play along.')
      steps.push('Mute left or right hand under Tracks / hands to focus on one hand.')
    } else {
      steps.push(
        'Score follow may need a quick Setup pass on your PDF — mark a few measures if the cursor looks off.',
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
