import { parseMusicXml } from '../musicxml/parseMusicXml.js'

const MIN_PLAYABLE_DURATION_SECONDS = 0.25
export const OMR_GENERATED_PLAYBACK_LIMITS = {
  maxDurationSeconds: 30 * 60,
  maxNoteCount: 12_000,
  maxMeasureCount: 800,
  maxMusicXmlBytes: 6 * 1024 * 1024,
}

function reject(message, details = {}) {
  return {
    ok: false,
    message,
    durationSeconds: details.durationSeconds ?? 0,
    noteCount: details.noteCount ?? 0,
    measureCount: details.measureCount ?? 0,
  }
}

export function validateOmrGeneratedPlayback(musicXmlString, fileName = 'score.omr.musicxml') {
  if (typeof musicXmlString !== 'string' || musicXmlString.trim().length === 0) {
    return reject('Generated playback failed — empty MusicXML.')
  }

  const byteLength = new TextEncoder().encode(musicXmlString).byteLength
  if (byteLength > OMR_GENERATED_PLAYBACK_LIMITS.maxMusicXmlBytes) {
    return reject(
      `Generated playback failed — MusicXML is too large for stable local playback (${Math.round(byteLength / 1024 / 1024)} MB).`,
    )
  }

  try {
    const timingMap = parseMusicXml(musicXmlString, fileName)
    const durationSeconds = timingMap.durationSeconds ?? 0
    const noteCount = timingMap.noteCount ?? timingMap.notes?.filter((note) => !note.isRest && note.midi != null).length ?? 0
    const measureCount = timingMap.measures?.length ?? 0

    if (noteCount <= 0) {
      return reject('Generated playback failed — no playable notes were detected.', {
        durationSeconds,
        noteCount,
        measureCount,
      })
    }

    if (durationSeconds < MIN_PLAYABLE_DURATION_SECONDS) {
      return reject('Generated playback failed — timing duration is zero.', {
        durationSeconds,
        noteCount,
        measureCount,
      })
    }

    if (durationSeconds > OMR_GENERATED_PLAYBACK_LIMITS.maxDurationSeconds) {
      return reject(
        `Generated playback failed — detected duration is too long (${Math.round(durationSeconds / 60)} min). Regenerate from a cleaner PDF or upload MusicXML/MXL.`,
        { durationSeconds, noteCount, measureCount },
      )
    }

    if (noteCount > OMR_GENERATED_PLAYBACK_LIMITS.maxNoteCount) {
      return reject(
        `Generated playback failed — detected too many notes (${noteCount}). Regenerate from a cleaner PDF or upload MusicXML/MXL.`,
        { durationSeconds, noteCount, measureCount },
      )
    }

    if (measureCount > OMR_GENERATED_PLAYBACK_LIMITS.maxMeasureCount) {
      return reject(
        `Generated playback failed — detected too many measures (${measureCount}). Regenerate from a cleaner PDF or upload MusicXML/MXL.`,
        { durationSeconds, noteCount, measureCount },
      )
    }

    return {
      ok: true,
      message: '',
      durationSeconds,
      noteCount,
      measureCount,
    }
  } catch (error) {
    return reject(
      error instanceof Error
        ? `Generated playback failed — ${error.message}`
        : 'Generated playback failed — MusicXML could not be parsed.',
    )
  }
}
