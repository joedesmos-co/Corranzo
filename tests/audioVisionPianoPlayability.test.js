import { describe, it, expect } from 'vitest'
import {
  evaluatePianoHand,
  analyzePianoTransitions,
  validatePianoArrangement,
} from '../src/features/audio-vision/pianoPlayability.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'

describe('piano playability model', () => {
  it('accepts an octave span and five notes in one hand', () => {
    const octave = [60, 72].map((midi) => ({ midi, hand: 'RH' }))
    expect(evaluatePianoHand(octave, { maxSpan: 12 }).playable).toBe(true)
    const five = [60, 64, 67, 71, 72].map((midi) => ({ midi, hand: 'RH' }))
    expect(evaluatePianoHand(five, { maxSpan: 12, maxNotesPerHand: 5 }).playable).toBe(true)
  })

  it('rejects a hand span wider than an octave', () => {
    const wide = [60, 73].map((midi) => ({ midi, hand: 'RH' }))
    const check = evaluatePianoHand(wide, { maxSpan: 12 })
    expect(check.playable).toBe(false)
    expect(check.reasons).toContain('span-13-gt-12')
  })

  it('rejects more than five notes on one hand', () => {
    const six = [60, 62, 64, 65, 67, 69].map((midi) => ({ midi, hand: 'RH' }))
    const check = evaluatePianoHand(six, { maxNotesPerHand: 5 })
    expect(check.playable).toBe(false)
  })

  it('flags left/right hand crossing', () => {
    const diagnostics = analyzePianoTransitions([
      { midi: 72, startBeat: 0, durBeats: 1, hand: 'LH' },
      { midi: 60, startBeat: 0, durBeats: 1, hand: 'RH' },
    ])
    expect(diagnostics.some((d) => d.kind === 'hand-crossing')).toBe(true)
  })

  it('flags an impossible hand jump', () => {
    const diagnostics = analyzePianoTransitions([
      { midi: 48, startBeat: 0, durBeats: 0.5, hand: 'LH' },
      { midi: 72, startBeat: 0.5, durBeats: 0.5, hand: 'LH' },
    ], { maxHandJump: 12, beatSeconds: 0.5 })
    expect(diagnostics.some((d) => d.kind === 'hand-jump')).toBe(true)
  })

  it('validates a whole arrangement', () => {
    const bad = validatePianoArrangement([
      { midi: 48, startBeat: 0, durBeats: 1, hand: 'LH' },
      { midi: 61, startBeat: 0, durBeats: 1, hand: 'LH' }, // span 13
    ], { maxSpan: 12 })
    expect(bad.playable).toBe(false)
    expect(bad.violations[0].kind).toBe('unplayable-hand')

    const good = validatePianoArrangement([
      { midi: 48, startBeat: 0, durBeats: 1, hand: 'LH' },
      { midi: 55, startBeat: 0, durBeats: 1, hand: 'LH' },
      { midi: 72, startBeat: 0, durBeats: 1, hand: 'RH' },
    ], { maxSpan: 12 })
    expect(good.playable).toBe(true)
  })
})

describe('arrangeSoloPiano is playable end to end', () => {
  it('reduces a wide chord to an octave span and reports it', () => {
    const notes = [
      { midi: 48, quantizedStartBeat: 0, quantizedDurBeats: 1, strength: 0.8 },
      { midi: 55, quantizedStartBeat: 0, quantizedDurBeats: 1, strength: 0.7 },
      { midi: 64, quantizedStartBeat: 0, quantizedDurBeats: 1, strength: 0.8 },
      { midi: 76, quantizedStartBeat: 0, quantizedDurBeats: 1, strength: 0.9 },
      { midi: 79, quantizedStartBeat: 0, quantizedDurBeats: 1, strength: 0.7 },
    ]
    const arranged = arrangeSoloPiano({
      quantizedNotes: notes, chords: [], melodyByBeat: [], difficulty: 'advanced',
    })
    expect(arranged.playability).toBeTruthy()
    for (const shape of arranged.playability.shapes) {
      expect(shape.span).toBeLessThanOrEqual(16)
    }
    // Whatever survives must pass the validated gate.
    expect(arranged.playability.violations.filter((v) => v.kind === 'unplayable-hand')).toHaveLength(0)
  })
})

describe('product pipeline exposes piano playability', () => {
  it('reports a validated piano arrangement for a wide chord', async () => {
    const { runAudioArrangementPipeline } = await import('../src/features/audio-vision/audioArrangementPipeline.js')
    const SR = 22050
    const melody = [60, 64, 67, 72, 71, 67, 64, 60]
    const noteSamples = Math.floor(0.28 * SR)
    const gapSamples = Math.floor(0.04 * SR)
    const samples = new Float32Array((noteSamples + gapSamples) * melody.length)
    melody.forEach((midi, index) => {
      const start = index * (noteSamples + gapSamples)
      const hz = 440 * 2 ** ((midi - 69) / 12)
      for (let i = 0; i < noteSamples; i += 1) {
        const t = i / SR
        samples[start + i] = Math.sin(2 * Math.PI * hz * t) * 0.35 * Math.exp(-t / 0.12)
      }
    })
    const out = await runAudioArrangementPipeline(
      { name: 'wide.wav', size: 1000, type: 'audio/wav' },
      new ArrayBuffer(64),
      { targetPart: 'solo-piano', difficulty: 'advanced' },
      {
        decodeAudioDataImpl: async () => ({ channelData: [samples], sampleRate: SR, durationSeconds: samples.length / SR, channelCount: 1 }),
        predictNotes: async () => [48, 55, 64, 76, 79].map((midi) => ({ midi, startSeconds: 0.2, endSeconds: 0.7, amplitude: 0.6 })),
      },
    )
    expect(out.ok).toBe(true)
    expect(out.playability).toBeTruthy()
    const unplayable = (out.playability.violations ?? []).filter((v) => v.kind === 'unplayable-hand')
    expect(unplayable).toHaveLength(0)
  }, 60000)
})
