/**
 * Per-note corrections: the musician removes a wrong note, the score
 * regenerates with exactly that note gone, and the edit survives the
 * regeneration without touching anything else.
 *
 * These tests protect the three properties the architecture rests on:
 *   1. a correction is a content key, so it still identifies the same note
 *      after a regeneration (an index would not);
 *   2. the transcription, the corrections and the arrangement are separate -
 *      applying corrections never mutates the note list it was given;
 *   3. a correction that no longer matches anything is inert, so a stale
 *      edit can never start deleting a different note.
 */
import { describe, it, expect } from 'vitest'
import {
  noteKey,
  createNoteCorrections,
  addRemoval,
  undoRemoval,
  hasRemoval,
  applyNoteCorrections,
  resolveCorrections,
  serializeNoteCorrections,
  parseNoteCorrections,
} from '../src/features/audio-vision/noteCorrections.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { synthBandFixture } from './audioVisionAnalysis.test.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const events = () => [
  { midi: 72, startBeat: 0, durBeats: 1, hand: 'RH', role: 'melody' },
  { midi: 76, startBeat: 1, durBeats: 1, hand: 'RH', role: 'melody' },
  { midi: 48, startBeat: 0, durBeats: 2, hand: 'LH', role: 'bass' },
]
const timeOf = (e) => (e.startBeat ?? 0) * 0.5 // 120 BPM

describe('note corrections: identity', () => {
  it('keys a note by pitch and time, not by its position in a list', () => {
    expect(noteKey({ midi: 72, startSeconds: 0 }, { timeSeconds: 0 })).toBe('72@0.00')
    expect(noteKey({ midi: 72 }, { timeSeconds: 1.234 })).toBe('72@1.23')
  })

  it('the same note gets the same key after a regeneration', () => {
    const first = events()[1]
    const second = events()[1] // a fresh object, as a re-run would produce
    expect(noteKey(first, { timeSeconds: timeOf(first) })).toBe(noteKey(second, { timeSeconds: timeOf(second) }))
  })
})

describe('note corrections: the correction set', () => {
  it('is immutable (adding and undoing never mutate the input)', () => {
    const base = createNoteCorrections()
    const added = addRemoval(base, '72@0.00')
    expect(base.removed).toEqual([])
    expect(added.removed).toEqual(['72@0.00'])
    const undone = undoRemoval(added, '72@0.00')
    expect(added.removed).toEqual(['72@0.00'])
    expect(undone.removed).toEqual([])
  })

  it('does not duplicate a key', () => {
    const once = addRemoval(createNoteCorrections(), '72@0.00')
    const twice = addRemoval(once, '72@0.00')
    expect(twice.removed).toHaveLength(1)
  })

  it('round trips through storage and rejects an unknown version', () => {
    const corrections = addRemoval(createNoteCorrections(), '72@0.00')
    expect(parseNoteCorrections(serializeNoteCorrections(corrections))).toEqual(corrections)
    expect(parseNoteCorrections({ version: 99, removed: ['72@0.00'] }).removed).toEqual([])
  })
})

describe('note corrections: applying them', () => {
  it('removes exactly the corrected note and nothing else', () => {
    const list = events()
    const corrections = addRemoval(createNoteCorrections(), noteKey(list[1], { timeSeconds: timeOf(list[1]) }))
    const result = applyNoteCorrections(list, corrections, { timeOf })
    expect(result.removedCount).toBe(1)
    expect(result.events.map((e) => `${e.midi}@${e.startBeat}`)).toEqual(['72@0', '48@0'])
  })

  it('never mutates the events it was given', () => {
    const list = events()
    const snapshot = JSON.stringify(list)
    applyNoteCorrections(list, addRemoval(createNoteCorrections(), '76@0.50'), { timeOf })
    expect(JSON.stringify(list)).toBe(snapshot)
  })

  it('is a no-op when there are no corrections', () => {
    const list = events()
    const result = applyNoteCorrections(list, createNoteCorrections(), { timeOf })
    expect(result.events).toHaveLength(3)
    expect(result.removedCount).toBe(0)
  })

  it('reports a stale correction instead of applying it to something else', () => {
    const list = events()
    const stale = addRemoval(createNoteCorrections(), '99@7.00')
    const resolution = resolveCorrections(list, stale, { timeOf })
    expect(resolution.applied).toEqual([])
    expect(resolution.stale).toEqual(['99@7.00'])
    expect(applyNoteCorrections(list, stale, { timeOf }).removedCount).toBe(0)
  })
})

describe('note corrections: end to end through the score', () => {
  it('the written MusicXML has the corrected note gone and every other note kept', () => {
    const arranged = arrangeSoloPiano({
      quantizedNotes: [
        { midi: 72, quantizedStartBeat: 0, quantizedDurBeats: 1 },
        { midi: 74, quantizedStartBeat: 1, quantizedDurBeats: 1 },
        { midi: 76, quantizedStartBeat: 2, quantizedDurBeats: 1 },
        { midi: 48, quantizedStartBeat: 0, quantizedDurBeats: 4 },
      ],
      chords: [],
      difficulty: 'intermediate',
      melodyContour: null,
      beat0: 0,
      beatPeriod: 0.5,
    })
    const beatPeriod = 0.5
    const withKeys = arranged.events.map((e) => ({
      ...e,
      correctionKey: noteKey(e, { timeSeconds: (e.startBeat ?? 0) * beatPeriod }),
    }))
    const target = withKeys.find((e) => e.midi === 74)
    const corrections = addRemoval(createNoteCorrections(), target.correctionKey)
    const corrected = applyNoteCorrections(withKeys, corrections, { timeOf: (e) => (e.startBeat ?? 0) * beatPeriod })

    const xml = buildArrangementMusicXml({ events: corrected.events, targetPart: 'solo-piano', bpm: 120, title: 'corrected' })
    const parsed = parseMusicXml(xml, 'corrected.musicxml')
    const pitches = parsed.notes.filter((n) => !n.isRest).map((n) => n.midi)
    expect(pitches).not.toContain(74)
    expect(pitches).toContain(72)
    expect(pitches).toContain(76)
    expect(pitches).toContain(48)
    expect(corrected.removedCount).toBe(1)
  })
})

describe('note corrections: through the real pipeline', () => {
  const SR = 22050
  const decode = (samples) => async () => ({
    channelData: [samples], sampleRate: SR, durationSeconds: samples.length / SR, channelCount: 1,
  })

  it('a correction passed to the pipeline removes exactly one note from the score', async () => {
    const samples = synthBandFixture({ seconds: 6 })
    const first = await runAudioArrangementPipeline({ name: 'band.mp3', size: 50000, type: 'audio/mpeg' }, new ArrayBuffer(64), {
      targetPart: 'solo-piano', difficulty: 'intermediate',
    }, { decodeAudioDataImpl: decode(samples), predictNotes: null })
    expect(first.ok).toBe(true)
    expect(first.arrangementEvents.length).toBeGreaterThan(2)

    // Remove the middle note of the arrangement, using the same key the review UI uses.
    const target = first.arrangementEvents[Math.floor(first.arrangementEvents.length / 2)]
    const corrections = addRemoval(createNoteCorrections(), target.correctionKey)
    const second = await runAudioArrangementPipeline({ name: 'band.mp3', size: 50000, type: 'audio/mpeg' }, new ArrayBuffer(64), {
      targetPart: 'solo-piano', difficulty: 'intermediate', corrections,
    }, { decodeAudioDataImpl: decode(samples), predictNotes: null })
    expect(second.ok).toBe(true)
    expect(second.correctionsApplied).toBe(1)
    expect(second.model.parts[0].events).toHaveLength(first.model.parts[0].events.length - 1)
    expect(second.model.parts[0].events.some((e) => e.correctionKey === target.correctionKey)).toBe(false)
    // A note that was not corrected must still be there.
    const kept = first.arrangementEvents.find((e) => e.correctionKey !== target.correctionKey)
    expect(second.model.parts[0].events.some((e) => e.correctionKey === kept.correctionKey)).toBe(true)
    // And the score is valid.
    expect(second.musicXml).toContain('<score-partwise')
    const parsed = parseMusicXml(second.musicXml, 'corrected.musicxml')
    expect(parsed.notes.filter((n) => !n.isRest).length).toBeGreaterThan(0)
  }, 90000)

  it('the arrangement events are reported uncorrected so an edit can be undone', async () => {
    const samples = synthBandFixture({ seconds: 4 })
    const out = await runAudioArrangementPipeline({ name: 'band.mp3', size: 50000, type: 'audio/mpeg' }, new ArrayBuffer(64), {
      targetPart: 'solo-guitar', difficulty: 'easy',
    }, { decodeAudioDataImpl: decode(samples), predictNotes: null })
    expect(out.ok).toBe(true)
    expect(out.arrangementEvents.length).toBeGreaterThanOrEqual(out.model.parts[0].events.length)
    expect(out.notation?.bpm).toBeGreaterThan(0)
  }, 90000)
})
