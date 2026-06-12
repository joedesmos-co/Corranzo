import { quartersToSeconds } from '../musicxml/timingMath.js'
import { formatTime } from '../playback/formatTime.js'
import {
  computeBestPitchOverlap,
  computePitchOnsetOverlapAtOffset,
  isLikelyRepeatOrEndingDifference,
} from './alignmentMatchHeuristics.js'

const ONSET_TOLERANCE_SECONDS = 0.15

export const ALIGNMENT_ASSESSMENT = {
  LIKELY_MATCH: 'likely-match',
  UNCERTAIN: 'uncertain',
  UNLIKELY_MATCH: 'unlikely-match',
}

function formatSignedSeconds(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) {
    return '—'
  }
  const sign = seconds >= 0 ? '+' : ''
  return `${sign}${seconds.toFixed(3)} s`
}

function formatTempoMapSummary(tempos) {
  if (!tempos?.length) {
    return 'No tempo data'
  }
  if (tempos.length === 1) {
    return `${Math.round(tempos[0].bpm)} BPM`
  }
  const preview = tempos
    .slice(0, 4)
    .map((tempo) => `${Math.round(tempo.bpm)} @ ${formatTime(tempo.timeSeconds)}`)
    .join(', ')
  const suffix = tempos.length > 4 ? ` (+${tempos.length - 4} more)` : ''
  return `${tempos.length} changes: ${preview}${suffix}`
}

function buildMusicXmlTempoSummary(tempoChanges) {
  const tempos = tempoChanges.map((change) => ({
    bpm: change.bpm,
    timeSeconds: quartersToSeconds(change.quarterTime, tempoChanges),
  }))
  return formatTempoMapSummary(tempos)
}


function assessAlignment({
  noteCountDelta,
  midiNoteCount,
  musicXmlNoteCount,
  durationDeltaSeconds,
  pitchOverlapPercent,
  firstNoteDeltaSeconds,
  likelyRepeatDifference,
}) {
  if (likelyRepeatDifference && pitchOverlapPercent >= 45) {
    return ALIGNMENT_ASSESSMENT.UNCERTAIN
  }

  const maxNoteCount = Math.max(midiNoteCount, musicXmlNoteCount, 1)
  const noteCountMismatch = Math.abs(noteCountDelta) / maxNoteCount > 0.15
  const durationMismatch = Math.abs(durationDeltaSeconds) > 8
  const pitchMismatch = pitchOverlapPercent < 45
  const firstNoteMismatch =
    firstNoteDeltaSeconds != null && Math.abs(firstNoteDeltaSeconds) > 3

  if (pitchMismatch || durationMismatch || noteCountMismatch || firstNoteMismatch) {
    if (pitchOverlapPercent >= 70 && Math.abs(durationDeltaSeconds) <= 2) {
      return ALIGNMENT_ASSESSMENT.UNCERTAIN
    }
    return ALIGNMENT_ASSESSMENT.UNLIKELY_MATCH
  }

  if (pitchOverlapPercent >= 75 && Math.abs(durationDeltaSeconds) <= 2) {
    return ALIGNMENT_ASSESSMENT.LIKELY_MATCH
  }

  return ALIGNMENT_ASSESSMENT.UNCERTAIN
}

const ASSESSMENT_MESSAGES = {
  [ALIGNMENT_ASSESSMENT.LIKELY_MATCH]:
    'These files look reasonably aligned. Small differences are still possible.',
  [ALIGNMENT_ASSESSMENT.UNCERTAIN]:
    'These files may match with small timing differences (for example repeats played in one export only).',
  [ALIGNMENT_ASSESSMENT.UNLIKELY_MATCH]:
    'These files may not represent the same performance. Do not rely on measure sync yet.',
}

export function computeAlignmentDiagnostics(midiProfile, timingMap) {
  if (!midiProfile || !timingMap) {
    return null
  }

  const musicXmlNotes = timingMap.notes.filter(
    (note) => !note.isRest && note.midi != null,
  )

  const noteCountDelta = midiProfile.noteCount - timingMap.noteCount
  const musicXmlDurationSeconds =
    timingMap.writtenDurationSeconds ?? timingMap.durationSeconds
  const durationDeltaSeconds = midiProfile.durationSeconds - musicXmlDurationSeconds

  const firstMusicXmlNote = musicXmlNotes[0] ?? null
  const firstMidiNote = midiProfile.firstNote

  const firstNoteDeltaSeconds =
    firstMidiNote && firstMusicXmlNote
      ? firstMidiNote.timeSeconds - firstMusicXmlNote.timeSeconds
      : null

  const pitchOverlapPercent = computePitchOnsetOverlapAtOffset(
    midiProfile.notes,
    musicXmlNotes,
    ONSET_TOLERANCE_SECONDS,
    0,
  )

  const pitchOverlapAdjustedPercent = computeBestPitchOverlap(
    midiProfile.notes,
    musicXmlNotes,
    ONSET_TOLERANCE_SECONDS,
    4,
  )

  const likelyRepeatDifference = isLikelyRepeatOrEndingDifference({
    pitchOverlapPercent: pitchOverlapAdjustedPercent,
    durationDeltaSeconds,
    midiDurationSeconds: midiProfile.durationSeconds,
    musicXmlDurationSeconds,
    midiNoteCount: midiProfile.noteCount,
    musicXmlNoteCount: timingMap.noteCount,
  })

  const assessment = assessAlignment({
    noteCountDelta,
    midiNoteCount: midiProfile.noteCount,
    musicXmlNoteCount: timingMap.noteCount,
    durationDeltaSeconds,
    pitchOverlapPercent: pitchOverlapAdjustedPercent,
    firstNoteDeltaSeconds,
    likelyRepeatDifference,
  })

  return {
    midiNoteCount: midiProfile.noteCount,
    musicXmlNoteCount: timingMap.noteCount,
    noteCountDelta,
    midiDurationSeconds: midiProfile.durationSeconds,
    musicXmlDurationSeconds,
    musicXmlPerformedDurationSeconds: timingMap.durationSeconds,
    writtenMeasureCount:
      timingMap.performedMeasureTimeline?.diagnostics?.writtenMeasureCount ??
      timingMap.measures?.length ??
      0,
    performedMeasureCount:
      timingMap.performedMeasureTimeline?.diagnostics?.performedMeasureCount ??
      timingMap.measures?.length ??
      0,
    repeatSectionCount:
      timingMap.performedMeasureTimeline?.diagnostics?.repeatSections?.length ?? 0,
    endingCount: timingMap.performedMeasureTimeline?.diagnostics?.endings?.length ?? 0,
    usesPerformedTimeline:
      timingMap.performedMeasureTimeline?.diagnostics?.usesPerformedTimeline ?? false,
    durationDeltaSeconds,
    durationDeltaLabel: formatSignedSeconds(durationDeltaSeconds),
    firstMidiNote,
    firstMusicXmlNote,
    firstNoteDeltaSeconds,
    firstNoteDeltaLabel: formatSignedSeconds(firstNoteDeltaSeconds),
    pitchOverlapPercent,
    pitchOverlapAdjustedPercent,
    likelyRepeatDifference,
    onsetToleranceSeconds: ONSET_TOLERANCE_SECONDS,
    midiTempoSummary: formatTempoMapSummary(midiProfile.tempos),
    musicXmlTempoSummary: buildMusicXmlTempoSummary(timingMap.tempoChanges),
    assessment,
    assessmentMessage: ASSESSMENT_MESSAGES[assessment],
    disclaimer:
      'Diagnostics compare separate files on a shared clock. They do not change playback or correct timing.',
  }
}
