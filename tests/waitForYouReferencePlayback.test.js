import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REFERENCE_PLAYBACK_UI_TIMEOUT_MS,
  waitForReferencePlaybackToSettle,
} from '../src/features/practice/useWaitForYouReferencePlayback.js'

describe('waitForReferencePlaybackToSettle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('releases the UI when reference playback never settles', async () => {
    vi.useFakeTimers()

    const settled = waitForReferencePlaybackToSettle(new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(REFERENCE_PLAYBACK_UI_TIMEOUT_MS)

    await expect(settled).resolves.toBeUndefined()
  })

  it('still reports reference playback failures that happen before the UI guard', async () => {
    await expect(
      waitForReferencePlaybackToSettle(Promise.reject(new Error('offline'))),
    ).rejects.toThrow('offline')
  })
})
