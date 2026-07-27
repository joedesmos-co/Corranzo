import { describe, expect, it } from 'vitest'
import { mapPlaybackVelocity } from '../src/features/playback/pianoVelocity.js'

describe('mapPlaybackVelocity', () => {
  it('softens peaks and keeps a low audible floor without crushing pp', () => {
    expect(mapPlaybackVelocity(1)).toBeLessThanOrEqual(0.92)
    expect(mapPlaybackVelocity(0)).toBeGreaterThanOrEqual(0.12)
    expect(mapPlaybackVelocity(0)).toBeLessThan(0.2)
    expect(mapPlaybackVelocity(0.5)).toBeLessThan(0.75)
  })

  it('preserves ordering across the dynamic range', () => {
    const soft = mapPlaybackVelocity(0.3)
    const mid = mapPlaybackVelocity(0.55)
    const loud = mapPlaybackVelocity(0.9)
    expect(mid).toBeGreaterThan(soft)
    expect(loud).toBeGreaterThan(mid)
  })
})
