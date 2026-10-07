/**
 * Guitar Vision — per-object extraction for strict evaluation.
 *
 * Converts a parsed MusicXML score into flat, comparable object lists:
 * note objects (one per notated note, rest or pitched) and marking objects
 * (ties, slurs, articulations, dynamics, techniques, text, repeats, …).
 *
 * ## Why objects rather than bags
 *
 * The Phase 0 audit found the existing metric reporting 100% pitch accuracy
 * while order-sensitive recovery was 0% and not one matched note had a correct
 * onset time. A bag metric can award credit for a pitch that is right in
 * isolation but attached to the wrong note, the wrong onset, or the wrong
 * chord. Per-object scoring requires a one-to-one identity assignment first,
 * so every attribute score below is conditional on having identified *the same
 * musical object* in both scores.
 *
 * Extraction is pure and side-effect free so it can be unit tested and so the
 * same objects can feed metrics, data generation and coverage reporting.
 */

import { STANDARD_GUITAR_TUNING } from '../../instruments/instruments.js'
import { soundingFromTab } from './pitchContract.js'

/**
 * Note-object attributes scored per matched pair. Each is compared only after
 * an identity assignment, so none of them can be satisfied by a note elsewhere
 * in the score.
 */
export const NOTE_ATTRIBUTES = Object.freeze([
  'noteVsRest',
  'soundingPitch',
  'writtenPitch',
  'onset',
  'duration',
  'dots',
  'tuplet',
  'string',
  'fret',
  'voice',
  'staff',
  'accidentals',
])

/**
 * Marking families compared as sets rather than per note. Each becomes its own
 * precision/recall so a model cannot hide a missing notation family inside an
 * aggregate.
 */
export const MARKING_FAMILIES = Object.freeze([
  'tie',
  'slur',
  'staccato',
  'accent',
  'tenuto',
  'marcato',
  'fermata',
  'dynamic',
  'hairpin',
  'tempoMarking',
  'performanceText',
  'repeat',
  'ending',
  'segno',
  'coda',
  'graceNote',
  'cueNote',
  'ghostNote',
  'deadNote',
  // Guitar-specific technique families
  'hammerOn',
  'pullOff',
  'slide',
  'glissando',
  'bend',
  'preBend',
  'bendRelease',
  'bendAmount',
  'vibrato',
  'naturalHarmonic',
  'artificialHarmonic',
  'pinchHarmonic',
  'tapping',
  'palmMute',
  'letRing',
  'tremoloPicking',
  'tremolo',
  'whammyBar',
  'fingering',
  'pickDirection',
  'barre',
  'chordSymbol',
  'chordDiagram',
  'capo',
  'tuning',
  'octaveShift',
  'arpeggio',
  'golpe',
  'trill',
  'mordent',
  'turn',
  'staccatissimo',
  'breathMark',
  'tremoloPicking',
  'lyric',
  'rehearsal',
  'fine',
  'toCoda',
  'daCapo',
  'dalSegno',
  'soundJump',
  'unresolvedText',
  'positionMark',
])

function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

function tupletKey(note) {
  const modification = note.timeModification
  if (!modification) return null
  return `${modification.actualNotes ?? '?'}:${modification.normalNotes ?? '?'}`
}

function accidentalKey(note) {
  if (!note.accidental?.type) return null
  return note.accidental.type
}

function writtenPitchKey(note) {
  const written = note.writtenPitch
  if (!written?.step) return null
  return `${String(written.step).toUpperCase()}:${written.alter ?? 0}:${written.octave}`
}

/**
 * Every marking token carried by a note. Family membership is derived from the
 * parsed representation rather than raw text so the same normaliser serves
 * MusicXML, MXL and future import formats.
 */
function noteMarkingTokens(note) {
  const tokens = []
  if (note.tieStart) tokens.push('tie')
  if ((note.slurs ?? []).length) tokens.push('slur')
  if (note.staccato) tokens.push('staccato')
  if (note.staccatissimo) tokens.push('staccatissimo')
  if (note.breathMark) tokens.push('breath-mark')
  if (note.accent) tokens.push('accent')
  if (note.tenuto) tokens.push('tenuto')
  if (note.marcato) tokens.push('marcato')
  if (note.fermata) tokens.push('fermata')
  for (const other of note.otherArticulations ?? []) {
    if (other?.kind) tokens.push(normalizeToken(other.kind))
  }
  if (note.notehead && note.notehead.value && note.notehead.value !== 'normal') {
    tokens.push(`notehead-${normalizeToken(note.notehead.value)}`)
  }
  if (note.notehead?.value === 'x') tokens.push('dead-note')
  if (note.lyric?.text) tokens.push('lyric')
  if (note.fingering?.length) tokens.push('fingering')
  if (note.pluck) tokens.push('pluck')
  for (const technique of note.guitarTechniques ?? []) {
    tokens.push(normalizeToken(technique.kind))
    if (technique.number != null) tokens.push(`${normalizeToken(technique.kind)}-amount`)
    if (technique.bend?.alterSemitones != null) tokens.push('bend-amount')
    if (technique.harmonic) tokens.push(technique.harmonic.artificial ? 'artificial-harmonic' : 'natural-harmonic')
  }
  for (const technique of note.guitarTechniques ?? []) {
    tokens.push(normalizeToken(technique.kind))
    if (technique.number != null) tokens.push(`${normalizeToken(technique.kind)}-amount`)
  }
  for (const family of ['hammer-on', 'pull-off', 'slide', 'glissando', 'bend']) {
    if (note.technical?.[family] || note[`${family}Start`]) tokens.push(family)
  }
  if (note.bend != null) tokens.push('bend')
  if (note.technical?.hammerOn) tokens.push('hammer-on')
  if (note.technical?.pullOff) tokens.push('pull-off')
  if (note.technical?.vibrato) tokens.push('vibrato')
  if (note.technical?.palmMute) tokens.push('palm-mute')
  if (note.technical?.letRing) tokens.push('let-ring')
  if (note.technical?.fingering != null) tokens.push('fingering')
  if (note.technical?.pickDirection) tokens.push('pick-direction')
  if (note.technical?.string != null) tokens.push('string-number')
  if (note.fretPosition != null) tokens.push('fret-position')
  return tokens
}

/**
 * Build note objects from a parsed score.
 *
 * `onAbsolute` is the cumulative onset in divisions across the part, which is
 * what makes onsets comparable between two independently parsed scores whose
 * per-measure division grids may differ.
 */
export function extractNoteObjects(parsed, { divisionsPerQuarter = 480 } = {}) {
  const objects = []
  const notes = parsed.notes ?? []

  for (const note of notes) {
    const measure = note.measureNumber ?? 0
    // A local position inside the measure, in quarter notes, is stable across
    // differing division grids; absolute measure+position is used for matching.
    const positionInMeasure = note.quarterTime ?? 0
    objects.push({
      kind: 'note',
      id: note.id ?? `${note.partId}:${measure}:${objects.length}`,
      partId: note.partId,
      measureNumber: measure,
      positionInMeasure,
      staff: note.staff ?? 1,
      voice: note.voice ?? 1,
      isRest: Boolean(note.isRest),
      isChord: Boolean(note.isChord),
      isGrace: Boolean(note.isGrace),
      soundingMidi: note.isRest ? null : (note.midi ?? null),
      writtenPitch: note.isRest ? null : writtenPitchKey(note),
      durationQuarters: note.durationQuarters ?? null,
      durationDivisions: note.durationDivisions ?? null,
      noteType: note.noteType ?? null,
      dots: note.dots ?? 0,
      tuplet: tupletKey(note),
      string: note.string ?? null,
      fret: note.fret ?? null,
      accidental: accidentalKey(note),
      isTabMirror: Boolean(note.suppressPlaybackAttack),
      markingTokens: noteMarkingTokens(note),
      divisionsPerQuarter,
    })
  }
  return objects
}

/**
 * Build marking objects from a parsed score. Each carries a type, an anchor
 * (the measure and position it attaches to) and a payload, so two markings are
 * only considered the same marking when they are the same kind in the same
 * place with the same content.
 */
export function extractMarkingObjects(parsed) {
  const markings = []
  const push = (family, anchor, payload = {}) => {
    markings.push({
      kind: 'marking',
      family,
      measureNumber: anchor.measureNumber ?? 0,
      positionInMeasure: anchor.positionInMeasure ?? 0,
      staff: anchor.staff ?? null,
      voice: anchor.voice ?? null,
      payload: typeof payload === 'string' ? { text: normalizeToken(payload) } : payload,
    })
  }

  for (const note of parsed.notes ?? []) {
    const anchor = {
      measureNumber: note.measureNumber ?? 0,
      positionInMeasure: note.quarterTime ?? 0,
      staff: note.staff ?? 1,
      voice: note.voice ?? 1,
    }
    if (note.tieStart) push('tie', anchor)
    for (const slur of note.slurs ?? []) push('slur', anchor, { number: slur.number ?? 1 })
    if (note.staccato) push('staccato', anchor)
    if (note.staccatissimo) push('staccatissimo', anchor)
    if (note.breathMark) push('breathMark', anchor)
    if (note.accent) push('accent', anchor)
    if (note.tenuto) push('tenuto', anchor)
    if (note.marcato) push('marcato', anchor)
    if (note.fermata) push('fermata', anchor)
    for (const other of note.otherArticulations ?? []) {
      if (other?.kind) push(normalizeToken(other.kind), anchor)
    }
    if (note.isGrace) push('graceNote', anchor)
    if (note.isCue) push('cueNote', anchor)
    if (note.notehead?.value === 'x') push('deadNote', anchor)
    if (note.notehead?.parentheses === 'yes') push('ghostNote', anchor)
    if (note.lyric?.text) push('lyric', anchor, { text: normalizeToken(note.lyric.text) })
    if (note.fingering?.length) push('fingering', anchor, { text: note.fingering.map((f) => f.value ?? f).join(',') })
    if (note.pluck || note.pickDirection) {
      push('pickDirection', anchor, { text: normalizeToken(note.pickDirection ?? note.pluck) })
    }
    for (const technique of note.guitarTechniques ?? []) {
      const family = techniqueFamilyOf(technique)
      if (!family) continue
      push(family, anchor, techniquePayloadOf(technique))
    }
    for (const [key, value] of Object.entries(note.technical ?? {})) {
      if (!value) continue
      push(normalizeToken(key), anchor, { text: typeof value === 'string' ? normalizeToken(value) : null })
    }
    if (note.fretPosition != null) push('fretPosition', anchor, { number: note.fretPosition })
  }

  for (const dynamic of parsed.dynamics ?? []) {
    push('dynamic', { measureNumber: dynamic.measureNumber ?? 0, positionInMeasure: dynamic.quarterTime ?? 0 }, {
      text: normalizeToken(dynamic.mark ?? dynamic.text),
    })
  }
  for (const wedge of parsed.wedgeSpans ?? []) {
    push('hairpin', { measureNumber: wedge.measureNumber ?? 0 }, {
      text: normalizeToken(wedge.type ?? wedge.wedgeType),
    })
  }
  for (const tempo of parsed.tempoChanges ?? []) {
    push('tempoMarking', { measureNumber: tempo.measureNumber ?? 0 }, {
      text: String(tempo.bpm ?? ''),
    })
  }
  for (const repeat of parsed.repeats ?? []) {
    push('repeat', { measureNumber: repeat.measureNumber ?? 0 }, {
      text: normalizeToken(repeat.direction ?? repeat.type),
    })
  }
  for (const chord of parsed.harmonyEvents ?? []) {
    push('chordSymbol', { measureNumber: chord.measureNumber ?? 0 }, {
      text: normalizeToken(chord.name ?? chord.root),
    })
  }

  for (const mark of parsed.scoreMarks ?? []) {
    const family = scoreMarkFamilyOf(mark.kind)
    if (!family) continue
    push(family, { measureNumber: mark.measureNumber ?? 0, positionInMeasure: mark.quarterTime ?? 0, staff: mark.staff ?? null }, {
      text: normalizeToken(mark.sourceText ?? mark.kind),
    })
  }

  for (const frame of parsed.frames ?? []) {
    push('chordDiagram', { measureNumber: frame.measureNumber ?? 0, positionInMeasure: frame.quarterTime ?? 0 }, {
      text: `${frame.frame?.strings ?? '?' }x${frame.frame?.frets ?? '?'}`,
    })
  }

  return markings
}

/**
 * Technique kind (kebab-case, as encoded) to marking family (camelCase, as
 * scored). Unknown kinds return null: they stay visible in canonical truth
 * quarantine, never in a scored family they do not belong to.
 */
export function techniqueFamilyOf(technique) {
  const kind = String(technique?.kind ?? '').toLowerCase()
  switch (kind) {
    case 'hammer-on': return 'hammerOn'
    case 'pull-off': return 'pullOff'
    case 'slide': return 'slide'
    case 'glissando': return 'glissando'
    case 'bend': return 'bend'
    case 'harmonic': return technique?.harmonic?.artificial ? 'artificialHarmonic' : 'naturalHarmonic'
    case 'tapping': return 'tapping'
    case 'palm-mute': return 'palmMute'
    case 'let-ring': return 'letRing'
    case 'golpe': return 'golpe'
    case 'vibrato': return 'vibrato'
    case 'tremolo-picking': return 'tremoloPicking'
    case 'arpeggio': return 'arpeggio'
    case 'trill': return 'trill'
    case 'mordent': return 'mordent'
    case 'turn': return 'turn'
    case 'shake': return 'turn'
    default: return null
  }
}

function techniquePayloadOf(technique) {
  const payload = { text: technique.text ?? null, number: technique.number ?? null }
  if (technique.bend?.alterSemitones != null) payload.semitones = technique.bend.alterSemitones
  if (technique.marks != null) payload.marks = technique.marks
  return payload
}

/** Score-mark kind to marking family. Navigation variants fold with payload. */
export function scoreMarkFamilyOf(kind) {
  switch (String(kind ?? '')) {
    case 'segno': return 'segno'
    case 'coda': return 'coda'
    case 'rehearsal': return 'rehearsal'
    case 'fine': return 'fine'
    case 'to-coda': return 'toCoda'
    case 'da-capo':
    case 'da-capo-al-fine':
    case 'da-capo-al-coda': return 'daCapo'
    case 'dal-segno':
    case 'dal-segno-al-fine':
    case 'dal-segno-al-coda': return 'dalSegno'
    case 'sound-jump': return 'soundJump'
    case 'capo': return 'capo'
    case 'barre': return 'barre'
    case 'position': return 'positionMark'
    case 'octave-shift': return 'octaveShift'
    case 'unresolved-text': return 'unresolvedText'
    default: return null
  }
}

/**
 * Physical-plausibility check: can this string/fret actually sound this pitch?
 *
 * This is the "staff/TAB consistency" measure. It is deliberately reported
 * separately from raw string/fret agreement, because a score can copy the
 * right digits onto the wrong strings and still be internally consistent while
 * being physically impossible to play.
 */
export function tabConsistencyOf(noteObject, { tuning = STANDARD_GUITAR_TUNING, capoFret = 0 } = {}) {
  if (noteObject.isRest) return null
  if (noteObject.string == null || noteObject.fret == null) return null
  if (!Number.isFinite(noteObject.soundingMidi)) return null
  const expected = soundingFromTab(noteObject.string, noteObject.fret, { tuning, capoFret })
  if (expected == null) return { consistent: false, reason: 'impossible-position', expected: null }
  return {
    consistent: expected === noteObject.soundingMidi,
    expectedSoundingMidi: expected,
    actualSoundingMidi: noteObject.soundingMidi,
    deltaSemitones: noteObject.soundingMidi - expected,
  }
}
