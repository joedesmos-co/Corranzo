#!/usr/bin/env node
/**
 * Deterministic regression for 10 ms pickups at the start of a phrase and at
 * a later system start. The old measure-start rule (>20 ms) skipped the
 * measure-start knot, so:
 *   - the first phrase had no knot at t=0 and the cursor was invisible for the
 *     first 10 ms of the piece; and
 *   - a later system switched to its first notehead 10 ms early (epsilon).
 * The fixed rule emits the measure-start knot, so the cursor starts at the
 * system's left edge and glides to the note exactly at its onset.
 */
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildCursorMotionTimeline, resolveCursorMotion } from '../src/features/score-follow/cursorMotionTimeline.js'
import { scoreWrap, attributes, soundTempo } from '../tests/helpers/buildXml.js'

const xml = scoreWrap(
  `<part id="P1">` +
    `<measure number="1">${attributes({ divisions: 100, beats: 4, beatType: 4 })}${soundTempo(120)}` +
    `<forward><duration>2</duration></forward>` +
    `<note default-x="60"><pitch><step>C</step><octave>5</octave></pitch><duration>398</duration><voice>1</voice><type>whole</type></note>` +
    `</measure>` +
    `<measure number="2">` +
    `<forward><duration>2</duration></forward>` +
    `<note default-x="60"><pitch><step>D</step><octave>5</octave></pitch><duration>398</duration><voice>1</voice><type>whole</type></note>` +
    `</measure>` +
    `</part>`,
)
const timingMap = parseMusicXml(xml)
const anchors = [
  { id: 'm1', page: 1, x: 0.2, y: 0.3, measureNumber: 1, source: 'manual', meta: { playableStartX: 0.2, playableEndX: 0.45, systemEndX: 0.95 } },
  { id: 'm2', page: 1, x: 0.2, y: 0.55, measureNumber: 2, source: 'manual', meta: { playableStartX: 0.2, playableEndX: 0.45, systemEndX: 0.95 } },
]
const timeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: anchors })
const at = (t) => {
  const c = resolveCursorMotion(timeline, t)
  return c ? { visible: true, x: c.x, measure: c.measureNumber, phrase: c.phraseIndex } : { visible: false }
}
const firstSamples = [0, 0.002, 0.005, 0.008, 0.01].map((t) => ({ t, ...at(t) }))
const secondSamples = [1.998, 2, 2.002, 2.005, 2.008, 2.01].map((t) => ({ t, ...at(t) }))
const firstPhrase = timeline.phrases[0]
const secondPhrase = timeline.phrases[1]
const firstStartError = firstSamples[0].visible ? Math.abs(firstSamples[0].x - firstPhrase.startX) : Infinity
const secondStart = secondPhrase.startTime
const secondStartSample = secondSamples.find((s) => Math.abs(s.t - secondStart) < 1e-9)
const secondStartError = secondStartSample?.visible ? Math.abs(secondStartSample.x - secondPhrase.startX) : Infinity
const secondOnset = secondSamples.at(-1)
const secondOnsetError = secondOnset?.visible ? Math.abs(secondOnset.x - 0.35) : Infinity
console.log(JSON.stringify({
  firstPhrase: { startTime: firstPhrase.startTime, startX: firstPhrase.startX, firstKnot: firstPhrase.knots[0], samples: firstSamples, startError: firstStartError },
  secondPhrase: { startTime: secondStart, startX: secondPhrase.startX, firstKnot: secondPhrase.knots[0], samples: secondSamples, startError: secondStartError, onsetError: secondOnsetError },
  pass: firstSamples.every((s) => s.visible) && firstStartError < 1e-6 && secondStartError < 1e-6 && secondOnsetError < 1e-6,
}, null, 2))
