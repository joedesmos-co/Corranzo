import { describe, expect, it } from 'vitest'
import {
  OMR_GENERATED_PLAYBACK_LIMITS,
  validateOmrGeneratedPlayback,
} from '../src/features/omr/validateOmrGeneratedPlayback.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'

describe('validateOmrGeneratedPlayback', () => {
  it('accepts generated OMR MusicXML with notes and duration', () => {
    const musicXml = buildOmrMusicXml({
      title: 'Test',
      measures: [
        {
          measureNumber: 1,
          uncertain: false,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: [{ midi: 60 }],
            },
          ],
        },
      ],
    })

    const result = validateOmrGeneratedPlayback(musicXml, 'test.omr.musicxml')
    expect(result.ok).toBe(true)
    expect(result.noteCount).toBeGreaterThan(0)
    expect(result.durationSeconds).toBeGreaterThan(0)
  })

  it('rejects empty MusicXML', () => {
    const result = validateOmrGeneratedPlayback('', 'test.omr.musicxml')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/empty/i)
  })

  it('rejects generated MusicXML that is too large before parsing', () => {
    const result = validateOmrGeneratedPlayback(
      'x'.repeat(OMR_GENERATED_PLAYBACK_LIMITS.maxMusicXmlBytes + 1),
      'huge.omr.musicxml',
    )
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/too large/i)
  })

  it('rejects implausibly long generated duration', () => {
    const measures = Array.from({ length: 301 }, (_, index) => ({
      measureNumber: index + 1,
      uncertain: false,
      events: [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ midi: 60 }],
        },
      ],
    }))
    const musicXml = buildOmrMusicXml({
      title: 'Slow',
      musical: { tempo: { bpm: 40, confidence: 1, fromDefault: false } },
      measures,
    })

    const result = validateOmrGeneratedPlayback(musicXml, 'slow.omr.musicxml')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/duration|too long/i)
  })

  it('rejects implausibly high generated measure count', () => {
    const measures = Array.from(
      { length: OMR_GENERATED_PLAYBACK_LIMITS.maxMeasureCount + 1 },
      (_, index) => ({
        measureNumber: index + 1,
        uncertain: false,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            durationType: 'quarter',
            notes: [{ midi: 60 }],
          },
        ],
      }),
    )
    const musicXml = buildOmrMusicXml({ title: 'Too many measures', measures })

    const result = validateOmrGeneratedPlayback(musicXml, 'many.omr.musicxml')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/too many measures/i)
  })

  it('rejects implausibly high generated note count', () => {
    const musicXml = buildOmrMusicXml({
      title: 'Too many notes',
      measures: [
        {
          measureNumber: 1,
          uncertain: false,
          events: [
            {
              type: 'note',
              startDivision: 0,
              durationDivisions: 4,
              durationType: 'quarter',
              notes: Array.from(
                { length: OMR_GENERATED_PLAYBACK_LIMITS.maxNoteCount + 1 },
                () => ({ midi: 60 }),
              ),
            },
          ],
        },
      ],
    })

    const result = validateOmrGeneratedPlayback(musicXml, 'many-notes.omr.musicxml')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/too many notes/i)
  })
})
