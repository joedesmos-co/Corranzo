import { describe, expect, it } from 'vitest'
import {
  isFiniteMidi,
  isPlayableTimingNote,
  sanitizePlaybackDurationSeconds,
} from '../src/features/playback/sanitizePlaybackNote.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'
import { playbackDurationSecondsForNote } from '../src/features/playback/staccatoPlayback.js'

describe('sanitizePlaybackNote', () => {
  it('rejects non-finite midi and duration values', () => {
    expect(isFiniteMidi(Number.NaN)).toBe(false)
    expect(isFiniteMidi(128)).toBe(false)
    expect(isPlayableTimingNote({ midi: 60, timeSeconds: 0 })).toBe(true)
    expect(isPlayableTimingNote({ midi: Number.NaN, timeSeconds: 0 })).toBe(false)
    expect(sanitizePlaybackDurationSeconds(Number.NaN)).toBe(0.03)
    expect(playbackDurationSecondsForNote({ durationSeconds: Number.NaN })).toBe(0.03)
  })

  it('buildScoreNoteSchedule skips malformed OMR-like notes', () => {
    const timingMap = {
      durationSeconds: 4,
      measures: [{ number: 1, beats: 4, beatType: 4 }],
      notes: [
        { midi: 60, timeSeconds: 0, durationSeconds: 0.5, isRest: false },
        { midi: Number.NaN, timeSeconds: 1, durationSeconds: 0.5, isRest: false },
        { midi: 62, timeSeconds: 2, durationSeconds: Number.NaN, isRest: false },
      ],
    }
    const events = buildScoreNoteSchedule(timingMap)
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(Number.isFinite(event.midi)).toBe(true)
      expect(event.baseDurationSeconds).toBeGreaterThan(0)
    }
  })
})
