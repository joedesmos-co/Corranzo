/**
 * Tab-lane layout tests: string-line geometry, position resolution,
 * deterministic x-from-time, target-strip positions — and instrument-aware
 * Wait For You guidance wording.
 */
import { describe, expect, it } from 'vitest'
import {
  FRET_DISC_RADIUS,
  TAB_LINE_GAP,
  buildFretboardTargetPositions,
  buildTabGeometry,
  buildTabLaneNotes,
  buildTargetPositions,
  yForString,
} from '../src/features/practice/tabLaneLayout.js'
import { buildVisualLaneGroups, VISUAL_LANE_DEFAULTS } from '../src/features/practice/visualPracticeLane.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getInstrument } from '../src/features/instruments/instruments.js'
import { getTabPositionsForTimingMap } from '../src/features/instruments/timingMapTabPositions.js'
import {
  buildGuidance,
  positionHintForCheckpoint,
  staffHandHint,
} from '../src/features/practice/waitForYouGuidance.js'

const GUITAR = getInstrument('guitar')
const PIANO = getInstrument('piano')

function guitarXml() {
  const note = (step, octave) =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>
      <direction><sound tempo="120"/></direction>
      ${note('E', 2)}${note('A', 2)}${note('D', 3)}${note('G', 3)}
    </measure>
  </part>
</score-partwise>`
}

describe('buildTabGeometry', () => {
  it('lays six string lines top-down with margins', () => {
    const geometry = buildTabGeometry(GUITAR.strings)
    expect(geometry.stringCount).toBe(6)
    expect(geometry.lines.length).toBe(6)
    for (let index = 1; index < geometry.lines.length; index += 1) {
      expect(geometry.lines[index] - geometry.lines[index - 1]).toBe(TAB_LINE_GAP)
    }
    expect(geometry.height).toBeGreaterThan(geometry.lines[5])
    // Open-string names top-down: E B G D A E.
    expect(geometry.stringLabels).toEqual(['E', 'B', 'G', 'D', 'A', 'E'])
  })

  it('maps string numbers to lines (string 1 on top)', () => {
    const geometry = buildTabGeometry(GUITAR.strings)
    expect(yForString(1, geometry)).toBe(geometry.lines[0])
    expect(yForString(6, geometry)).toBe(geometry.lines[5])
    // Out-of-range clamps rather than exploding.
    expect(yForString(9, geometry)).toBe(geometry.lines[5])
  })
})

describe('buildTabLaneNotes', () => {
  it('positions every note at x = time × px/s on its string line', () => {
    const map = parseMusicXml(guitarXml(), 'g.musicxml')
    const groups = buildVisualLaneGroups(map).map((group) => ({ ...group, status: 'upcoming' }))
    const positions = getTabPositionsForTimingMap(map, GUITAR)
    const geometry = buildTabGeometry(GUITAR.strings)

    const notes = buildTabLaneNotes(groups, geometry, { positions })
    expect(notes.length).toBe(4)
    expect(notes.unplacedCount).toBe(0)

    for (const note of notes) {
      const group = groups.find((candidate) => candidate.id === note.groupId)
      expect(note.x).toBeCloseTo(group.timeSeconds * VISUAL_LANE_DEFAULTS.pixelsPerSecond, 6)
      expect(geometry.lines).toContain(note.y)
      expect(note.fret).toBeGreaterThanOrEqual(0)
    }

    // Open strings land on their own lines: E2 → string 6 (bottom line).
    const e2 = notes.find((note) => note.midi === 40)
    expect(e2.string).toBe(6)
    expect(e2.fret).toBe(0)
    expect(e2.y).toBe(geometry.lines[5])
  })

  it('skips (and counts) notes with no resolvable position', () => {
    const geometry = buildTabGeometry(GUITAR.strings)
    const groups = [
      {
        id: 'g1',
        timeSeconds: 0,
        status: 'upcoming',
        notes: [{ id: 'x', midi: 60, label: 'C4' }],
      },
    ]
    const notes = buildTabLaneNotes(groups, geometry, { positions: new Map() })
    expect(notes.length).toBe(0)
    expect(notes.unplacedCount).toBe(1)
  })

  it('exports disc sizing shared with the renderer', () => {
    expect(FRET_DISC_RADIUS).toBeGreaterThan(0)
  })
})

describe('buildTargetPositions', () => {
  it('collects target string/fret pairs from explicit and derived positions', () => {
    const positions = new Map([['n2', { string: 5, fret: 3 }]])
    const targetGroup = {
      notes: [
        { id: 'n1', midi: 64, label: 'E4', string: 1, fret: 0 },
        { id: 'n2', midi: 48, label: 'C3' },
        { id: 'n3', midi: 999, label: '?', string: null, fret: null }, // unresolvable
      ],
    }
    const targets = buildTargetPositions(targetGroup, positions)
    expect(targets).toEqual([
      { string: 1, fret: 0, midi: 64, label: 'E4' },
      { string: 5, fret: 3, midi: 48, label: 'C3' },
    ])
  })

  it('keeps open-string TAB targets but removes open strings from fretboard markers', () => {
    const targetGroup = {
      notes: [
        { id: 'open', midi: 64, label: 'E4', string: 1, fret: 0 },
        { id: 'fretted', midi: 48, label: 'C3', string: 5, fret: 3 },
      ],
    }

    expect(buildTargetPositions(targetGroup)).toEqual([
      { string: 1, fret: 0, midi: 64, label: 'E4' },
      { string: 5, fret: 3, midi: 48, label: 'C3' },
    ])
    expect(buildFretboardTargetPositions(targetGroup)).toEqual([
      { string: 5, fret: 3, midi: 48, label: 'C3' },
    ])
  })
})

describe('instrument-aware Wait For You guidance', () => {
  const checkpoint = {
    id: 'c1',
    expectedMidis: [48],
    expectedMidi: 48,
    notes: [{ id: 'n1', midi: 48, label: 'C3', staff: 1 }],
  }

  it('suppresses hand hints for non-grand-staff instruments', () => {
    expect(staffHandHint(checkpoint)).toBe('right hand')
    expect(staffHandHint(checkpoint, PIANO)).toBe('right hand')
    expect(staffHandHint(checkpoint, GUITAR)).toBeNull()
  })

  it('describes checkpoint notes as fretboard positions for guitar', () => {
    const tabPositions = new Map([['n1', { string: 5, fret: 3 }]])
    expect(
      positionHintForCheckpoint(checkpoint, { strings: GUITAR.strings, tabPositions }),
    ).toBe('fret 3 · A string')
    expect(positionHintForCheckpoint(checkpoint, { strings: null })).toBeNull()
  })

  it('level-3 hints name the position for guitar and the hand for piano', () => {
    const tabPositions = new Map([['n1', { string: 5, fret: 3 }]])
    const guitarGuidance = buildGuidance({
      checkpoint,
      inputFeedback: { outcome: 'wrong' },
      wrongAttempts: 3,
      instrument: GUITAR,
      strings: GUITAR.strings,
      tabPositions,
    })
    expect(guitarGuidance.hint).toBe('Play C3 (fret 3 · A string).')

    const pianoGuidance = buildGuidance({
      checkpoint,
      inputFeedback: { outcome: 'wrong' },
      wrongAttempts: 3,
      instrument: PIANO,
    })
    expect(pianoGuidance.hint).toBe('Play C3 with your right hand.')
  })

  it('default (no instrument) wording is unchanged for existing piano flows', () => {
    const guidance = buildGuidance({
      checkpoint,
      inputFeedback: { outcome: 'wrong' },
      wrongAttempts: 3,
    })
    expect(guidance.hint).toBe('Play C3 with your right hand.')
  })
})
