import { describe, expect, it } from 'vitest'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import {
  CLEF_EVENT_KIND,
  detectStaffClefTimelineFromGlyphs,
  resolvePitchFromGrandStaff,
  resolveStaffClefsAtX,
} from '../src/features/omr/pitchFromStaffPosition.js'

const TREBLE_CLEF = '\ue050'
const BASS_CLEF = '\ue062'
const BLACK_NOTEHEAD = '\ue0a4'
const LEGACY_BASS_CLEF_8VB = '\ue1db'
const imageData = { width: 1000, height: 1000 }
const staffLines = {
  treble: [0.2, 0.21, 0.22, 0.23, 0.24],
  bass: [0.32, 0.33, 0.34, 0.35, 0.36],
  splitY: 0.28,
}

function glyph(text, x, y) {
  return { text, x, y, width: 10, height: 28, fontName: 'Bravura' }
}

function timeline() {
  return detectStaffClefTimelineFromGlyphs(
    [
      glyph(TREBLE_CLEF, 50, 220),
      glyph(BASS_CLEF, 55, 340),
      glyph(BLACK_NOTEHEAD, 120, 220),
      glyph(BLACK_NOTEHEAD, 130, 340),
      glyph(TREBLE_CLEF, 250, 340),
      glyph(BLACK_NOTEHEAD, 300, 340),
      glyph(BASS_CLEF, 400, 340),
      glyph(BLACK_NOTEHEAD, 450, 340),
      glyph(BLACK_NOTEHEAD, 500, 220),
      glyph(TREBLE_CLEF, 550, 340),
    ],
    imageData,
    staffLines,
    {
      noteheadGlyphTexts: [BLACK_NOTEHEAD],
      page: 3,
      systemIndex: 4,
    },
  )
}

describe('positioned staff-clef timeline', () => {
  it('distinguishes system-start, active, and courtesy clef evidence', () => {
    const result = timeline()
    const lower = result.events.filter((event) => event.staffRole === 'lower')

    expect(lower.map((event) => [event.clefSign, event.kind])).toEqual([
      ['bass', CLEF_EVENT_KIND.SYSTEM_START],
      ['treble', CLEF_EVENT_KIND.ACTIVE_CHANGE],
      ['bass', CLEF_EVENT_KIND.ACTIVE_CHANGE],
      ['treble', CLEF_EVENT_KIND.COURTESY_REMINDER],
    ])
    expect(lower[1].eventId).toBe('p3-s4-clef-lower-1')
    expect(result.endingClefs.lower).toBe('bass')
    expect(result.continuationClefs.lower).toBe('treble')
  })

  it('uses the most recent active event strictly before each note', () => {
    const result = timeline()

    expect(resolveStaffClefsAtX(result, 0.2).lower).toBe('bass')
    expect(resolveStaffClefsAtX(result, 0.35).lower).toBe('treble')
    expect(resolveStaffClefsAtX(result, 0.45).lower).toBe('bass')
    expect(resolveStaffClefsAtX(result, 0.6).lower).toBe('bass')
  })

  it('maps the same lower-staff position through the active clef sign', () => {
    const result = timeline()
    const before = resolvePitchFromGrandStaff(0.36, staffLines, result, 0.2)
    const during = resolvePitchFromGrandStaff(0.36, staffLines, result, 0.35)

    expect(before.staffRole).toBe('lower')
    expect(before.clefSign).toBe('bass')
    expect(during.staffRole).toBe('lower')
    expect(during.clefSign).toBe('treble')
    expect(during.midi - before.midi).toBe(21)
  })

  it('preserves a source composite bass-clef-8vb through pitch and XML', () => {
    const result = detectStaffClefTimelineFromGlyphs(
      [
        glyph(TREBLE_CLEF, 50, 220),
        {
          ...glyph(BASS_CLEF, 55, 340),
          originalLegacyText: LEGACY_BASS_CLEF_8VB,
        },
        glyph(BLACK_NOTEHEAD, 120, 220),
        glyph(BLACK_NOTEHEAD, 130, 340),
      ],
      imageData,
      staffLines,
      { noteheadGlyphTexts: [BLACK_NOTEHEAD] },
    )
    const lowerClef = result.events.find((event) => event.staffRole === 'lower')
    const standardMidi = resolvePitchFromGrandStaff(0.34, staffLines, undefined).midi
    const mapping = resolvePitchFromGrandStaff(0.34, staffLines, result, 0.13)

    expect(lowerClef?.octaveChange).toBe(-1)
    expect(mapping.clefOctaveChange).toBe(-1)
    expect(mapping.midi).toBe(standardMidi - 12)

    const xml = buildOmrMusicXml({
      includeDisclaimer: false,
      measures: [{
        measureNumber: 1,
        events: [{
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          clef: 'treble',
          notes: [{ midi: 72, clef: 'treble' }],
        }, {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          clef: 'bass',
          notes: [{ midi: mapping.midi, clef: 'bass', pitchMapping: mapping }],
        }],
      }],
    })
    expect(xml).toContain(
      '<clef><sign>F</sign><line>4</line><clef-octave-change>-1</clef-octave-change></clef>',
    )
  })

  it('treats an ordinary bass clef as an active reset after bass 8vb', () => {
    const result = detectStaffClefTimelineFromGlyphs(
      [
        glyph(TREBLE_CLEF, 50, 220),
        {
          ...glyph(BASS_CLEF, 55, 340),
          originalLegacyText: LEGACY_BASS_CLEF_8VB,
        },
        glyph(BLACK_NOTEHEAD, 130, 340),
        glyph(BASS_CLEF, 250, 340),
        glyph(BLACK_NOTEHEAD, 300, 340),
      ],
      imageData,
      staffLines,
      { noteheadGlyphTexts: [BLACK_NOTEHEAD] },
    )
    const lowerEvents = result.events.filter(
      (event) => event.staffRole === 'lower',
    )
    const under8vb = resolvePitchFromGrandStaff(0.34, staffLines, result, 0.2)
    const afterReset = resolvePitchFromGrandStaff(0.34, staffLines, result, 0.3)

    expect(lowerEvents.map((event) => [event.octaveChange, event.kind])).toEqual([
      [-1, CLEF_EVENT_KIND.SYSTEM_START],
      [0, CLEF_EVENT_KIND.ACTIVE_CHANGE],
    ])
    expect(afterReset.midi - under8vb.midi).toBe(12)
    expect(result.endingOctaveChanges.lower).toBe(0)
  })

  it('inherits bass 8vb when the next system omits a repeated clef glyph', () => {
    const result = detectStaffClefTimelineFromGlyphs(
      [glyph(BLACK_NOTEHEAD, 130, 340)],
      imageData,
      staffLines,
      {
        inheritedStaffClefs: {
          upper: 'treble',
          lower: 'bass',
          initialOctaveChanges: { upper: 0, lower: -1 },
        },
        noteheadGlyphTexts: [BLACK_NOTEHEAD],
      },
    )
    const standardMidi = resolvePitchFromGrandStaff(0.34, staffLines, undefined).midi
    const mapping = resolvePitchFromGrandStaff(0.34, staffLines, result, 0.13)

    expect(result.events).toHaveLength(0)
    expect(mapping.clefOctaveChange).toBe(-1)
    expect(mapping.midi).toBe(standardMidi - 12)
  })

  it('serializes active lower-staff changes as positioned MusicXML clefs', () => {
    const note = (midi, clef, clefSign) => ({
      midi,
      clef,
      pitchMapping: { clefSign },
      source: 'vector-glyph',
    })
    const xml = buildOmrMusicXml({
      includeDisclaimer: false,
      measures: [
        {
          measureNumber: 1,
          events: [
            { type: 'note', startDivision: 0, durationDivisions: 1, clef: 'treble', notes: [note(72, 'treble', 'treble')] },
            { type: 'note', startDivision: 0, durationDivisions: 1, clef: 'bass', notes: [note(48, 'bass', 'bass')] },
            { type: 'note', startDivision: 2, durationDivisions: 1, clef: 'bass', notes: [note(64, 'bass', 'treble')] },
            { type: 'note', startDivision: 3, durationDivisions: 1, clef: 'bass', notes: [note(43, 'bass', 'bass')] },
          ],
        },
      ],
    })

    expect(xml).toContain(
      '<attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>',
    )
    expect(xml.match(/<clef number="2"><sign>F<\/sign><line>4<\/line><\/clef>/g)).toHaveLength(2)
  })
})
