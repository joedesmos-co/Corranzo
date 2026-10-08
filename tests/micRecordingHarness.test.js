/**
 * WAV round-trip (S1 harness exchange format) + recording packet truth rules.
 */
import { describe, expect, it } from 'vitest'
import {
  decodeWav16PCM,
  encodeWav16PCM,
} from '../src/features/microphone-input/micWavEncoder.js'
import {
  buildRecordingSidecar,
  getPacketItem,
  markSessionItem,
  createRecordingSession,
  MIC_RECORDING_PACKET,
  validatePacketTruth,
} from '../src/features/microphone-input/micRecordingPacket.js'
import { synthSine } from '../src/features/microphone-input/micSyntheticClips.js'

describe('micWavEncoder', () => {
  it('round-trips a sine tone within 1 LSB', () => {
    const samples = synthSine(440, 44100, 0.2, 0.5)
    const bytes = encodeWav16PCM(samples, 44100)
    expect(bytes.length).toBe(44 + samples.length * 2)
    const decoded = decodeWav16PCM(bytes)
    expect(decoded.sampleRate).toBe(44100)
    expect(decoded.samples.length).toBe(samples.length)
    for (let index = 0; index < samples.length; index += 100) {
      expect(Math.abs(decoded.samples[index] - samples[index])).toBeLessThan(1 / 32767 + 1e-6)
    }
  })

  it('hard-clips out-of-range input instead of wrapping', () => {
    const bytes = encodeWav16PCM(new Float32Array([2, -2, 0]), 8000)
    const decoded = decodeWav16PCM(bytes)
    expect(decoded.samples[0]).toBeCloseTo(1, 4)
    expect(decoded.samples[1]).toBeCloseTo(-1, 4)
  })

  it('rejects non-WAV bytes', () => {
    expect(() => decodeWav16PCM(new Uint8Array([1, 2, 3]))).toThrow()
  })
})

describe('micRecordingPacket', () => {
  it('ships the full Stage-2 packet with unique ids', () => {
    expect(MIC_RECORDING_PACKET.length).toBe(23)
    const ids = MIC_RECORDING_PACKET.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(getPacketItem('piano-cmaj7')).not.toBeNull()
    expect(getPacketItem('nope')).toBeNull()
  })

  it('accepts explicit musician-entered chord truth, normalized', () => {
    const item = getPacketItem('piano-c-major-triad')
    expect(validatePacketTruth(item, [67, 60, 64, 60])).toEqual([60, 64, 67])
  })

  it('requires truth for played items and forbids it for silence', () => {
    expect(() => validatePacketTruth(getPacketItem('piano-c4-single'), [])).toThrow()
    expect(() => validatePacketTruth(getPacketItem('control-silence'), [60])).toThrow()
    expect(validatePacketTruth(getPacketItem('control-silence'), [])).toEqual([])
  })

  it('rejects non-integer and out-of-range MIDI', () => {
    const item = getPacketItem('acoustic-em-open')
    expect(() => validatePacketTruth(item, [60.5])).toThrow()
    expect(() => validatePacketTruth(item, [200])).toThrow()
  })

  it('marks detector output as never-truth in the sidecar', () => {
    const sidecar = buildRecordingSidecar({
      packetItemId: 'electric-clean-single',
      truthMidis: [57],
      audio: { sampleRate: 44100, durationSeconds: 2 },
      detectorFrames: [{ t: 0, midi: 57 }],
    })
    expect(sidecar.truth).toEqual([57])
    expect(sidecar.truthSource).toBe('user-entered')
    const missing = buildRecordingSidecar({ packetItemId: 'electric-clean-single' })
    expect(missing.truth).toBeNull()
    expect(missing.truthSource).toBe('missing')
  })

  it('tracks session item status', () => {
    const session = createRecordingSession()
    markSessionItem(session, 'piano-c4-single', { status: 'recorded', truthMidis: [60] })
    expect(session.items['piano-c4-single'].truth).toEqual([60])
  })
})
