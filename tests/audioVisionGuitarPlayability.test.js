import { describe, it, expect } from 'vitest'
import {
  choosePlayableVoicing,
  evaluateShape,
  validateGuitarArrangement,
  STANDARD_TUNING,
} from '../src/features/audio-vision/guitarPlayability.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'

const span = (positions) => evaluateShape(positions, { maxSpan: 4 }).shape.span

describe('guitar playability model', () => {
  it('standard tuning is string 1 = E4 ... string 6 = E2', () => {
    expect(STANDARD_TUNING).toEqual([64, 59, 55, 50, 45, 40])
  })

  it('reproduces and refuses the reported nine-fret span (string 1 fret 16 + string 6 fret 7)', () => {
    // The exact user report: midi 80 (string 1 fret 16) + midi 47 (string 6 fret 7).
    const impossible = [
      { midi: 80, string: 1, fret: 16 },
      { midi: 47, string: 6, fret: 7 },
    ]
    const check = evaluateShape(impossible, { maxSpan: 4 })
    expect(check.playable).toBe(false)
    expect(check.reasons).toContain('span-9-gt-4')

    const gate = validateGuitarArrangement(
      impossible.map((p) => ({ ...p, startBeat: 0 })),
      { maxSpan: 4 },
    )
    expect(gate.playable).toBe(false)
    expect(gate.violations[0].kind).toBe('unplayable-shape')
  })

  it('keeps the melody and drops the unreachable bass instead of exporting an impossible grip', () => {
    const voicing = choosePlayableVoicing(
      [{ midi: 47, isBassRoot: true }, { midi: 80, isMelody: true }],
      { maxSpan: 4 },
    )
    expect(voicing.positions.some((p) => p.midi === 80)).toBe(true)
    expect(voicing.positions.some((p) => p.midi === 47)).toBe(false)
    expect(voicing.simplified).toBe(true)
    expect(span(voicing.positions)).toBeLessThanOrEqual(4)
  })

  it('never puts two simultaneous notes on the same string', () => {
    const voicing = choosePlayableVoicing(
      [{ midi: 64 }, { midi: 64 }, { midi: 67 }],
      { maxSpan: 4 },
    )
    const strings = voicing.positions.map((p) => p.string)
    expect(new Set(strings).size).toBe(strings.length)
  })

  it('reduces a dense piano-like chord to a playable shape', () => {
    const dense = [40, 48, 55, 60, 64, 67, 72, 76, 79].map((midi) => ({ midi }))
    const voicing = choosePlayableVoicing(dense, { maxSpan: 4, maxFingers: 4 })
    expect(voicing.positions.length).toBeGreaterThan(0)
    expect(voicing.positions.length).toBeLessThanOrEqual(4 + 1)
    expect(span(voicing.positions)).toBeLessThanOrEqual(4)
    expect(voicing.simplified).toBe(true)
  })

  it('accepts playable open and barre chords', () => {
    const openC = [
      { midi: 48, string: 5, fret: 3 },
      { midi: 52, string: 4, fret: 2 },
      { midi: 55, string: 3, fret: 0 },
      { midi: 60, string: 2, fret: 1 },
      { midi: 64, string: 1, fret: 0 },
    ]
    expect(evaluateShape(openC, { maxSpan: 4 }).playable).toBe(true)

    const fBarre = [
      { midi: 53, string: 6, fret: 1 },
      { midi: 57, string: 5, fret: 3 },
      { midi: 60, string: 4, fret: 3 },
      { midi: 65, string: 3, fret: 1 },
      { midi: 69, string: 2, fret: 1 },
      { midi: 72, string: 1, fret: 1 },
    ]
    expect(evaluateShape(fBarre, { maxSpan: 4 }).playable).toBe(true)
  })

  it('accepts a legitimate four-fret stretch but rejects five', () => {
    expect(evaluateShape([{ midi: 45, string: 6, fret: 5 }, { midi: 60, string: 2, fret: 1 }], { maxSpan: 4 }).playable).toBe(true)
    expect(evaluateShape([{ midi: 45, string: 6, fret: 6 }, { midi: 60, string: 2, fret: 1 }], { maxSpan: 4 }).playable).toBe(false)
  })
})

describe('arrangeSoloGuitar is playable end to end', () => {
  const notesAt = (midis, onset = 0) => midis.map((midi) => ({
    midi,
    quantizedStartBeat: onset,
    quantizedDurBeats: 1,
    strength: 0.8,
  }))

  it('does not export a nine-fret grip from a dense onset', () => {
    const { events, playability, droppedNotes } = arrangeSoloGuitar({
      quantizedNotes: notesAt([47, 60, 64, 67, 80]),
      chords: [],
      difficulty: 'intermediate',
    })
    const gate = validateGuitarArrangement(events, { maxSpan: 4 })
    expect(gate.playable).toBe(true)
    expect(playability.playable).toBe(true)
    // The melody is preserved and the impossible bass is disclosed.
    expect(events.some((e) => e.midi === 80)).toBe(true)
    expect(droppedNotes.length + events.length).toBeGreaterThan(0)
    for (const onset of new Set(events.map((e) => e.startBeat))) {
      const group = events.filter((e) => e.startBeat === onset)
      expect(span(group)).toBeLessThanOrEqual(4)
    }
  })

  it('keeps every emitted event on a valid string and fret', () => {
    const { events } = arrangeSoloGuitar({
      quantizedNotes: notesAt([40, 48, 55, 64, 72, 83]),
      chords: [],
      difficulty: 'advanced',
    })
    for (const e of events) {
      expect(e.string).toBeGreaterThanOrEqual(1)
      expect(e.string).toBeLessThanOrEqual(6)
      expect(e.fret).toBeGreaterThanOrEqual(0)
      expect(e.fret).toBeLessThanOrEqual(19)
    }
    expect(validateGuitarArrangement(events, { maxSpan: 5 }).playable).toBe(true)
  })
})

describe('product pipeline exposes playability (solo guitar)', () => {
  it('a dense concert-piano chord is simplified to playable guitar and disclosed', async () => {
    const { runAudioArrangementPipeline } = await import('../src/features/audio-vision/audioArrangementPipeline.js')
    const SR = 22050
    // A short melody with real attacks, so the analysis finds onsets/melody.
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
      { name: 'dense.wav', size: 1000, type: 'audio/wav' },
      new ArrayBuffer(64),
      { targetPart: 'solo-guitar', difficulty: 'intermediate' },
      {
        decodeAudioDataImpl: async () => ({ channelData: [samples], sampleRate: SR, durationSeconds: 2, channelCount: 1 }),
        // The exact impossible pair plus a melody, at one onset.
        predictNotes: async () => [47, 76, 80].map((midi) => ({
          midi, startSeconds: 0.2, endSeconds: 0.8, amplitude: 0.6,
        })),
      },
    )
    expect(out.ok).toBe(true)
    expect(out.playability).toBeTruthy()
    expect(out.playability.playable).toBe(true)
    expect(out.simplifiedNoteCount).toBeGreaterThan(0)
    for (const violation of out.playability.violations) {
      expect(violation.kind).not.toBe('unplayable-shape')
    }
    for (const e of out.model.parts[0].events) {
      expect(e.string).toBeGreaterThanOrEqual(1)
      expect(e.string).toBeLessThanOrEqual(6)
    }
  }, 60000)
})

describe('full fingering and transitions', () => {
  it('assigns four fingers and detects a barre on an F shape', async () => {
    const { assignFingers } = await import('../src/features/audio-vision/guitarPlayability.js')
    const fBarre = [
      { midi: 53, string: 6, fret: 1 },
      { midi: 60, string: 4, fret: 3 },
      { midi: 65, string: 3, fret: 1 },
      { midi: 69, string: 2, fret: 1 },
      { midi: 72, string: 1, fret: 1 },
    ]
    const result = assignFingers(fBarre)
    expect(result.feasible).toBe(true)
    expect(result.barre).toBeTruthy()
    expect(result.barre.fret).toBe(1)
    expect(result.fingersUsed).toBeLessThanOrEqual(4)
    // fret 1 is the barre finger (1), fret 3 is finger 2
    const barreNotes = result.positions.filter((p) => p.fret === 1)
    expect(barreNotes.every((p) => p.finger === 1)).toBe(true)
    expect(result.positions.find((p) => p.fret === 3).finger).toBe(2)
  })

  it('leaves open strings unfingered', async () => {
    const { assignFingers } = await import('../src/features/audio-vision/guitarPlayability.js')
    const openC = [
      { midi: 48, string: 5, fret: 3 },
      { midi: 52, string: 4, fret: 2 },
      { midi: 55, string: 3, fret: 0 },
      { midi: 60, string: 2, fret: 1 },
      { midi: 64, string: 1, fret: 0 },
    ]
    const result = assignFingers(openC)
    expect(result.feasible).toBe(true)
    expect(result.positions.filter((p) => p.fret === 0).every((p) => p.finger === 0)).toBe(true)
  })

  it('rejects a shape needing five distinct frets', async () => {
    const { assignFingers } = await import('../src/features/audio-vision/guitarPlayability.js')
    const result = assignFingers([
      { midi: 45, string: 6, fret: 5 },
      { midi: 50, string: 5, fret: 5 },
      { midi: 55, string: 4, fret: 5 },
      { midi: 60, string: 3, fret: 5 },
      { midi: 65, string: 2, fret: 5 },
      { midi: 69, string: 1, fret: 5 },
    ])
    // All at one fret is a barre, so this IS feasible.
    expect(result.feasible).toBe(true)
    const spread = assignFingers([
      { midi: 45, string: 6, fret: 1 },
      { midi: 51, string: 5, fret: 2 },
      { midi: 57, string: 4, fret: 3 },
      { midi: 63, string: 3, fret: 4 },
      { midi: 69, string: 2, fret: 5 },
    ])
    expect(spread.feasible).toBe(false)
  })

  it('flags a hand jump and a same-string overlap', async () => {
    const { analyzeGuitarTransitions } = await import('../src/features/audio-vision/guitarPlayability.js')
    const diagnostics = analyzeGuitarTransitions([
      { midi: 45, startBeat: 0, durBeats: 2, string: 6, fret: 5 },
      { midi: 72, startBeat: 0.5, durBeats: 0.5, string: 1, fret: 8 },
    ], { maxHandJump: 2, beatSeconds: 0.5 })
    expect(diagnostics.some((d) => d.kind === 'hand-jump')).toBe(true)
    expect(diagnostics.some((d) => d.kind === 'same-string-overlap')).toBe(false)
    const overlap = analyzeGuitarTransitions([
      { midi: 45, startBeat: 0, durBeats: 2, string: 6, fret: 5 },
      { midi: 47, startBeat: 0.5, durBeats: 0.5, string: 6, fret: 7 },
    ])
    expect(overlap.some((d) => d.kind === 'same-string-overlap')).toBe(true)
  })

  it('difficulty changes the playable span and note count', async () => {
    const notes = [40, 47, 52, 59, 64, 71, 76, 80].map((midi) => ({
      midi, quantizedStartBeat: 0, quantizedDurBeats: 1, strength: 0.8,
    }))
    const easy = arrangeSoloGuitar({ quantizedNotes: notes, chords: [], difficulty: 'easy' })
    const advanced = arrangeSoloGuitar({ quantizedNotes: notes, chords: [], difficulty: 'advanced' })
    expect(validateGuitarArrangement(easy.events, { maxSpan: 3 }).playable).toBe(true)
    expect(validateGuitarArrangement(advanced.events, { maxSpan: 5 }).playable).toBe(true)
    expect(easy.events.length).toBeLessThanOrEqual(advanced.events.length)
  })
})

describe('export consistency', () => {
  it('MusicXML TAB and notation carry exactly the arranged string/fret', async () => {
    const { buildArrangementMusicXml } = await import('../src/features/audio-vision/arrangementMusicXml.js')
    const { parseMusicXml } = await import('../src/features/musicxml/parseMusicXml.js')
    const notes = [
      { midi: 60, quantizedStartBeat: 0, quantizedDurBeats: 1 },
      { midi: 64, quantizedStartBeat: 0, quantizedDurBeats: 1 },
      { midi: 67, quantizedStartBeat: 0, quantizedDurBeats: 1 },
      { midi: 72, quantizedStartBeat: 1, quantizedDurBeats: 1 },
    ]
    const { events } = arrangeSoloGuitar({ quantizedNotes: notes, chords: [], difficulty: 'intermediate' })
    const xml = buildArrangementMusicXml({ events, targetPart: 'solo-guitar', bpm: 100, title: 'T' })
    const parsed = parseMusicXml(xml)
    const staffOne = (parsed.notes ?? []).filter((n) => !n.isRest && (n.staff ?? 1) === 1)
    expect(staffOne.length).toBe(events.length)
    for (const e of events) {
      const match = staffOne.find((n) => n.midi === e.midi && n.string === e.string && n.fret === e.fret)
      expect(match).toBeTruthy()
    }
  })
})
