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

  it('flags a system-count mismatch only when the score has layout hints', () => {
    const timingMap = parseMusicXml(systemsAndPages(), 'systemsAndPages') // breaks before m3, m5
    const matched = reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts: [2, 2, 2] })
    expect(matched.flags.systemCountMismatch).toBe(false)
    const mismatched = reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts: [3, 3] })
    expect(mismatched.flags.systemCountMismatch).toBe(true)
  })
})

// --- Phase 2: honest model surfacing ----------------------------------------

function implicitPickupFixture() {
  // MusicXML pickup: measure 0 with implicit="yes" holding a single quarter.
  return (
    '<?xml version="1.0"?><score-partwise version="3.1">' +
    '<part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>' +
    '<part id="P1"><measure number="0" implicit="yes"><attributes><divisions>1</divisions>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note></measure>' +
    `<measure number="1">${fourQuarters()}</measure></part></score-partwise>`
  )
}

describe('Phase 2: parser surfaces honest pickup metadata', () => {
  it('preserves implicit="yes" on the measure', () => {
    const tm = parseMusicXml(implicitPickupFixture(), 'implicit')
    expect(tm.measures[0].implicit).toBe(true)
  })

  it('exposes the true notated length without changing timing length', () => {
    const tm = parseMusicXml(pickupFixture(), 'pickup')
    expect(tm.measures[0].notatedLengthQuarters).toBe(1) // one quarter actually written
    expect(tm.measures[0].lengthQuarters).toBe(4) // timing length unchanged (padded)
    const full = parseMusicXml(straight4(), 'straight4')
    expect(full.measures[0].notatedLengthQuarters).toBe(4)
    expect(full.measures[0].implicit).toBe(false)
  })
})

describe('Phase 2: pickup detection uses real metadata (not faked)', () => {
  it('detects an explicit implicit="yes" pickup', () => {
    const tm = parseMusicXml(implicitPickupFixture(), 'implicit')
    expect(reconcilePdfLayoutWithScore({ timingMap: tm, perSystemBarlineCounts: [2] }).flags.hasPickup).toBe(true)
  })

  it('detects a structurally short first bar via notatedLengthQuarters', () => {
    const tm = parseMusicXml(pickupFixture(), 'pickup')
    expect(reconcilePdfLayoutWithScore({ timingMap: tm, perSystemBarlineCounts: [3] }).flags.hasPickup).toBe(true)
  })

  it('does not flag a normal full first bar', () => {
    const tm = parseMusicXml(straight4(), 'straight4')
    expect(reconcilePdfLayoutWithScore({ timingMap: tm, perSystemBarlineCounts: [2, 2] }).flags.hasPickup).toBe(false)
  })
})

describe('Phase 2: repeat/volta reporting from the performed timeline', () => {
  it('reports performed vs written and which measures are revisited (repeat)', () => {
    const result = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(oneRepeat(), 'oneRepeat'),
      perSystemBarlineCounts: [4],
    })
    const f = result.flags
    expect(f.hasRepeats).toBe(true)
    expect(f.performedDiffersFromWritten).toBe(true)
    expect(f.writtenMeasureCount).toBe(4)
    expect(f.performedMeasureCount).toBe(6) // 1,2,1,2,3,4
    expect(f.maxRepeatPass).toBe(2)
    expect(f.repeatedMeasureNumbers).toEqual([1, 2])
  })

  it('reports voltas as a performed/written difference', () => {
    const f = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(singleMeasureVoltas(), 'voltas'),
      perSystemBarlineCounts: [4],
    }).flags
    expect(f.performedDiffersFromWritten).toBe(true)
    expect(f.repeatedMeasureNumbers).toContain(1)
  })

  it('reports no difference for a straight piece', () => {
    const f = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(straight4(), 'straight4'),
      perSystemBarlineCounts: [2, 2],
    }).flags
    expect(f.hasRepeats).toBe(false)
    expect(f.performedDiffersFromWritten).toBe(false)
    expect(f.performedMeasureCount).toBe(4)
    expect(f.repeatedMeasureNumbers).toEqual([])
  })
})

describe('Phase 2: tempo / time-signature changes with affected measures', () => {
  it('reports the measure where a tempo change takes effect', () => {
    const f = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(measureStartTempoChange(), 'tempo'),
      perSystemBarlineCounts: [3],
    }).flags
    expect(f.tempoChangeCount).toBe(1)
    expect(f.tempoChangeMeasures).toEqual([2])
  })

  it('reports the measure where a time-signature change takes effect', () => {
    const f = reconcilePdfLayoutWithScore({
      timingMap: parseMusicXml(timeSignatureChangeFixture(), 'timesig'),
      perSystemBarlineCounts: [2],
    }).flags
    expect(f.timeSignatureChangeCount).toBe(1)
    expect(f.timeSignatureChangeMeasures).toEqual([2])
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
