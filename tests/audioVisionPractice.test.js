import { describe, it, expect } from 'vitest'
import { quantizeToBeats } from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { getOrParseTimingMap } from '../src/features/musicxml/timingMapCache.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'

const BEAT = 0.5 // 120 BPM grid
const beats = Array.from({ length: 24 }, (_, i) => i * BEAT)

// Deterministic transcription-like input: melody + chord stack + a note
// sustained across the barline (startBeat 3.5, dur 1 beat in 4/4).
function transcribedInput() {
  const notes = [
    { midi: 72, startSeconds: 0, endSeconds: 0.45, strength: 0.9 }, // C5 melody
    { midi: 60, startSeconds: 0, endSeconds: 0.45, strength: 0.5 },
    { midi: 64, startSeconds: 0, endSeconds: 0.45, strength: 0.5 },
    { midi: 74, startSeconds: BEAT, endSeconds: BEAT + 0.45, strength: 0.9 }, // D5
    { midi: 67, startSeconds: 3.5 * BEAT, endSeconds: 4.5 * BEAT, strength: 0.9 }, // G4 across barline
  ]
  return quantizeToBeats(notes, beats)
}

const CHORDS = Array.from({ length: 4 }, () => ({ root: 0, quality: 'major', confidence: 0.8 }))

function arrangeAndParse(target) {
  const quantized = transcribedInput()
  const arranged = target === 'piano'
    ? arrangeSoloPiano({ quantizedNotes: quantized, chords: CHORDS, difficulty: 'intermediate' })
    : arrangeSoloGuitar({ quantizedNotes: quantized, chords: CHORDS, difficulty: 'intermediate' })
  const xml = buildArrangementMusicXml({
    events: arranged.events,
    targetPart: target === 'piano' ? 'solo-piano' : 'solo-guitar',
    bpm: 120,
    title: `Practice E2E ${target}`,
  })
  const { timingMap } = getOrParseTimingMap(xml, `e2e-${target}.musicxml`)
  return { arranged, xml, timingMap }
}

describe('Phase 8 — arrangement opens as a practicable Corranzo score', () => {
  for (const target of ['piano', 'guitar']) {
    it(`${target}: MusicXML parses to a timing map with tempo + measures`, () => {
      const { timingMap } = arrangeAndParse(target)
      expect(timingMap.notes.length).toBeGreaterThan(0)
      expect(timingMap.measures.length).toBeGreaterThanOrEqual(2)
      const tempos = timingMap.tempoChanges ?? []
      expect(tempos.some((t) => Math.abs((t.bpm ?? t.tempo ?? 0) - 120) < 1)).toBe(true)
    })

    it(`${target}: first checkpoint matches the first arranged onset (no callback stubs)`, () => {
      const { arranged, timingMap } = arrangeAndParse(target)
      const checkpoints = buildNoteCheckpoints(timingMap)
      expect(checkpoints.length).toBeGreaterThan(0)
      const firstArranged = [...arranged.events].sort((a, b) => a.startBeat - b.startBeat)[0]
      const expectedSeconds = firstArranged.startBeat * BEAT
      expect(Math.abs(checkpoints[0].timeSeconds - expectedSeconds)).toBeLessThan(0.06)
      // Chord onset at t=0 carries all surviving chord midis.
      const atZero = checkpoints.filter((c) => Math.abs(c.timeSeconds) < 0.06)
      expect(atZero.length).toBe(1)
      const survivors = arranged.events
        .filter((e) => Math.abs(e.startBeat) < 1e-9)
        .map((e) => e.midi)
        .sort((a, b) => a - b)
      expect([...atZero[0].expectedMidis].sort((a, b) => a - b)).toEqual(survivors)
    })

    it(`${target}: barline tie survives as sustained timing (Preview/WFY duration)`, () => {
      const { timingMap } = arrangeAndParse(target)
      const g4 = timingMap.notes.filter((n) => n.midi === 67 && !n.isRest)
      expect(g4.length).toBeGreaterThanOrEqual(1)
      // Tied halves must cover the full beat: 3.5–4.5 beats = 1.75–2.25 s.
      const start = Math.min(...g4.map((n) => n.timeSeconds))
      const end = Math.max(...g4.map((n) => n.timeSeconds + (n.durationSeconds ?? 0)))
      expect(start).toBeLessThanOrEqual(1.78)
      expect(end).toBeGreaterThanOrEqual(2.22)
    })
  }

  it('guitar: checkpoints carry the arranged string/fret (TAB/notation agreement)', () => {
    const { arranged, timingMap } = arrangeAndParse('guitar')
    const checkpoints = buildNoteCheckpoints(timingMap)
    const withTab = checkpoints.filter((c) => (c.expectedStringFrets ?? []).length > 0)
    expect(withTab.length).toBeGreaterThan(0)
    // Every arranged event with TAB must appear in some checkpoint with same string/fret.
    for (const e of arranged.events.filter((ev) => ev.string != null)) {
      const found = checkpoints.some((c) => (c.expectedStringFrets ?? []).some(
        (sf) => sf.string === e.string && sf.fret === e.fret,
      ))
      expect(found).toBe(true)
    }
  })

  it('piano: melody checkpoint sits in the right hand lane', () => {
    const { timingMap } = arrangeAndParse('piano')
    const checkpoints = buildNoteCheckpoints(timingMap)
    // First checkpoint contains the C5 melody note (72).
    expect(checkpoints[0].expectedMidis).toContain(72)
  })
})
