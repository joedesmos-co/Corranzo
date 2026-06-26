import { describe, expect, it } from 'vitest'
import {
  canManualScrubMusicXml,
  resolvePracticeTime,
} from '../src/features/practice/practiceClock.js'

describe('practiceClock', () => {
  it('follows playback time while playing', () => {
    expect(
      resolvePracticeTime({
        hasMusicXml: true,
        isPlaying: true,
        playbackCurrentTime: 12.5,
        manualTime: 3,
      }),
    ).toBe(12.5)
  })

  it('uses manual time while paused', () => {
    expect(
      resolvePracticeTime({
        hasMusicXml: true,
        isPlaying: false,
        playbackCurrentTime: 12.5,
        manualTime: 40,
      }),
    ).toBe(40)
  })

  it('allows manual scrub only when paused', () => {
    expect(canManualScrubMusicXml({ isPlaying: false })).toBe(true)
    expect(canManualScrubMusicXml({ isPlaying: true })).toBe(false)
  })

  it('paused transport seek keeps practice time on manual clock after sync', () => {
    const seekTarget = 55
    const manualTime = seekTarget
    const playbackCurrentTime = seekTarget

    expect(
      resolvePracticeTime({
        hasMusicXml: true,
        isPlaying: false,
        playbackCurrentTime,
        manualTime,
      }),
    ).toBe(seekTarget)
  })
})
