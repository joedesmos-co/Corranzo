import { describe, expect, it } from 'vitest'
import {
  canMarkWaitForYouCheckpoint,
  getNextCheckpointIndex,
  getWaitForYouStatus,
  shouldBlockWaitForYouAdvance,
  WFY_STATUS,
} from '../src/features/practice/waitForYouEngine.js'

describe('waitForYouEngine', () => {
  it('reports complete when the checkpoint index reaches the count', () => {
    expect(
      getWaitForYouStatus({ active: true, checkpointCount: 5, checkpointIndex: 5 }),
    ).toBe(WFY_STATUS.COMPLETE)
  })

  it('does not allow marking past the final checkpoint', () => {
    expect(
      canMarkWaitForYouCheckpoint({
        active: true,
        checkpointCount: 5,
        checkpointIndex: 5,
      }),
    ).toBe(false)
  })

  it('allows marking while waiting on a valid checkpoint', () => {
    expect(
      canMarkWaitForYouCheckpoint({
        active: true,
        checkpointCount: 5,
        checkpointIndex: 2,
      }),
    ).toBe(true)
  })

  it('does not allow marking when inactive', () => {
    expect(
      canMarkWaitForYouCheckpoint({
        active: false,
        checkpointCount: 5,
        checkpointIndex: 2,
      }),
    ).toBe(false)
  })

  it('does not allow marking when there are no checkpoints', () => {
    expect(
      canMarkWaitForYouCheckpoint({
        active: true,
        checkpointCount: 0,
        checkpointIndex: 0,
      }),
    ).toBe(false)
    expect(
      getWaitForYouStatus({ active: true, checkpointCount: 0, checkpointIndex: 0 }),
    ).toBe(WFY_STATUS.NO_CHECKPOINTS)
  })

  it('blocks duplicate advance signals for the same checkpoint id', () => {
    expect(shouldBlockWaitForYouAdvance('cp-1', 'cp-1')).toBe(true)
    expect(shouldBlockWaitForYouAdvance('cp-1', 'cp-2')).toBe(false)
    expect(shouldBlockWaitForYouAdvance(null, 'cp-1')).toBe(false)
  })

  it('advances to the sentinel index at the end of the list', () => {
    expect(getNextCheckpointIndex(4, 5)).toBe(5)
    expect(getNextCheckpointIndex(5, 5)).toBe(5)
  })
})
