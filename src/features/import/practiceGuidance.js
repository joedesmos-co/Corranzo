/**
 * Short “what to do next” steps after files load.
 * Happy-path Practice (PDF + timing ready) returns no instructional copy —
 * users should press Play without onboarding banners.
 */
export function buildPracticeGuidance({
  hasPdf,
  hasMidi,
  hasMusicXml,
  timingError,
  midiError,
  midiPlayable = true,
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
    return steps.slice(0, 3)
  }

  if (midiError) {
    steps.push('Sound file did not load — try uploading again from Library.')
  } else if (hasMidi && !midiPlayable) {
    steps.push('Sound file has no notes — Wait For You still works.')
  }

  return steps.slice(0, 3)
}
