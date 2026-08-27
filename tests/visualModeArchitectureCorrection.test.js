import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  STAFF_LINE_GAP,
  buildStaffGeometry,
  buildKeySignatureMarks,
  buildStaffLaneDynamicMarks,
  buildStaffLaneNotationMarkings,
  buildStaffLaneNotes,
  buildStaffLaneOctaveShiftMarks,
  buildStaffLaneRests,
  buildStaffLaneRhythmMarks,
  buildStaffLaneStems,
  buildStaffLaneWedgeMarks,
  buildSourceSystemStaffGeometry,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
import { PRACTICE_SCOPE } from '../src/features/practice/practiceScope.js'
import {
  buildVisualRenderingInstructions,
  compareVisualRenderingInstructions,
} from '../src/features/practice/visualRenderingInstructions.js'
import {
  buildSourceFidelityLaneLayout,
  buildSourceFidelityStructuralMarks,
  resolveSourceFidelityGroupX,
  resolveSourceFidelityLaneX,
  resolveSourceFidelityObjectX,
} from '../src/features/practice/sourceFidelityLayout.js'
import { resolveVisualLaneTransform } from '../src/features/practice/visualPracticeLane.js'
import * as F from './helpers/buildXml.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSource = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

function semanticTimingMap() {
  return {
    durationSeconds: 2,
    stavesPerSystem: 2,
    parts: [{ id: 'P1', name: 'Piano', staves: 2 }],
    measures: [
      {
        number: 1,
        startTimeSeconds: 0,
        endTimeSeconds: 2,
        startQuarters: 0,
        endQuarters: 4,
        beats: 4,
        beatType: 4,
        engravedWidth: 200,
        systemBreakBefore: false,
        pageBreakBefore: false,
      },
    ],
    beats: [],
    notes: [
      {
        id: 'right-quarter',
        sourceNoteheadId: 'sfnh-right-quarter',
        sourcePdfCenter: { x: 0.2, y: 0.3 },
        defaultX: 42,
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 0,
        timeSeconds: 0,
        durationQuarters: 1,
        durationSeconds: 0.5,
        midi: 60,
        writtenPitch: { step: 'C', alter: 0, octave: 4 },
        accidental: { type: 'natural' },
        keySignature: { fifths: 0, mode: 'major', cancelFifths: null },
        noteType: 'quarter',
        stemDirection: 'up',
        dots: 1,
      },
      {
        id: 'right-half',
        sourceNoteheadId: 'sfnh-right-half',
        partId: 'P1',
        staff: 1,
        voice: 2,
        measureNumber: 1,
        quarterTime: 0,
        timeSeconds: 0,
        durationQuarters: 2,
        durationSeconds: 1,
        midi: 63,
        writtenPitch: { step: 'E', alter: -1, octave: 4 },
        accidental: { type: 'flat' },
        noteType: 'half',
        stemDirection: 'down',
      },
      {
        id: 'left-whole',
        sourceNoteheadId: 'sfnh-left-whole',
        partId: 'P1',
        staff: 2,
        voice: 1,
        measureNumber: 1,
        quarterTime: 0,
        timeSeconds: 0,
        durationQuarters: 4,
        durationSeconds: 2,
        midi: 48,
        writtenPitch: { step: 'C', alter: 0, octave: 3 },
        noteType: 'whole',
      },
      {
        id: 'nearby-eighth',
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 0.16,
        timeSeconds: 0.08,
        durationQuarters: 0.5,
        durationSeconds: 0.25,
        midi: 62,
        writtenPitch: { step: 'D', alter: 0, octave: 4 },
        noteType: 'eighth',
      },
      {
        id: 'tie-start',
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 1,
        timeSeconds: 0.5,
        durationQuarters: 0.5,
        durationSeconds: 0.25,
        midi: 67,
        writtenPitch: { step: 'G', alter: 0, octave: 4 },
        noteType: 'eighth',
        tieStart: true,
        beams: [{ number: 1, value: 'begin' }],
      },
      {
        id: 'tie-stop',
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 1.5,
        timeSeconds: 0.75,
        durationQuarters: 0.5,
        durationSeconds: 0.25,
        midi: 67,
        writtenPitch: { step: 'G', alter: 0, octave: 4 },
        noteType: 'eighth',
        tieStop: true,
        suppressPlaybackAttack: true,
        beams: [{ number: 1, value: 'end' }],
      },
      {
        id: 'right-rest',
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 2,
        timeSeconds: 1,
        durationQuarters: 1,
        durationSeconds: 0.5,
        isRest: true,
        midi: null,
        noteType: 'quarter',
        dots: 1,
      },
      {
        id: 'left-rest',
        partId: 'P1',
        staff: 2,
        voice: 2,
        measureNumber: 1,
        quarterTime: 3,
        timeSeconds: 1.5,
        durationQuarters: 2,
        durationSeconds: 1,
        isRest: true,
        midi: null,
        noteType: 'half',
      },
    ],
  }
}

function geometry(representation, x, y) {
  return {
    representation,
    sourceCenter: { x, y, coordinateSpace: 'pdf-source-normalized' },
    sourceBBox: {
      x0: x - 0.01,
      y0: y - 0.01,
      x1: x + 0.01,
      y1: y + 0.01,
      coordinateSpace: 'pdf-source-normalized',
    },
    confidence: 0.96,
  }
}

function sourceVisualMap({ wrongMidi = false } = {}) {
  return {
    anchors: [
      {
        sourceNoteheadId: 'sfnh-right-quarter',
        sourceEventId: 'sfve-p1-m1-e0',
        sourceEventIds: ['sfve-p1-m1-e0'],
        page: 1,
        systemIndex: 0,
        staffIndex: 0,
        measureIndex: 0,
        measureNumber: 1,
        midi: wrongMidi ? 61 : 60,
        voice: 1,
        ...geometry('notation', 0.2, 0.3),
        alternates: [geometry('tab', 0.2, 0.7)],
      },
      {
        sourceNoteheadId: 'sfnh-right-half',
        sourceEventId: 'sfve-p1-m1-e0',
        sourceEventIds: ['sfve-p1-m1-e0'],
        page: 1,
        systemIndex: 0,
        staffIndex: 0,
        measureIndex: 0,
        measureNumber: 1,
        midi: 63,
        voice: 2,
        ...geometry('notation', 0.2, 0.27),
        alternates: [],
      },
      {
        sourceNoteheadId: 'sfnh-left-whole',
        sourceEventId: 'sfve-p1-m1-e0',
        sourceEventIds: ['sfve-p1-m1-e0'],
        page: 1,
        systemIndex: 0,
        staffIndex: 1,
        measureIndex: 0,
        measureNumber: 1,
        midi: 48,
        voice: 1,
        ...geometry('notation', 0.2, 0.5),
        alternates: [],
      },
    ],
  }
}

describe('Visual mode architecture correction', () => {
  it('keeps print-object=no events semantic while omitting their reconstructed glyphs', () => {
    const xml = `<?xml version="1.0"?>
      <score-partwise version="3.1">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1"><measure number="1">
          <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
          <note print-object="no"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem></note>
          <note print-object="yes"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem></note>
          <note print-object="no"><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>
          <note><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>
        </measure></part>
      </score-partwise>`
    const timingMap = parseMusicXml(xml, 'hidden-visual-objects.musicxml')
    const instructions = buildVisualRenderingInstructions(timingMap)
    const geometryModel = buildStaffGeometry(detectStaves(instructions))
    const notes = buildStaffLaneNotes(instructions, geometryModel)
    const rests = buildStaffLaneRests(instructions, geometryModel)
    const stems = buildStaffLaneStems(instructions, geometryModel, { notes })

    expect(timingMap.notes.map((note) => note.printObject)).toEqual([
      false,
      true,
      false,
      true,
    ])
    expect(instructions.flatMap((group) => [...group.notes, ...group.rests]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ printObject: false })]))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ midi: 62 })
    expect(rests).toHaveLength(1)
    expect(stems).toHaveLength(1)
  })

  it('uses one reconstructed renderer for PDF-backed and MusicXML-only pieces', () => {
    const view = readSource('components', 'practice', 'VisualPracticeView.jsx')
    const practice = readSource('components', 'practice', 'PracticeView.jsx')

    expect(view).toContain('buildVisualRenderingInstructions')
    expect(view).toContain('<StaffVisualLane')
    expect(view).toContain('<TabVisualLane')
    expect(view).not.toContain('SourcePdfVisualLane')
    expect(view).not.toContain('react-pdf')
    expect(practice).toContain('<VisualPracticeView timingSourceKind={timingSourceKind} />')
  })

  it('joins sfnh/sfve provenance and exposes normalized renderer-safe geometry', () => {
    const instructions = buildVisualRenderingInstructions(
      semanticTimingMap(),
      sourceVisualMap(),
      { preferredRepresentation: 'tab' },
    )
    const first = instructions[0]
    const quarter = first.notes.find((note) => note.id === 'right-quarter')
    const half = first.notes.find((note) => note.id === 'right-half')

    expect(first.expectedMidis).toEqual([48, 60, 63])
    expect(quarter.sourceOwnership).toMatchObject({
      sourceNoteheadId: 'sfnh-right-quarter',
      sourceEventId: 'sfve-p1-m1-e0',
      selectedRepresentation: 'tab',
      provenanceStatus: 'matched',
    })
    expect(half.sourceOwnership.selectedRepresentation).toBe('notation')
    expect(quarter.sourceLayout).toMatchObject({
      source: 'source-visual-map',
      coordinateSpace: 'pdf-source-normalized',
      page: 1,
      systemIndex: 0,
      staffIndex: 0,
      measureIndex: 0,
      representation: 'tab',
      x: 0.2,
      y: 0.7,
      confidence: 0.96,
    })
    expect(quarter.sourceLayout.bounds).toMatchObject({
      x0: 0.19,
      y0: 0.69,
      y1: 0.71,
    })
    expect(quarter.sourceLayout.bounds.x1).toBeCloseTo(0.21, 8)
    expect(first.sourceLayout).toMatchObject({
      source: 'source-visual-map',
      page: 1,
      systemIndex: 0,
      x: 0.2,
    })
    expect(quarter).not.toHaveProperty('sourcePdfCenter')
    expect(quarter).not.toHaveProperty('defaultX')
    expect(JSON.stringify(instructions)).not.toContain('sourceBBox')
    expect(JSON.stringify(instructions)).not.toContain('sourceCenter')
  })

  it('uses MusicXML layout without source provenance and keeps a semantic fallback', () => {
    const instructions = buildVisualRenderingInstructions(semanticTimingMap())
    const first = instructions[0]
    const quarter = first.notes.find((note) => note.id === 'right-quarter')
    const half = first.notes.find((note) => note.id === 'right-half')

    expect(quarter.sourceLayout).toMatchObject({
      source: 'musicxml-layout',
      page: 1,
      systemIndex: 0,
      measureNumber: 1,
      defaultX: 42,
      measureWidth: 200,
      xInMeasure: 0.21,
    })
    expect(half.sourceLayout).toMatchObject({
      source: 'semantic-fallback',
      page: 1,
      systemIndex: 0,
      measureNumber: 1,
    })
  })

  it('keeps printed second displacement without adding the semantic collision offset twice', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1" width="160">
            <attributes>
              <divisions>1</divisions>
              <time><beats>1</beats><beat-type>4</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef>
            </attributes>
            <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
            <note default-x="52"><chord/><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
          </measure>
          <measure number="2" width="160">
            <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
            <note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
          </measure>
          <measure number="3" width="160">
            <note default-x="40"><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>down</stem></note>
            <note default-x="52"><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>down</stem></note>
          </measure>
        </part>
      </score-partwise>
    `)
    const groups = buildVisualRenderingInstructions(timingMap)
    const sourceLayout = buildSourceFidelityLaneLayout(groups)
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry, { sourceLayout })
    const printed = notes
      .filter((note) => note.measureNumber === 1)
      .sort((left, right) => left.diatonic - right.diatonic)
    const fallback = notes
      .filter((note) => note.measureNumber === 2)
      .sort((left, right) => left.diatonic - right.diatonic)
    const printedStemDown = notes
      .filter((note) => note.measureNumber === 3)
      .sort((left, right) => left.diatonic - right.diatonic)
    const stems = buildStaffLaneStems(groups, geometry, {
      notes,
      sourceLayout,
    })
    const printedStem = stems.find((stem) => stem.groupId === printed[0].groupId)
    const fallbackStem = stems.find((stem) => stem.groupId === fallback[0].groupId)
    const printedDownStem = stems.find(
      (stem) => stem.groupId === printedStemDown[0].groupId,
    )

    expect(printed.map((note) => note.sourceXMode)).toEqual([
      'musicxml-layout',
      'musicxml-layout',
    ])
    expect(printed[1].x).toBeGreaterThan(printed[0].x)
    expect(printed.map((note) => note.xOffset)).toEqual([0, 0])
    expect(fallback.map((note) => note.sourceXMode)).toEqual([
      'semantic-fallback',
      'semantic-fallback',
    ])
    expect(fallback.map((note) => note.xOffset)).toEqual([0, 12])
    expect(printedStem).toMatchObject({ stemDown: false })
    expect(printedStem.x).toBeCloseTo(printed[1].x + 7, 8)
    expect(fallbackStem).toMatchObject({ stemDown: false })
    expect(fallbackStem.x).toBeCloseTo(
      fallback[1].x + fallback[1].xOffset + 7,
      8,
    )
    expect(printedDownStem).toMatchObject({ stemDown: true })
    expect(printedDownStem.x).toBeCloseTo(printedStemDown[0].x - 7, 8)
  })

  it('projects fermatas attached to rests into reconstructed notation markings', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1">
          <measure number="1" width="160">
            <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
            <note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><notations><fermata type="inverted"/></notations></note>
          </measure>
        </part>
      </score-partwise>
    `)
    const groups = buildVisualRenderingInstructions(timingMap)
    const sourceLayout = buildSourceFidelityLaneLayout(groups)
    const staffGeometry = buildStaffGeometry(detectStaves(groups))
    const rests = buildStaffLaneRests(groups, staffGeometry, { sourceLayout })
    const markings = buildStaffLaneNotationMarkings(groups, staffGeometry, {
      notes: buildStaffLaneNotes(groups, staffGeometry, { sourceLayout }),
      rests,
      sourceLayout,
    })

    expect(rests).toHaveLength(1)
    expect(rests[0].markings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'fermata', placement: 'below' }),
      ]),
    )
    expect(markings.noteMarkings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'fermata', shape: 'text', text: '𝄑' }),
      ]),
    )
  })

  it('places source-owned events at their printed X and maps the cursor to the same lane point', () => {
    const instructions = buildVisualRenderingInstructions(
      semanticTimingMap(),
      sourceVisualMap(),
    )
    const layout = buildSourceFidelityLaneLayout(instructions, {
      barlineTimes: [0],
      systemWidth: 1000,
      systemGap: 100,
    })
    const first = instructions[0]
    const quarter = first.notes.find((note) => note.id === 'right-quarter')

    expect(layout.mode).toBe('source-fidelity')
    expect(layout.systems).toHaveLength(1)
    expect(layout.systems[0]).toMatchObject({
      page: 1,
      systemIndex: 0,
      firstTimeSeconds: 0,
      keySignature: { fifths: 0 },
      timeSignature: { beats: 4, beatType: 4 },
    })
    expect(resolveSourceFidelityGroupX(layout, first)).toBeCloseTo(200, 6)
    expect(resolveSourceFidelityObjectX(layout, quarter, first)).toBeCloseTo(200, 6)
    expect(resolveSourceFidelityLaneX(layout, first.timeSeconds)).toBeCloseTo(200, 6)
    expect(layout.barlineXByTime.get('0.000000')).toBeCloseTo(0, 6)
  })

  it('preserves the original time layout when no source geometry or print structure exists', () => {
    const timingMap = semanticTimingMap()
    timingMap.measures[0].engravedWidth = null
    timingMap.notes = timingMap.notes.map((note) => {
      const withoutLayout = { ...note }
      delete withoutLayout.defaultX
      delete withoutLayout.defaultY
      delete withoutLayout.sourceNoteheadId
      return withoutLayout
    })
    const instructions = buildVisualRenderingInstructions(timingMap)
    const layout = buildSourceFidelityLaneLayout(instructions, { pixelsPerSecond: 90 })
    const group = instructions.find((event) => event.timeSeconds > 0)

    expect(layout.mode).toBe('temporal-fallback')
    expect(resolveSourceFidelityGroupX(layout, group)).toBeCloseTo(
      group.timeSeconds * 90,
      6,
    )
  })

  it('preserves source-declared grand-staff distance per reconstructed system', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1" width="180">
            <print new-system="yes">
              <staff-layout number="2"><staff-distance>82.5</staff-distance></staff-layout>
            </print>
            <attributes>
              <divisions>1</divisions>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <staves>2</staves>
              <clef number="1"><sign>G</sign><line>2</line></clef>
              <clef number="2"><sign>F</sign><line>4</line></clef>
            </attributes>
            <note default-x="20"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
            <backup><duration>4</duration></backup>
            <note default-x="20"><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
          </measure>
        </part>
      </score-partwise>
    `)
    const groups = buildVisualRenderingInstructions(timingMap)
    const layout = buildSourceFidelityLaneLayout(groups)
    const baseGeometry = buildStaffGeometry(detectStaves(groups))
    const sourceGeometry = buildSourceSystemStaffGeometry(
      baseGeometry,
      layout.systems[0],
    )

    expect(timingMap.measures[0].staffDistances).toEqual({ '2': 82.5 })
    expect(layout.systems[0].staffDistances).toEqual({ '2': 82.5 })
    expect(sourceGeometry.staves.bass.lines[0]).toBeCloseTo(
      sourceGeometry.staves.treble.lines[4] + 8.25 * STAFF_LINE_GAP,
      8,
    )

    const notes = buildStaffLaneNotes(groups, baseGeometry, { sourceLayout: layout })
    const bassNote = notes.find((note) => note.staffKind === 'bass')
    expect(bassNote.y).toBeCloseTo(
      sourceGeometry.staves.bass.lines[0] + STAFF_LINE_GAP * 2.5,
      8,
    )
  })

  it('projects MusicXML default-y instead of forcing fixed-clef pitch placement', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1" width="180">
            <print new-system="yes">
              <staff-layout number="2"><staff-distance>82.5</staff-distance></staff-layout>
            </print>
            <attributes>
              <divisions>1</divisions>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <staves>2</staves>
              <clef number="1"><sign>G</sign><line>2</line></clef>
              <clef number="2"><sign>F</sign><line>4</line></clef>
            </attributes>
            <note default-x="20" default-y="-122.5" relative-y="5"><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>2</staff></note>
          </measure>
        </part>
      </score-partwise>
    `)
    const groups = buildVisualRenderingInstructions(timingMap)
    const layout = buildSourceFidelityLaneLayout(groups)
    const baseGeometry = buildStaffGeometry({ hasTreble: true, hasBass: true })
    const sourceGeometry = buildSourceSystemStaffGeometry(
      baseGeometry,
      layout.systems[0],
    )
    const [note] = buildStaffLaneNotes(groups, baseGeometry, { sourceLayout: layout })

    expect(note.sourceYMode).toBe('musicxml-default-y')
    expect(note.y).toBeCloseTo(
      sourceGeometry.staves.bass.lines[0] - STAFF_LINE_GAP * 0.5,
      8,
    )
    expect(note.ledgerLines).toEqual([])
  })

  it('keeps semantic pitch Y when MusicXML has no printed vertical coordinate', () => {
    const timingMap = semanticTimingMap()
    timingMap.notes = timingMap.notes.map((note) => ({ ...note, defaultY: null }))
    const groups = buildVisualRenderingInstructions(timingMap)
    const layout = buildSourceFidelityLaneLayout(groups)
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry, { sourceLayout: layout })
    const quarter = notes.find((note) => note.sourceNoteId === 'right-quarter')

    expect(quarter.sourceYMode).toBe('semantic-fallback')
    expect(quarter.y).toBeCloseTo(
      geometry.staves.treble.lines[4] + STAFF_LINE_GAP,
      8,
    )
  })

  it('keeps the semantic staff geometry when source staff-distance is absent', () => {
    const geometry = buildStaffGeometry({ hasTreble: true, hasBass: true })
    expect(buildSourceSystemStaffGeometry(geometry, { staffDistances: null })).toBe(
      geometry,
    )
    expect(buildSourceSystemStaffGeometry(geometry, { staffDistances: { '2': -4 } })).toBe(
      geometry,
    )
  })

  it('splits source-crossing slurs at reconstructed system boundaries', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1" width="100">
            <print new-system="yes"/>
            <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
            <note default-x="80"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><notations><slur type="start" number="1" placement="above"/></notations></note>
          </measure>
          <measure number="2" width="100">
            <print new-system="yes"/>
            <note default-x="20"><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><notations><slur type="stop" number="1"/></notations></note>
          </measure>
        </part>
      </score-partwise>
    `)
    const groups = buildVisualRenderingInstructions(timingMap).map((group) => ({
      ...group,
      status: 'upcoming',
    }))
    const sourceLayout = buildSourceFidelityLaneLayout(groups)
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry, { sourceLayout })
    const { spanMarkings } = buildStaffLaneNotationMarkings(groups, geometry, {
      notes,
      sourceLayout,
    })
    const slurSegments = spanMarkings.filter((marking) => marking.kind === 'slur')
    const firstSystem = sourceLayout.systems[0]
    const secondSystem = sourceLayout.systems[1]
    const endpoints = slurSegments.map((segment) => {
      const values = segment.path.match(/-?\d+(?:\.\d+)?/g).map(Number)
      return { x1: values[0], x2: values[4] }
    })

    expect(slurSegments).toMatchObject([
      { segmentIndex: 0, segmentCount: 2, continuesToNext: true },
      { segmentIndex: 1, segmentCount: 2, continuedFromPrevious: true },
    ])
    expect(endpoints[0].x2).toBeLessThan(firstSystem.xEnd)
    expect(endpoints[1].x1).toBeGreaterThan(secondSystem.xStart)
    expect(endpoints.every(({ x1, x2 }) => x2 - x1 < sourceLayout.systemWidth)).toBe(true)
  })

  it('projects repeats, endings, and inline signature changes at source measure boundaries', () => {
    const timingMap = {
      measures: [
        {
          number: 1,
          startQuarters: 0,
          endQuarters: 4,
          marking: {
            forwardRepeat: true,
            backwardRepeat: false,
            endingStartNumbers: [1],
          },
        },
        {
          number: 2,
          startQuarters: 4,
          endQuarters: 8,
          marking: {
            forwardRepeat: false,
            backwardRepeat: true,
            backwardRepeatTimes: 3,
            endingStop: true,
          },
        },
      ],
      keySignatures: [
        { measureNumber: 1, quarterTime: 0, fifths: 0 },
        { measureNumber: 2, quarterTime: 4, fifths: 2, cancelFifths: 0 },
      ],
      timeSignatures: [
        { quarterTime: 0, beats: 4, beatType: 4 },
        { measureNumber: 2, quarterTime: 4, beats: 3, beatType: 4 },
      ],
    }
    const layout = {
      mode: 'source-fidelity',
      systems: [
        { occurrence: 0, xStart: 0, xEnd: 200 },
      ],
      measures: [
        { measureNumber: 1, repeatPass: 1, systemOccurrence: 0, xStart: 0, xEnd: 100 },
        { measureNumber: 2, repeatPass: 1, systemOccurrence: 0, xStart: 100, xEnd: 200 },
      ],
    }

    const marks = buildSourceFidelityStructuralMarks(timingMap, layout)

    expect(marks.repeats).toMatchObject([
      { direction: 'forward', x: 0 },
      { direction: 'backward', times: 3, x: 200 },
    ])
    expect(marks.endings).toMatchObject([
      { numbers: [1], xStart: 0, xEnd: 200 },
    ])
    expect(marks.keySignatures).toMatchObject([
      { measureNumber: 2, fifths: 2, x: 100 },
    ])
    expect(marks.timeSignatures).toMatchObject([
      { measureNumber: 2, beats: 3, beatType: 4, x: 100 },
    ])
  })

  it('does not invent inline symbols for an unmarked score or duplicate its opening signatures', () => {
    const timingMap = {
      measures: [{ number: 1, startQuarters: 0, endQuarters: 4, marking: null }],
      keySignatures: [{ quarterTime: 0, fifths: -3 }],
      timeSignatures: [{ quarterTime: 0, beats: 6, beatType: 8 }],
    }
    const sourceLayout = {
      mode: 'source-fidelity',
      systems: [{ occurrence: 0, xStart: 0, xEnd: 100 }],
      measures: [
        { measureNumber: 1, repeatPass: 1, systemOccurrence: 0, xStart: 0, xEnd: 100 },
      ],
    }

    expect(buildSourceFidelityStructuralMarks(timingMap, sourceLayout)).toEqual({
      repeats: [],
      endings: [],
      keySignatures: [],
      timeSignatures: [],
      clefs: [],
      systemClefs: [],
      dynamics: [],
      wedges: [],
      octaveShifts: [],
    })
    expect(
      buildSourceFidelityStructuralMarks(timingMap, { mode: 'temporal-fallback' }),
    ).toEqual({
      repeats: [],
      endings: [],
      keySignatures: [],
      timeSignatures: [],
      clefs: [],
      systemClefs: [],
      dynamics: [],
      wedges: [],
      octaveShifts: [],
    })
  })

  it('projects printed dynamics with source X/Y and keeps a MusicXML-only fallback', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1"><measure number="1" width="200">
          <print new-system="yes"/>
          <attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
          <direction placement="below"><direction-type><dynamics default-x="80" default-y="-65" relative-x="5" relative-y="-5"><sfz/></dynamics></direction-type><staff>1</staff></direction>
          <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
        </measure></part>
      </score-partwise>
    `, 'source-dynamic.musicxml')
    const groups = buildVisualRenderingInstructions(timingMap)
    const layout = buildSourceFidelityLaneLayout(groups)
    const structural = buildSourceFidelityStructuralMarks(timingMap, layout)
    const geometry = buildStaffGeometry({ hasTreble: true, hasBass: true })
    const rendered = buildStaffLaneDynamicMarks(structural, geometry)

    expect(timingMap.dynamicEvents).toMatchObject([{
      mark: 'sfz',
      staff: 1,
      placement: 'below',
      defaultX: 80,
      defaultY: -65,
      relativeX: 5,
      relativeY: -5,
      quarterTime: 0,
    }])
    expect(timingMap.notes[0].velocity).toBeCloseTo(0.7, 8)
    expect(structural.dynamics).toMatchObject([{
      mark: 'sfz',
      x: 238,
      sourceXMode: 'musicxml-default-x',
    }])
    expect(rendered).toMatchObject([{
      mark: 'sfz',
      placement: 'below',
      sourceYMode: 'musicxml-default-y',
    }])
    expect(rendered[0].y).toBeCloseTo(geometry.staves.treble.lines[0] + 7 * STAFF_LINE_GAP, 8)

    const fallback = buildSourceFidelityStructuralMarks(
      {
        parts: [{ id: 'P1' }],
        dynamicEvents: [{
          mark: 'p',
          partId: 'P1',
          measureNumber: 1,
          quarterTime: 1,
          timeSeconds: 1.5,
          placement: 'below',
          staff: 1,
        }],
      },
      { mode: 'temporal-fallback', pixelsPerSecond: 100 },
    )
    expect(fallback.dynamics).toMatchObject([{
      mark: 'p',
      x: 150,
      sourceXMode: 'temporal-fallback',
    }])

    const hiddenTimingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1"><measure number="1">
          <attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>
          <direction><direction-type><dynamics print-object="no"><ff/></dynamics></direction-type></direction>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
        </measure></part>
      </score-partwise>
    `)
    expect(hiddenTimingMap.dynamicEvents).toMatchObject([{ mark: 'ff', printObject: false }])
    expect(buildSourceFidelityStructuralMarks(
      hiddenTimingMap,
      { mode: 'temporal-fallback', pixelsPerSecond: 100 },
    ).dynamics).toEqual([])
  })

  it('pairs numbered hairpins, splits them at source systems, and keeps temporal fallback', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1">
          <measure number="1" width="200">
            <print new-system="yes"/>
            <attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
            <direction placement="below"><direction-type><wedge type="crescendo" number="1" default-y="-65"/></direction-type><staff>1</staff></direction>
            <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
            <direction placement="above"><direction-type><wedge type="diminuendo" number="2" default-y="-105" relative-x="5"/></direction-type><staff>2</staff></direction>
            <note default-x="80"><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
          </measure>
          <measure number="2" width="200">
            <print new-system="yes"/>
            <note default-x="40"><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
            <direction placement="below"><direction-type><wedge type="stop" number="1"/></direction-type><staff>1</staff></direction>
            <note default-x="80"><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
            <direction placement="above"><direction-type><wedge type="stop" number="2"/></direction-type><staff>2</staff></direction>
            <note default-x="120"><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
          </measure>
        </part>
      </score-partwise>
    `, 'numbered-hairpins.musicxml')
    const groups = buildVisualRenderingInstructions(timingMap)
    const layout = buildSourceFidelityLaneLayout(groups)
    const structural = buildSourceFidelityStructuralMarks(timingMap, layout)
    const geometry = buildStaffGeometry({ hasTreble: true, hasBass: true })
    const rendered = buildStaffLaneWedgeMarks(structural, geometry, {
      sourceSystemGeometries: new Map(
        layout.systems.map((system) => [
          system.occurrence,
          buildSourceSystemStaffGeometry(geometry, system),
        ]),
      ),
    })

    expect(timingMap.wedgeEvents).toMatchObject([
      { type: 'crescendo', stage: 'start', number: '1', staff: 1, defaultY: -65 },
      { type: 'diminuendo', stage: 'start', number: '2', staff: 2, relativeX: 5 },
      { type: null, stage: 'stop', number: '1', staff: 1 },
      { type: null, stage: 'stop', number: '2', staff: 2 },
    ])
    expect(structural.wedges).toHaveLength(4)
    expect(structural.wedges.filter((wedge) => wedge.number === '1')).toHaveLength(2)
    expect(structural.wedges.filter((wedge) => wedge.number === '2')).toHaveLength(2)
    expect(structural.wedges.find(
      (wedge) => wedge.number === '1' && wedge.segmentIndex === 1,
    ).xEnd).toBeLessThan(structural.wedges.find(
      (wedge) => wedge.number === '2' && wedge.segmentIndex === 1,
    ).xEnd)
    expect(structural.wedges.filter((wedge) => wedge.number === '1')).toMatchObject([
      { apertureStart: 0, segmentIndex: 0, segmentCount: 2 },
      { apertureEnd: 1, segmentIndex: 1, segmentCount: 2 },
    ])
    expect(structural.wedges.filter((wedge) => wedge.number === '2')).toMatchObject([
      { apertureStart: 1, segmentIndex: 0, segmentCount: 2 },
      { apertureEnd: 0, segmentIndex: 1, segmentCount: 2 },
    ])
    expect(rendered).toHaveLength(4)
    expect(rendered.every((wedge) => wedge.sourceYMode === 'musicxml-default-y')).toBe(true)

    const fallback = buildSourceFidelityStructuralMarks(
      timingMap,
      { mode: 'temporal-fallback', pixelsPerSecond: 100 },
    )
    expect(fallback.wedges).toHaveLength(2)
    expect(fallback.wedges).toMatchObject([
      { number: '1', xStart: 0, xEnd: 250, sourceXModeStart: 'temporal-fallback' },
      { number: '2', xStart: 50, xEnd: 300, sourceXModeEnd: 'temporal-fallback' },
    ])
  })

  it('does not render a source-hidden hairpin', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1"><measure number="1">
          <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
          <direction><direction-type><wedge type="crescendo" number="1" print-object="no"/></direction-type></direction>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
          <direction><direction-type><wedge type="stop" number="1"/></direction-type></direction>
          <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
        </measure></part>
      </score-partwise>
    `)
    expect(timingMap.wedgeEvents).toMatchObject([
      { stage: 'start', printObject: false },
      { stage: 'stop', printObject: true },
    ])
    expect(buildSourceFidelityStructuralMarks(
      timingMap,
      { mode: 'temporal-fallback', pixelsPerSecond: 100 },
    ).wedges).toEqual([])
  })

  it('pairs numbered ottava brackets across source systems without changing pitch', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1">
          <measure number="1" width="200">
            <print new-system="yes"/>
            <attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
            <direction placement="above"><direction-type><octave-shift type="down" size="8" number="1" default-y="55"/></direction-type><staff>1</staff></direction>
            <note default-x="40"><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
            <direction placement="below"><direction-type><octave-shift type="up" size="15" number="2" default-y="-145"/></direction-type><staff>2</staff></direction>
            <note default-x="80"><pitch><step>D</step><octave>6</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
          </measure>
          <measure number="2" width="200">
            <print new-system="yes"/>
            <note default-x="40"><pitch><step>E</step><octave>6</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
            <direction placement="above"><direction-type><octave-shift type="stop" size="8" number="1"/></direction-type><staff>1</staff></direction>
            <note default-x="80"><pitch><step>F</step><octave>6</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
            <direction placement="below"><direction-type><octave-shift type="stop" size="15" number="2"/></direction-type><staff>2</staff></direction>
            <note default-x="120"><pitch><step>G</step><octave>6</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
          </measure>
        </part>
      </score-partwise>
    `, 'numbered-ottava.musicxml')
    const originalMidis = timingMap.notes.map((note) => note.midi)
    const groups = buildVisualRenderingInstructions(timingMap)
    const layout = buildSourceFidelityLaneLayout(groups)
    const structural = buildSourceFidelityStructuralMarks(timingMap, layout)
    const geometry = buildStaffGeometry({ hasTreble: true, hasBass: true })
    const rendered = buildStaffLaneOctaveShiftMarks(structural, geometry, {
      sourceSystemGeometries: new Map(
        layout.systems.map((system) => [
          system.occurrence,
          buildSourceSystemStaffGeometry(geometry, system),
        ]),
      ),
    })

    expect(timingMap.octaveShiftEvents).toMatchObject([
      { type: 'down', stage: 'start', number: '1', size: 8, staff: 1, defaultY: 55 },
      { type: 'up', stage: 'start', number: '2', size: 15, staff: 2, defaultY: -145 },
      { type: null, stage: 'stop', number: '1', size: 8, staff: 1 },
      { type: null, stage: 'stop', number: '2', size: 15, staff: 2 },
    ])
    expect(structural.octaveShifts).toHaveLength(4)
    expect(structural.octaveShifts.filter((shift) => shift.number === '1')).toHaveLength(2)
    expect(structural.octaveShifts.filter((shift) => shift.number === '2')).toHaveLength(2)
    expect(structural.octaveShifts.find(
      (shift) => shift.number === '1' && shift.segmentIndex === 1,
    ).xEnd).toBeLessThan(structural.octaveShifts.find(
      (shift) => shift.number === '2' && shift.segmentIndex === 1,
    ).xEnd)
    expect(rendered.filter((shift) => shift.showLabel).map((shift) => shift.label)).toEqual([
      '8va',
      '15mb',
    ])
    expect(rendered.every((shift) => shift.sourceYMode === 'musicxml-default-y')).toBe(true)
    expect(timingMap.notes.map((note) => note.midi)).toEqual(originalMidis)

    const fallback = buildSourceFidelityStructuralMarks(
      timingMap,
      { mode: 'temporal-fallback', pixelsPerSecond: 100 },
    )
    expect(fallback.octaveShifts).toMatchObject([
      { number: '1', xStart: 0, xEnd: 250, sourceXModeStart: 'temporal-fallback' },
      { number: '2', xStart: 50, xEnd: 300, sourceXModeEnd: 'temporal-fallback' },
    ])
  })

  it('does not render a source-hidden ottava bracket', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1"><measure number="1">
          <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
          <direction><direction-type><octave-shift type="down" size="8" number="1" print-object="no"/></direction-type></direction>
          <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note>
          <direction><direction-type><octave-shift type="stop" size="8" number="1"/></direction-type></direction>
          <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note>
        </measure></part>
      </score-partwise>
    `)
    expect(timingMap.octaveShiftEvents).toMatchObject([
      { stage: 'start', printObject: false },
      { stage: 'stop', printObject: true },
    ])
    expect(buildSourceFidelityStructuralMarks(
      timingMap,
      { mode: 'temporal-fallback', pixelsPerSecond: 100 },
    ).octaveShifts).toEqual([])
  })

  it('preserves positioned clef changes without duplicating system-start declarations', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1" width="200">
            <print new-system="yes"/>
            <attributes>
              <divisions>1</divisions><staves>2</staves>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <clef number="1"><sign>G</sign><line>2</line></clef>
              <clef number="2"><sign>F</sign><line>4</line></clef>
            </attributes>
            <note default-x="20"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
            <backup><duration>4</duration></backup>
            <note default-x="20"><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
            <attributes><clef number="2" default-x="100" relative-x="10"><sign>G</sign><line>2</line></clef></attributes>
            <note default-x="120"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
          </measure>
          <measure number="2" width="160">
            <print new-system="yes"/>
            <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
            <note default-x="20"><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
            <backup><duration>4</duration></backup>
            <note default-x="20"><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
          </measure>
        </part>
      </score-partwise>
    `)
    const groups = buildVisualRenderingInstructions(timingMap)
    const layout = buildSourceFidelityLaneLayout(groups)
    const marks = buildSourceFidelityStructuralMarks(timingMap, layout)
    const geometry = buildStaffGeometry(detectStaves(groups))
    const renderedNotes = buildStaffLaneNotes(groups, geometry, { sourceLayout: layout })

    expect(timingMap.clefEvents).toMatchObject([
      { staff: 1, sign: 'G', line: 2, quarterTime: 0, initial: true, changed: false },
      { staff: 2, sign: 'F', line: 4, quarterTime: 0, initial: true, changed: false },
      {
        staff: 2,
        sign: 'G',
        line: 2,
        quarterTime: 2,
        defaultX: 100,
        relativeX: 10,
        initial: false,
        changed: true,
      },
      { staff: 2, sign: 'F', line: 4, quarterTime: 4, initial: false, changed: true },
    ])
    expect(marks.clefs).toMatchObject([
      { staff: 2, sign: 'G', line: 2, x: 308, systemOccurrence: 0 },
    ])
    expect(marks.systemClefs).toMatchObject([
      { staff: 1, sign: 'G', line: 2, systemOccurrence: 0 },
      { staff: 2, sign: 'F', line: 4, systemOccurrence: 0 },
      { staff: 1, sign: 'G', line: 2, systemOccurrence: 1 },
      { staff: 2, sign: 'F', line: 4, systemOccurrence: 1 },
    ])
    const lowerNoteAfterChange = renderedNotes.find(
      (note) => note.staffKind === 'bass' && note.measureNumber === 1 && note.writtenPitch?.octave === 4,
    )
    const firstSystemGeometry = buildSourceSystemStaffGeometry(geometry, layout.systems[0])
    expect(lowerNoteAfterChange).toMatchObject({
      clef: { sign: 'G', line: 2 },
      sourceYMode: 'musicxml-clef',
    })
    expect(lowerNoteAfterChange.y).toBeCloseTo(
      firstSystemGeometry.staves.bass.lines[4] + STAFF_LINE_GAP,
      8,
    )
    const [lowerStaffSharp] = buildKeySignatureMarks(
      { fifths: 1 },
      firstSystemGeometry,
      { clefs: [{ staff: 2, sign: 'G', line: 2 }] },
    ).filter((mark) => mark.staffKind === 'bass')
    expect(lowerStaffSharp.y).toBeCloseTo(firstSystemGeometry.staves.bass.lines[0], 8)
  })

  it('keeps ordinary opening grand-staff clefs in prefixes with no inline duplicates', () => {
    const timingMap = {
      parts: [{ id: 'P1' }],
      measures: [{ number: 1, startQuarters: 0, endQuarters: 4, engravedWidth: 100 }],
      clefEvents: [
        { partId: 'P1', staff: 1, sign: 'G', line: 2, quarterTime: 0, initial: true, changed: false },
        { partId: 'P1', staff: 2, sign: 'F', line: 4, quarterTime: 0, initial: true, changed: false },
      ],
    }
    const layout = {
      mode: 'source-fidelity',
      systems: [{ occurrence: 0, systemIndex: 0, xStart: 0, xEnd: 100 }],
      measures: [{
        measureNumber: 1,
        repeatPass: 1,
        systemOccurrence: 0,
        xStart: 0,
        xEnd: 100,
        layout: timingMap.measures[0],
      }],
    }

    const marks = buildSourceFidelityStructuralMarks(timingMap, layout)
    expect(marks.clefs).toEqual([])
    expect(marks.systemClefs).toMatchObject([
      { staff: 1, sign: 'G', systemOccurrence: 0 },
      { staff: 2, sign: 'F', systemOccurrence: 0 },
    ])
  })

  it('does not back-propagate a later clef through an independent MusicXML voice', () => {
    const timingMap = parseMusicXml(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions><staves>2</staves>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <clef number="1"><sign>G</sign><line>2</line></clef>
              <clef number="2"><sign>F</sign><line>4</line></clef>
            </attributes>
            <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>2</staff></note>
            <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
            <backup><duration>4</duration></backup>
            <note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
          </measure>
        </part>
      </score-partwise>
    `)

    expect(timingMap.notes.filter((note) => note.staff === 2)).toMatchObject([
      { quarterTime: 0, clef: { sign: 'F', line: 4 } },
      { quarterTime: 0, clef: { sign: 'F', line: 4 } },
    ])
  })

  it('fails the comparison harness on source-ownership disagreement', () => {
    const timingMap = semanticTimingMap()
    const instructions = buildVisualRenderingInstructions(
      timingMap,
      sourceVisualMap({ wrongMidi: true }),
    )
    const comparison = compareVisualRenderingInstructions(timingMap, instructions)

    expect(comparison.passed).toBe(false)
    expect(comparison.mismatches).toContainEqual({ kind: 'source-provenance', index: 0 })
    const quarter = instructions[0].notes.find((note) => note.id === 'right-quarter')
    expect(quarter.sourceLayout.source).toBe('musicxml-layout')
  })

  it('preserves exact onsets, chords, voices, hands, rests, ties, and printed values', () => {
    const timingMap = semanticTimingMap()
    const instructions = buildVisualRenderingInstructions(timingMap, sourceVisualMap())
    const comparison = compareVisualRenderingInstructions(timingMap, instructions)

    expect(comparison).toMatchObject({
      passed: true,
      expectedEventCount: 6,
      actualEventCount: 6,
      mismatchCount: 0,
    })
    expect(instructions[0].expectedMidis).toEqual([48, 60, 63])
    expect(instructions[1]).toMatchObject({ timeSeconds: 0.08, expectedMidis: [62] })
    expect(instructions.filter((event) => event.isRest)).toHaveLength(2)
    expect(instructions.flatMap((event) => event.notes).map((note) => note.voice))
      .toEqual(expect.arrayContaining([1, 2]))

    const right = buildVisualRenderingInstructions(timingMap, null, {
      practiceScope: PRACTICE_SCOPE.RIGHT_HAND,
    })
    const left = buildVisualRenderingInstructions(timingMap, null, {
      practiceScope: PRACTICE_SCOPE.LEFT_HAND,
    })
    expect(right.flatMap((event) => event.notes).some((note) => note.staff === 2)).toBe(false)
    expect(right.flatMap((event) => event.rests).some((rest) => rest.staff === 2)).toBe(false)
    expect(left.flatMap((event) => event.notes).every((note) => note.staff === 2)).toBe(true)
  })

  it('emits engraving instructions for noteheads, stems, beams, dots, rests, and ties', () => {
    const instructions = buildVisualRenderingInstructions(semanticTimingMap())
      .map((group) => ({ ...group, status: 'upcoming' }))
    const geometryModel = buildStaffGeometry(detectStaves(instructions))
    const notes = buildStaffLaneNotes(instructions, geometryModel)
    const stems = buildStaffLaneStems(instructions, geometryModel, { notes })
    const rhythm = buildStaffLaneRhythmMarks(notes, stems)
    const rests = buildStaffLaneRests(instructions, geometryModel)
    const markings = buildStaffLaneNotationMarkings(instructions, geometryModel, { notes })

    const quarter = notes.find((note) => note.noteType === 'quarter')
    const half = notes.find((note) => note.noteType === 'half')
    const whole = notes.find((note) => note.noteType === 'whole')
    expect(quarter).toMatchObject({ hollow: false, stemless: false, accidentalType: 'natural' })
    expect(half).toMatchObject({ hollow: true, stemless: false, accidentalType: 'flat' })
    expect(whole).toMatchObject({ hollow: true, stemless: true })
    expect(stems.some((stem) => stem.groupId === whole.groupId && stem.staffKind === whole.staffKind))
      .toBe(false)
    expect(rhythm.flags.length).toBeGreaterThan(0)
    expect(rhythm.beams).toHaveLength(1)
    expect(rhythm.dots).toHaveLength(1)
    expect(rests.map((rest) => rest.noteType)).toEqual(['quarter', 'half'])
    expect(rests.every((rest) => rest.glyph.length > 0)).toBe(true)
    expect(markings.spanMarkings.some((marking) => marking.kind === 'tie')).toBe(true)
  })

  it('passes representative permanent piano and guitar/TAB fixtures', () => {
    const fixturePaths = [
      'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml',
      'benchmarks/omr-fixtures/guitar-tab-sparse-vector/guitar-tab-sparse-vector.musicxml',
    ]
    const results = fixturePaths.map((relativePath) => {
      const timingMap = parseMusicXml(readFileSync(join(root, relativePath), 'utf8'), relativePath)
      const instructions = buildVisualRenderingInstructions(timingMap)
      return { timingMap, instructions, comparison: compareVisualRenderingInstructions(timingMap, instructions) }
    })

    expect(results.every((result) => result.comparison.passed)).toBe(true)
    expect(results[0].instructions.some((event) => event.isChord)).toBe(true)
    expect(new Set(results[0].instructions.flatMap((event) => event.notes).map((note) => note.voice)))
      .toEqual(new Set([1, 2]))
    expect(results[1].instructions.flatMap((event) => event.notes).some(
      (note) => note.string != null && note.fret != null,
    )).toBe(true)
    expect(results[1].instructions.some((event) => event.repeatPass === 2)).toBe(true)
  })

  it('keeps repeat passes and loop/seek cursor motion absolute and deterministic', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const instructions = buildVisualRenderingInstructions(timingMap)
    expect(compareVisualRenderingInstructions(timingMap, instructions).passed).toBe(true)
    expect(instructions.some((event) => event.repeatPass === 2)).toBe(true)

    const loopRegion = { isValid: true, startTimeSeconds: 4, endTimeSeconds: 6 }
    const loopInstructions = buildVisualRenderingInstructions(timingMap, null, { loopRegion })
    expect(loopInstructions.every(
      (event) => event.timeSeconds >= 4 && event.timeSeconds < 6,
    )).toBe(true)
    expect(compareVisualRenderingInstructions(timingMap, loopInstructions, { loopRegion }).passed)
      .toBe(true)

    const atSeek = resolveVisualLaneTransform({ frameTime: 5, viewWidth: 1000, durationSeconds: 8 })
    const afterLoopWrap = resolveVisualLaneTransform({ frameTime: 1, viewWidth: 1000, durationSeconds: 8 })
    expect(resolveVisualLaneTransform({ frameTime: 5, viewWidth: 1000, durationSeconds: 8 }))
      .toEqual(atSeek)
    expect(afterLoopWrap.scrollX).not.toBe(atSeek.scrollX)
  })

  it('reuses the score-follow bar style and leaves Play Along source boxes disabled', () => {
    const scoreOverlay = readSource('components', 'pdf', 'ScoreFollowOverlay.jsx')
    const staffLane = readSource('components', 'practice', 'StaffVisualLane.jsx')
    const tabLane = readSource('components', 'practice', 'TabVisualLane.jsx')
    const context = readSource('context', 'PracticeSessionContext.jsx')
    const session = readSource('features', 'practice', 'usePracticeSession.js')

    expect(scoreOverlay).toContain('score-follow-bar__line')
    expect(staffLane).toContain('score-follow-bar__line')
    expect(tabLane).toContain('score-follow-bar__line')
    expect(readSource('components', 'practice', 'VisualPracticeView.jsx')).toContain('getScoreTime')
    expect(context).toContain('playAlongNoteTarget: null')
    expect(context).toContain('showOnPage: false')
    expect(context).toContain('mode: \'wait-for-you\'')
    expect(session).toContain('seekToPracticeTimeWithWfy(seconds, { sync: false })')
  })
})
