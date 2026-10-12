import { describe, it, expect } from 'vitest'
import {
  quantizeToBeats,
  selectTexture,
  resolveSimultaneous,
  createArrangementModel,
  measureComplexity,
  PART_INSTRUMENTS,
  DIFFICULTIES,
} from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloPiano, chordAt } from '../src/features/audio-vision/soloPiano.js'
import { arrangeSoloGuitar, GUITAR_MIN, GUITAR_MAX } from '../src/features/audio-vision/soloGuitar.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

function fakeQuantized(count = 16) {
  const notes = []
  for (let i = 0; i < count; i += 1) {
    // Melody ascending C major + chord tones stacked every 4th onset (polyphonic conflict).
    notes.push({ midi: 60 + (i % 8), startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.8 })
    if (i % 4 === 0) {
      notes.push({ midi: 48, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.6 })
      notes.push({ midi: 55, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.5 })
      notes.push({ midi: 64, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.4 })
    }
  }
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5)
  return quantizeToBeats(notes, beats)
}

const CHORDS = Array.from({ length: 8 }, () => ({ root: 0, quality: 'major', confidence: 0.7 }))

describe('A4 arrangement model', () => {
  it('quantizes to the grid with residuals', () => {
    const q = quantizeToBeats([{ midi: 60, startSeconds: 0.51, endSeconds: 0.9 }], [0, 0.5, 1.0])
    expect(q[0].quantizedStartBeat).toBe(1)
    expect(q[0].provenance).toBeTruthy()
  })
  it('resolves conflicts by keeping melody, not random notes', () => {
    const events = [
      { midi: 76, isMelody: true, strength: 0.9 },
      { midi: 60, strength: 0.9 },
      { midi: 64, strength: 0.9 },
    ]
    const out = resolveSimultaneous(events, { maxVoices: 2, melodyMidi: 76 })
    expect(out.filter((e) => e.kept).map((e) => e.midi)).toContain(76)
    expect(out.filter((e) => e.kept)).toHaveLength(2)
  })
  it('rejects non-V1 parts (future-proof gate)', () => {
    expect(() => createArrangementModel({ targetPart: 'drums', difficulty: 'easy' })).toThrow()
  })
})

describe('A5/A6/A7 solo arrangement + difficulty', () => {
  const quantized = fakeQuantized()

  it('piano distributes two hands with melody in RH', () => {
    const { events, warnings } = arrangeSoloPiano({ quantizedNotes: quantized, chords: CHORDS, difficulty: DIFFICULTIES.INTERMEDIATE })
    expect(events.length).toBeGreaterThan(0)
    const rh = events.filter((e) => e.hand === 'RH')
    const lh = events.filter((e) => e.hand === 'LH')
    expect(rh.length).toBeGreaterThan(0)
    expect(lh.length).toBeGreaterThan(0)
    expect(events.filter((e) => e.role === 'melody').every((e) => e.hand === 'RH')).toBe(true)
    expect(Array.isArray(warnings)).toBe(true)
  })

  it('guitar assigns playable string/fret in range with TAB roles', () => {
    const { events, warnings } = arrangeSoloGuitar({ quantizedNotes: quantized, chords: CHORDS, difficulty: DIFFICULTIES.INTERMEDIATE })
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.midi).toBeGreaterThanOrEqual(GUITAR_MIN)
      expect(e.midi).toBeLessThanOrEqual(GUITAR_MAX)
      expect(e.string).toBeGreaterThanOrEqual(1)
      expect(e.string).toBeLessThanOrEqual(6)
      expect(e.fret).toBeGreaterThanOrEqual(0)
      expect(e.fret).toBeLessThanOrEqual(19)
    }
    // No impossible 6-note grips.
    const byOnset = new Map()
    for (const e of events) {
      const k = Math.round(e.startBeat * 4)
      byOnset.set(k, (byOnset.get(k) ?? 0) + 1)
    }
    expect(Math.max(...byOnset.values())).toBeLessThanOrEqual(4)
    expect(Array.isArray(warnings)).toBe(true)
  })

  it('guitar transposes out-of-range notes deliberately instead of dropping (A5)', () => {
    const beats = [0, 0.5, 1.0, 1.5, 2.0]
    const high = quantizeToBeats([{ midi: 95, startSeconds: 0, endSeconds: 0.4, strength: 0.9 }], beats)
    const { events, warnings } = arrangeSoloGuitar({ quantizedNotes: high, chords: [], difficulty: 'intermediate' })
    expect(events.length).toBe(1)
    expect(events[0].midi).toBe(83) // octave down into real fretboard range
    expect(events[0].octaveShifted).toBe(-12)
    expect(events[0].string).toBeGreaterThanOrEqual(1)
    expect(warnings.some((w) => w.kind === 'octave-transposed')).toBe(true)
    // Beyond double-transposition reach (MIDI 20 cello C) still drops honestly.
    const low = quantizeToBeats([{ midi: 20, startSeconds: 0, endSeconds: 0.4, strength: 0.9 }], beats)
    const dropped = arrangeSoloGuitar({ quantizedNotes: low, chords: [], difficulty: 'intermediate' })
    expect(dropped.events.length).toBe(0)
    expect(dropped.warnings.some((w) => w.kind === 'unplayable-note-dropped')).toBe(true)
  })

  it('suppresses harmonic-double inventions only with amplitude evidence', async () => {
    const { suppressHarmonicDoubles } = await import('../src/features/audio-vision/arrangementModel.js')
    const notes = [
      { midi: 60, startSeconds: 1.0, endSeconds: 1.4, amplitude: 0.6 },
      { midi: 72, startSeconds: 1.01, endSeconds: 1.4, amplitude: 0.3 }, // weak octave shadow
      { midi: 67, startSeconds: 1.02, endSeconds: 1.4, amplitude: 0.35 }, // weak fifth shadow
      { midi: 64, startSeconds: 1.0, endSeconds: 1.4, amplitude: 0.55 }, // strong third: kept
      { midi: 60, startSeconds: 2.0, endSeconds: 2.4 }, // no amplitude: kept
      { midi: 72, startSeconds: 2.01, endSeconds: 2.4 }, // no amplitude: kept
    ]
    const { notes: kept, suppressed } = suppressHarmonicDoubles(notes)
    expect(suppressed).toBe(2)
    expect(kept.map((n) => n.midi)).toEqual([60, 64, 60, 72])
    // Strongest note never dropped even when it is the upper octave.
    const inverted = suppressHarmonicDoubles([
      { midi: 60, startSeconds: 1.0, endSeconds: 1.4, amplitude: 0.2 },
      { midi: 72, startSeconds: 1.0, endSeconds: 1.4, amplitude: 0.8 },
    ])
    expect(inverted.notes.map((n) => n.midi)).toEqual([72])
    expect(inverted.suppressed).toBe(1)
  })

  it('chooses the melody from the detected contour, not the highest pitch', async () => {
    const { buildMelodyContour, chooseMelodyMidi } = await import('../src/features/audio-vision/arrangementModel.js')
    const detected = [
      { seconds: 1.0, midi: 60 }, { seconds: 1.05, midi: 60 },
      { seconds: 1.5, midi: 64 }, { seconds: 1.55, midi: 64 },
    ]
    const contour = buildMelodyContour(detected, { beat0: 0, beatPeriod: 0.5 })
    // Beat 2 (t=1.0s): the real melody 60 sits BELOW an invented octave 72.
    const chosen = chooseMelodyMidi([72, 60], contour.get(2))
    expect(chosen).toBe(60)
    // With no contour evidence we fall back to highest pitch.
    expect(chooseMelodyMidi([72, 60], null)).toBe(72)
    // Octave displacement of the contour line still counts as the melody:
    // detected midi 64 at beat 3 matches 52 (one octave below).
    const contour3 = buildMelodyContour([{ seconds: 1.5, midi: 64 }], { beat0: 0, beatPeriod: 0.5 })
    expect(chooseMelodyMidi([52, 55], contour3.get(3))).toBe(52)
    // No contour evidence for this beat -> highest-pitch fallback.
    expect(chooseMelodyMidi([52, 55], null)).toBe(55)
  })

  it('easy difficulty protects the detected melody line through thinning', () => {
    const beats = Array.from({ length: 16 }, (_, i) => i * 0.5)
    // Model output invents an octave ABOVE the real melody at every onset.
    const notes = []
    for (let i = 0; i < 8; i += 1) {
      notes.push({ midi: 72, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.9 })
      notes.push({ midi: 60 + (i % 3), startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.5 })
      notes.push({ midi: 55, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45, strength: 0.4 })
    }
    const contour = new Map()
    for (let i = 0; i < 8; i += 1) contour.set(i, new Set([60 + (i % 3)]))
    for (const difficulty of ['easy', 'intermediate', 'advanced']) {
      const { events } = arrangeSoloGuitar({ quantizedNotes: quantizeToBeats(notes, beats), chords: [], difficulty, melodyContour: contour })
      // Every real melody note survives at EVERY difficulty.
      for (let i = 0; i < 8; i += 1) {
        const at = events.filter((e) => Math.abs(e.startBeat - i) < 1e-6)
        expect(at.some((e) => e.midi === 60 + (i % 3))).toBe(true)
      }
    }
  })

  it('emits overlapping voices without drifting the parsed timeline', async () => {
    const beatsPerMeasure = 4
    const bpm = 108
    const period = 60 / bpm
    // RH has a sustained harmony note under a moving line (overlap), plus LH
    // bass; without intra-voice clipping every later note's parsed time drifts.
    const events = [
      { midi: 71, startBeat: 1.75, durBeats: 0.5, hand: 'RH', role: 'melody' },
      { midi: 77, startBeat: 2.5, durBeats: 1.0, hand: 'RH', role: 'melody' },
      { midi: 69, startBeat: 2.75, durBeats: 1.25, hand: 'RH', role: 'melody' },
      { midi: 57, startBeat: 2.5, durBeats: 1.5, hand: 'LH', role: 'bass' },
    ]
    const xml = buildArrangementMusicXml({ events, targetPart: 'solo-piano', bpm, title: 'Overlap' })
    const parsed = parseMusicXml(xml, 'overlap.musicxml')
    const got = parsed.notes.filter((n) => !n.isRest).map((n) => Math.round(n.timeSeconds / period))
    expect(got).toEqual([2, 3, 3, 3]) // beats 1.75→2, 2.5→3 (x2 voices), 2.75→3
    // No note may extend past the next barline after its own start.
    const barline = beatsPerMeasure * period
    const overflow = parsed.notes.filter((n) => {
      if (n.isRest) return false
      const next = Math.ceil(n.timeSeconds / barline - 1e-9) * barline
      return n.timeSeconds + n.durationSeconds > next + 1e-6
    })
    expect(overflow).toEqual([])
  })

  it('difficulty thinning never deletes the melody (only harmony/bass)', () => {
    const { simplifyForDifficulty } = require('../src/features/audio-vision/difficulty.js')
    // Dense window: melody + bass + three harmony notes in one half-beat.
    const events = [
      { midi: 72, quantizedStartBeat: 0, quantizedDurBeats: 1, isMelody: true, role: 'melody', strength: 0.9 },
      { midi: 48, quantizedStartBeat: 0, quantizedDurBeats: 1, isMelody: false, isBassRoot: true, role: 'bass', strength: 0.5 },
      { midi: 60, quantizedStartBeat: 0, quantizedDurBeats: 1, isMelody: false, role: 'harmony', strength: 0.45 },
      { midi: 64, quantizedStartBeat: 0, quantizedDurBeats: 1, isMelody: false, role: 'harmony', strength: 0.4 },
      { midi: 67, quantizedStartBeat: 0, quantizedDurBeats: 1, isMelody: false, role: 'harmony', strength: 0.35 },
    ]
    for (const difficulty of ['easy', 'intermediate', 'advanced']) {
      const simplified = simplifyForDifficulty(events, difficulty)
      expect(simplified.some((e) => e.midi === 72 && e.isMelody)).toBe(true)
      // Bass root survives ahead of weak harmony when the budget bites.
      expect(simplified.some((e) => e.midi === 48)).toBe(true)
      expect(simplified.length).toBeLessThan(events.length)
    }
    // Duplicate melody at the same beat dedupes instead of stacking.
    const dup = simplifyForDifficulty([
      { midi: 72, quantizedStartBeat: 0, quantizedDurBeats: 1, isMelody: true, role: 'melody' },
      { midi: 72, quantizedStartBeat: 0, quantizedDurBeats: 1, isMelody: true, role: 'melody' },
    ], 'easy')
    expect(dup).toHaveLength(1)
  })

  it('difficulty levels differ measurably (easy < intermediate < advanced)', () => {
    const levels = [DIFFICULTIES.EASY, DIFFICULTIES.INTERMEDIATE, DIFFICULTIES.ADVANCED]
    const complexities = levels.map((difficulty) => {
      const { events } = arrangeSoloPiano({ quantizedNotes: quantized, chords: CHORDS, difficulty })
      const simplified = simplifyForDifficulty(
        events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
        difficulty,
      )
      return measureComplexity(simplified.map((e) => ({ ...e, startBeat: e.quantizedStartBeat })))
    })
    const density = complexities.map((c) => c.notesPerBeat)
    expect(density[0]).toBeLessThanOrEqual(density[1])
    expect(density[1]).toBeLessThanOrEqual(density[2])
    expect(density[0]).toBeLessThan(density[2])
  })

  it('texture selection prefers melody-only when harmony is uncertain', () => {
    expect(selectTexture({ noteDensity: 5, chordConfidence: 0.1, difficulty: 'intermediate' })).toBe('melody-only')
    expect(selectTexture({ noteDensity: 5, chordConfidence: 0.8, difficulty: 'intermediate' })).not.toBe('melody-only')
  })
})

describe('A8 arrangement MusicXML validity + semantics', () => {
  it('piano output parses with two staves and real notes', () => {
    const { events } = arrangeSoloPiano({ quantizedNotes: fakeQuantized(8), chords: CHORDS, difficulty: DIFFICULTIES.EASY })
    const xml = buildArrangementMusicXml({ events, targetPart: PART_INSTRUMENTS.SOLO_PIANO, bpm: 120, title: 'Test Piano' })
    expect(xml).toContain('<staves>2</staves>')
    expect(xml).toContain('<per-minute>120</per-minute>')
    const parsed = parseMusicXml(xml)
    expect(parsed?.notes?.length ?? 0).toBeGreaterThan(0)
  })
  it('guitar output parses with string/fret TAB and playable range', () => {
    const { events } = arrangeSoloGuitar({ quantizedNotes: fakeQuantized(8), chords: CHORDS, difficulty: DIFFICULTIES.EASY })
    const xml = buildArrangementMusicXml({ events, targetPart: PART_INSTRUMENTS.SOLO_GUITAR, bpm: 100, title: 'Test Guitar' })
    expect(xml).toContain('<technical>')
    expect(xml).toContain('<string>')
    expect(xml).toContain('<fret>')
    const parsed = parseMusicXml(xml)
    expect(parsed?.notes?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('chord-window lookup (Audio Vision 304242e8f7)', () => {
  /**
   * Harmony analysis emits one chord window PER BEAT. The piano arranger used
   * to resolve them by measure index, so with 4 beats per measure every onset
   * inside measure 0 read chords[0] — the wrong chord for beats 1, 2 and 3.
   */
  const perBeatChords = [
    { root: 0, quality: 'major', confidence: 0.9, startSeconds: 0, endSeconds: 0.5 },
    { root: 5, quality: 'minor', confidence: 0.9, startSeconds: 0.5, endSeconds: 1.0 },
    { root: 7, quality: 'major', confidence: 0.9, startSeconds: 1.0, endSeconds: 1.5 },
    { root: 2, quality: 'major', confidence: 0.9, startSeconds: 1.5, endSeconds: 2.0 },
  ]

  it('resolves the chord at an onset by time, not by measure index', () => {
    const beatsPerMeasure = 4
    const beatPeriod = 0.5
    // Beat 1 is F minor; under the old index lookup it resolved to chords[0].
    expect(chordAt(perBeatChords, 1, beatsPerMeasure, { beat0: 0, beatPeriod }).root).toBe(5)
    // Beat 2 is G major.
    expect(chordAt(perBeatChords, 2, beatsPerMeasure, { beat0: 0, beatPeriod }).root).toBe(7)
    // Beat 3 is D major.
    expect(chordAt(perBeatChords, 3, beatsPerMeasure, { beat0: 0, beatPeriod }).root).toBe(2)
    // Beat 0 is C major, matching the index lookup's happy case.
    expect(chordAt(perBeatChords, 0, beatsPerMeasure, { beat0: 0, beatPeriod }).root).toBe(0)
  })

  it('uses the widest per-beat window when the arranger has no beat grid', () => {
    // beatPeriod 0.25 resolves beat 1 to the window at 0.25s, not 0.5s.
    const chord = chordAt(perBeatChords, 1, 4, { beat0: 0, beatPeriod: 0.25 })
    expect(chord.root).toBe(0)
  })

  it('falls back to the nearest window when an onset sits in a gap', () => {
    const gapped = [
      { root: 0, quality: 'major', confidence: 0.9, startSeconds: 0, endSeconds: 0.2 },
      { root: 9, quality: 'minor', confidence: 0.9, startSeconds: 1.4, endSeconds: 2.0 },
    ]
    const chord = chordAt(gapped, 3, 4, { beat0: 0, beatPeriod: 0.5 }) // t = 1.5s, inside window 2
    expect(chord.root).toBe(9)
  })

  it('voices from the pitch classes the model actually heard, evidenced not inferred', () => {
    const heard = [
      { root: 0, quality: 'major', confidence: 0.7, startSeconds: 0, endSeconds: 0.5, heardPcs: [7, 0, 5] },
    ]
    const chord = chordAt(heard, 0, 4, { beat0: 0, beatPeriod: 0.5 })
    expect(chord.voicingSource).toBe('heard')
    expect(chord.tones).toEqual([7, 0, 5])
  })

  it('falls back to the template voicing when nothing was heard', () => {
    const chord = chordAt(perBeatChords, 0, 4, { beat0: 0, beatPeriod: 0.5 })
    expect(chord.voicingSource).toBe('template')
    expect(chord.tones).toEqual([0, 4, 7])
  })

  it('feeds the resolved chord into the arrangement so onsets voice locally', () => {
    const beats = Array.from({ length: 40 }, (_, i) => i * 0.5)
    const quantized = quantizeToBeats(
      [
        { midi: 60, startSeconds: 0.1, endSeconds: 0.4, strength: 0.9 },
        { midi: 64, startSeconds: 0.6, endSeconds: 0.9, strength: 0.9 },
      ],
      beats,
    )
    const { events } = arrangeSoloPiano({
      quantizedNotes: quantized,
      chords: perBeatChords,
      difficulty: DIFFICULTIES.INTERMEDIATE,
      beatsPerMeasure: 4,
      beat0: 0,
      beatPeriod: 0.5,
    })
    // Two onsets survive and are voiced independently of measure 0.
    expect(events.length).toBeGreaterThanOrEqual(2)
    const midis = events.map((event) => event.midi).sort((a, b) => a - b)
    expect(midis).toContain(60)
    expect(midis).toContain(64)
  })

  it('attaches hearsay-free heard voicings in the analysis stage', async () => {
    const { attachHeardVoicings } = await import('../src/features/audio-vision/musicAnalysis.js')
    const chords = [
      { root: 0, quality: 'major', confidence: 0.7, startSeconds: 0, endSeconds: 0.5 },
      { root: 7, quality: 'major', confidence: 0.7, startSeconds: 0.5, endSeconds: 1.0 },
    ]
    const notes = [
      { midi: 60, startSeconds: 0.0, endSeconds: 0.45 },
      { midi: 64, startSeconds: 0.0, endSeconds: 0.45 },
      { midi: 67, startSeconds: 0.05, endSeconds: 0.4 },
    ]
    const out = attachHeardVoicings(chords, notes)
    expect(out[0].heardPcs).toContain(0)
    expect(out[0].heardPcs).toContain(4)
    expect(out[0].heardPcs).toContain(7)
    expect(out[0].provenanceVoicing).toBe('predicted')
    // A window with no sounding transcription is labelled inferred, not fabricated.
    expect(out[1].heardPcs).toEqual([])
    expect(out[1].provenanceVoicing).toBe('inferred')
  })
})
