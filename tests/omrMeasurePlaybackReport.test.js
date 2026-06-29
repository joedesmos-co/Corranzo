import { describe, expect, it } from 'vitest'
import {
  buildOmrMeasurePlaybackReport,
  formatOmrMeasurePlaybackReport,
} from '../src/features/omr/omrMeasurePlaybackReport.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { buildVectorEvents } from '../src/features/omr/processVectorOmrPage.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { parseTempoFromTextItems } from '../src/features/omr/parseOmrTempoMarking.js'

const measureBox = { measureNumber: 12, page: 1 }

function onsets(positions) {
  return positions.map(({ x, positionInMeasure, clef = 'treble', midi = 60 + x }) => ({
    cx: x,
    midi,
    naturalMidi: midi,
    clef,
    positionInMeasure,
  }))
}

describe('omrMeasurePlaybackReport', () => {
  it('flags sequential same-x fragments and reports first bad measure', () => {
    const report = buildOmrMeasurePlaybackReport({
      measures: [
        {
          measureNumber: 1,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              notes: [{ cx: 40, midi: 60, clef: 'treble' }],
            },
            {
              type: 'note',
              startDivision: 4,
              durationDivisions: 4,
              notes: [{ cx: 41, midi: 64, clef: 'treble' }],
            },
          ],
        },
        {
          measureNumber: 2,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 20,
              notes: [{ cx: 40, midi: 60, clef: 'treble' }],
            },
          ],
        },
      ],
      musical: { tempo: { bpm: 120 }, timeSignature: { beats: 4, beatType: 4 } },
    })

    expect(report.firstBadMeasure).toBe(1)
    expect(report.flaggedMeasures).toContain(1)
    expect(report.flaggedMeasures).toContain(2)
    expect(formatOmrMeasurePlaybackReport(report)).toMatch(/First bad measure: 1/)
  })

  it('includes backup/forward counts from generated MusicXML', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 4, positionInMeasure: 0.1, clef: 'bass', midi: 43 },
        { x: 120, positionInMeasure: 0.45, clef: 'treble', midi: 66 },
      ]),
      measureBox,
      { beats: 3, beatType: 4 },
    )
    const musicXml = buildOmrMusicXml({
      measures: [{ measureNumber: 12, uncertain: false, events }],
      musical: { tempo: { bpm: 120 }, timeSignature: { beats: 3, beatType: 4 } },
    })
    const report = buildOmrMeasurePlaybackReport({
      measures: [{ measureNumber: 12, uncertain: false, events }],
      musical: { tempo: { bpm: 120 }, timeSignature: { beats: 3, beatType: 4 } },
      musicXml,
    })
    const measure = report.measures[0]
    expect(measure.backupCount).toBeGreaterThan(0)
    expect(parseMusicXml(musicXml, 'report.omr.musicxml').notes.length).toBeGreaterThan(0)
  })
})

describe('vector chord + tempo hardening regressions', () => {
  it('merges stacked chord tones at the same beat instead of sequencing them', () => {
    const events = buildVectorEvents(
      onsets([
        { x: 70, positionInMeasure: 0.35, clef: 'treble', midi: 59 },
        { x: 82, positionInMeasure: 0.36, clef: 'treble', midi: 62 },
        { x: 94, positionInMeasure: 0.37, clef: 'treble', midi: 66 },
        { x: 106, positionInMeasure: 0.38, clef: 'treble', midi: 71 },
      ]),
      measureBox,
      { beats: 4, beatType: 4 },
    )

    const onset = events.find((event) => event.type === 'note' && (event.notes?.length ?? 0) > 1)
    expect(onset?.notes?.length).toBe(4)

    const musicXml = buildOmrMusicXml({
      measures: [{ measureNumber: 12, uncertain: false, events }],
    })
    const timing = parseMusicXml(musicXml, 'chord.omr.musicxml')
    const stacked = timing.notes.filter(
      (note) => Math.abs(note.quarterTime - (onset.startDivision ?? 0) / 4) < 0.01,
    )
    expect(stacked.length).toBe(4)
    expect(new Set(stacked.map((note) => note.quarterTime)).size).toBe(1)
  })

  it('ignores tempo words on later PDF pages', () => {
    expect(parseTempoFromTextItems([{ text: 'Allegro' }], { pageNumber: 2 }).fromDefault).toBe(true)
    expect(parseTempoFromTextItems([{ text: 'Allegro' }], { pageNumber: 1 }).bpm).toBe(120)
    expect(parseTempoFromTextItems([{ text: '♩ = 96' }], { pageNumber: 3 }).bpm).toBe(96)
  })
})
