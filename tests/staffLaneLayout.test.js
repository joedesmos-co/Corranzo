/**
 * Staff-lane layout tests: pitch → staff position mapping, ledger lines,
 * one-staff vs grand-staff geometry, and deterministic x-from-time.
 */
import { describe, expect, it } from 'vitest'
import {
  HOLLOW_NOTE_MIN_SECONDS,
  NOTEHEAD_RX,
  STAFF_KIND,
  STAFF_LINE_GAP,
  STEMLESS_MIN_SECONDS,
  STEM_LENGTH_GAPS,
  buildStaffGeometry,
  buildStaffLaneNotes,
  buildStaffLaneStems,
  detectStaves,
  midiToDiatonic,
  resolveStaffKind,
  staffYForNote,
} from '../src/features/practice/staffLaneLayout.js'

const HALF = STAFF_LINE_GAP / 2

describe('midiToDiatonic', () => {
  it('maps naturals and sharps to letter steps', () => {
    expect(midiToDiatonic(60)).toEqual({ diatonic: 28, sharp: false }) // C4
    expect(midiToDiatonic(61)).toEqual({ diatonic: 28, sharp: true }) // C#4 shares C's step
    expect(midiToDiatonic(59)).toEqual({ diatonic: 27, sharp: false }) // B3
    expect(midiToDiatonic(64)).toEqual({ diatonic: 30, sharp: false }) // E4
    expect(midiToDiatonic(77)).toEqual({ diatonic: 38, sharp: false }) // F5
    expect(midiToDiatonic(21)).toEqual({ diatonic: 5, sharp: false }) // A0
  })
})

describe('staff assignment', () => {
  it('honors explicit MusicXML staff numbers over pitch', () => {
    expect(resolveStaffKind({ midi: 72, staff: 2 })).toBe(STAFF_KIND.BASS)
    expect(resolveStaffKind({ midi: 40, staff: 1 })).toBe(STAFF_KIND.TREBLE)
  })

  it('falls back to a middle-C split when staff is untagged', () => {
    expect(resolveStaffKind({ midi: 60, staff: null })).toBe(STAFF_KIND.TREBLE)
    expect(resolveStaffKind({ midi: 59, staff: null })).toBe(STAFF_KIND.BASS)
  })

  it('detects single-staff vs grand-staff pieces', () => {
    const trebleOnly = [{ notes: [{ midi: 60 }, { midi: 72 }] }]
    const mixed = [{ notes: [{ midi: 60 }] }, { notes: [{ midi: 48 }] }]
    expect(detectStaves(trebleOnly)).toEqual({ hasTreble: true, hasBass: false, grandStaff: false })
    expect(detectStaves(mixed).grandStaff).toBe(true)
    expect(detectStaves([]).hasTreble).toBe(true) // empty default
  })
})

describe('staff geometry', () => {
  it('renders 5 lines for a single staff and 10 for a grand staff', () => {
    const single = buildStaffGeometry({ hasTreble: true, hasBass: false })
    expect(single.lines.length).toBe(5)
    expect(single.staves[STAFF_KIND.TREBLE]).toBeTruthy()
    expect(single.staves[STAFF_KIND.BASS]).toBeUndefined()
    expect(single.grandStaff).toBe(false)

    const grand = buildStaffGeometry({ hasTreble: true, hasBass: true })
    expect(grand.lines.length).toBe(10)
    expect(grand.grandStaff).toBe(true)
    const treble = grand.staves[STAFF_KIND.TREBLE]
    const bass = grand.staves[STAFF_KIND.BASS]
    expect(bass.lines[0]).toBeGreaterThan(treble.lines[4]) // bass sits below treble
    expect(grand.height).toBeGreaterThan(bass.lines[4])
  })
})

describe('staffYForNote', () => {
  const geometry = buildStaffGeometry({ hasTreble: true, hasBass: true })
  const treble = geometry.staves[STAFF_KIND.TREBLE]
  const bass = geometry.staves[STAFF_KIND.BASS]

  it('places staff-line pitches on their lines', () => {
    expect(staffYForNote(64, STAFF_KIND.TREBLE, geometry).y).toBe(treble.lines[4]) // E4 bottom line
    expect(staffYForNote(77, STAFF_KIND.TREBLE, geometry).y).toBe(treble.lines[0]) // F5 top line
    expect(staffYForNote(71, STAFF_KIND.TREBLE, geometry).y).toBe(treble.lines[2]) // B4 middle line
    expect(staffYForNote(43, STAFF_KIND.BASS, geometry).y).toBe(bass.lines[4]) // G2 bottom line
    expect(staffYForNote(57, STAFF_KIND.BASS, geometry).y).toBe(bass.lines[0]) // A3 top line
  })

  it('places spaces between lines', () => {
    const f4 = staffYForNote(65, STAFF_KIND.TREBLE, geometry).y // F4: bottom space
    expect(f4).toBe(treble.lines[4] - HALF)
  })

  it('gives middle C one ledger line on either staff', () => {
    const onTreble = staffYForNote(60, STAFF_KIND.TREBLE, geometry)
    expect(onTreble.ledgerLines).toEqual([onTreble.y]) // sits on its ledger
    expect(onTreble.y).toBe(treble.lines[4] + STAFF_LINE_GAP)

    const onBass = staffYForNote(60, STAFF_KIND.BASS, geometry)
    expect(onBass.ledgerLines).toEqual([onBass.y])
    expect(onBass.y).toBe(bass.lines[0] - STAFF_LINE_GAP)
  })

  it('adds no ledger for notes just beyond the outer line', () => {
    const g5 = staffYForNote(79, STAFF_KIND.TREBLE, geometry) // space above top line
    expect(g5.ledgerLines).toEqual([])
    const d4 = staffYForNote(62, STAFF_KIND.TREBLE, geometry) // space below bottom line
    expect(d4.ledgerLines).toEqual([])
  })

  it('stacks ledger lines for far-out pitches', () => {
    const c6 = staffYForNote(84, STAFF_KIND.TREBLE, geometry) // C6: 2 ledgers above
    expect(c6.ledgerLines.length).toBe(2)
    const b0 = staffYForNote(23, STAFF_KIND.BASS, geometry) // B0: far below bass
    expect(b0.ledgerLines.length).toBe(6)
    expect(Math.max(...b0.ledgerLines)).toBeGreaterThan(bass.lines[4])
  })

  it('flags sharps', () => {
    expect(staffYForNote(61, STAFF_KIND.TREBLE, geometry).sharp).toBe(true)
    expect(staffYForNote(60, STAFF_KIND.TREBLE, geometry).sharp).toBe(false)
    // C#4 occupies C4's staff position
    expect(staffYForNote(61, STAFF_KIND.TREBLE, geometry).y).toBe(
      staffYForNote(60, STAFF_KIND.TREBLE, geometry).y,
    )
  })
})

describe('buildStaffLaneNotes', () => {
  const geometry = buildStaffGeometry({ hasTreble: true, hasBass: true })

  it('positions notes deterministically from time', () => {
    const groups = [
      { id: 'g1', timeSeconds: 0, status: 'current', notes: [{ midi: 60, durationSeconds: 0.5 }] },
      { id: 'g2', timeSeconds: 2, status: 'upcoming', notes: [{ midi: 64, durationSeconds: 2 }] },
    ]
    const notes = buildStaffLaneNotes(groups, geometry, { pixelsPerSecond: 150 })
    expect(notes.length).toBe(2)
    expect(notes[0].x).toBe(0)
    expect(notes[1].x).toBe(300) // 2s × 150px/s — no incremental state
    expect(notes[0].status).toBe('current')
    expect(notes[0].hollow).toBe(false)
    expect(notes[1].hollow).toBe(2 >= HOLLOW_NOTE_MIN_SECONDS)
  })

  it('stacks chord notes at one x with distinct staff positions', () => {
    const groups = [
      {
        id: 'chord',
        timeSeconds: 1,
        isChord: true,
        notes: [
          { midi: 60, durationSeconds: 1 },
          { midi: 64, durationSeconds: 1 },
          { midi: 67, durationSeconds: 1 },
        ],
      },
    ]
    const notes = buildStaffLaneNotes(groups, geometry)
    expect(new Set(notes.map((n) => n.x)).size).toBe(1)
    expect(new Set(notes.map((n) => n.y)).size).toBe(3)
    expect(new Set(notes.map((n) => n.id)).size).toBe(3)
  })
})

describe('buildStaffLaneStems', () => {
  const geometry = buildStaffGeometry({ hasTreble: true, hasBass: true })
  const px = 150
  const group = (id, timeSeconds, midis, durationSeconds = 0.5) => ({
    id,
    timeSeconds,
    notes: midis.map((midi) => ({ midi, durationSeconds })),
  })

  it('points stems up below the middle line and down at/above it', () => {
    // G4 (below treble middle line B4) → up; C5 (above) → down; B4 (on) → down.
    const stems = buildStaffLaneStems(
      [group('low', 0, [67]), group('high', 1, [72]), group('mid', 2, [71])],
      geometry,
      { pixelsPerSecond: px },
    )
    expect(stems.length).toBe(3)
    const [low, high, mid] = stems
    expect(low.stemDown).toBe(false)
    expect(low.y2).toBeLessThan(low.y1) // extends upward (smaller SVG y)
    expect(low.x).toBe(0 * px + NOTEHEAD_RX) // right side of the head
    expect(high.stemDown).toBe(true)
    expect(high.y2).toBeGreaterThan(high.y1)
    expect(high.x).toBe(1 * px - NOTEHEAD_RX) // left side of the head
    expect(mid.stemDown).toBe(true)
  })

  it('respects bass staff direction', () => {
    // A2 (below bass middle line D3) → up; A3 (above) → down.
    const stems = buildStaffLaneStems(
      [group('low', 0, [45]), group('high', 1, [57])],
      geometry,
      { pixelsPerSecond: px },
    )
    expect(stems[0].staffKind).toBe(STAFF_KIND.BASS)
    expect(stems[0].stemDown).toBe(false)
    expect(stems[1].stemDown).toBe(true)
  })

  it('gives a chord one shared stem spanning all noteheads', () => {
    const stems = buildStaffLaneStems([group('chord', 1, [60, 64, 67])], geometry, {
      pixelsPerSecond: px,
    })
    expect(stems.length).toBe(1)
    const stem = stems[0]
    // Farthest from middle is C4 (below) → stem up from the lowest head.
    expect(stem.stemDown).toBe(false)
    const noteYs = buildStaffLaneNotes([group('chord', 1, [60, 64, 67])], geometry, {
      pixelsPerSecond: px,
    }).map((n) => n.y)
    expect(stem.y1).toBe(Math.max(...noteYs)) // attaches at the lowest head
    expect(stem.y2).toBe(Math.min(...noteYs) - STEM_LENGTH_GAPS * STAFF_LINE_GAP)
  })

  it('splits stems per staff for cross-staff groups', () => {
    const stems = buildStaffLaneStems([group('both', 0, [48, 72])], geometry, {
      pixelsPerSecond: px,
    })
    expect(stems.length).toBe(2)
    expect(new Set(stems.map((s) => s.staffKind)).size).toBe(2)
  })

  it('skips stems for whole-note-style durations', () => {
    const stems = buildStaffLaneStems(
      [group('whole', 0, [60], STEMLESS_MIN_SECONDS + 0.5), group('quarter', 1, [60], 0.5)],
      geometry,
      { pixelsPerSecond: px },
    )
    expect(stems.length).toBe(1)
    expect(stems[0].groupId).toBe('quarter')
  })
})
