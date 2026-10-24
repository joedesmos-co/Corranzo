/**
 * Per-note corrections: the musician removes a wrong note, the score
 * regenerates with exactly that note gone, and the edit survives a reload and
 * a regeneration without touching anything else.
 *
 * These tests protect the properties the architecture rests on:
 *   1. a correction is a content key (pitch + written beat + occurrence), so
 *      it identifies the same note after regeneration and cannot collide with
 *      a repeated note or a simultaneous duplicate;
 *   2. the transcription, the corrections and the arrangement are separate -
 *      applying corrections never mutates the evidence it was given;
 *   3. a correction that no longer matches anything is inert, so a stale edit
 *      can never start deleting a different note;
 *   4. the record persists with the arrangement identity (recording + target +
 *      difficulty + excerpt), and never leaks to a different score.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  noteKey,
  annotateNoteKeys,
  createNoteCorrections,
  addRemoval,
  undoRemoval,
  undoLastRemoval,
  hasRemoval,
  applyNoteCorrections,
  resolveCorrections,
  serializeNoteCorrections,
  parseNoteCorrections,
} from '../src/features/audio-vision/noteCorrections.js'
import {
  getNoteCorrectionStorageKey,
  loadNoteCorrections,
  saveNoteCorrections,
  clearNoteCorrections,
} from '../src/features/audio-vision/noteCorrectionStorage.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { synthBandFixture } from './audioVisionAnalysis.test.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { buildSessionMeta } from '../src/features/session/sessionPersistence.js'
import { rebuildMusicXmlSourceFromSessionMeta } from '../src/features/import/musicXmlSource.js'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
}

const events = () => [
  { midi: 72, startBeat: 0, durBeats: 1, hand: 'RH', role: 'melody' },
  { midi: 76, startBeat: 1, durBeats: 1, hand: 'RH', role: 'melody' },
  { midi: 48, startBeat: 0, durBeats: 2, hand: 'LH', role: 'bass' },
]
const timeOf = (event) => event.startBeat ?? 0

describe('note corrections: identity', () => {
  it('keys a note by pitch, written beat and occurrence', () => {
    expect(noteKey({ midi: 72, startSeconds: 0 }, { timeSeconds: 0 })).toBe('72@0.0000#1')
    expect(noteKey({ midi: 72 }, { timeSeconds: 1.234 })).toBe('72@1.2340#1')
    expect(noteKey({ midi: 72 }, { timeSeconds: 1.234, occurrence: 2 })).toBe('72@1.2340#2')
  })

  it('the same note gets the same key after a regeneration', () => {
    const first = events()[1]
    const second = events()[1]
    expect(noteKey(first, { timeSeconds: timeOf(first) })).toBe(noteKey(second, { timeSeconds: timeOf(second) }))
  })

  it('repeated notes at different beats never share a key', () => {
    const repeated = [
      { midi: 60, startBeat: 0, durBeats: 1 },
      { midi: 60, startBeat: 1, durBeats: 1 },
      { midi: 60, startBeat: 1, durBeats: 1 },
    ]
    const keys = annotateNoteKeys(repeated, { timeOf }).map((event) => event.correctionKey)
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[1]).not.toBe(keys[2])
  })

  it('assigns distinct keys to simultaneous duplicates and removes exactly one', () => {
    const duplicated = [
      { midi: 60, startBeat: 2, durBeats: 1, hand: 'RH', role: 'melody' },
      { midi: 60, startBeat: 2, durBeats: 1, hand: 'RH', role: 'melody' },
      { midi: 64, startBeat: 2, durBeats: 1, hand: 'RH', role: 'melody' },
    ]
    const annotated = annotateNoteKeys(duplicated, { timeOf })
    expect(annotated[0].correctionKey).not.toBe(annotated[1].correctionKey)
    const target = annotated[0].correctionKey
    const result = applyNoteCorrections(duplicated, addRemoval(createNoteCorrections(), target), { timeOf })
    expect(result.removedCount).toBe(1)
    expect(result.events).toHaveLength(2)
    expect(result.events.filter((event) => event.midi === 60)).toHaveLength(1)
    expect(result.events.some((event) => event.midi === 64)).toBe(true)
  })

  it('keeps duplicate keys stable when the array is reordered', () => {
    const duplicated = [
      { midi: 60, startBeat: 2, durBeats: 1, hand: 'RH' },
      { midi: 60, startBeat: 2, durBeats: 2, hand: 'LH' },
    ]
    const forward = annotateNoteKeys(duplicated, { timeOf })
    const backward = annotateNoteKeys([...duplicated].reverse(), { timeOf })
    const byDuration = (list) => Object.fromEntries(list.map((event) => [event.durBeats, event.correctionKey]))
    expect(byDuration(backward)).toEqual(byDuration(forward))
    expect(byDuration(forward)[1]).not.toBe(byDuration(forward)[2])
  })
})

describe('note corrections: the correction set', () => {
  it('is immutable (adding and undoing never mutate the input)', () => {
    const base = createNoteCorrections()
    const added = addRemoval(base, '72@0.0000#1')
    expect(base.removed).toEqual([])
    expect(added.removed).toEqual(['72@0.0000#1'])
    const undone = undoRemoval(added, '72@0.0000#1')
    expect(added.removed).toEqual(['72@0.0000#1'])
    expect(undone.removed).toEqual([])
  })

  it('does not duplicate a key and can undo the last edit', () => {
    let corrections = addRemoval(createNoteCorrections(), '72@0.0000#1')
    corrections = addRemoval(corrections, '76@1.0000#1')
    corrections = addRemoval(corrections, '76@1.0000#1')
    expect(corrections.removed).toHaveLength(2)
    expect(undoLastRemoval(corrections).removed).toEqual(['72@0.0000#1'])
    expect(hasRemoval(corrections, '76@1.0000#1')).toBe(true)
  })

  it('round trips through storage and rejects an unknown version', () => {
    const corrections = addRemoval(createNoteCorrections(), '72@0.0000#1')
    expect(parseNoteCorrections(serializeNoteCorrections(corrections))).toEqual(corrections)
    expect(parseNoteCorrections({ version: 99, removed: ['72@0.0000#1'] }).removed).toEqual([])
  })

  it('keeps legacy v1 keys but never lets them delete a v2 duplicate', () => {
    const legacy = parseNoteCorrections({ version: 1, removed: ['72@0.00'] })
    expect(legacy.removed).toEqual(['72@0.00'])
    const result = applyNoteCorrections(events(), legacy, { timeOf })
    expect(result.removedCount).toBe(0)
  })
})

describe('note corrections: applying them', () => {
  it('removes exactly the corrected note and nothing else', () => {
    const list = events()
    const key = noteKey(list[1], { timeSeconds: timeOf(list[1]) })
    const corrections = addRemoval(createNoteCorrections(), key)
    const result = applyNoteCorrections(list, corrections, { timeOf })
    expect(result.removedCount).toBe(1)
    expect(result.removedEvents.map((event) => event.midi)).toEqual([76])
    expect(result.events.map((event) => `${event.midi}@${event.startBeat}`)).toEqual(['72@0', '48@0'])
  })

  it('never mutates the events it was given', () => {
    const list = events()
    const snapshot = JSON.stringify(list)
    applyNoteCorrections(list, addRemoval(createNoteCorrections(), '76@1.0000#1'), { timeOf })
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
    const stale = addRemoval(createNoteCorrections(), '99@7.0000#1')
    const resolution = resolveCorrections(list, stale, { timeOf })
    expect(resolution.applied).toEqual([])
    expect(resolution.stale).toEqual(['99@7.0000#1'])
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
        { midi: 48, quantizedStartBeat: 0, quantizedDurBeats: 1 },
      ],
      chords: [],
      difficulty: 'intermediate',
      melodyContour: null,
      beat0: 0,
      beatPeriod: 0.5,
    })
    const withKeys = annotateNoteKeys(arranged.events, { timeOf })
    const target = withKeys.find((event) => event.midi === 74)
    expect(target.correctionKey).toBeTruthy()
    const corrected = applyNoteCorrections(
      withKeys,
      addRemoval(createNoteCorrections(), target.correctionKey),
      { timeOf },
    )

    const xml = buildArrangementMusicXml({ events: corrected.events, targetPart: 'solo-piano', bpm: 120, title: 'corrected' })
    const originalXml = buildArrangementMusicXml({ events: withKeys, targetPart: 'solo-piano', bpm: 120, title: 'original' })
    const parsed = parseMusicXml(xml, 'corrected.musicxml')
    const pitches = parsed.notes.filter((note) => !note.isRest).map((note) => note.midi)
    expect(pitches).not.toContain(74)
    expect(pitches).toContain(72)
    expect(pitches).toContain(76)
    expect(pitches).toContain(48)
    expect(corrected.removedCount).toBe(1)

    // The practice targets are built from this MusicXML: the removed note must
    // vanish from the checkpoints and every other target must remain.
    const before = buildNoteCheckpoints(parseMusicXml(originalXml, 'original.musicxml'))
    const after = buildNoteCheckpoints(parsed)
    expect(after.length).toBe(before.length - 1)
    expect(after.some((checkpoint) => checkpoint.expectedMidis.includes(74))).toBe(false)
    for (const midi of [72, 76, 48]) {
      expect(after.some((checkpoint) => checkpoint.expectedMidis.includes(midi))).toBe(true)
    }
  })

  it('keeps the guitar TAB staff intact after one note is removed', () => {
    const arranged = arrangeSoloGuitar({
      quantizedNotes: [
        { midi: 64, quantizedStartBeat: 0, quantizedDurBeats: 1 },
        { midi: 67, quantizedStartBeat: 1, quantizedDurBeats: 1 },
        { midi: 71, quantizedStartBeat: 2, quantizedDurBeats: 1 },
      ],
      chords: [],
      difficulty: 'intermediate',
      melodyContour: null,
      beat0: 0,
      beatPeriod: 0.5,
    })
    const withKeys = annotateNoteKeys(arranged.events, { timeOf })
    const target = withKeys.find((event) => event.midi === 67)
    expect(target?.correctionKey).toBeTruthy()
    const corrected = applyNoteCorrections(withKeys, addRemoval(createNoteCorrections(), target.correctionKey), { timeOf })
    const xml = buildArrangementMusicXml({ events: corrected.events, targetPart: 'solo-guitar', bpm: 120, title: 'guitar' })
    expect(xml).toContain('<technical>')
    expect(xml).toContain('<staff>2</staff>')
    expect(corrected.events.some((event) => event.midi === 67)).toBe(false)
    expect(corrected.events.some((event) => event.midi === 64)).toBe(true)
    expect(corrected.events.some((event) => event.midi === 71)).toBe(true)
  })
})

describe('note corrections: through the real pipeline', () => {
  const SR = 22050
  const decode = (samples) => async () => ({
    channelData: [samples], sampleRate: SR, durationSeconds: samples.length / SR, channelCount: 1,
  })

  it('a correction passed to the pipeline removes exactly one note from the score', async () => {
    const samples = synthBandFixture({ seconds: 6 })
    const first = await runAudioArrangementPipeline(
      { name: 'band.mp3', size: 50000, type: 'audio/mpeg' },
      new ArrayBuffer(64),
      { targetPart: 'solo-piano', difficulty: 'intermediate' },
      { decodeAudioDataImpl: decode(samples), predictNotes: null },
    )
    expect(first.ok).toBe(true)
    expect(first.arrangementEvents.length).toBeGreaterThan(2)
    expect(first.transcriptionEvidence.noteCount).toBe(first.arrangementEvents.length)
    expect(first.correctionsApplied).toBe(0)

    // Remove a middle note of the arrangement, using the same key the review UI uses.
    const target = first.arrangementEvents[Math.floor(first.arrangementEvents.length / 2)]
    const corrections = addRemoval(createNoteCorrections(), target.correctionKey)
    const second = await runAudioArrangementPipeline(
      { name: 'band.mp3', size: 50000, type: 'audio/mpeg' },
      new ArrayBuffer(64),
      { targetPart: 'solo-piano', difficulty: 'intermediate', corrections },
      { decodeAudioDataImpl: decode(samples), predictNotes: null },
    )
    expect(second.ok).toBe(true)
    expect(second.correctionsApplied).toBe(1)
    expect(second.correctionsStale).toBe(0)
    expect(second.removedEvents).toHaveLength(1)
    expect(second.removedEvents[0].correctionKey).toBe(target.correctionKey)
    expect(second.model.parts[0].events).toHaveLength(first.model.parts[0].events.length - 1)
    expect(second.model.parts[0].events.some((event) => event.correctionKey === target.correctionKey)).toBe(false)
    // The evidence is retained whole and uncorrected.
    expect(second.arrangementEvents).toHaveLength(first.arrangementEvents.length)
    expect(second.transcriptionEvidence.noteCount).toBe(first.arrangementEvents.length)
    // A note that was not corrected must still be there.
    const kept = first.arrangementEvents.find((event) => event.correctionKey !== target.correctionKey)
    expect(second.model.parts[0].events.some((event) => event.correctionKey === kept.correctionKey)).toBe(true)
    // And the score is valid.
    expect(second.musicXml).toContain('<score-partwise')
    const parsed = parseMusicXml(second.musicXml, 'corrected.musicxml')
    expect(parsed.notes.filter((note) => !note.isRest).length).toBeGreaterThan(0)
  }, 120_000)

  it('reports a stale saved correction and leaves the score unchanged', async () => {
    const samples = synthBandFixture({ seconds: 4 })
    const stale = addRemoval(createNoteCorrections(), '127@999.0000#1')
    const out = await runAudioArrangementPipeline(
      { name: 'band.mp3', size: 50000, type: 'audio/mpeg' },
      new ArrayBuffer(64),
      { targetPart: 'solo-guitar', difficulty: 'easy', corrections: stale },
      { decodeAudioDataImpl: decode(samples), predictNotes: null },
    )
    expect(out.ok).toBe(true)
    expect(out.correctionsApplied).toBe(0)
    expect(out.correctionsStale).toBe(1)
    expect(out.staleCorrectionKeys).toEqual(['127@999.0000#1'])
    expect(out.corrections.removed).toEqual(['127@999.0000#1'])
  }, 120_000)
})

describe('note corrections: persistence', () => {
  beforeEach(() => {
    store.clear()
  })

  const settings = { targetPart: 'solo-piano', difficulty: 'intermediate', excerpt: null }
  const fingerprint = 'take-one.wav::123::99'

  it('round-trips for the same recording and arrangement', () => {
    const corrections = addRemoval(createNoteCorrections(), '60@0.0000#1')
    expect(saveNoteCorrections(fingerprint, settings, corrections)).toBe(true)
    expect(loadNoteCorrections(fingerprint, settings)).toEqual(corrections)
  })

  it('never applies to a different recording, target, difficulty or excerpt', () => {
    const corrections = addRemoval(createNoteCorrections(), '60@0.0000#1')
    saveNoteCorrections(fingerprint, settings, corrections)
    expect(loadNoteCorrections('take-two.wav::123::99', settings).removed).toEqual([])
    expect(loadNoteCorrections(fingerprint, { ...settings, targetPart: 'solo-guitar' }).removed).toEqual([])
    expect(loadNoteCorrections(fingerprint, { ...settings, difficulty: 'advanced' }).removed).toEqual([])
    expect(loadNoteCorrections(fingerprint, { ...settings, excerpt: { startSeconds: 30, durationSeconds: 60 } }).removed).toEqual([])
  })

  it('clears the stored record when the set becomes empty', () => {
    const corrections = addRemoval(createNoteCorrections(), '60@0.0000#1')
    saveNoteCorrections(fingerprint, settings, corrections)
    expect(store.has(getNoteCorrectionStorageKey(fingerprint, settings))).toBe(true)
    expect(clearNoteCorrections(fingerprint, settings)).toBe(true)
    expect(store.has(getNoteCorrectionStorageKey(fingerprint, settings))).toBe(false)
    expect(loadNoteCorrections(fingerprint, settings).removed).toEqual([])
  })

  it('travels with the saved score metadata, separate from the MusicXML bytes', () => {
    const corrections = addRemoval(createNoteCorrections(), '60@0.0000#1')
    const meta = buildSessionMeta({
      pdfMeta: null,
      midiSource: null,
      musicXmlSource: {
        fileName: 'solo-piano-arrangement.musicxml',
        data: new TextEncoder().encode('<score-partwise/>').buffer,
        source: 'audio-arrangement',
        omrMeta: {
          arrangement: {
            targetPart: 'solo-piano',
            difficulty: 'intermediate',
            corrections,
            correctionsApplied: 1,
            removedNoteCount: 1,
            originalNoteCount: 4,
          },
        },
      },
      activeView: 'import',
      pageNumber: 1,
    })
    expect(meta.omrMeta.arrangement.corrections).toEqual(corrections)
    const restored = rebuildMusicXmlSourceFromSessionMeta(
      meta.musicXmlFileName,
      new TextEncoder().encode('<score-partwise/>').buffer,
      meta,
    )
    expect(restored.source).toBe('audio-arrangement')
    expect(restored.omrMeta.arrangement.corrections).toEqual(corrections)
    expect(restored.omrMeta.arrangement.removedNoteCount).toBe(1)
  })

  it('is safe without localStorage (SSR/private mode)', () => {
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    expect(loadNoteCorrections(fingerprint, settings).removed).toEqual([])
    expect(saveNoteCorrections(fingerprint, settings, createNoteCorrections())).toBe(false)
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  })
})
