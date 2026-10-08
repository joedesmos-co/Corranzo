/**
 * Capture device selection (S1 harness): optional exact deviceId with
 * fallback that can never hard-fail on a stale device id.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  acquireInstrumentStream,
  INSTRUMENT_AUDIO_CONSTRAINTS,
} from '../src/features/microphone-input/useMicrophoneCapture.js'

describe('acquireInstrumentStream device selection', () => {
  it('requests the unchanged constraints when no device is selected', async () => {
    const stream = { id: 'default' }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    await expect(acquireInstrumentStream({ getUserMedia })).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: INSTRUMENT_AUDIO_CONSTRAINTS,
      video: false,
    })
  })

  it('adds an exact deviceId for interface/direct-input selection', async () => {
    const stream = { id: 'interface' }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    await expect(
      acquireInstrumentStream({ getUserMedia }, { deviceId: 'abc123' }),
    ).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { ...INSTRUMENT_AUDIO_CONSTRAINTS, deviceId: { exact: 'abc123' } },
      video: false,
    })
  })

  it('retries without the device id when the device is gone, then defaults', async () => {
    const stream = { id: 'recovered' }
    const overconstrained = Object.assign(new Error('gone'), { name: 'OverconstrainedError' })
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(overconstrained)
      .mockRejectedValueOnce(overconstrained)
      .mockResolvedValueOnce(stream)
    await expect(
      acquireInstrumentStream({ getUserMedia }, { deviceId: 'stale' }),
    ).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledTimes(3)
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: INSTRUMENT_AUDIO_CONSTRAINTS,
      video: false,
    })
    expect(getUserMedia).toHaveBeenNthCalledWith(3, { audio: true, video: false })
  })

  it('still surfaces permission denial immediately with a device id', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    const getUserMedia = vi.fn().mockRejectedValue(denied)
    await expect(
      acquireInstrumentStream({ getUserMedia }, { deviceId: 'abc123' }),
    ).rejects.toBe(denied)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})
