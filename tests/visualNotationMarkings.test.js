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
  buildStaffLaneNotationMarkings,
  buildStaffLaneNotes,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
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
