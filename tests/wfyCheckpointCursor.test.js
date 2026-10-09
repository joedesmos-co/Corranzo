import { describe, expect, it } from 'vitest'
import { resolveWfyCheckpointCursor } from '../src/features/score-follow/wfyCheckpointCursor.js'
import { WFY_STATUS } from '../src/features/practice/waitForYouEngine.js'

const checkpoint = { id: 'cp-0', measureNumber: 3, timeSeconds: 1.5, expectedMidis: [60] }
const target = { visible: true, page: 2, x: 0.42, y: 0.3, noteAnchorY: 0.34, targetKey: 'cp-0' }
const timelineCursor = { visible: true, page: 2, measureNumber: 3, x: 0.3, y: 0.5, smoothed: true }

function args(overrides = {}) {
  return {
    practiceMode: 'wait-for-you',
    checkpointMode: 'note',
    waitForYouStatus: WFY_STATUS.WAITING,
    currentCheckpoint: checkpoint,
    noteTarget: target,
    scoreFollowCursor: timelineCursor,
    ...overrides,
  }
}

describe('WFY checkpoint-locked cursor', () => {
  it('locks x to the checkpoint notehead, keeps system-anchored y', () => {
    const cursor = resolveWfyCheckpointCursor(args())
    expect(cursor).toMatchObject({
      visible: true,
      page: 2,
      measureNumber: 3,
      x: 0.42,
      y: 0.5,
      smoothed: false,
      checkpointLocked: true,
    })
  })

  it('stays out of Preview / Play Along / beat mode', () => {
    expect(resolveWfyCheckpointCursor(args({ practiceMode: 'preview' }))).toBeNull()
    expect(resolveWfyCheckpointCursor(args({ practiceMode: 'play-along' }))).toBeNull()
    expect(resolveWfyCheckpointCursor(args({ checkpointMode: 'beat' }))).toBeNull()
    expect(resolveWfyCheckpointCursor(args({ waitForYouStatus: WFY_STATUS.COMPLETE }))).toBeNull()
    expect(resolveWfyCheckpointCursor(args({ noteTarget: { visible: false } }))).toBeNull()
    expect(resolveWfyCheckpointCursor(args({ currentCheckpoint: null }))).toBeNull()
  })

  it('follows score-follow visibility (no geometry, no bar)', () => {
    const cursor = resolveWfyCheckpointCursor(
      args({ scoreFollowCursor: { ...timelineCursor, visible: false } }),
    )
    expect(cursor.visible).toBe(false)
  })
})
