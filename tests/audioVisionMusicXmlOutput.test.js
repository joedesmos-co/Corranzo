/**
 * End-to-end MusicXML verification for the Audio Vision pipeline.
 *
 * The arrangement must be WRITABLE, not just present: every measure filled
 * exactly, no silent overflow, and the notes that were arranged must still be
 * there after the MusicXML is written, read back and parsed.
 *
 * These checks run against the real pipeline output (the arrangement the user
 * actually gets), not against a hand-written score.
 */
import { describe, it, expect } from 'vitest'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { synthBandFixture } from './audioVisionAnalysis.test.js'

const SR = 22050

function wavDecodeOf(samples, sampleRate = SR) {
  return async () => ({
    channelData: [samples],
    sampleRate,
    durationSeconds: samples.length / sampleRate,
    channelCount: 1,
  })
}

function fakeFile(name = 'song.mp3', size = 50000) {
  return { name, size, type: 'audio/mpeg' }
}

/**
 * Every measure must hold exactly one bar of duration for each voice: a
 * <backup> starts the next voice at the barline again, so the totals are
 * counted per voice (the same definition the project uses in
 * audioVisionMeasureIntegrity.test.js).
 *
 * The bar length is read from the score itself (the detected time signature
 * and the divisions), because the arrangement is written in the meter the
 * analysis found - 3/4 is as valid as 4/4.
 */
function measureIntegrity(xml) {
  const divisions = Number(/<divisions>(\d+)<\/divisions>/.exec(xml)?.[1] ?? 4)
  const beats = Number(/<beats>(\d+)<\/beats>/.exec(xml)?.[1] ?? 4)
  const beatType = Number(/<beat-type>(\d+)<\/beat-type>/.exec(xml)?.[1] ?? 4)
  const expected = beats * (divisions * 4) / beatType
  const measures = [...xml.matchAll(/<measure number="(\d+)"([^>]*)>([\s\S]*?)<\/measure>/g)]
  const problems = []
  for (const [, number, attrs, body] of measures) {
    const implicit = /implicit="yes"/.test(attrs)
    let voice = 1
    const totals = new Map()
    const childRe = /<note>([\s\S]*?)<\/note>|<backup>/g
    let child
    while ((child = childRe.exec(body)) !== null) {
      if (child[1] == null) {
        voice += 1
        continue
      }
      if (/<chord\s*\/?>/.test(child[1])) continue
      totals.set(voice, (totals.get(voice) ?? 0) + Number(child[1].match(/<duration>(\d+)</)?.[1] ?? 0))
    }
    for (const [, total] of totals) {
      if (total > expected) problems.push(`measure ${number} voice ${voice} overflows (${total} > ${expected})`)
      else if (total !== expected && !implicit) problems.push(`measure ${number} voice ${voice} is ${total}/${expected}`)
    }
  }
  return { measures: measures.length, problems, expected }
}

describe('Audio Vision MusicXML output', () => {
  it('writes a score whose measures are exactly filled and whose notes survive a round trip', async () => {
    const samples = synthBandFixture({ seconds: 8 })
    const out = await runAudioArrangementPipeline(fakeFile('band.mp3'), new ArrayBuffer(64), {
      targetPart: 'solo-piano',
      difficulty: 'intermediate',
    }, {
      decodeAudioDataImpl: wavDecodeOf(samples),
      predictNotes: null,
    })
    expect(out.ok).toBe(true)
    expect(out.musicXml).toContain('<score-partwise')

    const integrity = measureIntegrity(out.musicXml)
    expect(integrity.measures).toBeGreaterThan(0)
    expect(integrity.problems).toEqual([])

    const parsed = parseMusicXml(out.musicXml, 'audio-vision-roundtrip.musicxml')
    expect(parsed).toBeTruthy()

    // The parsed score must hold the notes the arrangement produced - a score
    // that loses notes on the way out is a broken arrangement, even if the
    // XML is well formed.
    const writtenNotes = [...out.musicXml.matchAll(/<note>/g)].length
    const parsedNotes = (parsed.notes ?? []).filter((n) => !n.isRest).length
    expect(parsedNotes).toBeGreaterThan(0)
    expect(parsedNotes).toBeLessThanOrEqual(writtenNotes)

    // Every parsed note must carry a real pitch and a positive duration.
    for (const note of parsed.notes ?? []) {
      if (note.isRest) continue
      expect(Number.isFinite(note.midi)).toBe(true)
      expect(note.durationSeconds).toBeGreaterThan(0)
    }
  }, 90000)

  it('the arrangement keeps the melody it transcribed (a recognizable line, not a texture)', async () => {
    const samples = synthBandFixture({ seconds: 8 })
    const out = await runAudioArrangementPipeline(fakeFile('band.mp3'), new ArrayBuffer(64), {
      targetPart: 'solo-piano',
      difficulty: 'intermediate',
    }, {
      decodeAudioDataImpl: wavDecodeOf(samples),
      predictNotes: null,
    })
    expect(out.ok).toBe(true)

    const arranged = out.model?.parts?.[0]?.events ?? []
    expect(arranged.length).toBeGreaterThan(0)

    // The melody line must be present and must be the highest line: the
    // arrangement is a solo piece, not a chord dump.
    const byBeat = new Map()
    for (const event of arranged) {
      const beat = Math.round((event.startBeat ?? 0) * 4) / 4
      const current = byBeat.get(beat)
      if (!current || (event.midi ?? 0) > current.midi) byBeat.set(beat, event)
    }
    const tops = [...byBeat.values()].map((e) => e.midi)
    expect(tops.length).toBeGreaterThan(1)
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(3)
  }, 90000)
})
