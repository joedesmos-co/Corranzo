import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  getTimingValidation,
  timingIsInvalid,
  timingNoticeFor,
  TIMING_VALIDATION_STATUS,
  OVERFULL_CLASSIFICATION,
  validateMeasureTiming,
} from '../src/features/musicxml/timingValidation.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { describeSourceFidelity } from '../src/features/practice/canonicalTimingContract.js'

/**
 * Raw note builders WITHOUT the default <voice> tag (buildXml.note adds one),
 * so these fixtures model voice-flattened exports precisely.
 */
function plainNote(step, octave, duration) {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>quarter</type></note>`
}
function plainRest(duration) {
  return `<note><rest/><duration>${duration}</duration></note>`
}
function voicedNote(voice, step, octave, duration) {
  return `<note><voice>${voice}</voice><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>quarter</type></note>`
}
function voicedRest(voice, duration) {
  return `<note><voice>${voice}</voice><rest/><duration>${duration}</duration></note>`
}
function attributesXml(divisions = 1) {
  return `<attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
}
function part(id, measuresXml) {
  return `<part id="${id}">${measuresXml}</part>`
}
function wrap(partsXml, partList = null) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">${partList ?? `<part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>`}${partsXml}</score-partwise>`
}

/** Voice-flattened 4/4 measures: two voices sequenced into one stream. */
function flattenedScore() {
  // m1: half + quarter + half + quarter = 6q of sequential content in a 4/4
  // window (no <voice>, no <backup>). The 4th note onsets at 5.0q — inside
  // m2's window — and collides with m2's first note onset.
  const m1 = `<measure number="1">${attributesXml()}${plainNote('C', 4, 2)}${plainNote('E', 4, 1)}${plainNote('C', 4, 2)}${plainNote('E', 4, 1)}</measure>`
  // m2: rest, then a note at 5.0q (same performed time as m1's 4th note).
  const m2 = `<measure number="2">${plainRest(1)}${plainNote('F', 4, 1)}${plainRest(2)}</measure>`
  return wrap(part('P1', m1 + m2))
}

/** Voice-flattened score whose m1 note ties into m2's first note. */
function flattenedWithTieScore() {
  const m1 =
    `<measure number="1">${attributesXml()}` +
    `${plainNote('C', 4, 2)}${plainNote('E', 4, 1)}` +
    `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/></note>` +
    `</measure>`
  const m2 =
    `<measure number="2">` +
    `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/></note>` +
    `${plainNote('F', 4, 1)}${plainRest(1)}</measure>`
  return wrap(part('P1', m1 + m2))
}

/** Two correct voices with backup (valid): both fit the 4/4 window. */
function validTwoVoiceScore() {
  const m1 =
    `<measure number="1">${attributesXml()}` +
    `${voicedNote(1, 'C', 5, 2)}${voicedNote(1, 'D', 5, 2)}` +
    `<backup><duration>4</duration></backup>` +
    `${voicedRest(2, 1)}${voicedNote(2, 'E', 4, 1)}${voicedNote(2, 'F', 4, 1)}${voicedNote(2, 'G', 4, 1)}` +
    `</measure>`
  return wrap(part('P1', m1))
}

/** Valid grand-staff score: both staves attack together in the SAME measure. */
function validGrandStaffScore() {
  const partList = `<part-list><score-part id="P1"><part-name>Upper</part-name></score-part><score-part id="P2"><part-name>Lower</part-name></score-part></part-list>`
  const upper = `<measure number="1">${attributesXml()}${plainNote('C', 5, 2)}${plainNote('E', 5, 2)}</measure>`
  const lower = `<measure number="1">${attributesXml()}${plainNote('C', 4, 2)}${plainNote('G', 4, 2)}</measure>`
  return wrap(part('P1', upper) + part('P2', lower), partList)
}

/** Pickup measure: short first bar, implicit — never overfull. */
function pickupScore() {
  const m0 = `<measure number="0" implicit="yes">${attributesXml()}${plainNote('G', 4, 1)}</measure>`
  const m1 = `<measure number="1">${plainNote('C', 5, 4)}</measure>`
  return wrap(part('P1', m0 + m1))
}

/** Tie across a barline on a valid file: sustain must not count as overflow. */
function tieAcrossBarlineScore() {
  const m1 =
    `<measure number="1">${attributesXml()}` +
    `<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="start"/><type>half</type></note>` +
    `</measure>`
  const m2 =
    `<measure number="2">` +
    `<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="stop"/><type>half</type></note>` +
    `${plainRest(2)}</measure>`
  return wrap(part('P1', m1 + m2))
}

/** Tuplets inside a 4/4 measure: 3 eighths (2-in-the-time-of-3) + half + rest fit — never overfull. */
function tupletScore() {
  const tuplet = (step) =>
    `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>`
  // divisions=3 per quarter: three triplet notes (1 division each) + half (6) + rest (3) = 12 = 4/4.
  const m1 = `<measure number="1">${attributesXml(3)}${tuplet('C')}${tuplet('D')}${tuplet('E')}${plainNote('F', 5, 6)}${plainRest(3)}</measure>`
  return wrap(part('P1', m1))
}

function crossMeasureCheckpointCount(timingMap) {
  return buildNoteCheckpoints(timingMap).filter(
    (checkpoint) => new Set((checkpoint.notes ?? []).map((note) => note.measureNumber)).size > 1,
  ).length
}

describe('measure timing validation', () => {
  it('validates a correct two-voice score with backup', () => {
    const timingMap = parseMusicXml(validTwoVoiceScore(), 'two-voice.musicxml')
    const validation = timingMap.timingValidation
    expect(validation.status).toBe(TIMING_VALIDATION_STATUS.VALID)
    expect(validation.overfullMeasures).toHaveLength(0)
    expect(timingIsInvalid(timingMap)).toBe(false)
    expect(crossMeasureCheckpointCount(timingMap)).toBe(0)
  })

  it('flags voice-flattened overfull measures and classifies them', () => {
    const timingMap = parseMusicXml(flattenedScore(), 'flattened.musicxml')
    const validation = getTimingValidation(timingMap)
    expect(validation.status).toBe(TIMING_VALIDATION_STATUS.INVALID)
    expect(validation.overfullMeasures).toHaveLength(1)
    const [row] = validation.overfullMeasures
    expect(row.measureNumber).toBe(1)
    expect(row.notatedNoteEndQuarters).toBeCloseTo(6, 6)
    expect(row.nominalQuarters).toBe(4)
    expect(row.excessQuarters).toBeCloseTo(2, 6)
    expect(row.classification).toBe(OVERFULL_CLASSIFICATION.UNVOICED_FLATTENED)
    expect(validation.summary.overfullMeasureCount).toBe(1)
    expect(validation.summary.worstExcessQuarters).toBeCloseTo(2, 6)
  })

  it('classifies voice-tagged measures without backup as voiced-without-backup', () => {
    const m1 =
      `<measure number="1">${attributesXml()}` +
      `${voicedNote(1, 'C', 5, 4)}${voicedNote(2, 'E', 4, 4)}` + // sequenced, no backup
      `</measure>`
    const timingMap = parseMusicXml(wrap(part('P1', m1)), 'no-backup.musicxml')
    const [row] = getTimingValidation(timingMap).overfullMeasures
    expect(row.classification).toBe(OVERFULL_CLASSIFICATION.VOICED_WITHOUT_BACKUP)
    expect(row.voiceTags).toEqual([1, 2])
  })

  it('never flags pickup measures', () => {
    const timingMap = parseMusicXml(pickupScore(), 'pickup.musicxml')
    expect(getTimingValidation(timingMap).status).toBe(TIMING_VALIDATION_STATUS.VALID)
  })

  it('never flags ties sustained across a barline', () => {
    const timingMap = parseMusicXml(tieAcrossBarlineScore(), 'tie.musicxml')
    expect(getTimingValidation(timingMap).status).toBe(TIMING_VALIDATION_STATUS.VALID)
  })

  it('never flags tuplets', () => {
    const timingMap = parseMusicXml(tupletScore(), 'tuplet.musicxml')
    expect(getTimingValidation(timingMap).status).toBe(TIMING_VALIDATION_STATUS.VALID)
  })

  it('recomputes validation for timing maps built without it', () => {
    const measures = [{ index: 0, number: 1, lengthQuarters: 4 }]
    const partMeasureNoteEnds = new Map([
      ['P1', [{ index: 0, number: 1, endQuarters: 6, noteCount: 3, voices: [], hasBackup: false }]],
    ])
    const validation = validateMeasureTiming(measures, partMeasureNoteEnds)
    expect(validation.status).toBe(TIMING_VALIDATION_STATUS.INVALID)
    expect(validation.overfullMeasures[0].excessQuarters).toBe(2)
  })
})

describe('Wait For You checkpoint grouping under invalid timing', () => {
  it('splits impossible cross-measure checkpoints on an invalidated score', () => {
    const timingMap = parseMusicXml(flattenedScore(), 'flattened.musicxml')
    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints.length).toBeGreaterThan(0)
    // No checkpoint requires notes written in more than one measure.
    expect(crossMeasureCheckpointCount(timingMap)).toBe(0)
    // Every checkpoint is single-measure, and at least one was produced by the
    // split fallback (the flattened m1/m2 onsets collide).
    const split = checkpoints.filter((checkpoint) => checkpoint.splitFromCrossMeasureGroup)
    expect(split.length).toBeGreaterThan(0)
    for (const checkpoint of split) {
      const measureNumbers = new Set((checkpoint.notes ?? []).map((note) => note.measureNumber))
      expect(measureNumbers.size).toBe(1)
      expect(checkpoint.timingValidated).toBe(false)
    }
    // Ids stay unique (WFY one-shot consumption keys on ids).
    const ids = new Set(checkpoints.map((checkpoint) => checkpoint.id))
    expect(ids.size).toBe(checkpoints.length)
  })

  it('preserves every note as a requirement (nothing dropped or re-timed)', () => {
    const timingMap = parseMusicXml(flattenedScore(), 'flattened.musicxml')
    const checkpoints = buildNoteCheckpoints(timingMap)
    const requiredMidis = checkpoints.flatMap((checkpoint) =>
      (checkpoint.notes ?? []).map((note) => note.midi),
    )
    const sourceMidis = timingMap.notes
      .filter((note) => !note.isRest && note.midi != null && !note.suppressPlaybackAttack)
      .map((note) => note.midi)
    expect(requiredMidis.length).toBe(sourceMidis.length)
    expect(new Set(requiredMidis)).toEqual(new Set(sourceMidis))
  })

  it('keeps same-measure cross-staff simultaneity merged (grand staff)', () => {
    // Both staves attack together inside the same measure: one playable
    // target, never split — piano chords must not be broken apart.
    const timingMap = parseMusicXml(validGrandStaffScore(), 'grand-staff.musicxml')
    expect(getTimingValidation(timingMap).status).toBe(TIMING_VALIDATION_STATUS.VALID)
    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints).toHaveLength(2)
    const expectedPairs = [[60, 72], [67, 76]]
    checkpoints.forEach((checkpoint, index) => {
      expect(checkpoint.notes).toHaveLength(2)
      expect([...checkpoint.expectedMidis].sort()).toEqual(expectedPairs[index])
      expect(checkpoint.splitFromCrossMeasureGroup).toBe(false)
      expect(checkpoint.timingValidated).toBe(true)
    })
  })

  it('never breaks a legitimate cross-measure tie on an invalidated score', () => {
    // The tie continuation (written m2) must fold into its m1 attack — one
    // target with the sustained duration — and must never appear as a
    // separate playable checkpoint nor be dropped.
    const timingMap = parseMusicXml(flattenedWithTieScore(), 'flattened-tie.musicxml')
    expect(getTimingValidation(timingMap).status).toBe(TIMING_VALIDATION_STATUS.INVALID)
    // Parse-level written+sustained duration: 2q attack + 2q continuation.
    const parsedHead = timingMap.notes.find((note) => note.tieStart)
    expect(parsedHead.durationQuarters).toBeCloseTo(4, 6)
    const checkpoints = buildNoteCheckpoints(timingMap)
    const tieStops = checkpoints.filter((checkpoint) =>
      (checkpoint.notes ?? []).some((note) => note.tieStop && !note.tieStart && !note.suppressPlaybackAttack),
    )
    expect(tieStops).toHaveLength(0)
    const head = checkpoints.find((checkpoint) =>
      (checkpoint.notes ?? []).some((note) => note.tieStart && note.tiedContinuations?.length),
    )
    expect(head).toBeTruthy()
    const headNote = head.notes.find((note) => note.tieStart && note.tiedContinuations?.length)
    expect(headNote.tiedContinuations).toHaveLength(1)
    expect(headNote.tiedContinuations[0].measureNumber).toBe(2)
  })
})

describe('source fidelity reporting', () => {
  it('reports timing-invalid as an unsupported source reason', () => {
    const timingMap = parseMusicXml(flattenedScore(), 'flattened.musicxml')
    const fidelity = describeSourceFidelity(timingMap)
    expect(fidelity.unsupported.some((reason) => reason.startsWith('timing-invalid:overfull-measures'))).toBe(true)
    expect(fidelity.timingValidation.status).toBe(TIMING_VALIDATION_STATUS.INVALID)
  })

  it('reports nothing for a valid score', () => {
    const timingMap = parseMusicXml(validTwoVoiceScore(), 'two-voice.musicxml')
    const fidelity = describeSourceFidelity(timingMap)
    expect(fidelity.unsupported.some((reason) => reason.startsWith('timing-invalid'))).toBe(false)
  })

  it('produces honest musician copy only for invalidated scores', () => {
    const invalid = parseMusicXml(flattenedScore(), 'flattened.musicxml')
    const valid = parseMusicXml(validTwoVoiceScore(), 'two-voice.musicxml')
    expect(timingNoticeFor(invalid)).toMatch(/more notes than fit/)
    expect(timingNoticeFor(valid)).toBeNull()
  })
})
