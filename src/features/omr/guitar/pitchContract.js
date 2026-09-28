/**
 * Guitar Vision — the one written-pitch vs sounding-pitch contract.
 *
 * ## Why this module exists
 *
 * Guitar notation is conventionally engraved an octave above the pitch it
 * sounds. Three parts of the app previously disagreed about what a MusicXML
 * `<pitch>` element means for guitar:
 *
 *   - the emitter wrote *written* pitch and tagged the clef with
 *     `<clef-octave-change>-1</clef-octave-change>`,
 *   - the parser read `<pitch>` and ignored the clef octave change, so it
 *     treated written pitch as sounding,
 *   - every ground-truth score in the repository stored *sounding* pitch.
 *
 * The result was that 41% of the notes in BWV 997 were wrong by exactly one
 * octave, guitar playback was an octave sharp, and emitted files were
 * internally inconsistent (an octave-lowering clef with no `<transpose>`).
 *
 * ## The contract
 *
 * For any Corranzo guitar score:
 *
 *   1. `<pitch>` is always the **sounding** (concert) pitch. One meaning, no
 *      exceptions, so that playback, score-following, Wait For You and Play
 *      Along can all read `<pitch>` directly.
 *   2. Guitar parts MUST NOT carry `<clef-octave-change>`. It would apply the
 *      octave shift a second time, on top of an already-sounding pitch.
 *   3. Guitar parts MUST NOT carry `<transpose>`. The transposition is
 *      already applied to the stored pitch, so emitting it would subtract the
 *      offset again.
 *   4. `<string>` / `<fret>` must agree with the sounding pitch:
 *      `sounding = tuning[string - 1] + fret + capoFret`.
 *   5. Printed staff position is a *rendering* concern. It is derived from the
 *      sounding pitch at draw time, never by rewriting the stored pitch.
 *
 * Rule 1 is the load-bearing one. Rules 2 and 3 exist so that a
 * standards-conformant reader and the Corranzo parser agree on the file.
 *
 * ## Relationship to the printed score
 *
 * Guitar standard notation is printed in treble clef with an 8 below, so a
 * notehead drawn on the staff spells a *written* pitch one octave above the
 * sounding pitch. `soundingFromWritten` performs exactly that step. Note that
 * this is an octave relationship and not the "written a major second above
 * sounding" relation: with a treble-8vb clef the note *name* is preserved and
 * only the octave differs, which matches how guitar music is actually
 * engraved and how this repository's ground truth is encoded.
 *
 * For a pitched a semitone-above instrument (scordatura) the extra chromatic
 * offset is a separate, per-instrument value and is deliberately NOT folded
 * into this contract.
 */

import { STANDARD_GUITAR_TUNING } from '../../instruments/instruments.js'

export const GUITAR_PITCH_CONTRACT_VERSION = 'guitar-pitch/1.0'

/** Guitar sounds an octave below its written treble-clef pitch. */
export const GUITAR_WRITTEN_OCTAVE_OFFSET = -1

export const SEMITONES_PER_OCTAVE = 12

/**
 * Sounding MIDI for a written (engraved) treble-clef pitch.
 * `sounding = written + writtenOctaveOffset * 12`
 */
export function soundingFromWritten(writtenMidi, writtenOctaveOffset = GUITAR_WRITTEN_OCTAVE_OFFSET) {
  if (!Number.isFinite(writtenMidi)) return writtenMidi
  return writtenMidi + writtenOctaveOffset * SEMITONES_PER_OCTAVE
}

/** Inverse of {@link soundingFromWritten}. */
export function writtenFromSounding(soundingMidi, writtenOctaveOffset = GUITAR_WRITTEN_OCTAVE_OFFSET) {
  if (!Number.isFinite(soundingMidi)) return soundingMidi
  return soundingMidi - writtenOctaveOffset * SEMITONES_PER_OCTAVE
}

/**
 * Sounding MIDI for a fretted position. This is sounding by construction: the
 * open-string pitch and fret are physical facts, not notation.
 */
export function soundingFromTab(
  string,
  fret,
  { tuning = STANDARD_GUITAR_TUNING, capoFret = 0 } = {},
) {
  if (!Number.isInteger(string) || string < 1 || string > tuning.length) return null
  if (!Number.isFinite(fret) || fret < 0) return null
  const open = tuning[string - 1]
  if (open == null) return null
  return open + fret + capoFret
}

/**
 * Every position that sounds a given pitch, most plausible first. Used by the
 * paired staff+TAB consistency check to ask "is this engraving a physically
 * possible way to play the note?".
 */
export function tabPositionsForSounding(
  soundingMidi,
  { tuning = STANDARD_GUITAR_TUNING, capoFret = 0, maxFret = 24 } = {},
) {
  if (!Number.isFinite(soundingMidi)) return []
  const positions = []
  for (let string = 1; string <= tuning.length; string += 1) {
    const fret = soundingMidi - tuning[string - 1] - capoFret
    if (fret >= 0 && fret <= maxFret) {
      positions.push({ string, fret })
    }
  }
  return positions.sort((left, right) => left.fret - right.fret)
}

/**
 * Serialization invariants for guitar MusicXML. Purely declarative so the
 * validator, the emitter and the docs cannot drift apart.
 */
export const GUITAR_MUSICXML_RULES = Object.freeze({
  pitchIsSounding: true,
  forbidClefOctaveChange: true,
  forbidTranspose: true,
  requireFretPitchAgreement: true,
})

/** Rule identifiers reported by {@link validateGuitarMusicXml}. */
export const GUITAR_PITCH_VIOLATIONS = Object.freeze({
  CLEF_OCTAVE_CHANGE: 'guitar-clef-octave-change-double-counts-transposition',
  TRANSPOSE: 'guitar-transpose-would-subtract-offset-twice',
  STRING_FRET_DISAGREES: 'guitar-string-fret-disagrees-with-sounding-pitch',
})

/**
 * Audit a guitar MusicXML document against the contract.
 *
 * Reports every violation rather than the first, because a file typically
 * carries the clef problem on every measure and needs one fix, not N reports.
 *
 * @returns {{ version: string, ok: boolean, violations: Array<object> }}
 */
export function validateGuitarMusicXml(xml, { tuning = STANDARD_GUITAR_TUNING, capoFret = 0 } = {}) {
  const source = typeof xml === 'string' ? xml : ''
  const violations = []

  const clefOctaveChanges = source.match(/<clef-octave-change>[^<]*<\/clef-octave-change>/g) ?? []
  if (GUITAR_MUSICXML_RULES.forbidClefOctaveChange && clefOctaveChanges.length > 0) {
    violations.push({
      rule: GUITAR_PITCH_VIOLATIONS.CLEF_OCTAVE_CHANGE,
      count: clefOctaveChanges.length,
      sample: clefOctaveChanges[0],
      detail:
        'Stored pitch is already sounding; a clef octave change applies the ' +
        'octave shift a second time.',
    })
  }

  const transposes = source.match(/<transpose>[\s\S]*?<\/transpose>/g) ?? []
  if (GUITAR_MUSICXML_RULES.forbidTranspose && transposes.length > 0) {
    violations.push({
      rule: GUITAR_PITCH_VIOLATIONS.TRANSPOSE,
      count: transposes.length,
      sample: transposes[0].replace(/\s+/g, ' ').slice(0, 120),
      detail:
        'The written-to-sounding offset is already applied to the stored ' +
        'pitch, so <transpose> would subtract it again.',
    })
  }

  if (GUITAR_MUSICXML_RULES.requireFretPitchAgreement) {
    for (const mismatch of findStringFretMismatches(source, { tuning, capoFret })) {
      violations.push({ rule: GUITAR_PITCH_VIOLATIONS.STRING_FRET_DISAGREES, ...mismatch })
      if (violations.length >= 50) break
    }
  }

  return { version: GUITAR_PITCH_CONTRACT_VERSION, ok: violations.length === 0, violations }
}

const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/**
 * Find notes whose `<string>`/`<fret>` cannot produce their own `<pitch>`.
 *
 * Only notes that carry BOTH a position and a pitch are checkable; a note with
 * a position but no pitch is a missing-pitch defect, not a contract violation,
 * and is left to the coverage report.
 */
function findStringFretMismatches(source, { tuning, capoFret }) {
  const mismatches = []
  const noteRe = /<note\b[\s\S]*?<\/note>/g
  let noteMatch
  let index = 0
  while ((noteMatch = noteRe.exec(source)) !== null) {
    index += 1
    if (index > 20000) break
    const note = noteMatch[0]
    if (/<rest\s*\/?>/.test(note)) continue

    const pitchMatch = note.match(
      /<pitch>[\s\S]*?<step>\s*([A-G])\s*<\/step>\s*(?:<alter>\s*(-?\d+)\s*<\/alter>\s*)?<octave>\s*(-?\d+)\s*<\/octave>/,
    )
    if (!pitchMatch) continue

    const technical = note.match(/<technical>[\s\S]*?<\/technical>/)?.[0] ?? null
    if (!technical) continue
    const string = Number(technical.match(/<string>\s*(\d+)\s*<\/string>/)?.[1])
    const fret = Number(technical.match(/<fret>\s*(\d+)\s*<\/fret>/)?.[1])
    if (!Number.isInteger(string) || !Number.isInteger(fret)) continue

    const step = STEP_TO_SEMITONE[pitchMatch[1]]
    if (step == null) continue
    const alter = Number(pitchMatch[2] ?? 0)
    const octave = Number(pitchMatch[3])
    if (!Number.isFinite(octave)) continue
    const pitchMidi = (octave + 1) * 12 + step + alter

    const expected = soundingFromTab(string, fret, { tuning, capoFret })
    if (expected != null && expected !== pitchMidi) {
      mismatches.push({
        noteIndex: index,
        string,
        fret,
        pitchMidi,
        expectedSoundingMidi: expected,
        deltaSemitones: pitchMidi - expected,
        detail:
          `string ${string} fret ${fret} sounds MIDI ${expected} but the note ` +
          `stores MIDI ${pitchMidi} (off by ${pitchMidi - expected}).`,
      })
    }
  }
  return mismatches
}
