import { describe, it, expect } from 'vitest'
import { detectKeySignature, buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'

const scale = (midis, durBeats = 1) => midis.map((midi, i) => ({ midi, startBeat: i, durBeats, hand: 'RH' }))

describe('Audio Vision key signature', () => {
  it('detects C major', () => {
    const k = detectKeySignature(scale([60, 62, 64, 65, 67, 69, 71, 72]))
    expect(k.mode).toBe('major')
    expect(k.fifths).toBe(0)
  })
  it('detects G major (one sharp)', () => {
    const k = detectKeySignature(scale([67, 69, 71, 72, 74, 76, 78, 79]))
    expect(k.mode).toBe('major')
    expect(k.fifths).toBe(1)
  })
  it('detects F major (one flat)', () => {
    const k = detectKeySignature(scale([65, 67, 69, 70, 72, 74, 76, 77]))
    expect(k.mode).toBe('major')
    expect(k.fifths).toBe(-1)
  })
  it('detects A minor (no accidentals)', () => {
    const k = detectKeySignature(scale([57, 59, 60, 62, 64, 65, 67, 69]))
    expect(k.mode).toBe('minor')
    expect(k.fifths).toBe(0)
  })
  it('detects D minor (one flat)', () => {
    const k = detectKeySignature(scale([62, 64, 65, 67, 69, 70, 72, 74]))
    expect(k.mode).toBe('minor')
    expect(k.fifths).toBe(-1)
  })
  it('writes the detected key into MusicXML without changing pitch spelling', () => {
    const events = scale([67, 69, 71, 72, 74, 76, 78, 79])
    const xml = buildArrangementMusicXml({ events, targetPart: 'solo-piano', bpm: 100 })
    expect(xml).toContain('<fifths>1</fifths>')
    expect(xml).toContain('<mode>major</mode>')
  })
})
