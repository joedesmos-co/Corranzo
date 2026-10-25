/**
 * Product-path checks for v3 Audio Vision corrections: the pipeline result the
 * review screen and Open in Practice consume, not just the pure data model.
 */
import { describe, expect, it } from 'vitest'
import {
  addRemoval,
  addUserNote,
  applyNoteCorrections,
  createNoteCorrections,
  setNoteEdit,
} from '../src/features/audio-vision/noteCorrections.js'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { synthBandFixture } from './audioVisionAnalysis.test.js'

const SR = 22050
const decode = (samples) => async () => ({
  channelData: [samples], sampleRate: SR, durationSeconds: samples.length / SR, channelCount: 1,
})

async function arrange(corrections) {
  const samples = synthBandFixture({ seconds: 6 })
  return runAudioArrangementPipeline(
    { name: 'band.mp3', size: 50000, type: 'audio/mpeg' },
    new ArrayBuffer(64),
    { targetPart: 'solo-piano', difficulty: 'intermediate', corrections },
    { decodeAudioDataImpl: decode(samples), predictNotes: null },
  )
}

function keyFor(result, index) {
  return result.arrangementEvents[index]?.correctionKey
}

function checkpointsAfter(result) {
  const parsed = parseMusicXml(result.musicXml, 'edited.musicxml')
  const checkpoints = buildNoteCheckpoints(parsed)
  const xml = buildArrangementMusicXml({
    events: result.model.parts[0].events,
    targetPart: 'solo-piano',
    bpm: result.notation.bpm,
    beatsPerMeasure: result.notation.beatsPerMeasure,
    title: 'edited',
  })
  return { parsed, checkpoints, xml }
}

describe('v3 corrections through the product pipeline', () => {
  it('propagates pitch, onset and duration edits into events, counts and MusicXML', async () => {
    const before = await arrange(null)
    expect(before.ok).toBe(true)
    expect(before.arrangementEvents.length).toBeGreaterThan(2)
    const target = before.arrangementEvents[1]
    const corrections = setNoteEdit(createNoteCorrections(), target.correctionKey, {
      pitchDelta: 1,
      onsetDeltaBeats: 0.25,
      durationDeltaBeats: -0.25,
    })
    const after = await arrange(corrections)
    expect(after.ok).toBe(true)
    expect(after.correctionsEdited).toBe(1)
    expect(after.correctionsAdded).toBe(0)
    expect(after.correctionsApplied).toBe(0)
    const edited = after.model.parts[0].events.find((event) => event.correctionKey === target.correctionKey)
    expect(edited.midi).toBe(Math.min(108, target.midi + 1))
    expect(edited.startBeat).toBe(target.startBeat + 0.25)
    expect(edited.durBeats).toBe(Math.max(0.05, target.durBeats - 0.25))
    const othersBefore = before.model.parts[0].events
      .filter((event) => event.correctionKey !== target.correctionKey)
      .map((event) => `${event.midi}@${event.startBeat}/${event.durBeats}`)
    const othersAfter = after.model.parts[0].events
      .filter((event) => event.correctionKey !== target.correctionKey)
      .map((event) => `${event.midi}@${event.startBeat}/${event.durBeats}`)
    expect(othersAfter).toEqual(othersBefore)
    expect(parseMusicXml(after.musicXml, 'edited.musicxml').notes.length).toBeGreaterThan(0)
    expect(checkpointsAfter(after).checkpoints.length).toBeGreaterThan(0)
  }, 120000)

  it('adds a missing note, emits it in the score, and removes it again with Undo state', async () => {
    const before = await arrange(null)
    expect(before.ok).toBe(true)
    const used = new Set(before.arrangementEvents.map((event) => `${event.midi}@${event.startBeat}`))
    let add = { midi: 84, startBeat: 3.5, durBeats: 0.5 }
    for (let attempt = 0; attempt < 12 && used.has(`${add.midi}@${add.startBeat}`); attempt += 1) {
      add = { ...add, midi: 84 + attempt, startBeat: 3.5 + attempt * 0.25 }
    }
    const corrections = addUserNote(createNoteCorrections(), add)
    const after = await arrange(corrections)
    expect(after.ok).toBe(true)
    expect(after.correctionsAdded).toBe(1)
    const added = after.model.parts[0].events.find((event) => event.isUserAdded)
    expect(added).toMatchObject({ midi: add.midi, startBeat: add.startBeat, durBeats: add.durBeats, provenance: 'user' })
    const { parsed, checkpoints, xml } = checkpointsAfter(after)
    expect(parsed.notes.filter((note) => !note.isRest).some((note) => note.midi === add.midi)).toBe(true)
    expect(checkpoints.length).toBeGreaterThan(0)
    expect(xml).toContain('<score-partwise')

    const removedCorrections = addRemoval(corrections, `user:${corrections.added[0].id}`)
    const removed = await arrange(removedCorrections)
    expect(removed.ok).toBe(true)
    expect(removed.correctionsAdded).toBe(0)
    expect(removed.removedAddedEvents).toHaveLength(1)
    expect(removed.model.parts[0].events.some((event) => event.isUserAdded)).toBe(false)
    expect(applyNoteCorrections(removed.arrangementEvents, removedCorrections, { timeOf: (event) => event.startBeat }).events)
      .not.toContainEqual(expect.objectContaining({ isUserAdded: true }))
  }, 120000)

  it('keeps a corrected score deterministic across a second rebuild', async () => {
    const before = await arrange(null)
    const target = before.arrangementEvents[0]
    const corrections = setNoteEdit(createNoteCorrections(), target.correctionKey, { pitchDelta: -2 })
    const first = await arrange(corrections)
    const second = await arrange(corrections)
    expect(first.musicXml).toBe(second.musicXml)
    expect(first.model.parts[0].events.map((event) => `${event.midi}@${event.startBeat}`))
      .toEqual(second.model.parts[0].events.map((event) => `${event.midi}@${event.startBeat}`))
  }, 120000)
})
