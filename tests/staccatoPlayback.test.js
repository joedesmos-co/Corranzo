import { describe, expect, it } from 'vitest'
import {
  playbackDurationSecondsForNote,
  playbackVelocityForNote,
  staccatoPlaybackDurationSeconds,
  ACCENT_VELOCITY_BOOST,
} from '../src/features/playback/staccatoPlayback.js'
import { DEFAULT_MUSICXML_VELOCITY } from '../src/features/musicxml/dynamicsMap.js'

describe('staccatoPlayback', () => {
  it('shortens staccato to half the written duration', () => {
    expect(staccatoPlaybackDurationSeconds(0.5)).toBeCloseTo(0.25, 6)
    expect(staccatoPlaybackDurationSeconds(1)).toBeCloseTo(0.5, 6)
  })

  it('leaves non-staccato notes at written duration', () => {
    expect(playbackDurationSecondsForNote({ durationSeconds: 0.5, staccato: false })).toBeCloseTo(0.5, 6)
    expect(playbackDurationSecondsForNote({ durationSeconds: 0.5, staccato: true })).toBeCloseTo(0.25, 6)
  })

  it('boosts velocity for accented notes without changing non-accented velocity', () => {
    expect(playbackVelocityForNote({ velocity: DEFAULT_MUSICXML_VELOCITY, accent: false })).toBeCloseTo(
      DEFAULT_MUSICXML_VELOCITY,
      6,
    )
    expect(playbackVelocityForNote({ velocity: DEFAULT_MUSICXML_VELOCITY, accent: true })).toBeCloseTo(
      DEFAULT_MUSICXML_VELOCITY + ACCENT_VELOCITY_BOOST,
      6,
    )
  })
})
