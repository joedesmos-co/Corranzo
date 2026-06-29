import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  beginOmrUiBlock,
  endOmrUiBlock,
  isOmrUiBlocked,
  releaseOmrUiLocks,
} from '../src/features/omr/omrUiGuard.js'

describe('omrUiGuard', () => {
  beforeEach(() => {
    releaseOmrUiLocks()
  })

  afterEach(() => {
    releaseOmrUiLocks()
  })

  it('tracks nested generation counters', () => {
    beginOmrUiBlock('a')
    beginOmrUiBlock('b')
    expect(isOmrUiBlocked()).toBe(true)
    endOmrUiBlock()
    expect(isOmrUiBlocked()).toBe(true)
    endOmrUiBlock()
    expect(isOmrUiBlocked()).toBe(false)
  })

  it('releaseOmrUiLocks clears nested generation counters', () => {
    beginOmrUiBlock('a')
    beginOmrUiBlock('b')
    releaseOmrUiLocks()
    expect(isOmrUiBlocked()).toBe(false)
  })
})
