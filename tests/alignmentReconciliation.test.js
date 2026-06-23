/**
 * Phase 1 tests — layout reconciliation + per-system confidence + anchor-gen tie-in.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  reconcilePdfLayoutWithScore,
  systemConfidence,
  detectPickupMeasure,
  WEAK_SYSTEM_THRESHOLD,
} from '../src/features/score-follow/alignmentReconciliation.js'
import { buildAnchorsFromSystemStarts } from '../src/features/score-follow/buildAnchorsFromSystemStarts.js'
import {
  straight4,
  oneRepeat,
  singleMeasureVoltas,
  measureStartTempoChange,
  systemsAndPages,
  scoreWrap,
  attributes,
  note,
  fourQuarters,
  soundTempo,
} from './helpers/buildXml.js'

function pickupFixture() {
  // m1 holds a single quarter in 4/4 (lengthQuarters 1 < 4) → pickup.
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${note('G')}</measure>` +
    `<measure number="2">${fourQuarters()}</measure>` +
    `<measure number="3">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

function timeSignatureChangeFixture() {
  const xml =
    `<measure number="1">${attributes({ beats: 4, beatType: 4 })}${soundTempo(120)}${fourQuarters()}</measure>` +
    `<measure number="2">${attributes({ beats: 3, beatType: 4 })}${note('C')}${note('D')}${note('E')}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

describe('detectPickupMeasure', () => {
  it('flags a short first measure', () => {
    expect(detectPickupMeasure([{ beats: 4, beatType: 4, lengthQuarters: 1 }])).toBe(true)
  })
  it('does not flag a full first measure', () => {
    expect(detectPickupMeasure([{ beats: 4, beatType: 4, lengthQuarters: 4 }])).toBe(false)
  })
  it('is safe on empty/garbage input', () => {
    expect(detectPickupMeasure([])).toBe(false)
    expect(detectPickupMeasure([{ beats: 'x', beatType: 0, lengthQuarters: 2 }])).toBe(false)
  })
})

describe('systemConfidence', () => {
  it('is 1.0 when detected barlines equal expected measures', () => {
    expect(systemConfidence({ detectedBarlines: 5, expectedMeasures: 5 })).toBe(1)
  })
  it('decays as the mismatch grows', () => {
    const near = systemConfidence({ detectedBarlines: 6, expectedMeasures: 5 })
    const far = systemConfidence({ detectedBarlines: 9, expectedMeasures: 5 })
    expect(near).toBeGreaterThan(far)
    expect(far).toBeLessThan(0.5)
  })
  it('caps at medium when there is no barline evidence', () => {
    expect(systemConfidence({ detectedBarlines: 0, expectedMeasures: 5 })).toBeLessThan(0.5)
  })
  it('blends ink strength when provided', () => {
    const weakInk = systemConfidence({ detectedBarlines: 5, expectedMeasures: 5, inkStrength: 0 })
    const strongInk = systemConfidence({ detectedBarlines: 5, expectedMeasures: 5, inkStrength: 1 })
    expect(strongInk).toBeGreaterThan(weakInk)
    expect(strongInk).toBe(1)
  })
})

describe('reconcilePdfLayoutWithScore — clean detection', () => {
  const timingMap = parseMusicXml(straight4(), 'straight4')

  it('maps a perfectly detected layout with full confidence and no warnings', () => {
    const result = reconcilePdfLayoutWithScore({
      timingMap,
      perSystemBarlineCounts: [2, 2],
    })
    expect(result.totals.expectedMeasureCount).toBe(4)
    expect(result.totals.systemCount).toBe(2)
    expect(result.totals.detectedBarlineTotal).toBe(4)
    expect(result.totals.minConfidence).toBe(1)
    expect(result.perSystem.every((s) => s.delta === 0)).toBe(true)
    expect(result.flags.barlineTotalMismatch).toBe(false)
    expect(result.flags.hasRepeats).toBe(false)
    expect(result.flags.weakSystems).toEqual([])
  })
})

describe('reconcilePdfLayoutWithScore — mis-detection', () => {
  const timingMap = parseMusicXml(straight4(), 'straight4')

  it('flags a barline total that does not match the measure count', () => {
    const result = reconcilePdfLayoutWithScore({
      timingMap,
      perSystemBarlineCounts: [3, 3], // sums to 6, score has 4
    })
    expect(result.totals.detectedBarlineTotal).toBe(6)
    expect(result.flags.barlineTotalMismatch).toBe(true)
    // Expected measures reconcile back to 4 total even though detection summed to 6.
    expect(result.perSystem.reduce((a, s) => a + s.expectedMeasures, 0)).toBe(4)
    expect(result.perSystem.every((s) => s.barlineMismatch)).toBe(true)
  })

  it('marks systems weak when detection is far off', () => {
    const result = reconcilePdfLayoutWithScore({
      timingMap,
      perSystemBarlineCounts: [8, 0],
    })
    expect(result.flags.weakSystems.length).toBeGreaterThan(0)
    expect(result.totals.minConfidence).toBeLessThan(WEAK_SYSTEM_THRESHOLD)
  })
})

describe('reconcilePdfLayoutWithScore — structural flags', () => {
  it('detects repeats from performed vs written duration', () => {
    const result = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(oneRepeat(), 'oneRepeat'),
      perSystemBarlineCounts: [4],
    })
    expect(result.flags.hasRepeats).toBe(true)
    expect(result.flags.repeatExpansionRatio).toBeGreaterThan(1)
  })

  it('detects voltas (also a repeat expansion)', () => {
    const result = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(singleMeasureVoltas(), 'voltas'),
      perSystemBarlineCounts: [4],
    })
    expect(result.flags.hasRepeats).toBe(true)
  })

  it('detects pickup measures from explicit or structural signals', () => {
    // The current parser pads measure 1 and drops `implicit`, so it carries no
    // pickup signal (asserted here) — surfacing `implicit` is a Phase 2 parser
    // task. The reconciler already fires on a measure model that does carry it.
    const parsed = parseMusicXml(pickupFixture(), 'pickup')
    expect(reconcilePdfLayoutWithScore({ timingMap: parsed, perSystemBarlineCounts: [3] }).flags.hasPickup).toBe(
      false,
    )

    const implicitMap = {
      measures: [{ number: 1, beats: 4, beatType: 4, lengthQuarters: 4, implicit: 'yes' }],
      durationSeconds: 8,
      writtenDurationSeconds: 8,
      tempoChanges: [],
      timeSignatures: [],
    }
    expect(reconcilePdfLayoutWithScore({ timingMap: implicitMap, perSystemBarlineCounts: [1] }).flags.hasPickup).toBe(
      true,
    )

    const shortBarMap = {
      measures: [{ number: 1, beats: 4, beatType: 4, lengthQuarters: 1 }],
      durationSeconds: 1,
      writtenDurationSeconds: 1,
      tempoChanges: [],
      timeSignatures: [],
    }
    expect(reconcilePdfLayoutWithScore({ timingMap: shortBarMap, perSystemBarlineCounts: [1] }).flags.hasPickup).toBe(
      true,
    )
  })

  it('counts tempo changes', () => {
    const result = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(measureStartTempoChange(), 'tempo'),
      perSystemBarlineCounts: [3],
    })
    expect(result.flags.tempoChangeCount).toBe(1)
  })

  it('counts time-signature changes', () => {
    const result = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(timeSignatureChangeFixture(), 'timesig'),
      perSystemBarlineCounts: [2],
    })
    expect(result.flags.timeSignatureChangeCount).toBe(1)
  })

  it('flags a system-count mismatch only when the score has layout hints', () => {
    const timingMap = parseMusicXml(systemsAndPages(), 'systemsAndPages') // breaks before m3, m5
    const matched = reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts: [2, 2, 2] })
    expect(matched.flags.systemCountMismatch).toBe(false)
    const mismatched = reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts: [3, 3] })
    expect(mismatched.flags.systemCountMismatch).toBe(true)
  })
})

describe('anchor generation consumes a reconciled layout safely', () => {
  it('produces ordered anchors that never exceed the measure count and start at measure 1', () => {
    const timingMap = parseMusicXml(systemsAndPages(), 'systemsAndPages')
    const measureCount = timingMap.measures.length
    // Three detected system starts (matching the score's 3 systems).
    const systemStarts = [
      { id: 's0', page: 1, x: 0.1, y: 0.16 },
      { id: 's1', page: 1, x: 0.1, y: 0.42 },
      { id: 's2', page: 2, x: 0.1, y: 0.16 },
    ]
    const anchors = buildAnchorsFromSystemStarts(systemStarts, timingMap)
    expect(anchors.length).toBeGreaterThan(0)
    expect(anchors.length).toBeLessThanOrEqual(measureCount)
    expect(anchors[0].measureNumber).toBe(1)
    const measureNumbers = anchors.map((a) => a.measureNumber)
    const sorted = [...measureNumbers].sort((a, b) => a - b)
    expect(measureNumbers).toEqual(sorted)
  })
})
