import { describe, expect, it } from 'vitest'
import { friendlyPianoLabels, labelHandTracks } from '../src/features/playback/parseMidiFile.js'

const notes = (midis) => midis.map((midi) => ({ midi }))

describe('labelHandTracks — hand inference', () => {
  it('labels two Klavier tracks as Right/Left hand by average pitch', () => {
    const midiTracks = [
      { name: 'Klavier 1', notes: notes([72, 76, 79]) }, // higher → right
      { name: 'Klavier 2', notes: notes([45, 48, 50]) }, // lower → left
    ]
    const summary = [
      { id: 0, name: 'Klavier 1', noteCount: 3, muted: false },
      { id: 1, name: 'Klavier 2', noteCount: 3, muted: false },
    ]
    expect(labelHandTracks(midiTracks, summary).map((t) => t.name)).toEqual([
      'Right hand',
      'Left hand',
    ])
  })

  it('still labels English "Piano" two-hand scores', () => {
    const midiTracks = [
      { name: 'Piano', notes: notes([40, 43]) },
      { name: 'Piano', notes: notes([70, 74]) },
    ]
    const summary = [
      { id: 0, name: 'Piano', noteCount: 2, muted: false },
      { id: 1, name: 'Piano', noteCount: 2, muted: false },
    ]
    expect(labelHandTracks(midiTracks, summary).map((t) => t.name)).toEqual([
      'Left hand',
      'Right hand',
    ])
  })
})

describe('friendlyPianoLabels — Piano N fallback', () => {
  it('renames numbered Klavier tracks to Piano N when hands cannot be inferred', () => {
    const tracks = [
      { id: 0, name: 'Klavier 1' },
      { id: 1, name: 'Klavier 2' },
      { id: 2, name: 'Klavier 3' },
    ]
    expect(friendlyPianoLabels(tracks).map((t) => t.name)).toEqual([
      'Piano 1',
      'Piano 2',
      'Piano 3',
    ])
  })

  it('uses a bare "Piano" for a single piano track', () => {
    expect(friendlyPianoLabels([{ id: 0, name: 'Klavier' }]).map((t) => t.name)).toEqual(['Piano'])
  })

  it('recognizes non-English / technical piano spellings', () => {
    const tracks = [
      { id: 0, name: 'Flügel' },
      { id: 1, name: 'Pianoforte' },
    ]
    expect(friendlyPianoLabels(tracks).map((t) => t.name)).toEqual(['Piano 1', 'Piano 2'])
  })

  it('never renames hands or non-piano instruments', () => {
    expect(
      friendlyPianoLabels([
        { id: 0, name: 'Right hand' },
        { id: 1, name: 'Left hand' },
      ]).map((t) => t.name),
    ).toEqual(['Right hand', 'Left hand'])

    expect(
      friendlyPianoLabels([
        { id: 0, name: 'Violin' },
        { id: 1, name: 'Klavier' },
      ]).map((t) => t.name),
    ).toEqual(['Violin', 'Piano'])
  })

  it('end-to-end: 2 Klavier tracks → hands; 3 → Piano N', () => {
    const two = [
      { name: 'Klavier 1', notes: notes([72, 76]) },
      { name: 'Klavier 2', notes: notes([45, 48]) },
    ]
    const twoSummary = two.map((t, id) => ({ id, name: t.name, noteCount: 2, muted: false }))
    expect(friendlyPianoLabels(labelHandTracks(two, twoSummary)).map((t) => t.name)).toEqual([
      'Right hand',
      'Left hand',
    ])

    const threeSummary = [0, 1, 2].map((id) => ({ id, name: `Klavier ${id + 1}`, muted: false }))
    // labelHandTracks is a no-op for !=2 tracks, so the Piano N fallback applies.
    expect(friendlyPianoLabels(labelHandTracks([{}, {}, {}], threeSummary)).map((t) => t.name)).toEqual(
      ['Piano 1', 'Piano 2', 'Piano 3'],
    )
  })
})
