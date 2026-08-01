import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireInstrumentStream,
  attachCaptureRecoveryListeners,
  INSTRUMENT_AUDIO_CONSTRAINTS,
} from '../src/features/microphone-input/useMicrophoneCapture.js'

class FakeTrack extends EventTarget {
  constructor() {
    super()
    this.readyState = 'live'
  }
}

class FakeContext extends EventTarget {
  constructor() {
    super()
    this.state = 'running'
    this.resume = vi.fn(async () => {
      this.state = 'running'
    })
  }
}

function captureResources() {
  const track = new FakeTrack()
  const stream = { getAudioTracks: () => [track] }
  const context = new FakeContext()
  const mediaDevices = new EventTarget()
  return { track, stream, context, mediaDevices }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('microphone capture lifecycle', () => {
  it('requests raw instrument constraints and falls back only for unsupported shapes', async () => {
    const stream = { id: 'fallback' }
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('unsupported'), { name: 'OverconstrainedError' }))
      .mockResolvedValueOnce(stream)
    await expect(acquireInstrumentStream({ getUserMedia })).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: INSTRUMENT_AUDIO_CONSTRAINTS,
      video: false,
    })
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true, video: false })
  })

  it('does not retry a denied permission request', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    const getUserMedia = vi.fn().mockRejectedValue(denied)
    await expect(acquireInstrumentStream({ getUserMedia })).rejects.toBe(denied)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('reports an ended stream once and removes every listener during cleanup', () => {
    const resources = captureResources()
    const onInterrupted = vi.fn()
    const cleanup = attachCaptureRecoveryListeners({ ...resources, onInterrupted })
    resources.track.readyState = 'ended'
    resources.track.dispatchEvent(new Event('ended'))
    resources.mediaDevices.dispatchEvent(new Event('devicechange'))
    expect(onInterrupted).toHaveBeenCalledTimes(1)
    expect(onInterrupted).toHaveBeenCalledWith('stream-ended')
    cleanup()
    resources.track.dispatchEvent(new Event('ended'))
    expect(onInterrupted).toHaveBeenCalledTimes(1)
  })

  it('resumes a suspended or interrupted AudioContext', async () => {
    const resources = captureResources()
    const onInterrupted = vi.fn()
    const cleanup = attachCaptureRecoveryListeners({ ...resources, onInterrupted })
    resources.context.state = 'suspended'
    resources.context.dispatchEvent(new Event('statechange'))
    await Promise.resolve()
    expect(resources.context.resume).toHaveBeenCalledTimes(1)
    expect(onInterrupted).not.toHaveBeenCalled()
    cleanup()
  })

  it('waits for visibility restoration instead of restarting audio while hidden', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    const resources = captureResources()
    const onInterrupted = vi.fn()
    const cleanup = attachCaptureRecoveryListeners({ ...resources, onInterrupted })
    resources.context.state = 'suspended'
    resources.context.dispatchEvent(new Event('statechange'))
    await Promise.resolve()
    expect(resources.context.resume).not.toHaveBeenCalled()
    expect(onInterrupted).not.toHaveBeenCalled()
    cleanup()
  })

  it('reacquires after an AudioContext resume failure or device disconnection signal', async () => {
    const failed = captureResources()
    failed.context.resume = vi.fn().mockRejectedValue(new Error('route lost'))
    const failedInterrupt = vi.fn()
    attachCaptureRecoveryListeners({ ...failed, onInterrupted: failedInterrupt })
    failed.context.state = 'interrupted'
    failed.context.dispatchEvent(new Event('statechange'))
    await Promise.resolve()
    await Promise.resolve()
    expect(failedInterrupt).toHaveBeenCalledWith('audio-context-resume-failed')

    const disconnected = captureResources()
    const disconnectedInterrupt = vi.fn()
    attachCaptureRecoveryListeners({ ...disconnected, onInterrupted: disconnectedInterrupt })
    disconnected.track.readyState = 'ended'
    disconnected.mediaDevices.dispatchEvent(new Event('devicechange'))
    expect(disconnectedInterrupt).toHaveBeenCalledWith('input-device-changed')
  })

  it('stops reacting after explicit stop/disable cleanup', () => {
    const resources = captureResources()
    const onInterrupted = vi.fn()
    const cleanup = attachCaptureRecoveryListeners({ ...resources, onInterrupted })
    cleanup()
    resources.track.readyState = 'ended'
    resources.track.dispatchEvent(new Event('ended'))
    resources.context.state = 'closed'
    resources.context.dispatchEvent(new Event('statechange'))
    resources.mediaDevices.dispatchEvent(new Event('devicechange'))
    expect(onInterrupted).not.toHaveBeenCalled()
  })
})
