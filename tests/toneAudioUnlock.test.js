import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Tone from 'tone'
import {
  __resetToneAudioUnlockForTests,
  awaitToneStarted,
  hasUserUnlockedAudio,
  startToneFromUserGesture,
} from '../src/features/audio/toneAudioUnlock.js'

vi.mock('tone', () => ({
  getContext: vi.fn(() => ({ state: 'suspended' })),
  start: vi.fn(() => Promise.resolve()),
}))

describe('toneAudioUnlock', () => {
  afterEach(() => {
    __resetToneAudioUnlockForTests()
    vi.clearAllMocks()
    Tone.getContext.mockReturnValue({ state: 'suspended' })
  })

  it('dedupes concurrent startToneFromUserGesture calls', async () => {
    await Promise.all([startToneFromUserGesture(), startToneFromUserGesture()])
    expect(Tone.start).toHaveBeenCalledTimes(1)
    expect(hasUserUnlockedAudio()).toBe(true)
  })

  it('skips Tone.start when context is already running', async () => {
    Tone.getContext.mockReturnValue({ state: 'running' })
    await startToneFromUserGesture()
    expect(Tone.start).not.toHaveBeenCalled()
    expect(hasUserUnlockedAudio()).toBe(true)
  })

  it('awaitToneStarted uses the hook promise without a second start', async () => {
    const unlock = Promise.resolve()
    await awaitToneStarted(unlock)
    expect(Tone.start).not.toHaveBeenCalled()
    expect(hasUserUnlockedAudio()).toBe(true)
  })
})
