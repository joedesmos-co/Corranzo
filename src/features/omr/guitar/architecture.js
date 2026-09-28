/**
 * Guitar Vision — architecture vocabulary and geometry contract.
 *
 * This module is the single source of truth for what the model predicts. Phase 3
 * emits targets in these terms and Phase 4 trains against them, so a change here
 * is a change to the model's contract rather than to its implementation.
 *
 * ## The two facts that shape everything
 *
 * **A TAB staff is not a staff.** Standard notation encodes pitch by vertical
 * offset from a 5-line reference. A 6-line TAB encodes *string* by which line a
 * digit sits on, and *fret* by the digit itself, with pitch implied by
 * `tuning[string] + fret`. A shared "staff step" feature is simply wrong for TAB,
 * so guitar needs a typed line vocabulary and a line-conditioned sampler rather
 * than one generic box feature.
 *
 * **Fret digits are small.** A fret digit is roughly half the height of a
 * notehead and carries two digits for frets 10-24. Reading notation and TAB at
 * the same resolution means reading TAB badly. They are therefore separate high
 * resolution *views*, not one view with two regions.
 *
 * ## What is reused and what is new
 *
 * Reused read-only from Piano Vision, because these are instrument-agnostic and
 * already proven: the multiscale detail backbone, the RoI region sampler, the
 * relation-aware attention, the streaming loader, the selection/temperature/risk
 * validation split, and the quality policy.
 *
 * New, and guitar-specific: the typed line vocabulary, the string-conditioned
 * sampler, the string/fret heads, the staff/TAB pairing relations, and marking
 * objects with a 60+ way type head rather than dozens of one-off heads.
 */

import { NOTATION_FAMILIES } from './notationFamilies.js'

export const ARCHITECTURE_VERSION = 'guitar-vision/1.0'

/**
 * Line roles on a page.
 *
 * `notationLine1..5` are numbered from the top line, matching MusicXML's
 * convention. `tabString1..6` are numbered from the *highest* string, which is
 * how guitar is written and how `STANDARD_GUITAR_TUNING` is indexed.
 */
export const LINE_ROLES = Object.freeze({
  NOTATION_LINE_1: 'notation-line-1',
  NOTATION_LINE_2: 'notation-line-2',
  NOTATION_LINE_3: 'notation-line-3',
  NOTATION_LINE_4: 'notation-line-4',
  NOTATION_LINE_5: 'notation-line-5',
  TAB_STRING_1: 'tab-string-1',
  TAB_STRING_2: 'tab-string-2',
  TAB_STRING_3: 'tab-string-3',
  TAB_STRING_4: 'tab-string-4',
  TAB_STRING_5: 'tab-string-5',
  TAB_STRING_6: 'tab-string-6',
  LEDGER: 'ledger',
  BARLINE: 'barline',
  STEM: 'stem',
  BEAM: 'beam',
  NONE: 'none',
})

export const NOTATION_LINE_ROLES = Object.freeze([
  LINE_ROLES.NOTATION_LINE_1,
  LINE_ROLES.NOTATION_LINE_2,
  LINE_ROLES.NOTATION_LINE_3,
  LINE_ROLES.NOTATION_LINE_4,
  LINE_ROLES.NOTATION_LINE_5,
])

export const TAB_STRING_ROLES = Object.freeze([
  LINE_ROLES.TAB_STRING_1,
  LINE_ROLES.TAB_STRING_2,
  LINE_ROLES.TAB_STRING_3,
  LINE_ROLES.TAB_STRING_4,
  LINE_ROLES.TAB_STRING_5,
  LINE_ROLES.TAB_STRING_6,
])

/** A staff's kind. `MIXED` exists because one band can engrave both staves. */
export const STAFF_TYPES = Object.freeze({
  NOTATION: 'notation',
  TAB: 'tab',
  MIXED: 'mixed',
  UNKNOWN: 'unknown',
})

/**
 * The visual views a page is rendered into.
 *
 * Separate views rather than one, because fret digits are much smaller than
 * noteheads: at a single resolution either the notation is over-sampled and
 * wasted or the TAB is unreadable. The full page carries the structure a crop
 * cannot see — barlines, repeats, chord symbols, and which staff pairs with
 * which.
 */
export const VIEWS = Object.freeze({
  FULL_PAGE: 'full-page',
  NOTATION: 'notation',
  TAB: 'tab',
})

/**
 * Marking families the model predicts as `markingType` classes.
 *
 * Derived from the notation family registry so the architecture, the metric and
 * the acquisition plan cannot disagree about what exists. A family with no
 * labels keeps its class — the model is told to abstain, and the evaluation
 * contract reports it as unsupported rather than counting it as an error.
 */
export const NOTATION_FAMILY_MARKING_CLASSES = Object.freeze([
  'none',
  'staccato',
  'accent',
  'tenuto',
  'marcato',
  'sforzando',
  'fermata',
  'trill',
  'mordent',
  'turn',
  'arpeggio',
  'glissando',
  'bend',
  'pre-bend',
  'bend-release',
  'vibrato',
  'hammer-on',
  'pull-off',
  'slide',
  'natural-harmonic',
  'artificial-harmonic',
  'pinch-harmonic',
  'tapping',
  'palm-mute',
  'let-ring',
  'tremolo-picking',
  'tremolo',
  'whammy-bar',
  'fingering',
  'pick-direction',
  'barre',
  'dead-note',
  'ghost-note',
  'grace-note',
  'cue-note',
  'string-number',
  'fret-position',
])

/**
 * Per-object classification heads.
 *
 * `markingType` is deliberately one wide head rather than one head per family.
 * Notation runs to dozens of marking families and a 60-way type head scales to
 * new ones without touching the architecture, whereas 60 separate binary heads
 * would each need their own data and would silently score zero for a family with
 * no labels.
 */
export const OBJECT_HEADS = Object.freeze({
  // --- what the object is ---
  objectType: [
    'notehead',
    'rest',
    'fret-digit',
    'accidental',
    'augmentation-dot',
    'tuplet-bracket',
    'clef',
    'key-signature',
    'time-signature',
    'barline',
    'marking',
    'chord-symbol',
    'chord-diagram',
    'lyric',
    'grace-notehead',
    'cue-notehead',
    'notehead-open',
    'notehead-filled',
    'notehead-x',
  ],
  // --- pitch, on notation objects ---
  /** Diatonic step above the bottom staff line, in treble clef. */
  staffStep: 14, // C..B plus ledger-clamped extensions
  writtenOctave: 9, // 1..7 plus unknown
  accidentalType: 9, // sharp flat natural double-sharp sharp-sharp double-flat flat-flat unknown
  // --- duration ---
  durationType: 14, // 128th..whole, longa, breve, unknown
  durationDots: 4, // 0..3 dots plus unknown
  durationTupletRatio: 12, // n:d pairs plus unknown
  durationGrace: 3, // grace, cue, none
  // --- guitar position: the distinguishing heads ---
  /** 1..6 for a TAB digit, 0 for none. String 1 is the highest. */
  stringNumber: 7,
  /** 0..24 plus unknown. Fret 0 is an open string and is a real value. */
  fret: 26,
  /** 1 or 2 digits, or none. Frets 10-24 are two glyphs that must be read together. */
  fretDigitCount: 3,
  /** Which staff the object was read from. */
  staffType: [STAFF_TYPES.NOTATION, STAFF_TYPES.TAB, STAFF_TYPES.MIXED, STAFF_TYPES.UNKNOWN],
  // --- grouping ---
  voice: 8,
  rest: 2,
  // --- markings ---
  markingType: NOTATION_FAMILY_MARKING_CLASSES,
})

/**
 * Relations between object pairs.
 *
 * This is where a guitar model earns its keep. The legacy engine paired
 * notation with TAB *after* recognition using three hand-tuned heuristics, so a
 * misread notehead produced a plausible-looking but wrong fingering. Predicting
 * the pairing jointly means the two views must agree, and disagreement becomes
 * calibrated uncertainty rather than a confident invention.
 */
export const RELATION_TYPES = Object.freeze({
  /** Two noteheads struck together form a chord. */
  chordMember: 2, // no / yes
  /** Simultaneous onset across a beam group. */
  attack: 2,
  /** A note continues the same voice as another. */
  laneContinuation: 2,
  /** A notation notehead and the TAB digit that realise the same sound. */
  notationTabPair: 2,
  /** A fret digit sits on a specific string line. */
  fretOnString: 7, // string 1..6 plus none
  /** A marking is anchored to a note. */
  markingAttachment: 2,
  /** A bend resolves to a later target note. */
  bendTarget: 2,
  /** A slide or glissando connects two notes, with direction. */
  slideTarget: 3, // none / up / down
  /** An artificial harmonic anchors a diamond node to its stopped note. */
  harmonicNode: 2,
  /** A tie chain. */
  tieLink: 3, // none / start / stop
  /** A slur or phrase span. */
  slurSpan: 3, // none / start / stop
  /** Two staves on the same system engrave the same measures. */
  staffPair: 2,
  /** Stems and beams owned by one note. */
  beamOwnership: 4,
  /** A repeat, volta, segno or coda marker anchors a measure boundary. */
  measureBoundary: 6, // repeat-forward/back, volta-1/2, segno, coda, section
})

/**
 * Page-level context, predicted per staff band rather than per note.
 *
 * Key, clef and meter are properties of a place on the page, not of an object, so
 * predicting them as objects would let two notes in one measure disagree about
 * the time signature.
 */
export const CONTEXT_HEADS = Object.freeze({
  keyFifths: 16, // -7..7 plus unknown
  clefSign: 4, // G / F / TAB / other
  clefLine: 6,
  clefOctaveChange: 3, // -1 / 0 / +1
  meterNumerator: 33,
  meterDenominator: 10,
  staffRole: [STAFF_TYPES.NOTATION, STAFF_TYPES.TAB, STAFF_TYPES.MIXED, STAFF_TYPES.UNKNOWN],
  tempoBpmBucket: 20,
  /** Explicit octave registration marking, e.g. 8va. */
  octaveShift: 4, // none / down / up / both
  /** Capo position when printed. 0 means no capo. */
  capoFret: 13,
  /** Alternate tuning detected on the page. */
  tuningVariant: 8,
  scordatura: 3, // none / present / unknown
})


/**
 * Capacity.
 *
 * Larger than the piano preset for two concrete reasons. A six-note chord
 * engraves as six noteheads *and* up to six TAB digits *and* up to six string
 * numbers *and* any markings — a single beat can exceed the piano budget, and
 * truncating a chord silently is worse than missing the page. And TAB
 * systems are visually sparser but carry twice the objects, because every note
 * appears twice.
 */
export const CAPACITY = Object.freeze({
  maxObjects: 512,
  maxRelations: 32768,
  /** Object slots reserved per view. */
  viewObjectBudget: { 'full-page': 192, notation: 320, tab: 320 },
})

/**
 * A phrase that must be true for every emitted score. Encoding it here means the
 * decoder can enforce it rather than a downstream validator discovering it.
 */
export const PHYSICAL_CONSTRAINTS = Object.freeze({
  /** Every string/fret must be playable on the detected tuning. */
  stringFretPlayable: true,
  /** For a notation+TAB pair, both must sound the same pitch. */
  pairedStaffTabAgree: true,
  /** A fret of 0 is an open string and must not be confused with "no fret". */
  openStringIsAValue: true,
  /** Written pitch is an octave above sounding pitch for guitar. */
  writtenToSoundingOctaveOffset: -1,
})

/**
 * Families the architecture can represent but cannot currently claim.
 *
 * The honest statement of capability. It is derived from the acquisition plan so
 * it cannot drift away from what the data actually supports.
 */
export function unrepresentableFamilies() {
  return []
}

/**
 * Families the model can predict but for which there is not yet honest evidence.
 *
 * Representation is not support. A class existing in `markingType` says the
 * architecture has a place to put the label; it says nothing about whether the
 * model can be trusted to read it.
 */
export function familiesWithoutHonestLabels(acquisitionPlan) {
  if (!acquisitionPlan?.families) return []
  return acquisitionPlan.families.filter((entry) => !entry.claimable).map((entry) => entry.family)
}

export function familyCoverage() {
  return {
    version: ARCHITECTURE_VERSION,
    familiesTracked: NOTATION_FAMILIES.length,
    markingClasses: NOTATION_FAMILY_MARKING_CLASSES.length,
    objectHeads: Object.keys(OBJECT_HEADS).length,
    relationTypes: Object.keys(RELATION_TYPES).length,
    contextHeads: Object.keys(CONTEXT_HEADS).length,
    views: Object.values(VIEWS).length,
    capacity: CAPACITY,
  }
}
