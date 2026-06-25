import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  warmupPianoSamplesOnIdle,
  __resetPianoSampleWarmupForTests,
} from '../src/features/playback/pianoSampleWarmup.js'

describe('pianoSampleWarmup', () => {
  afterEach(() => {
    __resetPianoSampleWarmupForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('schedules idle preload only once', () => {
    const idle = vi.fn((callback) => {
      callback()
      return 1
    })
    vi.stubGlobal('window', {})
    vi.stubGlobal('requestIdleCallback', idle)

    warmupPianoSamplesOnIdle()
    warmupPianoSamplesOnIdle()

    expect(idle).toHaveBeenCalledTimes(1)
  })

  it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    const setTimeoutMock = vi.fn(() => 0)
    vi.stubGlobal('window', { setTimeout: setTimeoutMock })
    vi.stubGlobal('requestIdleCallback', undefined)

    warmupPianoSamplesOnIdle()

    expect(setTimeoutMock).toHaveBeenCalled()
  })
})
