import { describe, expect, it } from 'vitest'
import {
  evaluateGuitarScore,
  matchNoteObjects,
  pairCost,
  scoreMarkingFamilies,
} from '../src/features/omr/guitar/guitarMetrics.js'
import { extractMarkingObjects, extractNoteObjects, tabConsistencyOf } from '../src/features/omr/guitar/guitarObjects.js'

/**
 * Minimal note factories. Positions and durations are in quarter notes, matching
 * what extractNoteObjects reads.
 */
function note(overrides = {}) {
  return {
    kind: 'note',
    id: overrides.id ?? 'n',
    partId: 'P1',
    measureNumber: 1,
    positionInMeasure: 0,
    staff: 1,
    voice: 1,
    isRest: false,
    isChord: false,
    isGrace: false,
    soundingMidi: 60,
    writtenPitch: 'C:0:4',
    durationQuarters: 1,
    durationDivisions: 480,
    noteType: 'quarter',
    dots: 0,
    tuplet: null,
    string: null,
    fret: null,
    accidental: null,
    isTabMirror: false,
    markingTokens: [],
    divisionsPerQuarter: 480,
    ...overrides,
  }
}

function rest(overrides = {}) {
  return note({ isRest: true, soundingMidi: null, writtenPitch: null, ...overrides })
}

function objects(list) {
  return list.map((item, index) => note({ id: `t${index}`, ...item }))
}

describe('pairCost', () => {
  it('rejects a rest/pitched-note pairing outright', () => {
    expect(pairCost(rest(), note())).toBe(Number.POSITIVE_INFINITY)
    expect(pairCost(note(), rest())).toBe(Number.POSITIVE_INFINITY)
  })

  it('rejects pairs outside the onset window', () => {
    expect(pairCost(note({ positionInMeasure: 0 }), note({ positionInMeasure: 2 }))).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  it('rejects pairs outside the pitch window', () => {
    expect(pairCost(note({ soundingMidi: 60 }), note({ soundingMidi: 90 }))).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  it('rejects pairing across a staff boundary', () => {
    expect(pairCost(note({ staff: 1 }), note({ staff: 2 }))).toBe(Number.POSITIVE_INFINITY)
  })

  it('costs less when onset, pitch and duration all agree', () => {
    const close = pairCost(note(), note({ positionInMeasure: 0.25, soundingMidi: 61, durationQuarters: 1 }))
    const far = pairCost(note(), note({ positionInMeasure: 0.5, soundingMidi: 66, durationQuarters: 0.5 }))
    expect(close).toBeLessThan(far)
  })
})

describe('matchNoteObjects', () => {
  it('pairs identical scores one-to-one', () => {
    const truth = objects([{ positionInMeasure: 0 }, { positionInMeasure: 1 }])
    const generated = objects([{ positionInMeasure: 0 }, { positionInMeasure: 1 }])
    const result = matchNoteObjects(truth, generated)
    expect(result.matches.length).toBe(2)
    expect(result.missed).toHaveLength(0)
    expect(result.falsePositives).toHaveLength(0)
  })

  it('finds the globally best pairing rather than a greedy one', () => {
    // Two truth notes and two generated notes that overlap in a way where the
    // locally cheapest first choice is not part of the best global assignment.
    const truth = objects([
      { positionInMeasure: 0, soundingMidi: 60, durationQuarters: 1 },
      { positionInMeasure: 1, soundingMidi: 64, durationQuarters: 1 },
    ])
    const generated = objects([
      { positionInMeasure: 0, soundingMidi: 60, durationQuarters: 1 },
      { positionInMeasure: 1, soundingMidi: 67, durationQuarters: 1 },
    ])
    const result = matchNoteObjects(truth, generated)
    expect(result.matches.length).toBe(2)
    // The second truth note should be matched to the second generated note
    // (onset agrees) rather than the first (pitch agrees).
    const second = result.matches.find((match) => match.truth.positionInMeasure === 1)
    expect(second.generated.soundingMidi).toBe(67)
  })

  it('counts missed truth notes and extra generated notes separately', () => {
    const truth = objects([{ positionInMeasure: 0 }, { positionInMeasure: 1 }, { positionInMeasure: 2 }])
    const generated = objects([{ positionInMeasure: 0 }])
    const result = matchNoteObjects(truth, generated)
    expect(result.matches).toHaveLength(1)
    expect(result.missed).toHaveLength(2)
    expect(result.falsePositives).toHaveLength(0)
  })

  it('reports a spurious generated note as a false positive, not a match', () => {
    const truth = objects([{ positionInMeasure: 0 }])
    const generated = objects([{ positionInMeasure: 0 }, { positionInMeasure: 3 }])
    const result = matchNoteObjects(truth, generated)
    expect(result.matches).toHaveLength(1)
    expect(result.falsePositives).toHaveLength(1)
  })

  it('never matches two truth objects to the same generated object', () => {
    const truth = objects([
      { positionInMeasure: 0, soundingMidi: 60 },
      { positionInMeasure: 0, soundingMidi: 60 },
    ])
    const generated = objects([{ positionInMeasure: 0, soundingMidi: 60 }])
    const result = matchNoteObjects(truth, generated)
    expect(result.matches).toHaveLength(1)
    expect(result.missed).toHaveLength(1)
  })

  it('matches across differing part identifiers by ordinal position', () => {
    // Imported scores carry a content-hash part id; our emitter always writes
    // P1. Pairing on the raw id would match nothing and report a clean sweep.
    const truth = objects([{ positionInMeasure: 0, partId: 'P5cabd0870c65f135' }])
    const generated = objects([{ positionInMeasure: 0, partId: 'P1' }])
    const result = matchNoteObjects(truth, generated)
    expect(result.matches).toHaveLength(1)
    expect(result.missed).toHaveLength(0)
  })

  it('does not let an empty comparison report as a perfect score', () => {
    const report = evaluateGuitarScore({ truthNotes: [], generatedNotes: [] })
    expect(report.detection.f1).toBe(0)
    expect(report.attributes.soundingPitch.accuracy).toBeNull()
    expect(report.endToEndNoteAccuracy).toBe(0)
  })

  it('reports 0 rather than 1 when nothing could be matched', () => {
    const truth = objects([{ positionInMeasure: 0 }, { positionInMeasure: 4 }])
    const generated = objects([{ positionInMeasure: 2 }])
    const report = evaluateGuitarScore({ truthNotes: truth, generatedNotes: generated })
    expect(report.detection.matched).toBe(0)
    expect(report.attributes.soundingPitch.accuracy).toBeNull()
    expect(report.endToEndNoteAccuracy).toBe(0)
  })
})

describe('scoreMarkingFamilies', () => {
  const marking = (family, positionInMeasure, payload = {}) => ({
    kind: 'marking',
    family,
    measureNumber: 1,
    positionInMeasure,
    staff: 1,
    voice: 1,
    payload,
  })

  it('marks a family unsupported when neither side has any', () => {
    const results = scoreMarkingFamilies([], [])
    expect(results.bend.supported).toBe(false)
    expect(results.bend.recall).toBeNull()
  })

  it('scores a matched marking as full precision and recall', () => {
    const results = scoreMarkingFamilies(
      [marking('tie', 0), marking('tie', 1)],
      [marking('tie', 0), marking('tie', 1)],
    )
    expect(results.tie.supported).toBe(true)
    expect(results.tie.precision).toBe(1)
    expect(results.tie.recall).toBe(1)
  })

  it('penalises an invented marking', () => {
    const results = scoreMarkingFamilies([marking('tie', 0)], [marking('tie', 0), marking('tie', 1)])
    expect(results.tie.precision).toBe(0.5)
    expect(results.tie.recall).toBe(1)
  })

  it('does not match the same family at a distant position', () => {
    const results = scoreMarkingFamilies([marking('tie', 0)], [marking('tie', 3)])
    expect(results.tie.matched).toBe(0)
  })

  it('does not match different families to each other', () => {
    const results = scoreMarkingFamilies([marking('bend', 0)], [marking('slide', 0)])
    expect(results.bend.recall).toBe(0)
    expect(results.slide.precision).toBe(0)
  })
})

describe('tabConsistencyOf', () => {
  it('accepts a physically playable position', () => {
    // String 1 open is E4 (64).
    expect(tabConsistencyOf(note({ soundingMidi: 64, string: 1, fret: 0 })).consistent).toBe(true)
  })

  it('rejects a position that cannot sound the stored pitch', () => {
    const result = tabConsistencyOf(note({ soundingMidi: 65, string: 1, fret: 0 }))
    expect(result.consistent).toBe(false)
    expect(result.deltaSemitones).toBe(1)
  })

  it('returns null when there is no position to check', () => {
    expect(tabConsistencyOf(note({ string: null, fret: null }))).toBeNull()
  })

  it('accounts for capo', () => {
    expect(tabConsistencyOf(note({ soundingMidi: 66, string: 1, fret: 0 }), { capoFret: 2 }).consistent).toBe(
      true,
    )
  })
})

describe('evaluateGuitarScore', () => {
  /** A tiny MusicXML score, so the public entry point is exercised end to end. */
  function scoreXml(notes) {
    const body = notes
      .map(
        (spec) =>
          `<note>${spec.rest ? '<rest/>' : `<pitch><step>${spec.step ?? 'C'}</step><octave>${spec.octave ?? 4}</octave></pitch>`}` +
          `<duration>${spec.duration ?? 480}</duration><voice>${spec.voice ?? 1}</voice>` +
          `${spec.string ? `<notations><technical><string>${spec.string}</string><fret>${spec.fret}</fret></technical></notations>` : ''}` +
          `</note>`,
      )
      .join('')
    return `<?xml version="1.0"?><score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>480</divisions></attributes>${body}</measure></part>
    </score-partwise>`
  }

  /** Minimal parser for these fixtures: enough shape for extraction. */
  function parse(xml) {
    const noteRe = /<note>([\s\S]*?)<\/note>/g
    const notes = []
    let match
    let index = 0
    while ((match = noteRe.exec(xml)) !== null) {
      const body = match[1]
      const isRest = body.includes('<rest/>')
      const step = body.match(/<step>(\w)<\/step>/)?.[1]
      const octave = Number(body.match(/<octave>(-?\d+)<\/octave>/)?.[1])
      const duration = Number(body.match(/<duration>(\d+)<\/duration>/)?.[1] ?? 480)
      const voice = Number(body.match(/<voice>(\d+)<\/voice>/)?.[1] ?? 1)
      const string = body.match(/<string>(\d+)<\/string>/)?.[1]
      const fret = body.match(/<fret>(\d+)<\/fret>/)?.[1]
      const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
      const elapsed = notes.reduce((sum, note) => sum + note.durationDivisions, 0)
      notes.push({
        id: `P1-m1-n${index}`,
        partId: 'P1',
        measureNumber: 1,
        quarterTime: elapsed / 480,
        durationQuarters: duration / 480,
        durationDivisions: duration,
        midi: isRest ? null : (octave + 1) * 12 + (semitones[step] ?? 0),
        writtenPitch: isRest ? null : { step, alter: null, octave },
        isRest,
        isChord: false,
        isGrace: false,
        voice,
        staff: 1,
        dots: 0,
        noteType: 'quarter',
        string: string ? Number(string) : null,
        fret: fret ? Number(fret) : null,
        accidental: null,
        slurs: [],
        guitarTechniques: [],
        technical: {},
      })
      index += 1
    }
    return { notes }
  }

  /**
   * The same notes at deliberately wrong onsets, built by hand rather than by
   * re-encoding durations. The Phase 0 pathology was precisely "all the right
   * pitches, all in the wrong place", so the regression test has to be able to
   * state that directly.
   */
  function scoreWithOnsets(onsets) {
    const truth = objects(onsets.map((positionInMeasure) => ({ positionInMeasure })))
    return truth
  }

  it('scores a perfect transcription as perfect', () => {
    const xml = scoreXml([{ step: 'C', octave: 4 }, { step: 'E', octave: 4 }])
    const report = evaluateGuitarScore({ generatedXml: xml, truthXml: xml, parse })
    expect(report.detection.f1).toBe(1)
    expect(report.attributes.soundingPitch.accuracy).toBe(1)
    expect(report.attributes.onset.accuracy).toBe(1)
    expect(report.endToEndNoteAccuracy).toBe(1)
  })

  it('does not let a bag-style credit hide wrong onsets', () => {
    // The pathological case: identical pitches and identical note count, but
    // the second note is placed a beat late. A bag metric scores this 100%.
    const truth = scoreWithOnsets([0, 1])
    const generated = scoreWithOnsets([0, 2])

    const report = evaluateGuitarScore({ truthNotes: truth, generatedNotes: generated })

    // The bag view: every pitch present, and among the objects that were
    // matched at all, the matched onset is itself correct.
    expect(report.attributes.soundingPitch.accuracy).toBe(1)
    expect(report.attributes.onset.accuracy).toBe(1)

    // Attribute accuracy is conditional on identity, so the misplacement has to
    // show up in detection and in the end-to-end number instead. This is why
    // detection is reported first and must always be read alongside it.
    expect(report.detection.matched).toBe(1)
    expect(report.detection.missed).toBe(1)
    expect(report.detection.falsePositive).toBe(1)
    expect(report.detection.f1).toBeCloseTo(0.5, 3)
    expect(report.endToEndNoteAccuracy).toBeCloseTo(0.5, 3)
  })

  it('reports end-to-end accuracy that accounts for detection, not just pitch', () => {
    const truth = scoreXml([{ step: 'C', octave: 4 }, { step: 'E', octave: 4 }, { step: 'G', octave: 4 }])
    // Only one of the three notes is transcribed.
    const partial = scoreXml([{ step: 'C', octave: 4 }])
    const report = evaluateGuitarScore({ generatedXml: partial, truthXml: truth, parse })
    expect(report.attributes.soundingPitch.accuracy).toBe(1)
    expect(report.detection.recall).toBeCloseTo(1 / 3, 3)
    expect(report.endToEndNoteAccuracy).toBeLessThan(0.4)
  })

  it('flags an unplayable string/fret pairing in the generated score', () => {
    // String 1 open is E4, so claiming E4 on string 1 fret 0 is fine; claiming
    // F4 (65) there is not.
    const truth = scoreXml([{ step: 'E', octave: 4, string: 1, fret: 0 }])
    const generated = scoreXml([{ step: 'F', octave: 4, string: 1, fret: 0 }])
    const report = evaluateGuitarScore({ generatedXml: generated, truthXml: truth, parse })
    expect(report.tabConsistency.truthRate).toBe(1)
    expect(report.tabConsistency.generatedRate).toBe(0)
  })

  it('refuses to run without an explicit parser', () => {
    expect(() =>
      evaluateGuitarScore({ generatedXml: '<x/>', truthXml: '<x/>' }),
    ).toThrow(TypeError)
  })
})

describe('extractNoteObjects', () => {
  it('exposes every attribute the metric needs', () => {
    const parsed = {
      notes: [
        {
          id: 'n0',
          partId: 'P1',
          measureNumber: 3,
          quarterTime: 1.5,
          durationQuarters: 0.5,
          durationDivisions: 240,
          midi: 64,
          writtenPitch: { step: 'E', alter: null, octave: 4 },
          isRest: false,
          isChord: true,
          isGrace: false,
          voice: 2,
          staff: 1,
          dots: 1,
          noteType: 'eighth',
          string: 1,
          fret: 0,
          accidental: { type: 'natural' },
          tieStart: true,
          slurs: [{ number: 1 }],
          staccato: true,
          technical: { hammerOn: true },
          guitarTechniques: [{ kind: 'bend', number: '2' }],
        },
      ],
    }
    const [object] = extractNoteObjects(parsed)
    expect(object.measureNumber).toBe(3)
    expect(object.positionInMeasure).toBe(1.5)
    expect(object.soundingMidi).toBe(64)
    expect(object.writtenPitch).toBe('E:0:4')
    expect(object.dots).toBe(1)
    expect(object.string).toBe(1)
    expect(object.accidental).toBe('natural')
    expect(object.markingTokens).toEqual(
      expect.arrayContaining(['tie', 'slur', 'staccato', 'hammer-on', 'bend']),
    )
  })

  it('marks rests with a null pitch', () => {
    const [object] = extractNoteObjects({ notes: [{ isRest: true, measureNumber: 1 }] })
    expect(object.isRest).toBe(true)
    expect(object.soundingMidi).toBeNull()
  })
})

describe('extractMarkingObjects', () => {
  it('anchors each marking to a measure and position', () => {
    const markings = extractMarkingObjects({
      notes: [
        { measureNumber: 2, quarterTime: 0.5, tieStart: true, voice: 1, staff: 1 },
        { measureNumber: 2, quarterTime: 0.5, staccato: true, voice: 1, staff: 1 },
      ],
    })
    const tie = markings.find((marking) => marking.family === 'tie')
    expect(tie.measureNumber).toBe(2)
    expect(tie.positionInMeasure).toBe(0.5)
    expect(markings.some((marking) => marking.family === 'staccato')).toBe(true)
  })
})
