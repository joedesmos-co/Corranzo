/**
 * Full note-correction model (record version 3): pitch, onset, duration and
 * musician-added notes, on top of the shipped removal workflow.
 *
 * The invariants these tests protect are the ones in
 * docs/audio-vision-corrections-design.md:
 *
 *   1. editing one note never changes an unrelated note;
 *   2. removals win over every other edit;
 *   3. an added note never duplicates an existing pitch+onset (two identical
 *      practice targets would be created);
 *   4. the rebuild is deterministic (same record twice, same notes);
 *   5. v1/v2 records still load (removals only);
 *   6. the written MusicXML reflects the edits and still parses.
 */
import { describe, it, expect } from 'vitest'
import {
  annotateNoteKeys,
  applyNoteCorrections,
  addRemoval,
  addUserNote,
  createNoteCorrections,
  noteEdit,
  parseNoteCorrections,
  removeUserNote,
  serializeNoteCorrections,
  setNoteEdit,
  undoLastEdit,
  resolveCorrections,
} from '../src/features/audio-vision/noteCorrections.js'
import { arrangeSoloPiano } from '../src/features/audio-vision/soloPiano.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { loadNoteCorrections, saveNoteCorrections } from '../src/features/audio-vision/noteCorrectionStorage.js'
import { synthBandFixture } from './audioVisionAnalysis.test.js'

const timeOf = (e) => (e.startBeat ?? 0) * 0.5 // 120 BPM
const quarter = () => [
  { midi: 72, startBeat: 0, durBeats: 1, hand: 'RH', role: 'melody' },
  { midi: 76, startBeat: 1, durBeats: 1, hand: 'RH', role: 'melody' },
  { midi: 48, startBeat: 0, durBeats: 2, hand: 'LH', role: 'bass' },
]
const keyFor = (events, index) => annotateNoteKeys(events, { timeOf })[index].correctionKey
const asText = (events) => events.map((e) => `${e.midi}@${e.startBeat}/${e.durBeats}`)

describe('v3 corrections: pitch, onset, duration', () => {
  it('changes the pitch of exactly one note', () => {
    const events = quarter()
    const key = keyFor(events, 1)
    const corrections = setNoteEdit(createNoteCorrections(), key, { pitchDelta: -1 })
    const result = applyNoteCorrections(events, corrections, { timeOf })
    expect(asText(result.events)).toEqual(['72@0/1', '75@1/1', '48@0/2'])
    expect(result.editedCount).toBe(1)
  })

  it('moves the onset of exactly one note and never before the bar', () => {
    const events = quarter()
    const key = keyFor(events, 1)
    const shifted = applyNoteCorrections(events, setNoteEdit(createNoteCorrections(), key, { onsetDeltaBeats: 0.5 }), { timeOf })
    expect(asText(shifted.events)).toEqual(['72@0/1', '76@1.5/1', '48@0/2'])
    const clamped = applyNoteCorrections(events, setNoteEdit(createNoteCorrections(), key, { onsetDeltaBeats: -8 }), { timeOf })
    expect(clamped.events.every((e) => (e.startBeat ?? 0) >= 0)).toBe(true)
  })

  it('changes the duration of exactly one note', () => {
    const events = quarter()
    const key = keyFor(events, 0)
    const result = applyNoteCorrections(events, setNoteEdit(createNoteCorrections(), key, { durationDeltaBeats: 0.5 }), { timeOf })
    expect(asText(result.events)).toEqual(['72@0/1.5', '76@1/1', '48@0/2'])
  })

  it('combines edits on one note without touching the others', () => {
    const events = quarter()
    const key = keyFor(events, 1)
    const corrections = setNoteEdit(createNoteCorrections(), key, { pitchDelta: 12, onsetDeltaBeats: 0.25, durationDeltaBeats: -0.5 })
    const result = applyNoteCorrections(events, corrections, { timeOf })
    expect(result.events[1].midi).toBe(88)
    expect(result.events[1].startBeat).toBe(1.25)
    expect(result.events[1].durBeats).toBe(0.5)
    expect(result.events[0]).toEqual(annotateNoteKeys(events, { timeOf })[0])
    expect(result.events[2]).toEqual(annotateNoteKeys(events, { timeOf })[2])
  })

  it('removals win over edits', () => {
    const events = quarter()
    const key = keyFor(events, 0)
    let corrections = setNoteEdit(createNoteCorrections(), key, { pitchDelta: -2 })
    corrections = addRemoval(corrections, key)
    const result = applyNoteCorrections(events, corrections, { timeOf })
    expect(result.events.map((e) => e.midi)).toEqual([76, 48])
    expect(result.removedCount).toBe(1)
  })

  it('is deterministic: the same record applied twice gives identical notes', () => {
    const events = quarter()
    const corrections = setNoteEdit(createNoteCorrections(), keyFor(events, 1), { pitchDelta: 1, onsetDeltaBeats: 0.5 })
    const a = applyNoteCorrections(events, corrections, { timeOf })
    const b = applyNoteCorrections(events, corrections, { timeOf })
    expect(asText(a.events)).toEqual(asText(b.events))
  })

  it('bounds absurd edits instead of corrupting the score', () => {
    const events = quarter()
    const key = keyFor(events, 0)
    const corrections = setNoteEdit(createNoteCorrections(), key, { pitchDelta: 99, durationDeltaBeats: -99 })
    const result = applyNoteCorrections(events, corrections, { timeOf })
    expect(result.events[0].midi).toBeLessThanOrEqual(108)
    expect(result.events[0].durBeats).toBeGreaterThan(0)
  })
})

describe('v3 corrections: adding notes', () => {
  it('adds a missing note once, marked as created by the musician', () => {
    const events = quarter()
    const corrections = addUserNote(createNoteCorrections(), { midi: 67, startBeat: 0.5, durBeats: 0.5, hand: 'RH' })
    const result = applyNoteCorrections(events, corrections, { timeOf })
    expect(result.addedCount).toBe(1)
    const added = result.events.find((e) => e.isUserAdded)
    expect(added.midi).toBe(67)
    expect(added.startBeat).toBe(0.5)
    expect(added.provenance).toBe('user')
  })

  it('refuses to create a duplicate of an existing pitch+onset', () => {
    const events = quarter()
    const corrections = addUserNote(createNoteCorrections(), { midi: 72, startBeat: 0, durBeats: 1 })
    const result = applyNoteCorrections(events, corrections, { timeOf })
    expect(result.addedCount).toBe(0)
    expect(result.skippedAdditions).toHaveLength(1)
    expect(result.events).toHaveLength(3)
  })

  it('an added note can be removed again', () => {
    const events = quarter()
    let corrections = addUserNote(createNoteCorrections(), { midi: 67, startBeat: 0.5, durBeats: 0.5 })
    const id = corrections.added[0].id
    corrections = addRemoval(corrections, `user:${id}`)
    const result = applyNoteCorrections(events, corrections, { timeOf })
    expect(result.addedCount).toBe(0)
    expect(result.events.some((e) => e.isUserAdded)).toBe(false)
  })

  it('removeUserNote drops the addition from the record', () => {
    let corrections = addUserNote(createNoteCorrections(), { midi: 67, startBeat: 0.5, durBeats: 0.5 })
    corrections = removeUserNote(corrections, corrections.added[0].id)
    expect(corrections.added).toHaveLength(0)
  })
})

describe('v3 corrections: record shape and undo', () => {
  it('undo walks back the last edit of any kind', () => {
    let corrections = createNoteCorrections()
    corrections = addRemoval(corrections, '72@0.0000#1')
    corrections = setNoteEdit(corrections, '76@0.5000#1', { pitchDelta: 1 })
    expect(corrections.removed).toHaveLength(1)
    expect(Object.keys(corrections.notes)).toHaveLength(1)
    corrections = undoLastEdit(corrections)
    expect(Object.keys(corrections.notes)).toHaveLength(0)
    expect(corrections.removed).toHaveLength(1)
    corrections = undoLastEdit(corrections)
    expect(corrections.removed).toHaveLength(0)
  })

  it('round-trips through storage', () => {
    const events = quarter()
    let corrections = setNoteEdit(createNoteCorrections(), keyFor(events, 1), { pitchDelta: -1, onsetDeltaBeats: 0.25 })
    corrections = addUserNote(corrections, { midi: 55, startBeat: 2, durBeats: 0.5 })
    expect(parseNoteCorrections(serializeNoteCorrections(corrections))).toEqual(corrections)
  })

  it('a v1 or v2 record still loads, as removals only', () => {
    for (const version of [1, 2]) {
      const loaded = parseNoteCorrections({ version, removed: ['72@0.0000'] })
      expect(loaded.removed).toEqual(['72@0.0000'])
      expect(loaded.notes).toEqual({})
      expect(loaded.added).toEqual([])
    }
  })

  it('ignores an unknown version instead of guessing', () => {
    expect(parseNoteCorrections({ version: 99, removed: ['x'], notes: { y: { pitchDelta: 1 } } }))
      .toEqual(createNoteCorrections())
  })

  it('noteEdit returns a copy, never the stored object', () => {
    const corrections = setNoteEdit(createNoteCorrections(), 'k', { pitchDelta: 1 })
    const edit = noteEdit(corrections, 'k')
    edit.pitchDelta = 5
    expect(corrections.notes.k.pitchDelta).toBe(1)
  })
})

describe('v3 corrections: reset, stale resolution and persistence', () => {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  }
  const settings = { targetPart: 'solo-piano', difficulty: 'intermediate', excerpt: null }
  const fingerprint = 'v3-test.wav::12::34'

  it('resets one note\'s edits without touching another note', () => {
    const events = quarter()
    let corrections = setNoteEdit(createNoteCorrections(), keyFor(events, 0), { pitchDelta: 2 })
    corrections = setNoteEdit(corrections, keyFor(events, 1), { pitchDelta: -2 })
    corrections = setNoteEdit(corrections, keyFor(events, 0), null)
    expect(noteEdit(corrections, keyFor(events, 0))).toEqual({})
    expect(noteEdit(corrections, keyFor(events, 1))).toEqual({ pitchDelta: -2 })
  })

  it('reports stale edits, but treats a removed user-added note as applied', () => {
    const events = quarter()
    let corrections = setNoteEdit(createNoteCorrections(), 'gone@0.0000#1', { pitchDelta: 1 })
    corrections = addUserNote(corrections, { midi: 67, startBeat: 2, durBeats: 1 })
    corrections = addRemoval(corrections, `user:${corrections.added[0].id}`)
    const resolution = resolveCorrections(events, corrections, { timeOf })
    expect(resolution.stale).toContain('gone@0.0000#1')
    expect(resolution.applied).toContain(`user:${corrections.added[0].id}`)
  })

  it('persists a record containing only a pitch edit', () => {
    storage.clear()
    const events = quarter()
    const corrections = setNoteEdit(createNoteCorrections(), keyFor(events, 0), { pitchDelta: 1 })
    expect(saveNoteCorrections(fingerprint, settings, corrections)).toBe(true)
    expect(storage.size).toBe(1)
    expect(loadNoteCorrections(fingerprint, settings)).toEqual(corrections)
  })

  it('persists a record containing only an added note', () => {
    storage.clear()
    const corrections = addUserNote(createNoteCorrections(), { midi: 67, startBeat: 2, durBeats: 1 })
    expect(saveNoteCorrections(fingerprint, settings, corrections)).toBe(true)
    expect(storage.size).toBe(1)
    expect(loadNoteCorrections(fingerprint, settings)).toEqual(corrections)
  })

  it('clears storage when the last edit is undone, not only the last removal', () => {
    storage.clear()
    const events = quarter()
    const corrections = setNoteEdit(createNoteCorrections(), keyFor(events, 0), { pitchDelta: 1 })
    saveNoteCorrections(fingerprint, settings, corrections)
    expect(storage.size).toBe(1)
    saveNoteCorrections(fingerprint, settings, createNoteCorrections())
    expect(storage.size).toBe(0)
  })
})

describe('v3 corrections: the score', () => {
  const arranged = () => {
    const out = arrangeSoloPiano({
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
    return annotateNoteKeys(out.events, { timeOf })
  }

  it('the written MusicXML reflects pitch, onset and duration edits', () => {
    const events = arranged()
    const target = events.find((e) => e.midi === 74)
    const corrections = setNoteEdit(createNoteCorrections(), target.correctionKey, { pitchDelta: 3, durationDeltaBeats: 1 })
    const result = applyNoteCorrections(events, corrections, { timeOf })
    const xml = buildArrangementMusicXml({ events: result.events, targetPart: 'solo-piano', bpm: 120, title: 'edited' })
    const parsed = parseMusicXml(xml, 'edited.musicxml')
    const pitches = parsed.notes.filter((n) => !n.isRest).map((n) => n.midi)
    expect(pitches).toContain(77) // 74 + 3
    expect(pitches).toContain(72)
    expect(pitches).toContain(76)
    expect(pitches).toContain(48)
    expect(pitches).not.toContain(74)
    expect(parsed.notes.filter((n) => !n.isRest).every((n) => n.durationSeconds > 0)).toBe(true)
  })

  it('an added note appears in the written score', () => {
    const events = arranged()
    const corrections = addUserNote(createNoteCorrections(), { midi: 67, startBeat: 1, durBeats: 0.5, hand: 'RH' })
    const result = applyNoteCorrections(events, corrections, { timeOf })
    const xml = buildArrangementMusicXml({ events: result.events, targetPart: 'solo-piano', bpm: 120, title: 'added' })
    const parsed = parseMusicXml(xml, 'added.musicxml')
    expect(parsed.notes.filter((n) => !n.isRest).some((n) => n.midi === 67)).toBe(true)
  })

  it('every measure stays exactly one bar after edits', () => {
    const events = arranged()
    const target = events.find((e) => e.midi === 76)
    const corrections = setNoteEdit(createNoteCorrections(), target.correctionKey, { onsetDeltaBeats: 0.5, durationDeltaBeats: -0.25 })
    const result = applyNoteCorrections(events, corrections, { timeOf })
    const xml = buildArrangementMusicXml({ events: result.events, targetPart: 'solo-piano', bpm: 120, title: 'bars' })
    for (const [, body] of xml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)) {
      let voice = 1
      const totals = new Map()
      const childRe = /<note>([\s\S]*?)<\/note>|<backup>/g
      let child
      while ((child = childRe.exec(body)) !== null) {
        if (child[1] == null) { voice += 1; continue }
        if (/<chord\s*\/?>/.test(child[1])) continue
        totals.set(voice, (totals.get(voice) ?? 0) + Number(child[1].match(/<duration>(\d+)</)?.[1] ?? 0))
      }
      for (const [, total] of totals) expect(total).toBe(64)
    }
  })
})

describe('v3 corrections: through the real pipeline', () => {
  const SR = 22050
  const decode = (samples) => async () => ({
    channelData: [samples], sampleRate: SR, durationSeconds: samples.length / SR, channelCount: 1,
  })

  it('a pitch edit reaches the events Practice consumes and keeps the score valid', async () => {
    const samples = synthBandFixture({ seconds: 6 })
    const before = await runAudioArrangementPipeline({ name: 'band.mp3', size: 50000, type: 'audio/mpeg' }, new ArrayBuffer(64), {
      targetPart: 'solo-piano', difficulty: 'intermediate',
    }, { decodeAudioDataImpl: decode(samples), predictNotes: null })
    expect(before.ok).toBe(true)
    expect(before.arrangementEvents.length).toBeGreaterThan(2)

    const target = before.arrangementEvents[Math.floor(before.arrangementEvents.length / 2)]
    const corrections = setNoteEdit(createNoteCorrections(), target.correctionKey, { pitchDelta: 1 })
    const after = await runAudioArrangementPipeline({ name: 'band.mp3', size: 50000, type: 'audio/mpeg' }, new ArrayBuffer(64), {
      targetPart: 'solo-piano', difficulty: 'intermediate', corrections,
    }, { decodeAudioDataImpl: decode(samples), predictNotes: null })
    expect(after.ok).toBe(true)

    // The note is one semitone higher; every other note is unchanged.
    const edited = after.model.parts[0].events.find((e) => e.correctionKey === target.correctionKey)
    expect(edited.midi).toBe(Math.max(21, Math.min(108, target.midi + 1)))
    const othersBefore = before.model.parts[0].events.filter((e) => e.correctionKey !== target.correctionKey).map((e) => `${e.midi}@${e.startBeat}`)
    const othersAfter = after.model.parts[0].events.filter((e) => e.correctionKey !== target.correctionKey).map((e) => `${e.midi}@${e.startBeat}`)
    expect(othersAfter).toEqual(othersBefore)
    expect(after.musicXml).toContain('<score-partwise')
    expect(parseMusicXml(after.musicXml, 'edited.musicxml').notes.filter((n) => !n.isRest).length).toBeGreaterThan(0)
  }, 90000)
})
