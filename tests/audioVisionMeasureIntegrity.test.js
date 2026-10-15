import { describe, it, expect } from 'vitest'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

/**
 * PRIORITY 1 regression: MusicXML measure integrity.
 *
 * A <chord/> note must reuse its parent onset's duration — emitting its own
 * duration is invalid MusicXML, and it is exactly what made Audio Vision
 * measures read as overfull (parent dur 4 + chord dur 1 ⇒ the parser's running
 * total for the voice ran past the barline). Score Following reported these.
 */
describe('arrangement MusicXML measure integrity', () => {
  it('a chord note reuses its parent onset duration (no overfull measures)', () => {
    const events = [
      { midi: 60, startBeat: 0, durBeats: 0.5, hand: 'RH', role: 'harmony' },
      { midi: 64, startBeat: 0, durBeats: 0.25, hand: 'RH', role: 'harmony' }, // same onset
      { midi: 67, startBeat: 0, durBeats: 1.0, hand: 'RH', role: 'harmony' },
      { midi: 72, startBeat: 2, durBeats: 1, hand: 'RH', role: 'melody' },
    ]
    for (const targetPart of ['solo-piano', 'solo-guitar']) {
      const xml = buildArrangementMusicXml({ events, targetPart, bpm: 120, title: 'chord' })
      const notes = [...xml.matchAll(/<note>([\s\S]*?)<\/note>/g)]
      let parentDur = null
      for (const [, body] of notes) {
        const dur = Number(body.match(/<duration>(\d+)</)[1])
        if (/<chord\/>/.test(body)) {
          expect(dur).toBe(parentDur) // invalid MusicXML if it differs
        } else {
          parentDur = dur
        }
      }
    }
  })

  it('no note extends past its barline (parser-level check)', () => {
    const events = [
      { midi: 71, startBeat: 1.75, durBeats: 0.5, hand: 'RH', role: 'melody' },
      { midi: 77, startBeat: 2.5, durBeats: 1.0, hand: 'RH', role: 'melody' },
      { midi: 69, startBeat: 2.75, durBeats: 1.25, hand: 'RH', role: 'melody' },
      { midi: 57, startBeat: 2.5, durBeats: 1.5, hand: 'LH', role: 'bass' },
    ]
    for (const targetPart of ['solo-piano', 'solo-guitar']) {
      const xml = buildArrangementMusicXml({ events, targetPart, bpm: 108, title: 'barline' })
      const parsed = parseMusicXml(xml, 'barline.musicxml')
      const beatPeriod = 60 / 108
      const barline = 4 * beatPeriod
      for (const n of parsed.notes) {
        if (n.isRest) continue
        const next = Math.ceil(n.timeSeconds / barline - 1e-9) * barline
        expect(n.timeSeconds + n.durationSeconds).toBeLessThanOrEqual(next + 1e-6)
      }
    }
  })

  it('every measure writes exactly one bar of duration for each voice', () => {
    // 8 beats at 4/4 = two measures; each voice must total 64 divisions.
    const events = [
      { midi: 60, startBeat: 0, durBeats: 1, hand: 'RH' },
      { midi: 72, startBeat: 4, durBeats: 2, hand: 'RH' },
      { midi: 48, startBeat: 0, durBeats: 1, hand: 'LH' },
      { midi: 45, startBeat: 4, durBeats: 3, hand: 'LH' },
    ]
    const xml = buildArrangementMusicXml({ events, targetPart: 'solo-piano', bpm: 120, title: 'bars' })
    for (const [, body] of xml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)) {
      // Walk top-level children in order: <note>, <backup>, <attributes>, …
      // A <backup> starts the next voice at the barline again.
      let voice = 1
      const totals = new Map()
      const childRe = /<note>([\s\S]*?)<\/note>|<backup>/g
      let child
      while ((child = childRe.exec(body)) !== null) {
        if (child[1] == null) {
          voice += 1
          continue
        }
        if (/<chord\/>/.test(child[1])) continue // chords do not advance time
        totals.set(voice, (totals.get(voice) ?? 0) + Number(child[1].match(/<duration>(\d+)</)[1]))
      }
      for (const [, total] of totals) expect(total).toBe(64)
    }
  })
})
