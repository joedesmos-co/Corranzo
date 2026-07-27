import { describe, expect, it } from 'vitest'
import * as F from './helpers/buildXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'
import {
  capturePlaybackSemantics,
  countAttacksForMidiAtOnset,
} from '../src/features/playback/playbackSemanticsBenchmark.js'
import {
  playbackDurationSecondsForNote,
  playbackVelocityForNote,
  FERMATA_DURATION_RATIO,
  TENUTO_PLAYBACK_RATIO,
  MARCATO_DURATION_RATIO,
  MARCATO_VELOCITY_BOOST,
} from '../src/features/playback/staccatoPlayback.js'
import { DYNAMICS_TO_VELOCITY } from '../src/features/musicxml/dynamicsMap.js'
import { WEDGE_ENDPOINT_FALLBACK_DELTA } from '../src/features/playback/playbackExpressionPolicy.js'

function schedule(xml) {
  return buildScoreNoteSchedule(parseMusicXml(xml))
}

describe('Playback Semantics Sprint 1', () => {
  it('tied note across a barline attacks once and extends duration', () => {
    const xml = F.scoreWrap(
      `<part id="P1">` +
        `<measure number="1">${F.attributes()}${F.soundTempo(120)}${F.tiedNote('C', 4, 1, { start: true })}${F.note('D')}${F.note('E')}${F.note('F')}</measure>` +
        `<measure number="2">${F.tiedNote('C', 4, 1, { stop: true })}${F.note('D')}${F.note('E')}${F.note('F')}</measure>` +
        `</part>`,
    )
    const report = capturePlaybackSemantics(xml)
    expect(report.metrics.suppressedTieContinuations).toBe(1)
    expect(report.metrics.tieContinuationReattacks).toBe(0)
    const head = report.events.find((event) => event.midiPitch === 60)
    expect(head.performedDurationSeconds).toBeCloseTo(1, 5) // two quarters @120
    expect(countAttacksForMidiAtOnset(report.events, 60, 0)).toBe(1)
  })

  it('three-note tie chain suppresses both continuations', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}` +
        `${F.tiedNote('C', 4, 1, { start: true })}` +
        `${F.tiedNote('C', 4, 1, { start: true, stop: true })}` +
        `${F.tiedNote('C', 4, 1, { stop: true })}` +
        `${F.note('G')}</measure></part>`,
    )
    const report = capturePlaybackSemantics(xml)
    expect(report.metrics.suppressedTieContinuations).toBe(2)
    expect(report.events.filter((event) => event.midiPitch === 60)).toHaveLength(1)
    expect(report.events.find((event) => event.midiPitch === 60).tieChainId).toBeTruthy()
  })

  it('partially tied chord only suppresses the tied pitch', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}` +
        `${F.tiedNote('C', 4, 1, { start: true })}` +
        `${F.note('E', 4, 1, '<chord/>')}` +
        `${F.tiedNote('C', 4, 1, { stop: true })}` +
        `${F.note('E', 4, 1, '<chord/>')}` +
        `</measure></part>`,
    )
    const report = capturePlaybackSemantics(xml)
    expect(report.metrics.suppressedTieContinuations).toBe(1)
    // E attacks twice; C once
    expect(report.events.filter((event) => event.midiPitch === 64)).toHaveLength(2)
    expect(report.events.filter((event) => event.midiPitch === 60)).toHaveLength(1)
  })

  it('slurred notes still attack independently', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}` +
        `${F.note('C', 4, 1, '<notations><slur type="start"/></notations>')}` +
        `${F.note('D', 4, 1, '<notations><slur type="stop"/></notations>')}` +
        `</measure></part>`,
    )
    const report = capturePlaybackSemantics(xml)
    expect(report.events).toHaveLength(2)
    expect(report.metrics.suppressedTieContinuations).toBe(0)
  })

  it('staccato shortens sounding duration without changing written duration', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${F.staccatoNote()}${F.note('D')}</measure></part>`,
    )
    const events = schedule(xml)
    expect(events[0].writtenDurationSeconds).toBeCloseTo(0.5, 6)
    expect(events[0].baseDurationSeconds).toBeCloseTo(0.25, 6)
  })

  it('accent and marcato boost attack velocity; marcato shortens sounding', () => {
    expect(playbackVelocityForNote({ velocity: 0.7, accent: true })).toBeCloseTo(0.82, 5)
    expect(playbackVelocityForNote({ velocity: 0.7, marcato: true })).toBeCloseTo(
      0.7 + MARCATO_VELOCITY_BOOST,
      5,
    )
    expect(playbackDurationSecondsForNote({ durationSeconds: 1, marcato: true })).toBeCloseTo(
      MARCATO_DURATION_RATIO,
      5,
    )
    expect(playbackDurationSecondsForNote({ durationSeconds: 1, tenuto: true })).toBeCloseTo(
      TENUTO_PLAYBACK_RATIO,
      5,
    )
  })

  it('fermata extends performed duration by documented policy', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${F.fermataNote()}</measure></part>`,
    )
    const events = schedule(xml)
    expect(events[0].writtenDurationSeconds).toBeCloseTo(0.5, 6)
    expect(events[0].baseDurationSeconds).toBeCloseTo(0.5 * FERMATA_DURATION_RATIO, 5)
    expect(events[0].articulationSource).toContain('fermata')
  })

  it('pp → mf → ff produces ordered velocity levels', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}` +
        `${F.dynamicsDirection('pp')}${F.note('C')}` +
        `${F.dynamicsDirection('mf')}${F.note('D')}` +
        `${F.dynamicsDirection('ff')}${F.note('E')}` +
        `</measure></part>`,
    )
    const events = schedule(xml)
    expect(events.map((event) => event.velocity)).toEqual([
      DYNAMICS_TO_VELOCITY.pp,
      DYNAMICS_TO_VELOCITY.mf,
      DYNAMICS_TO_VELOCITY.ff,
    ])
    expect(events[0].velocity).toBeLessThan(events[1].velocity)
    expect(events[1].velocity).toBeLessThan(events[2].velocity)
  })

  it('crescendo and diminuendo interpolate between endpoints', () => {
    const cresc = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes({ divisions: 4 })}${F.soundTempo(120)}` +
        `${F.dynamicsDirection('p')}${F.wedgeDirection('crescendo')}` +
        `${F.note('C', 4, 4)}${F.note('D', 4, 4)}${F.note('E', 4, 4)}${F.note('F', 4, 4)}` +
        `${F.dynamicsDirection('f')}${F.wedgeDirection('stop')}` +
        `</measure></part>`,
    )
    const crescEvents = schedule(cresc)
    expect(crescEvents[0].velocity).toBeCloseTo(DYNAMICS_TO_VELOCITY.p, 5)
    expect(crescEvents[crescEvents.length - 1].velocity).toBeGreaterThan(crescEvents[0].velocity)
    expect(crescEvents[1].velocity).toBeGreaterThan(crescEvents[0].velocity)

    const dim = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes({ divisions: 4 })}${F.soundTempo(120)}` +
        `${F.dynamicsDirection('f')}${F.wedgeDirection('diminuendo')}` +
        `${F.note('C', 4, 4)}${F.note('D', 4, 4)}` +
        `${F.wedgeDirection('stop')}` +
        `</measure></part>`,
    )
    const dimEvents = schedule(dim)
    // Fallback endpoint when no discrete dynamic at stop.
    expect(dimEvents[0].velocity).toBeCloseTo(DYNAMICS_TO_VELOCITY.f, 5)
    expect(dimEvents[1].velocity).toBeLessThan(dimEvents[0].velocity)
    expect(dimEvents[1].velocity).toBeCloseTo(
      DYNAMICS_TO_VELOCITY.f - WEDGE_ENDPOINT_FALLBACK_DELTA * 0.5,
      2,
    )
  })

  it('initial dotted-quarter tempo converts to quarter BPM', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.metronomeDirection('quarter', 72, { dot: true })}${F.note('C')}</measure></part>`,
    )
    const timing = parseMusicXml(xml)
    expect(timing.tempoChanges[0].bpm).toBe(108)
  })

  it('mid-score tempo change alters subsequent event timing', () => {
    const xml = F.measureStartTempoChange()
    const timing = parseMusicXml(xml)
    expect(timing.tempoChanges.some((change) => change.bpm === 60)).toBe(true)
    const events = schedule(xml)
    expect(events[0].activeTempoBpm).toBe(120)
    const after = events.find((event) => event.measureNumber === 2)
    expect(after.activeTempoBpm).toBe(60)
  })

  it('a tempo restores prior BPM when emitted as sound tempo', () => {
    const xml = F.scoreWrap(
      `<part id="P1">` +
        `<measure number="1">${F.attributes()}${F.soundTempo(110)}${F.note('C')}${F.note('D')}${F.note('E')}${F.note('F')}</measure>` +
        `<measure number="2">${F.soundTempo(70)}${F.note('C')}${F.note('D')}${F.note('E')}${F.note('F')}</measure>` +
        `<measure number="3">${F.soundTempo(110)}${F.note('C')}${F.note('D')}${F.note('E')}${F.note('F')}</measure>` +
        `</part>`,
    )
    const events = schedule(xml)
    expect(events.find((event) => event.measureNumber === 3).activeTempoBpm).toBe(110)
  })

  it('tempo change inside a repeat applies on each performed pass', () => {
    const xml = F.scoreWrap(
      `<part id="P1">` +
        `<measure number="1">${F.attributes()}${F.soundTempo(120)}` +
        `<barline location="left"><repeat direction="forward"/></barline>` +
        `${F.note('C')}${F.note('D')}${F.note('E')}${F.note('F')}</measure>` +
        `<measure number="2">${F.soundTempo(60)}${F.note('C')}${F.note('D')}${F.note('E')}${F.note('F')}` +
        `<barline location="right"><repeat direction="backward"/></barline></measure>` +
        `<measure number="3">${F.note('G')}${F.note('A')}${F.note('B')}${F.note('C', 5)}</measure>` +
        `</part>`,
    )
    const report = capturePlaybackSemantics(xml)
    const m2Passes = report.events.filter((event) => event.performedMeasure === 2)
    expect(m2Passes.some((event) => event.performedPass === 1)).toBe(true)
    expect(m2Passes.some((event) => event.performedPass === 2)).toBe(true)
    expect(m2Passes.every((event) => event.activeTempo === 60)).toBe(true)
  })

  it('first/second endings keep expression on written measures', () => {
    const xml = F.voltaBackwardOnSecondEnding()
    const timing = parseMusicXml(xml)
    expect(timing.performedMeasureTimeline.entries.length).toBeGreaterThan(4)
    const events = schedule(xml)
    expect(events.every((event) => Number.isFinite(event.scoreTimeSeconds))).toBe(true)
  })

  it('Piano and Guitar schedules preserve midi pitch (non-regression)', () => {
    const piano = schedule(
      F.scoreWrap(
        `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${F.note('C')}${F.note('E')}</measure></part>`,
      ),
    )
    expect(piano.map((event) => event.midi)).toEqual([60, 64])

    const guitar = F.scoreWrap(
      `<part id="P1"><measure number="1">` +
        `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>` +
        `<staves>2</staves>` +
        `<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>` +
        `<clef number="2"><sign>TAB</sign><line>5</line></clef></attributes>` +
        `${F.soundTempo(120)}` +
        `${F.note('E', 3, 1, '<staff>1</staff>')}` +
        `${F.note('E', 3, 1, '<chord/><staff>2</staff><notations><technical><string>6</string><fret>0</fret></technical></notations>')}` +
        `</measure></part>`,
    )
    const gEvents = schedule(guitar)
    // TAB mirror suppressed; notation pitch preserved.
    expect(gEvents.every((event) => event.midi === 52)).toBe(true)
    expect(gEvents).toHaveLength(1)
  })
})
