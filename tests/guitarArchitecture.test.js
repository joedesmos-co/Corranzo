import { describe, expect, it } from 'vitest'
import {
  ARCHITECTURE_VERSION,
  CONTEXT_HEADS,
  LINE_ROLES,
  NOTATION_LINE_ROLES,
  OBJECT_HEADS,
  RELATION_TYPES,
  STAFF_TYPES,
  TAB_STRING_ROLES,
  VIEWS,
  familyCoverage,
  familiesWithoutHonestLabels,
} from '../src/features/omr/guitar/architecture.js'
import { NOTATION_FAMILIES } from '../src/features/omr/guitar/notationFamilies.js'
import {
  clusterFretDigits,
  lineRelativeGrid,
  stringForY,
  tabDigitSamplePositions,
} from '../src/features/omr/guitar/tabGeometry.js'
import { STANDARD_GUITAR_TUNING } from '../src/features/instruments/instruments.js'
import { soundingFromTab } from '../src/features/omr/guitar/pitchContract.js'

describe('architecture vocabulary', () => {
  it('is versioned so a model can be matched to its contract', () => {
    expect(ARCHITECTURE_VERSION).toBe('guitar-vision/1.0')
    expect(familyCoverage().version).toBe(ARCHITECTURE_VERSION)
  })

  it('models five notation lines and six TAB strings as distinct roles', () => {
    expect(NOTATION_LINE_ROLES).toHaveLength(5)
    expect(TAB_STRING_ROLES).toHaveLength(6)
    // The whole point: a 6-line TAB is not a 6-line staff.
    const overlap = NOTATION_LINE_ROLES.filter((role) => TAB_STRING_ROLES.includes(role))
    expect(overlap).toEqual([])
  })

  it('names string 1 as the highest string, matching the tuning table', () => {
    // Line roles are ordered top-down, so tab-string-1 is the high E (MIDI 64).
    expect(TAB_STRING_ROLES[0]).toBe(LINE_ROLES.TAB_STRING_1)
    expect(STANDARD_GUITAR_TUNING[0]).toBe(64)
    expect(soundingFromTab(1, 0)).toBe(STANDARD_GUITAR_TUNING[0])
  })

  it('separates notation, TAB and mixed staves', () => {
    expect(STAFF_TYPES.MIXED).toBeTruthy()
    expect(OBJECT_HEADS.staffType).toContain(STAFF_TYPES.MIXED)
    expect(CONTEXT_HEADS.staffRole).toContain(STAFF_TYPES.MIXED)
  })

  it('has dedicated string and fret heads', () => {
    // 7 = strings 1..6 plus none. 26 = frets 0..24 plus unknown.
    expect(OBJECT_HEADS.stringNumber).toBe(7)
    expect(OBJECT_HEADS.fret).toBe(26)
    // Fret 0 is an open string and must occupy a real class.
    expect(OBJECT_HEADS.fret).toBeGreaterThan(24)
  })

  it('models multi-digit frets as a first-class quantity', () => {
    expect(OBJECT_HEADS.fretDigitCount).toBe(3)
  })

  it('predicts the notation/TAB pairing as a relation, not a post-hoc heuristic', () => {
    expect(RELATION_TYPES.notationTabPair).toBe(2)
    expect(RELATION_TYPES.fretOnString).toBe(7)
    // Direction matters for slides and glissandi.
    expect(RELATION_TYPES.slideTarget).toBe(3)
  })

  it('models bend targets rather than only a bend glyph', () => {
    expect(RELATION_TYPES.bendTarget).toBe(2)
    expect(RELATION_TYPES.harmonicNode).toBe(2)
  })

  it('separates views so small fret digits get resolution', () => {
    expect(Object.values(VIEWS)).toEqual(expect.arrayContaining(['full-page', 'notation', 'tab']))
  })

  it('scales capacity for chords that appear twice, once per staff', () => {
    const capacity = familyCoverage().capacity
    // A six-note chord is six noteheads + six TAB digits + string numbers.
    expect(capacity.maxObjects).toBeGreaterThanOrEqual(512)
  })

  it('reports page-level context as a separate stream', () => {
    expect(CONTEXT_HEADS.keyFifths).toBeGreaterThan(15)
    expect(CONTEXT_HEADS.clefSign).toBeGreaterThanOrEqual(4)
    expect(CONTEXT_HEADS.capoFret).toBeGreaterThanOrEqual(13)
  })

  it('has a marking class for every technique the mission requires', () => {
    const required = [
      'bend',
      'pre-bend',
      'bend-release',
      'vibrato',
      'hammer-on',
      'pull-off',
      'slide',
      'glissando',
      'natural-harmonic',
      'artificial-harmonic',
      'pinch-harmonic',
      'tapping',
      'palm-mute',
      'let-ring',
      'tremolo-picking',
      'tremolo',
      'whammy-bar',
      'fingering',
      'pick-direction',
      'barre',
      'dead-note',
      'ghost-note',
      'grace-note',
      'cue-note',
      'staccato',
      'accent',
      'tenuto',
      'marcato',
      'fermata',
      'arpeggio',
    ]
    const classes = OBJECT_HEADS.markingType
    for (const family of required) {
      expect(classes, `missing marking class ${family}`).toContain(family)
    }
  })

  it('derives its marking classes from the family registry so they cannot drift', () => {
    // Every marking class except 'none' must correspond to a tracked family.
    const classes = OBJECT_HEADS.markingType.filter((name) => name !== 'none')
    const tracked = new Set(NOTATION_FAMILIES)
    for (const className of classes) {
      expect(tracked.has(className), `${className} is not in the notation family registry`).toBe(true)
    }
  })

  it('represents every tracked family, claiming none as unrepresentable', () => {
    // The architecture is designed for the whole surface. Anything it cannot
    // represent would be a silent drop.
    expect(familiesWithoutHonestLabels()).toEqual([])
  })
})

describe('string geometry', () => {
  const lineYs = [0.1, 0.12, 0.14, 0.16, 0.18, 0.2]

  it('maps a y position to a 1-based string with string 1 highest', () => {
    expect(stringForY(0.1, lineYs)).toBe(1)
    expect(stringForY(0.2, lineYs)).toBe(6)
    expect(stringForY(0.14, lineYs)).toBe(3)
  })

  it('abstains rather than guessing a string it cannot justify', () => {
    // Halfway between string 3 and 4 is not a fret digit position.
    expect(stringForY(0.15, lineYs)).toBeNull()
    // Far outside the staff entirely.
    expect(stringForY(0.4, lineYs)).toBeNull()
  })

  it('tolerates unsorted input', () => {
    expect(stringForY(0.16, [...lineYs].reverse())).toBe(4)
  })

  it('returns null with no geometry', () => {
    expect(stringForY(0.1, null)).toBeNull()
    expect(stringForY(0.1, [])).toBeNull()
  })
})

describe('line-relative sampling', () => {
  it('produces a grid whose count matches the requested resolution', () => {
    const grid = lineRelativeGrid({ grid: 3 })
    expect(grid.length).toBe(3 * 3 * 2)
  })

  it('anchors samples on the string line, not the box centre', () => {
    // The same digit on two different strings must produce different features.
    const onString3 = tabDigitSamplePositions({
      centerX: 0.5,
      stringLineY: 0.14,
      staffGap: 0.02,
      digitWidth: 0.01,
    })
    const onString6 = tabDigitSamplePositions({
      centerX: 0.5,
      stringLineY: 0.2,
      staffGap: 0.02,
      digitWidth: 0.01,
    })
    expect(onString3.positions).not.toEqual(onString6.positions)
    expect(onString3.anchorY).toBe(0.14)
    expect(onString6.anchorY).toBe(0.2)
  })

  it('straddles the line so the line itself is represented', () => {
    const { positions, count } = tabDigitSamplePositions({
      centerX: 0.5,
      stringLineY: 0.14,
      staffGap: 0.02,
      digitWidth: 0.01,
    })
    const ys = []
    for (let index = 0; index < count; index += 1) ys.push(positions[index * 2 + 1])
    // Samples must fall on both sides of the line, otherwise the model cannot
    // tell "digit on this line" from "digit between lines".
    expect(Math.min(...ys)).toBeLessThan(0.14)
    expect(Math.max(...ys)).toBeGreaterThan(0.14)
  })

  it('keeps every sample inside the digit horizontally', () => {
    const { positions, count } = tabDigitSamplePositions({
      centerX: 0.5,
      stringLineY: 0.14,
      staffGap: 0.02,
      digitWidth: 0.01,
    })
    for (let index = 0; index < count; index += 1) {
      expect(Math.abs(positions[index * 2] - 0.5)).toBeLessThanOrEqual(0.01)
    }
  })
})

describe('multi-digit fret clustering', () => {
  it('joins two glyphs on one string into a single fret', () => {
    // A "1" and a "2" typeset tight on string 5 is the fret 12.
    const clusters = clusterFretDigits([
      { string: 5, x: 0.5, width: 0.008, text: '1' },
      { string: 5, x: 0.511, width: 0.008, text: '2' },
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].fret).toBe(12)
    expect(clusters[0].digitCount).toBe(2)
  })

  it('keeps well-separated digits on one string as separate frets', () => {
    const clusters = clusterFretDigits([
      { string: 5, x: 0.5, width: 0.008, text: '0' },
      { string: 5, x: 0.55, width: 0.008, text: '3' },
    ])
    expect(clusters).toHaveLength(2)
    expect(clusters.map((cluster) => cluster.fret)).toEqual([0, 3])
  })

  it('never joins digits across different strings', () => {
    // The failure this prevents: a "1" on string 5 and a "2" on string 6 at the
    // same x becoming the fret 12 on one string.
    const clusters = clusterFretDigits([
      { string: 5, x: 0.5, width: 0.008, text: '1' },
      { string: 6, x: 0.5, width: 0.008, text: '2' },
    ])
    expect(clusters).toHaveLength(2)
    expect(clusters.map((cluster) => cluster.string).sort()).toEqual([5, 6])
  })

  it('flags an out-of-range fret instead of trusting it', () => {
    // Fret 9 on string 1 is ordinary. Fret 30 does not exist on a 24-fret guitar
    // and must be rejected rather than clamped, or the model learns that
    // unreachable positions are fine.
    const ordinary = clusterFretDigits([{ string: 1, x: 0.5, width: 0.008, text: '9' }])
    expect(ordinary[0].fret).toBe(9)
    expect(ordinary[0].valid).toBe(true)

    const impossible = clusterFretDigits([
      { string: 1, x: 0.5, width: 0.008, text: '3' },
      { string: 1, x: 0.512, width: 0.008, text: '0' },
    ])
    expect(impossible[0].fret).toBe(30)
    expect(impossible[0].valid).toBe(false)
  })

  it('accepts a fret at the top of the range', () => {
    const clusters = clusterFretDigits([
      { string: 1, x: 0.5, width: 0.008, text: '2' },
      { string: 1, x: 0.512, width: 0.008, text: '4' },
    ])
    expect(clusters[0].fret).toBe(24)
    expect(clusters[0].valid).toBe(true)
  })

  it('produces positions that sound the intended pitch', () => {
    const clusters = clusterFretDigits([
      { string: 6, x: 0.5, width: 0.008, text: '1' },
      { string: 6, x: 0.512, width: 0.008, text: '2' },
    ])
    expect(soundingFromTab(clusters[0].string, clusters[0].fret)).toBe(52)
  })
})
