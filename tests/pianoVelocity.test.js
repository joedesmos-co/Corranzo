import { describe, expect, it } from 'vitest'
import { mapPlaybackVelocity } from '../src/features/playback/pianoVelocity.js'

describe('mapPlaybackVelocity', () => {
  it('softens peaks and raises the quiet floor', () => {
    expect(mapPlaybackVelocity(1)).toBeLessThan(0.9)
    expect(mapPlaybackVelocity(0)).toBeGreaterThan(0.2)
    expect(mapPlaybackVelocity(0.5)).toBeLessThan(0.75)
  })

  it('preserves ordering across the dynamic range', () => {
    const soft = mapPlaybackVelocity(0.3)
    const loud = mapPlaybackVelocity(0.9)
    expect(loud).toBeGreaterThan(soft)
  })
})
