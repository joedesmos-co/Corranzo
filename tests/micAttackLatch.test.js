import { describe, expect, it } from 'vitest'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  markMicAttackConsumed,
  resetMicAttackLatch,
  updateMicAttackRelease,
} from '../src/features/practice/micAttackLatch.js'

describe('micAttackLatch', () => {
  it('blocks further matches until the gate closes after a consumed attack', () => {
    const latch = createMicAttackLatchState()
    expect(canAcceptMicAttackMatch(latch)).toBe(true)

    markMicAttackConsumed(latch)
    expect(canAcceptMicAttackMatch(latch)).toBe(false)

    updateMicAttackRelease(latch, true)
    expect(canAcceptMicAttackMatch(latch)).toBe(false)

    for (let index = 0; index < 3; index += 1) {
      updateMicAttackRelease(latch, false)
    }
    expect(canAcceptMicAttackMatch(latch)).toBe(false)

    updateMicAttackRelease(latch, false)
    expect(canAcceptMicAttackMatch(latch)).toBe(true)
  })

  it('resets only when explicitly cleared', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch)
    resetMicAttackLatch(latch)
    expect(canAcceptMicAttackMatch(latch)).toBe(true)
  })
})
