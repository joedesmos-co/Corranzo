import { describe, expect, it } from 'vitest'
import {
  assignVectorNotationArticulations,
  VECTOR_NOTATION_ARTICULATION_GLYPHS,
} from '../src/features/omr/detectVectorNotationArticulations.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotationMarkings,
  buildStaffLaneNotes,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
import { VISUAL_MARKING_KIND } from '../src/features/practice/visualNotationMarkings.js'
import { normalizeNoncanonicalArticulationGlyphs } from '../src/features/omr/normalizeNoncanonicalArticulationGlyphs.js'

const measureBox = {
  measureNumber: 1,
  x0: 0.1,
  playableX0: 0.2,
  x1: 0.8,
  y0: 0.08,
  y1: 0.42,
  staffLines: {
    treble: [0.1, 0.12, 0.14, 0.16, 0.18],
    bass: [0.3, 0.32, 0.34, 0.36, 0.38],
    splitY: 0.24,
  },
}
const imageData = { width: 1000, height: 1000 }

function note(cx, cy, midi) {
  return { cx, cy, midi, naturalMidi: midi, clef: 'treble' }
}

function articulationScore(articulations) {
  return buildOmrMusicXml({
    includeDisclaimer: false,
    measures: [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            durationType: 'quarter',
            notes: [
              {
                midi: 60,
                naturalMidi: 60,
                clef: 'treble',
                notationArticulations: articulations,
              },
            ],
          },
        ],
      },
    ],
  })
}

describe('Notation Fidelity Sprint 5 — authoritative articulation semantics', () => {
  it('normalizes only a conservative repeated noncanonical articulation font profile', () => {
    const pageText = [
      ...Array.from({ length: 12 }, (_, index) => ({
        text: '\ue0a4',
        x: index * 12,
        y: 100,
        width: 10.5,
        height: 15,
        fontName: 'embedded-music',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        text: '\ue4a0',
        x: index * 20,
        y: 70,
        width: 6.3,
        height: 9,
        fontName: 'embedded-music',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        text: '\ue4a3',
        x: index * 20 + 10,
        y: 70,
        width: 6.3,
        height: 9,
        fontName: 'embedded-music',
      })),
    ]
    const normalized = normalizeNoncanonicalArticulationGlyphs(pageText)
    expect(normalized.applied).toBe(true)
    expect(normalized.diagnostics.mappedGlyphCount).toBe(4)
    expect(normalized.items.filter((item) => item.text === '\ue4a2')).toHaveLength(2)
    expect(normalized.items.filter((item) => item.text === '\ue4a0')).toHaveLength(2)
  })

  it('leaves canonical SMuFL articulation metrics untouched', () => {
    const pageText = [
      ...Array.from({ length: 12 }, (_, index) => ({
        text: '\ue0a4',
        x: index * 12,
        y: 100,
        width: 6.4,
        height: 20,
        fontName: 'smufl',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        text: '\ue4a0',
        x: index * 20,
        y: 70,
        width: 7.1,
        height: 20,
        fontName: 'smufl',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        text: '\ue4a3',
        x: index * 20 + 10,
        y: 70,
        width: 1.5,
        height: 20,
        fontName: 'smufl',
      })),
    ]
    const normalized = normalizeNoncanonicalArticulationGlyphs(pageText)
    expect(normalized.applied).toBe(false)
    expect(normalized.items).toBe(pageText)
  })

  it('normalizes a repeated broad legacy accent without requiring a paired staccato', () => {
    const pageText = [
      ...Array.from({ length: 12 }, (_, index) => ({
        text: '\ue0a4',
        x: index * 12,
        y: 100,
        width: 10.5,
        height: 15,
        fontName: 'embedded-music',
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        text: '\ue4a3',
        x: index * 20,
        y: 70,
        width: 6.3,
        height: 9,
        fontName: 'embedded-music',
      })),
    ]
    const normalized = normalizeNoncanonicalArticulationGlyphs(pageText)
    expect(normalized.applied).toBe(true)
    expect(normalized.items.filter((item) => item.text === '\ue4a0')).toHaveLength(4)
  })

  it('uses the SMuFL tenuto, marcato, and fermata codepoints', () => {
    expect(VECTOR_NOTATION_ARTICULATION_GLYPHS.get('\ue4a4')).toEqual({
      type: 'tenuto',
      placement: 'above',
    })
    expect(VECTOR_NOTATION_ARTICULATION_GLYPHS.get('\ue4ac')).toEqual({
      type: 'marcato',
      placement: 'above',
    })
    expect(VECTOR_NOTATION_ARTICULATION_GLYPHS.get('\ue4c1')).toEqual({
      type: 'fermata',
      placement: 'below',
    })
    expect(VECTOR_NOTATION_ARTICULATION_GLYPHS.has('\ue4e5')).toBe(false)
  })

  it('attaches marks by placement and chord column without crossing staves', () => {
    const notes = [
      note(300, 170, 67),
      note(300, 184, 64),
      note(300, 198, 60),
      { ...note(300, 340, 43), clef: 'bass' },
    ]
    const result = assignVectorNotationArticulations(
      [
        { text: '\ue4a4', x: 300, y: 140, width: 12 },
        { text: '\ue4ad', x: 300, y: 220, width: 12 },
      ],
      notes,
      measureBox,
      imageData,
    )

    expect(result.detectedByType).toMatchObject({ tenuto: 1, marcato: 1 })
    expect(result.appliedByType).toMatchObject({ tenuto: 3, marcato: 3 })
    expect(result.assignments.get(3)).toBeUndefined()
    expect(result.assignments.get(0)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tenuto', placement: 'above' }),
        expect.objectContaining({ type: 'marcato', placement: 'below' }),
      ]),
    )
  })

  it('rejects long staff-line fragments instead of emitting tenuto', () => {
    const result = assignVectorNotationArticulations(
      [{ text: '\ue4a4', x: 300, y: 140, width: 80 }],
      [note(300, 170, 60)],
      measureBox,
      imageData,
    )
    expect(result.detectedByType.tenuto).toBe(1)
    expect(result.appliedByType.tenuto).toBe(0)
    expect(result.rejectedCandidates).toHaveLength(1)
  })

  it('emits and parses placement-preserving tenuto, marcato, and fermata', () => {
    const xml = articulationScore([
      { type: 'tenuto', placement: 'above' },
      { type: 'marcato', placement: 'below' },
      { type: 'fermata', placement: 'above' },
    ])
    expect(xml).toContain('<tenuto placement="above"/>')
    expect(xml).toContain(
      '<strong-accent type="down" placement="below"/>',
    )
    expect(xml).toContain(
      '<fermata type="upright" placement="above"/>',
    )

    const parsed = parseMusicXml(xml, 'sprint5.musicxml').notes[0]
    expect(parsed).toMatchObject({
      midi: 60,
      durationQuarters: 1,
      tenuto: true,
      marcato: true,
      fermata: true,
      articulationPlacements: {
        tenuto: 'above',
        marcato: 'below',
        fermata: 'above',
      },
    })
  })

  it('renders marcato/fermata and centers one chord-level mark', () => {
    const xml = `<?xml version="1.0"?>
      <score-partwise version="3.1">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1"><measure number="1">
          <attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><notations><articulations><strong-accent type="up" placement="above"/></articulations><fermata type="upright" placement="above"/></notations></note>
          <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><notations><articulations><strong-accent type="up" placement="above"/></articulations><fermata type="upright" placement="above"/></notations></note>
          <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><notations><articulations><strong-accent type="up" placement="above"/></articulations><fermata type="upright" placement="above"/></notations></note>
        </measure></part>
      </score-partwise>`
    const groups = buildVisualLaneGroups(parseMusicXml(xml)).map((group) => ({
      ...group,
      status: 'upcoming',
    }))
    const geometry = buildStaffGeometry(detectStaves(groups))
    const notes = buildStaffLaneNotes(groups, geometry)
    const { noteMarkings } = buildStaffLaneNotationMarkings(groups, geometry, {
      notes,
    })
    expect(
      noteMarkings.filter(
        (marking) => marking.kind === VISUAL_MARKING_KIND.MARCATO,
      ),
    ).toHaveLength(1)
    expect(
      noteMarkings.filter(
        (marking) => marking.kind === VISUAL_MARKING_KIND.FERMATA,
      ),
    ).toHaveLength(1)
    expect(
      noteMarkings.find(
        (marking) => marking.kind === VISUAL_MARKING_KIND.FERMATA,
      )?.text,
    ).toBe('𝄐')
  })
})
