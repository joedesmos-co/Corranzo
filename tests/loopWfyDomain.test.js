import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildBeatLoopRegion,
  buildMeasureLoopRegion,
  shouldRestartLoop,
} from '../src/features/practice/practiceLoopRegion.js'
import { buildBeatCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import * as F from './helpers/buildXml.js'

/** m1 |: m2 m3 :| m4 — m3 appears twice in performed order. */
function oneRepeatWithM3Inside() {
  const forwardRepeat = `<barline location="left"><repeat direction="forward"/></barline>`
  const backwardRepeat = `<barline location="right"><repeat direction="backward"/></barline>`
  const xml =
    `<measure number="1">${F.attributes()}${F.soundTempo(120)}${forwardRepeat}${F.fourQuarters()}</measure>` +
    `<measure number="2">${F.fourQuarters()}</measure>` +
    `<measure number="3">${F.fourQuarters()}${backwardRepeat}</measure>` +
    `<measure number="4">${F.fourQuarters()}</measure>`
  return F.scoreWrap(`<part id="P1">${xml}</part>`)
}

describe('loop and WFY use performed time domain', () => {
  it('loop region for repeated measures uses performed start/end', () => {
    const t = parseMusicXml(oneRepeatWithM3Inside())
    const region = buildMeasureLoopRegion(t, 3, 4)
    expect(region.isValid).toBe(true)
    // Written m3 starts at 4s; performed spans both passes through m4 at 14s.
    expect(region.startTimeSeconds).toBeCloseTo(4, 6)
    expect(region.endTimeSeconds).toBeCloseTo(14, 6)
  })

  it('shouldRestartLoop wraps at performed loop end', () => {
    const t = parseMusicXml(oneRepeatWithM3Inside())
    const region = buildMeasureLoopRegion(t, 2, 3)
    expect(shouldRestartLoop(region.endTimeSeconds - 0.01, region)).toBe(true)
    expect(shouldRestartLoop(region.startTimeSeconds, region)).toBe(false)
  })

  it('WFY beat checkpoints cover performed passes', () => {
    const t = parseMusicXml(F.oneRepeat())
    const checkpoints = buildBeatCheckpoints(t)
    // 4 measures × 4 beats × 2 passes for m1–2 + 4 for m3–4 = 24
    expect(checkpoints).toHaveLength(24)
    const m2pass2 = checkpoints.filter(
      (cp) => cp.measureNumber === 2 && cp.repeatPass === 2,
    )
    expect(m2pass2).toHaveLength(4)
    expect(m2pass2[0].timeSeconds).toBeCloseTo(6, 6)
  })

  it('beat loop ending on the last performed beat uses performed end time', () => {
    const t = parseMusicXml(F.oneRepeat())
    const lastBeat = t.performedMeasureTimeline.performedBeats.at(-1)
    const region = buildBeatLoopRegion(t, lastBeat, lastBeat)

    expect(lastBeat.measureNumber).toBe(4)
    expect(region.isValid).toBe(true)
    expect(region.startTimeSeconds).toBeCloseTo(11.5, 6)
    expect(region.endTimeSeconds).toBeCloseTo(12, 6)
  })
})
