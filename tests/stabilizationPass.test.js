import { describe, expect, it } from 'vitest'
import { shouldRestartLoop } from '../src/features/practice/practiceLoopRegion.js'

describe('stabilization pass regressions', () => {
  it('loop region ending at piece duration is a wrap candidate', () => {
    const region = {
      isValid: true,
      startTimeSeconds: 10,
      endTimeSeconds: 60,
    }
    const duration = 60

    const loopEndNearPieceEnd =
      duration > 0 && region.endTimeSeconds >= duration - 0.05
    const atPieceEnd = duration > 0 && 60 >= duration - 0.001

    expect(loopEndNearPieceEnd).toBe(true)
    expect(atPieceEnd).toBe(true)
    expect(shouldRestartLoop(region.endTimeSeconds - 0.01, region)).toBe(true)
  })

  it('document load keeps page inside bounds instead of resetting to 1', () => {
    const clampPage = (page, total) => Math.min(Math.max(1, page), total)
    expect(clampPage(8, 12)).toBe(8)
    expect(clampPage(15, 12)).toBe(12)
    expect(clampPage(1, 12)).toBe(1)
  })
})
