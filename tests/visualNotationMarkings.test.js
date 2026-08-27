import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getInstrument } from '../src/features/instruments/instruments.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  VISUAL_MARKING_KIND,
  buildVisualSpanMarkings,
} from '../src/features/practice/visualNotationMarkings.js'
import {
  buildStaffGeometry,
  buildStaffLaneGraceNotes,
  buildStaffLaneNotationMarkings,
  buildStaffLaneNotes,
  buildStaffLaneStems,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
import { buildSourceFidelityLaneLayout } from '../src/features/practice/sourceFidelityLayout.js'
import { buildVisualRenderingInstructions } from '../src/features/practice/visualRenderingInstructions.js'
import {
  buildTabGeometry,
  buildTabLaneNotes,
  buildTabLaneTechniqueMarkings,
} from '../src/features/practice/tabLaneLayout.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import * as F from './helpers/buildXml.js'

function markedNote(step, octave, notations = '') {
  return (
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>1</duration><voice>1</voice><type>quarter</type>${notations}</note>`
  )
}

function tieNotations(type) {
  return `<tie type="${type}"/><notations><tied type="${type}"/></notations>`
}

function staffMarkingScore() {
  const xml =
    `<measure number="1">${F.attributes({ beats: 5 })}${F.soundTempo(120)}` +
    markedNote('C', 4, tieNotations('start')) +
    markedNote('C', 4, tieNotations('stop')) +
    markedNote(
      'D',
      4,
      '<notations><slur type="start" number="1"/><articulations><staccato/></articulations></notations>',
    ) +
    markedNote(
      'E',
      4,
      '<notations><slur type="stop" number="1"/><articulations><accent/></articulations></notations>',
    ) +
    markedNote('F', 4, '<notations><articulations><tenuto/></articulations></notations>') +
    '</measure>'
  return F.scoreWrap(`<part id="P1">${xml}</part>`)
}

function tabNote(step, octave, string, fret, extraNotation = '') {
  return (
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    '<duration>1</duration><voice>1</voice><type>quarter</type>' +
    `<notations><technical><string>${string}</string><fret>${fret}</fret>${extraNotation}</technical></notations>` +
    '</note>'
  )
}

function slideTabNote(step, octave, string, fret, type) {
  return (
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    '<duration>1</duration><voice>1</voice><type>quarter</type>' +
    `<notations><technical><string>${string}</string><fret>${fret}</fret></technical><slide type="${type}" number="1"/></notations>` +
    '</note>'
  )
}

function guitarTechniqueScore() {
  const attributes =
    '<attributes><divisions>1</divisions><time><beats>8</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>TAB</sign><line>5</line></clef></attributes>'
  const xml =
    `<measure number="1">${attributes}${F.soundTempo(120)}` +
    tabNote('E', 4, 1, 0, '<hammer-on type="start" number="1">H</hammer-on>') +
    tabNote('F', 4, 1, 1, '<hammer-on type="stop" number="1">H</hammer-on>') +
    tabNote('G', 4, 1, 3, '<pull-off type="start" number="1">P</pull-off>') +
    tabNote('F', 4, 1, 1, '<pull-off type="stop" number="1">P</pull-off>') +
    slideTabNote('A', 3, 3, 2, 'start') +
    slideTabNote('B', 3, 2, 0, 'stop') +
    tabNote('C', 4, 2, 1, '<bend><bend-alter>1</bend-alter></bend>') +
    tabNote('D', 4, 2, 3, '<other-technical>vibrato</other-technical>') +
    '</measure>'
  const partList = '<part-list><score-part id="P1"><part-name>Guitar TAB</part-name></score-part></part-list>'
  return F.scoreWrap(`<part id="P1">${xml}</part>`, partList)
}

describe('visual notation marking model', () => {
  it('normalizes ties, slurs, staccato, accent, and tenuto in visual groups', () => {
    const timingMap = parseMusicXml(staffMarkingScore(), 'staff-markings.musicxml')
    const groups = buildVisualLaneGroups(timingMap)
    const checkpoints = buildNoteCheckpoints(timingMap)
    const spans = buildVisualSpanMarkings(groups)
    const noteKinds = groups.flatMap((group) =>
      group.notes.flatMap((note) => note.markings.map((marking) => marking.kind)),
    )

    expect(groups.map((group) => group.id)).toEqual(checkpoints.map((checkpoint) => checkpoint.id))
    expect(checkpoints).toHaveLength(4)
    expect(spans.map((span) => span.kind)).toEqual(
      expect.arrayContaining([VISUAL_MARKING_KIND.TIE, VISUAL_MARKING_KIND.SLUR]),
    )
    expect(noteKinds).toEqual(
      expect.arrayContaining([
        VISUAL_MARKING_KIND.STACCATO,
        VISUAL_MARKING_KIND.ACCENT,
        VISUAL_MARKING_KIND.TENUTO,
      ]),
    )
  })

  it('builds staff rendering geometry for tie/slur arcs and articulation marks', () => {
    const groups = buildVisualLaneGroups(parseMusicXml(staffMarkingScore())).map((group) => ({
      ...group,
      status: 'upcoming',
    }))
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry, { pixelsPerSecond: 120 })
    const { noteMarkings, spanMarkings } = buildStaffLaneNotationMarkings(groups, geometry, {
      pixelsPerSecond: 120,
      notes,
    })

    expect(spanMarkings.find((marking) => marking.kind === VISUAL_MARKING_KIND.TIE)?.path)
      .toMatch(/^M .* Q /)
    expect(spanMarkings.find((marking) => marking.kind === VISUAL_MARKING_KIND.SLUR)?.path)
      .toMatch(/^M .* Q /)
    expect(noteMarkings.find((marking) => marking.kind === VISUAL_MARKING_KIND.STACCATO)?.shape)
      .toBe('dot')
    expect(noteMarkings.find((marking) => marking.kind === VISUAL_MARKING_KIND.ACCENT)?.text)
      .toBe('>')
    expect(noteMarkings.find((marking) => marking.kind === VISUAL_MARKING_KIND.TENUTO)?.shape)
      .toBe('line')
  })

  it('renders staccatissimo as a wedge without collapsing it into staccato', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes({ beats: 2 })}` +
      markedNote(
        'C',
        4,
        '<notations><articulations><staccatissimo placement="below"/></articulations></notations>',
      ) +
      markedNote(
        'D',
        4,
        '<notations><articulations><staccato placement="above"/></articulations></notations>',
      ) +
      '</measure></part>',
    )
    const groups = buildVisualLaneGroups(parseMusicXml(xml, 'staccatissimo.musicxml'))
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const { noteMarkings } = buildStaffLaneNotationMarkings(groups, geometry, { notes })
    const staccatissimo = noteMarkings.find(
      (marking) => marking.kind === VISUAL_MARKING_KIND.STACCATISSIMO,
    )
    const staccato = noteMarkings.find(
      (marking) => marking.kind === VISUAL_MARKING_KIND.STACCATO,
    )

    expect(staccatissimo).toMatchObject({ shape: 'text', text: '▾', placement: 'below' })
    expect(staccato).toMatchObject({ shape: 'dot', placement: 'above' })
  })

  it('infers omitted articulation placement from the written stem direction', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes({ beats: 2 })}` +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>up</stem><notations><articulations><staccato/><accent/></articulations></notations></note>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>down</stem><notations><articulations><staccato/></articulations></notations></note>' +
      '</measure></part>',
    )
    const groups = buildVisualLaneGroups(parseMusicXml(xml, 'articulation-placement.musicxml'))
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const { noteMarkings } = buildStaffLaneNotationMarkings(groups, geometry, { notes })
    const staccatos = noteMarkings.filter((marking) => marking.kind === VISUAL_MARKING_KIND.STACCATO)
    const accent = noteMarkings.find((marking) => marking.kind === VISUAL_MARKING_KIND.ACCENT)

    expect(staccatos.map((marking) => marking.placement)).toEqual(['below', 'above'])
    expect(accent).toMatchObject({ placement: 'below' })
  })

  it('anchors a printed trill to its owned note without treating two-note tremolo as a trill', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes({ beats: 3 })}` +
      markedNote(
        'B',
        4,
        '<notations><ornaments><trill-mark/></ornaments></notations>',
      ) +
      markedNote(
        'C',
        5,
        '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations>',
      ) +
      markedNote(
        'D',
        5,
        '<notations><ornaments><trill-mark print-object="no"/></ornaments></notations>',
      ) +
      '</measure></part>',
    )
    const timingMap = parseMusicXml(xml, 'trill.musicxml')
    expect(timingMap.notes).toMatchObject([
      { trill: { placement: null, printObject: true } },
      { tremolo: { type: 'start', marks: 3 } },
      { trill: { printObject: false } },
    ])
    const groups = buildVisualLaneGroups(timingMap)
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const { noteMarkings } = buildStaffLaneNotationMarkings(groups, geometry, { notes })
    const trills = noteMarkings.filter(
      (marking) => marking.kind === VISUAL_MARKING_KIND.TRILL,
    )

    expect(trills).toHaveLength(1)
    expect(trills[0]).toMatchObject({ shape: 'text', text: 'tr', placement: 'above' })
    expect(trills[0].x).toBe(notes[0].x)
    expect(trills[0].y).toBeLessThan(geometry.staves.treble.lines[0])
  })

  it('pairs two-note tremolo into its written stroke count without changing note attacks', () => {
    const tremolo = (step, octave, type, marks = 3, printObject = null) => markedNote(
      step,
      octave,
      `<notations><ornaments><tremolo type="${type}"${
        printObject ? ` print-object="${printObject}"` : ''
      }>${marks}</tremolo></ornaments></notations>`,
    )
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes({ beats: 5 })}` +
      tremolo('B', 5, 'start') +
      tremolo('C', 6, 'stop') +
      tremolo('D', 6, 'single', 2) +
      tremolo('E', 6, 'start', 3, 'no') +
      tremolo('F', 6, 'stop') +
      '</measure></part>',
    )
    const timingMap = parseMusicXml(xml, 'two-note-tremolo.musicxml')
    const groups = buildVisualLaneGroups(timingMap)
    const tremoloSpans = buildVisualSpanMarkings(groups).filter(
      (marking) => marking.kind === VISUAL_MARKING_KIND.TREMOLO,
    )
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const stems = buildStaffLaneStems(groups, geometry, { notes })
    const { tremoloMarkings } = buildStaffLaneNotationMarkings(groups, geometry, {
      notes,
      stems,
    })

    expect(timingMap.notes.map((note) => note.quarterTime)).toEqual([0, 1, 2, 3, 4])
    expect(tremoloSpans).toHaveLength(1)
    expect(tremoloSpans[0]).toMatchObject({ marks: 3, fromMidi: 83, toMidi: 84 })
    expect(tremoloMarkings).toHaveLength(3)
    expect(new Set(tremoloMarkings.map((marking) => marking.spanId)).size).toBe(1)
    expect(tremoloMarkings.map((marking) => marking.strokeIndex)).toEqual([0, 1, 2])
    expect(tremoloMarkings.every((marking) => marking.x2 > marking.x1)).toBe(true)
  })

  it('renders only source-visible tuplet numbers without changing their timing ratio', () => {
    const tupletNote = (step, type, attributes = '') => markedNote(
      step,
      5,
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      `<notations><tuplet type="${type}" ${attributes}/></notations>`,
    )
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes({ beats: 6 })}` +
      tupletNote('C', 'start', 'bracket="no"') +
      tupletNote('D', 'stop') +
      tupletNote('E', 'start', 'bracket="no" show-number="none"') +
      tupletNote('F', 'stop') +
      tupletNote('G', 'start', 'bracket="yes" show-number="both" placement="above"') +
      tupletNote('A', 'stop') +
      '</measure></part>',
    )
    const timingMap = parseMusicXml(xml, 'visible-tuplets.musicxml')
    const groups = buildVisualLaneGroups(timingMap)
    const spans = buildVisualSpanMarkings(groups).filter(
      (marking) => marking.kind === VISUAL_MARKING_KIND.TUPLET,
    )
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const stems = buildStaffLaneStems(groups, geometry, { notes })
    const { tupletMarkings } = buildStaffLaneNotationMarkings(groups, geometry, {
      notes,
      stems,
    })

    expect(timingMap.notes.map((note) => note.quarterTime)).toEqual([0, 1, 2, 3, 4, 5])
    expect(timingMap.notes.every((note) => note.timeModification?.actualNotes === 3)).toBe(true)
    expect(spans).toHaveLength(2)
    expect(tupletMarkings.map((marking) => marking.label)).toEqual(['3', '3:2'])
    expect(tupletMarkings[0]).toMatchObject({ renderNumber: true, renderBracket: false })
    expect(tupletMarkings[1]).toMatchObject({
      renderNumber: true,
      renderBracket: true,
      placement: 'above',
    })
    expect(tupletMarkings[1].bracketPath).toMatch(/^M .* L /)
  })

  it('renders source grace groups without adding playback or Wait For You attacks', () => {
    const graceNote = ({
      step,
      defaultX,
      defaultY,
      beam = '',
      notations = '',
      accidental = '',
      printObject = '',
    }) =>
      `<note default-x="${defaultX}" default-y="${defaultY}"${
        printObject ? ` print-object="${printObject}"` : ''
      }><grace slash="yes"/><pitch><step>${step}</step><octave>5</octave></pitch>` +
      '<voice>1</voice><type>16th</type><stem>up</stem>' +
      `${accidental ? `<accidental>${accidental}</accidental>` : ''}${beam}${notations}</note>`
    const principal = (step, defaultX, notations = '') =>
      `<note default-x="${defaultX}" default-y="0"><pitch><step>${step}</step><octave>5</octave></pitch>` +
      `<duration>1</duration><voice>1</voice><type>quarter</type>${notations}</note>`
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1" width="100">${F.attributes({ beats: 2 })}` +
      graceNote({
        step: 'F',
        defaultX: 10,
        defaultY: 20,
        accidental: 'double-sharp',
        beam: '<beam number="1">begin</beam><beam number="2">begin</beam>',
        notations: '<notations><slur type="start" number="1" placement="above"/></notations>',
      }) +
      graceNote({
        step: 'G',
        defaultX: 18,
        defaultY: 15,
        beam: '<beam number="1">end</beam><beam number="2">end</beam>',
      }) +
      principal('C', 35, '<notations><slur type="stop" number="1"/></notations>') +
      graceNote({
        step: 'E',
        defaultX: 55,
        defaultY: 10,
        printObject: 'no',
      }) +
      principal('D', 70) +
      '</measure></part>',
    )
    const timingMap = parseMusicXml(xml, 'visual-grace.musicxml')
    const checkpoints = buildNoteCheckpoints(timingMap)
    const groups = buildVisualRenderingInstructions(timingMap).map((group) => ({
      ...group,
      status: 'upcoming',
    }))
    const sourceLayout = buildSourceFidelityLaneLayout(groups)
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry, { sourceLayout })
    const grace = buildStaffLaneGraceNotes(notes, geometry, { sourceLayout })

    expect(timingMap.noteCount).toBe(2)
    expect(timingMap.notes.map((note) => note.quarterTime)).toEqual([0, 1])
    expect(timingMap.timingEvents.filter((event) => event.type === 'note-on')).toHaveLength(2)
    expect(checkpoints.map((checkpoint) => checkpoint.expectedMidis)).toEqual([[72], [74]])
    expect(timingMap.notes[0].graceNotesBefore).toHaveLength(2)
    expect(timingMap.notes[1].graceNotesBefore).toHaveLength(1)
    expect(grace.notes).toHaveLength(2)
    expect(grace.notes.every((note) => note.sourceXMode === 'musicxml-layout')).toBe(true)
    expect(grace.notes[0].accidentalGlyph).toBe('𝄪')
    expect(grace.notes[1].x).toBeLessThan(notes[0].x)
    expect(grace.beams.map((beam) => beam.number)).toEqual([1, 2])
    expect(grace.slurs).toHaveLength(1)
    expect(grace.slurs[0].path).toMatch(/^M .* Q /)
  })

  it('renders guitar hammer-on, pull-off, slide, bend, and vibrato markings in TAB geometry', () => {
    const guitar = getInstrument('guitar')
    const groups = buildVisualLaneGroups(parseMusicXml(guitarTechniqueScore())).map((group) => ({
      ...group,
      status: 'upcoming',
    }))
    const geometry = buildTabGeometry(guitar.strings)
    const notes = buildTabLaneNotes(groups, geometry, { pixelsPerSecond: 120 })
    const markings = buildTabLaneTechniqueMarkings(groups, geometry, {
      pixelsPerSecond: 120,
      notes,
    })
    const texts = markings.map((marking) => marking.text)

    expect(texts).toEqual(expect.arrayContaining(['h', 'p', '/', 'b', '~']))
    expect(markings.find((marking) => marking.kind === VISUAL_MARKING_KIND.SLIDE)?.render)
      .toBe('line')
    expect(markings.find((marking) => marking.kind === VISUAL_MARKING_KIND.HAMMER_ON)?.render)
      .toBe('arc')
    expect(markings.find((marking) => marking.kind === VISUAL_MARKING_KIND.PULL_OFF)?.render)
      .toBe('arc')
  })
})
