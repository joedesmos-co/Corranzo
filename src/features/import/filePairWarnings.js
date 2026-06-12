import { isLikelyRepeatOrEndingDifference } from '../practice/alignmentMatchHeuristics.js'

const DURATION_WARN_SECONDS = 12
const DURATION_STRONG_WARN_SECONDS = 25
const FIRST_NOTE_WARN_SECONDS = 3
const FIRST_NOTE_STRONG_WARN_SECONDS = 6

/**
 * Friendly cross-file warnings (separate from diagnostics assessment).
 */
export function buildFilePairWarnings(diagnostics) {
  if (!diagnostics) {
    return []
  }

  const warnings = []
  const pitchOverlap =
    diagnostics.pitchOverlapAdjustedPercent ?? diagnostics.pitchOverlapPercent ?? 0

  const repeatLike =
    diagnostics.likelyRepeatDifference ??
    isLikelyRepeatOrEndingDifference({
      pitchOverlapPercent: pitchOverlap,
      durationDeltaSeconds: diagnostics.durationDeltaSeconds,
      midiDurationSeconds: diagnostics.midiDurationSeconds,
      musicXmlDurationSeconds: diagnostics.musicXmlDurationSeconds,
      midiNoteCount: diagnostics.midiNoteCount,
      musicXmlNoteCount: diagnostics.musicXmlNoteCount,
    })

  if (repeatLike && pitchOverlap >= 40) {
    warnings.push({
      id: 'pair-repeat-interpretation',
      strength: 'mild',
      message:
        'These files look like the same piece. Total length may differ because repeats or endings are interpreted differently between the sound file and score timing.',
    })
    return warnings
  }

  const durationDelta = diagnostics.durationDeltaSeconds
  const absDuration = Math.abs(durationDelta ?? 0)

  if (Number.isFinite(durationDelta) && absDuration >= DURATION_WARN_SECONDS) {
    const midiLonger = durationDelta > 0
    const strength =
      absDuration >= DURATION_STRONG_WARN_SECONDS ? 'strong' : 'mild'

    warnings.push({
      id: 'pair-duration-mismatch',
      strength,
      message:
        strength === 'strong'
          ? `Playback is about ${absDuration.toFixed(0)} seconds longer than the score timing file. If this is the same piece, repeats may be played in one file but not the other.`
          : `Playback length differs by about ${absDuration.toFixed(0)} seconds${midiLonger ? ' (sound file is longer)' : ' (score timing is longer)'}.`,
    })
  }

  const firstDelta = diagnostics.firstNoteDeltaSeconds
  if (
    firstDelta != null &&
    Number.isFinite(firstDelta) &&
    Math.abs(firstDelta) >= FIRST_NOTE_WARN_SECONDS
  ) {
    const strength =
      Math.abs(firstDelta) >= FIRST_NOTE_STRONG_WARN_SECONDS ? 'strong' : 'mild'
    warnings.push({
      id: 'pair-first-note-offset',
      strength,
      message:
        strength === 'strong'
          ? `The two files start about ${Math.abs(firstDelta).toFixed(1)} seconds apart. Measure position may feel offset during playback.`
          : `Start times are offset by about ${Math.abs(firstDelta).toFixed(1)} seconds between sound and timing files.`,
    })
  }

  if (
    pitchOverlap < 35 &&
    diagnostics.midiNoteCount > 0 &&
    diagnostics.musicXmlNoteCount > 0
  ) {
    warnings.push({
      id: 'pair-low-overlap',
      strength: 'mild',
      message:
        'Note patterns do not line up closely. The files might be different versions — see Advanced for details.',
    })
  }

  return warnings
}
