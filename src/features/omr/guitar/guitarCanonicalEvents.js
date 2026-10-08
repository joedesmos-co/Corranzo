/**
 * Guitar Vision — canonical GuitarEvent truth representation (G3/G4/G5).
 *
 * A GuitarEvent is the unit of playable truth the next training campaign
 * learns. It is built deterministically from symbolic source (parseMusicXml
 * output), never guessed from pixels:
 *
 * - time/onset/duration in quarter notes (divisions-independent),
 * - measure-relative position + voice + staff,
 * - pitch (sounding MIDI + spelling), string/fret with verified pairing (G4),
 * - rhythm truth: dots, tuplet ratio, tie chain, beams, grace/chord flags (G5),
 * - techniques[] with parameters (bend semitones/prebend/release, slide
 *   direction, hammer/pull pairing), articulations[], dynamics context,
 * - source IDs (fixture/part/measure/index) and support state per G0.
 *
 * Invalid or unverifiable data is quarantined, never silently repaired (G6
 * reports it; this module collects it).
 */

import { soundingFromTab } from './pitchContract.js'
import { STANDARD_GUITAR_TUNING } from '../../instruments/instruments.js'
import { classifySourceElement, SUPPORT } from './guitarVocabulary.js'
import { isMinedText } from '../../musicxml/guitarTextMarks.js'

export const GUITAR_EVENT_SCHEMA_VERSION = 'guitar-event/1.0'

/** Natural harmonic sounding offsets above the open string, by touched fret. */
export const NATURAL_HARMONIC_OFFSETS = Object.freeze({ 12: 12, 7: 19, 5: 24 })

const PITCH_CLASS = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })

/** MIDI for a preserved technical pitch {step, alter, octave}, or null. */
function techPitchMidi(pitch) {
  if (!pitch || !pitch.step || !Number.isFinite(pitch.octave)) return null
  const base = PITCH_CLASS[String(pitch.step).toUpperCase()]
  if (base == null) return null
  return (pitch.octave + 1) * 12 + base + (Number(pitch.alter) || 0)
}

/**
 * Shared string/fret→pitch verification (canonical truth AND playability
 * use this one function so they can never disagree). Returns
 * { status: 'verified'|'quarantined'|'unplayable', expected, candidates }.
 *
 * Natural harmonics sound the series, not the stopped pitch; artificial
 * harmonics arbitrate via the preserved sounding/touching/base triple.
 */
export function verifyPairing(string, fret, midi, { tuning, capoFret = 0, techniques = [] } = {}) {
  const expected = soundingFromTab(string, fret, { tuning, capoFret })
  if (expected == null || !Number.isFinite(midi)) {
    return { status: 'unplayable', expected, candidates: [] }
  }
  const harmonic = (techniques ?? []).find((t) => t.kind === 'harmonic')
  const candidates = [expected]
  if (harmonic && !harmonic.artificial && NATURAL_HARMONIC_OFFSETS[fret] != null) {
    candidates.push(tuning[string - 1] + capoFret + NATURAL_HARMONIC_OFFSETS[fret])
  }
  if (harmonic?.artificial) {
    for (const key of ['soundingPitch', 'touchingPitch', 'basePitch']) {
      const triple = techPitchMidi(harmonic[key])
      if (triple != null) candidates.push(triple)
    }
  }
  return { status: candidates.includes(midi) ? 'verified' : 'quarantined', expected, candidates }
}

/** Technique kinds the canonical model represents with parameters. */
export const TECHNIQUE_KINDS = Object.freeze([
  'bend', 'slide', 'glissando', 'hammer-on', 'pull-off', 'vibrato',
  'harmonic', 'tapping', 'palm-mute', 'let-ring', 'tremolo-picking',
  'golpe', 'arpeggio', 'trill', 'mordent', 'turn', 'shake',
])

function techniqueFromParsed(raw) {
  if (!raw) return null
  const kind = String(raw.kind ?? '').toLowerCase()
  const numbered = { number: raw.number ?? '1', type: raw.type ?? null }
  switch (kind) {
    case 'bend':
      // Amount, pre-bend and release travel with the technique — never
      // presence-only when the source carries them.
      return { kind: 'bend', semitones: raw.bend?.alterSemitones ?? null, alterRaw: raw.bend?.alterRaw ?? null, prebend: raw.bend?.prebend ?? false, release: raw.bend?.release ?? false, shape: raw.bend?.shape ?? null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'slide':
      return { kind: 'slide', direction: raw.type === 'stop' ? 'into' : 'out', lineType: raw.lineType ?? null, style: null, ...numbered, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'glissando':
      return { kind: 'glissando', direction: raw.type === 'stop' ? 'into' : 'out', lineType: raw.lineType ?? null, ...numbered, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'hammer-on':
      return { kind: 'hammer-on', ...numbered, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'pull-off':
      return { kind: 'pull-off', ...numbered, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'harmonic':
      return { kind: 'harmonic', artificial: raw.harmonic?.artificial ?? false, natural: raw.harmonic?.natural ?? false, basePitch: raw.harmonic?.basePitch ?? null, touchingPitch: raw.harmonic?.touchingPitch ?? null, soundingPitch: raw.harmonic?.soundingPitch ?? null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'tapping':
      return { kind: 'tapping', hand: raw.hand ?? raw.tap?.hand ?? null, fret: raw.tap?.fret ?? null, ...numbered, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'palm-mute':
      return { kind: 'palm-mute', spanType: raw.type ?? null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'let-ring':
      return { kind: 'let-ring', spanType: raw.type ?? null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'golpe':
      return { kind: 'golpe', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'vibrato':
      return { kind: 'vibrato', width: null, source: raw.text != null ? 'other-technical' : 'wavy-line', ...numbered, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'tremolo-picking':
      return { kind: 'tremolo-picking', marks: raw.marks ?? null, strokeType: raw.type ?? null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'arpeggio':
      return { kind: 'arpeggio', direction: raw.direction ?? null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'trill':
    case 'mordent':
    case 'turn':
    case 'shake':
      return { kind, ...numbered, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    default: {
      // G0: an unrecognised technique kind is AMBIGUOUS, never dropped.
      const verdict = classifySourceElement(kind.replace(/^technical:/, ''))
      return { kind, support: verdict.support, reason: verdict.reason ?? 'unmodelled technique kind', params: null }
    }
  }
}

/**
 * G0 gap audit over the RAW source XML.
 *
 * Catches what the symbolic parser cannot represent, so a canonical layer
 * built on parsed output never inherits a silent drop. When the caller passes
 * `rawXml`, every such element becomes a quarantine entry instead.
 *
 * The audit mirrors the parser's knowledge: anything the parser populates
 * into structured fields (harmonics, palm-mute, frames, segno/coda, notehead
 * shapes, bend parameters, ...) is NOT flagged here. Only genuinely
 * unrepresented content is.
 *
 * One entry per distinct element name per score: the audit answers "what was
 * dropped", per-event pairing answers "where".
 */
const KNOWN_TECHNICAL_CHILDREN = new Set([
  'string', 'fret', 'hammer-on', 'pull-off', 'bend', 'harmonic',
  'tapped', 'tap', 'palm-mute', 'let-ring', 'golpe', 'other-technical',
  'fingering', 'pluck', 'up-bow', 'down-bow', 'open-string', 'stopped',
])
const KNOWN_ARTICULATION_CHILDREN = new Set([
  'staccato', 'accent', 'tenuto', 'strong-accent', 'marcato',
  'staccatissimo', 'breath-mark',
])
const UNSUPPORTED_SCORE_ELEMENTS = new Set([
  // Multi-measure-rest counts: the rest itself parses, the span count does not.
  'measure-style',
])

export function auditRawXmlGaps(xml, { includeNonSoundingNotes = false } = {}) {
  const source = typeof xml === 'string' ? xml : ''
  if (!source) return []
  const gaps = []
  const seen = new Set()
  const flag = (code, element, detail) => {
    const key = `${code}:${element}`
    if (seen.has(key)) return
    seen.add(key)
    gaps.push({ eventId: null, code, element, detail })
  }

  for (const block of source.match(/<technical>[\s\S]*?<\/technical>/g) ?? []) {
    // Subtrees the parser resolves with parameters (bend, harmonic) are not
    // re-scanned: their children are represented, not dropped.
    const resolved = block
      .replace(/<bend>[\s\S]*?<\/bend>/g, '<bend/>')
      .replace(/<harmonic>[\s\S]*?<\/harmonic>/g, '<harmonic/>')
    for (const tag of resolved.match(/<([a-z-]+)(?=[\s/>])/g) ?? []) {
      const name = tag.slice(1)
      if (name === 'technical' || KNOWN_TECHNICAL_CHILDREN.has(name)) continue
      // Bend parameters live under <bend> and are parsed with parameters.
      if (['bend-alter', 'pre-bend', 'release'].includes(name)) continue
      const verdict = classifySourceElement(name)
      flag('unmodelled-technique-flag', name,
        `<${name}> inside <technical> is not populated by the parser (${verdict.support})`)
    }
    // <other-technical> is only interpreted when its text matches vibrato.
    // Any other free-text technique (whammy, P.H., S.V.) is preserved by the
    // parser as other-technical but uninterpretable as a family.
    for (const match of block.match(/<other-technical>([^<]*)<\/other-technical>/g) ?? []) {
      const text = match.replace(/<\/?other-technical>/g, '')
      if (!/vib(?:rato)?/i.test(text)) {
        flag('unmodelled-technique-flag', 'other-technical',
          `<other-technical>${text}</other-technical> is preserved but matches no technique family`)
      }
    }
  }
  for (const block of source.match(/<articulations>[\s\S]*?<\/articulations>/g) ?? []) {
    for (const tag of block.match(/<([a-z-]+)(?=[\s/>])/g) ?? []) {
      const name = tag.slice(1)
      if (name === 'articulations' || KNOWN_ARTICULATION_CHILDREN.has(name)) continue
      flag('unmodelled-articulation', name,
        `<${name}> inside <articulations> is preserved but untyped by the parser`)
    }
  }
  for (const element of UNSUPPORTED_SCORE_ELEMENTS) {
    if (new RegExp(`<${element}(?=[\\s/>])`).test(source)) {
      const verdict = classifySourceElement(element)
      flag('unsupported-element', element,
        `<${element}> is parsed as absent (${verdict.support}${verdict.reason ? `: ${verdict.reason}` : ''})`)
    }
  }

  if (/<grace(?=[\s/>])/.test(source) && !includeNonSoundingNotes) {
    flag('grace-dropped', 'grace', 'grace notes are dropped from the parsed note list; parse with includeNonSoundingNotes for zero-duration events')
  }

  // Only unmined free text quarantines: capo/position/barre/navigation words
  // resolve into scoreMarks with their source text retained.
  for (const match of source.match(/<words>([^<]*)<\/words>/g) ?? []) {
    const text = match.replace(/<\/?words>/g, '')
    if (text.trim() && !isMinedText(text)) {
      flag('ignored-text-direction', 'words', `free-text <words>${text.trim()}</words> matches no known pattern and is not interpreted`)
    }
  }
  return gaps
}

/**
 * Build canonical events from parsed MusicXML.
 *
 * Guitar truth callers parse with `{ includeNonSoundingNotes: true }` so
 * grace notes arrive as zero-duration events; the rhythm layer counts no
 * time for them either way.
 *
 * @param {object} parsed  parseMusicXml() output
 * @param {object} [options] { tuning, capoFret, sourceId, rawXml }
 * @returns {{ version, events, pairings, relations, quarantined, rhythm }}
 */
export function canonicalEventsFromParsed(parsed, options = {}) {
  const tuning = options.tuning ?? firstTuning(parsed) ?? STANDARD_GUITAR_TUNING
  // Capo is text-mined by the parser (MusicXML has no capo element); an
  // explicit option still wins, and 0 means open strings throughout.
  const capoFret = options.capoFret ?? parsed.capo?.fret ?? 0
  const sourceId = options.sourceId ?? parsed.fileName ?? 'unknown-source'
  const quarantined = []

  const notes = (parsed.notes ?? []).filter((note) => !note.isTabMirror)
  const tabMirrors = (parsed.notes ?? []).filter((note) => note.isTabMirror)
  const tabStaves = tabStavesByPart(parsed)

  // The parser merges tie-stop durations into the chain head for playback
  // sustain (applyTieSustainToNotes). Notation truth needs the opposite: each
  // segment keeps its notated duration in its own measure, so de-merge here.
  // Chain members remain one sounding event via their shared tieChainId.
  const chainMembers = new Map()
  for (const note of notes) {
    if (note.tieChainId) {
      if (!chainMembers.has(note.tieChainId)) chainMembers.set(note.tieChainId, [])
      chainMembers.get(note.tieChainId).push(note)
    }
  }
  const notatedDuration = new Map()
  for (const [, members] of chainMembers) {
    const ordered = [...members].sort((a, b) => (a.quarterTime ?? 0) - (b.quarterTime ?? 0))
    const head = ordered[0]
    const absorbed = ordered.slice(1).reduce((sum, m) => sum + (m.durationQuarters ?? 0), 0)
    const restored = (head.durationQuarters ?? 0) - absorbed
    if (restored < -1e-9) {
      quarantined.push({ eventId: null, code: 'tie-chain-corrupt', detail: `chain ${head.tieChainId} absorbs more than the head holds` })
      notatedDuration.set(head, head.durationQuarters ?? 0)
    } else {
      notatedDuration.set(head, Math.max(0, restored))
    }
  }

  // Index TAB mirrors by onset+pitch for G4 pairing verification.
  const mirrorsByKey = new Map()
  for (const mirror of tabMirrors) {
    const key = `${mirror.quarterTime.toFixed(6)}|${mirror.midi}`
    if (!mirrorsByKey.has(key)) mirrorsByKey.set(key, [])
    mirrorsByKey.get(key).push(mirror)
  }

  const events = []
  const pairings = []
  notes.forEach((note, index) => {
    const eventId = `${sourceId}:e${index}`
    const isTieContinuation = Boolean(note.suppressPlaybackAttack)
    const techniques = (note.guitarTechniques ?? []).map(techniqueFromParsed).filter(Boolean)
    const staffRole = staffRoleOf(note, tabStaves)
    // Cross-check raw technical flags the parser ignores (G0: surface, don't drop).
    for (const [key, value] of Object.entries(note.technical ?? {})) {
      if (value == null || value === false) continue
      if (!techniques.some((t) => t.kind === String(key).toLowerCase())) {
        const verdict = classifySourceElement(key)
        quarantined.push({ eventId, code: 'unmodelled-technique-flag', detail: `${key}: ${verdict.support}${verdict.reason ? ` (${verdict.reason})` : ''}` })
      }
    }

    const event = {
      schema: GUITAR_EVENT_SCHEMA_VERSION,
      id: eventId,
      source: { score: sourceId, partId: note.partId ?? null, measure: note.measureNumber ?? null, noteId: note.id ?? null },
      time: {
        onsetQuarters: round6(note.quarterTime ?? 0),
        durationQuarters: round6(notatedDuration.has(note) ? notatedDuration.get(note) : (note.durationQuarters ?? 0)),
        measureRelativeQuarters: null, // filled below once measures are known
        voice: note.voice ?? 1,
        staff: note.staff ?? 1,
        staffRole,
        tuplet: note.timeModification ? `${note.timeModification.actualNotes}:${note.timeModification.normalNotes}` : null,
        dots: note.dots ?? 0,
        noteType: note.noteType ?? null,
        beams: (note.beams ?? []).map((b) => `${b.number}:${b.value}`),
        stemDirection: note.stemDirection ?? null,
        isGrace: Boolean(note.isGrace),
        isCue: Boolean(note.isCue),
        graceSlash: note.slash ?? null,
        graceKind: note.isGrace ? (note.slash === 'yes' ? 'acciaccatura' : 'appoggiatura') : null,
        isChordTone: Boolean(note.isChord),
        isRest: Boolean(note.isRest),
        isMeasureRest: Boolean(note.isMeasureRest),
        isTieContinuation,
        tieChainId: note.tieChainId ?? null,
        tie: { start: Boolean(note.tieStart), stop: Boolean(note.tieStop) },
      },
      pitch: note.isRest
        ? null
        : {
            soundingMidi: note.midi ?? null,
            step: note.writtenPitch?.step ?? null,
            alter: note.writtenPitch?.alter ?? null,
            octave: note.writtenPitch?.octave ?? null,
            accidental: note.accidental?.type ?? null,
          },
      notehead: note.notehead ?? null,
      deadNote: note.notehead?.value === 'x',
      ghostNote: note.notehead?.parentheses === 'yes',
      tab: note.string != null || note.fret != null
        ? { string: note.string ?? null, fret: note.fret ?? null, pairing: 'explicit', positionKind: positionKindOf(note, tabStaves), source: 'explicit' }
        : { string: null, fret: null, pairing: 'none', positionKind: 'none', source: 'none' },
      techniques,
      articulations: {
        staccato: Boolean(note.staccato),
        accent: Boolean(note.accent),
        tenuto: Boolean(note.tenuto),
        marcato: Boolean(note.marcato),
        fermata: Boolean(note.fermata),
        staccatissimo: Boolean(note.staccatissimo),
        breathMark: Boolean(note.breathMark),
        other: (note.otherArticulations ?? []).map((a) => a.kind),
        slurs: (note.slurs ?? []).map((s) => ({ type: s.type, number: s.number ?? '1' })),
      },
      fingering: {
        left: (note.fingering ?? []).map((f) => f.value),
        right: note.pluck ?? null,
        pick: note.pickDirection ?? null,
        openString: Boolean(note.openString),
      },
      lyric: note.lyric ?? null,
      dynamics: { velocity: note.velocity ?? null },
      support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED,
    }

    // G4: verify string/fret implies the sounding pitch (shared verifier;
    // harmonics arbitrate via series physics / the preserved pitch triple).
    if (!note.isRest && event.tab.string != null && event.tab.fret != null && Number.isFinite(note.midi)) {
      const verdict = verifyPairing(event.tab.string, event.tab.fret, note.midi,
        { tuning, capoFret, techniques: event.techniques })
      if (verdict.status === 'unplayable') {
        quarantined.push({ eventId, code: 'impossible-position', detail: `string ${event.tab.string} fret ${event.tab.fret} is unplayable on ${tuning.length}-string tuning` })
        event.tab.pairing = 'quarantined'
      } else if (verdict.status === 'quarantined') {
        quarantined.push({ eventId, code: 'pairing-pitch-mismatch', detail: `string ${event.tab.string} fret ${event.tab.fret} sounds ${verdict.expected}${verdict.candidates.length > 1 ? ` (harmonic candidates ${verdict.candidates.join('/')})` : ''} but notation stores ${note.midi}` })
        event.tab.pairing = 'quarantined'
      } else {
        event.tab.pairing = 'verified'
      }
    }

    // G4: link the TAB-mirror duplicate when the part engraves both staves.
    if (!note.isRest && Number.isFinite(note.midi)) {
      const key = `${(note.quarterTime ?? 0).toFixed(6)}|${note.midi}`
      const mirrors = mirrorsByKey.get(key)
      if (mirrors?.length) {
        const mirror = mirrors.shift()
        pairings.push({
          scope: 'staff-mirror',
          eventId,
          mirrorNoteId: mirror.id ?? null,
          mirrorStaff: mirror.staff ?? null,
          onsetQuarters: round6(note.quarterTime ?? 0),
          soundingMidi: note.midi,
          verified: (mirror.string ?? null) === (event.tab.string ?? null) || event.tab.string == null,
        })
      }
    }

    events.push(event)
  })

  // A3: cross-part TAB pairing. Notation and TAB often live in separate
  // PARTS (not staves); link them by onset+pitch with tuning verification.
  pairCrossPartTab(events, parsed, { tuning, capoFret, tabStaves }, pairings, quarantined)

  // Measure-relative positions + rhythm round-trip (G5).
  const rhythm = rhythmTruth(events, parsed.measures ?? [], quarantined)

  // G4: technique relationships resolve to event identities, not glyphs.
  const relations = buildTechniqueRelations(events, quarantined)

  // G0: audit the raw source for elements the parser drops silently.
  if (options.rawXml) {
    quarantined.push(...auditRawXmlGaps(options.rawXml, { includeNonSoundingNotes: options.includeNonSoundingNotes }))
  }

  return {
    version: GUITAR_EVENT_SCHEMA_VERSION,
    events,
    pairings,
    relations,
    quarantined,
    rhythm,
    tuning: [...tuning],
    capoFret,
    capo: parsed.capo ?? null,
    navigation: parsed.scoreMarks ?? [],
    frames: parsed.frames ?? [],
  }
}

/**
 * Resolve technique start/stop pairs and destinations across events.
 *
 * Slides, glissandi, hammer-ons and pull-offs pair by (kind, number) within
 * a part+voice in onset order; a bend resolves to the next pitched event in
 * its voice (the note the bend arrives at). Unpaired starts quarantine —
 * they are structurally dangling, not implicitly complete.
 */
export function buildTechniqueRelations(events, quarantined = []) {
  const relations = []
  const ordered = [...events]
    .filter((e) => !e.time.isRest)
    .sort((a, b) => a.time.onsetQuarters - b.time.onsetQuarters || (a.time.isGrace ? -1 : 0))

  const openByKey = new Map()
  for (const event of ordered) {
    const lane = `${event.source.partId}|${event.time.voice}`
    for (const technique of event.techniques ?? []) {
      if (!['slide', 'glissando', 'hammer-on', 'pull-off'].includes(technique.kind)) continue
      // Hammer-ons and pull-offs alternate within one legato chain, so they
      // pair as a family; slides pair as their own family.
      const family = technique.kind === 'slide' || technique.kind === 'glissando' ? 'slide' : 'legato'
      const key = `${lane}|${family}|${technique.number ?? '1'}`
      if (technique.type === 'stop' || (family === 'legato' && technique.type == null && openByKey.has(key))) {
        const start = openByKey.get(key)?.event ?? null
        if (start && start.id !== event.id) {
          relations.push({ kind: family === 'slide' ? 'slide-link' : 'legato-link', technique: technique.kind, fromEventId: start.id, toEventId: event.id, number: technique.number ?? '1' })
          openByKey.delete(key)
          continue
        }
        // A stop with no open start still links backwards to the previous
        // pitched event in its lane (exporters often mark only one side).
        const previous = previousPitched(ordered, event)
        if (previous) {
          relations.push({ kind: family === 'slide' ? 'slide-link' : 'legato-link', technique: technique.kind, fromEventId: previous.id, toEventId: event.id, number: technique.number ?? '1', inferred: true })
          continue
        }
        quarantined.push({ eventId: event.id, code: 'dangling-technique-stop', detail: `${technique.kind} stop with no start and no previous note` })
      } else {
        if (openByKey.has(key)) {
          quarantined.push({ eventId: event.id, code: 'overlapping-technique-start', detail: `${technique.kind} number ${technique.number ?? '1'} starts twice without a stop` })
        }
        openByKey.set(key, { event, technique: technique.kind, family })
      }
    }
  }
  for (const [key, start] of openByKey) {
    const number = start.event.techniques.find((t) => t.kind === start.technique)?.number ?? '1'
    if (start.family === 'legato') {
      // Legato marks are inherently pairwise: an unpaired start arrives at
      // the next pitched event in its lane.
      const next = nextPitched(ordered, start.event)
      if (next) {
        relations.push({ kind: 'legato-link', technique: start.technique, fromEventId: start.event.id, toEventId: next.id, number, inferred: true })
        continue
      }
    }
    quarantined.push({ eventId: start.event.id, code: 'dangling-technique-start', detail: `${start.technique} number ${number} starts with no stop` })
  }

  // Bends arrive at the next pitched event in the same lane. A pre-bend is
  // already bent at the attack, so with no following note it is
  // self-contained (no destination, no quarantine); a normal bend stranded
  // on the final event is structurally dangling.
  for (const event of ordered) {
    const bend = (event.techniques ?? []).find((t) => t.kind === 'bend')
    if (!bend) continue
    const target = nextPitched(ordered, event)
    if (target) {
      relations.push({ kind: 'bend-destination', technique: 'bend', fromEventId: event.id, toEventId: target.id, semitones: bend.semitones ?? null, prebend: bend.prebend, release: bend.release })
    } else if (!bend.prebend) {
      quarantined.push({ eventId: event.id, code: 'bend-no-destination', detail: 'bend on the final event has no arrival note' })
    }
  }
  return relations
}

function laneOf(event) {
  return `${event.source.partId}|${event.time.voice}`
}

function previousPitched(ordered, event) {
  const lane = laneOf(event)
  const earlier = ordered.filter((e) => laneOf(e) === lane && e.time.onsetQuarters < event.time.onsetQuarters && !e.time.isGrace && !e.time.isCue)
  return earlier.length ? earlier[earlier.length - 1] : null
}

function nextPitched(ordered, event) {
  const lane = laneOf(event)
  return ordered.find((e) => laneOf(e) === lane && (e.time.onsetQuarters > event.time.onsetQuarters || (e.time.onsetQuarters === event.time.onsetQuarters && e.id !== event.id && !e.time.isChordTone)) && !e.time.isGrace && !e.time.isCue) ?? null
}

function firstTuning(parsed) {
  for (const part of parsed.parts ?? []) {
    if (Array.isArray(part.tuning) && part.tuning.length) return part.tuning
    // Declared tuning on a standard staff counts: it is still the score's
    // tuning statement (TAB-gated `tuning` stays untouched for consumers).
    if (Array.isArray(part.declaredTuning) && part.declaredTuning.length) return part.declaredTuning
  }
  return null
}

/**
 * Which staves are TAB staves, by part id. A circled string number on the
 * notation staff (string, no fret) is a different claim from a TAB position
 * (string + fret); conflating them would teach the model that every string
 * number is a fretting position.
 */
function tabStavesByPart(parsed) {
  const map = new Map()
  for (const part of parsed.parts ?? []) {
    map.set(part.id, { tabs: new Set(part.tabStaves ?? []), staves: part.staves ?? 1 })
  }
  return map
}

/** Staff role for position semantics: tab / standard / unknown. */
function staffRoleOf(note, tabStaves) {
  const info = tabStaves.get(note.partId)
  if (!info || info.tabs.size === 0) return 'standard'
  if (note.staff != null) return info.tabs.has(note.staff) ? 'tab' : 'standard'
  // Staffless note in a single-TAB-staff part can only be TAB.
  if (info.staves === 1 && info.tabs.has(1)) return 'tab'
  return 'unknown'
}

/**
 * G5 — deterministic rhythm truth.
 * Fills measure-relative positions and verifies per (measure, voice) that
 * sounded durations reconstruct the measure length. Tie-stop notes sustain
 * rather than re-articulate: they contribute to the chain but a voice-total
 * check counts each onset once, so ties never double-count time.
 */
export function rhythmTruth(events, measures, quarantined = []) {
  const starts = new Map(measures.map((m) => [m.number, m.startQuarters ?? m.startQuarters === 0 ? m.startQuarters : null]))
  // measures carry startQuarters/endQuarters; fall back to index order.
  const byNumber = new Map(measures.map((m) => [m.number, m]))
  for (const event of events) {
    const measure = byNumber.get(event.source.measure)
    const start = measure ? (measure.startQuarters ?? 0) : 0
    event.time.measureRelativeQuarters = round6(event.time.onsetQuarters - start)
  }

  // Sounded time per (measure, voice, staff) is the UNION of note spans, not
  // the sum of durations: classical guitar notation routinely sustains a bass
  // note through melody onsets in the same voice grid (overlapping spans are
  // sustain, not corruption). Only spans running past the barline fail.
  const spans = new Map() // `${measure}|${partId}|${voice}|${staff}` -> [[start, end]]
  for (const event of events) {
    if (event.time.isGrace || event.time.isCue) continue
    // Chord tones share their chord head's onset: counting them would
    // double-count one attack as two durations. Tie segments (heads restored
    // to notated length above, continuations in their own measures) count
    // normally — each occupies its own measure exactly once.
    if (event.time.isChordTone) continue
    const key = `${event.source.measure}|${event.source.partId}|${event.time.voice}|${event.time.staff}`
    if (!spans.has(key)) spans.set(key, [])
    const start = event.time.measureRelativeQuarters ?? 0
    spans.get(key).push([start, start + event.time.durationQuarters])
  }
  const unionLength = (intervals) => {
    const ordered = [...intervals].sort((a, b) => a[0] - b[0])
    let total = 0
    let cur = null
    for (const [start, end] of ordered) {
      if (cur == null || start > cur[1] + 1e-9) {
        if (cur) total += cur[1] - cur[0]
        cur = [start, end]
      } else {
        cur[1] = Math.max(cur[1], end)
      }
    }
    if (cur) total += cur[1] - cur[0]
    return round6(total)
  };

  const checks = []
  const seenMeasures = new Set()
  for (const measure of measures) {
    // Multi-part scores repeat measure numbers per part timeline: check each
    // number once, and quarantine when the duplicates disagree (different
    // lengths would make "the bar" ambiguous).
    if (seenMeasures.has(measure.number)) {
      const first = measures.find((m) => m.number === measure.number)
      const sameLength = (first.lengthQuarters ?? first.endQuarters - first.startQuarters) ===
        (measure.lengthQuarters ?? measure.endQuarters - measure.startQuarters)
      if (!sameLength) {
        quarantined.push({ eventId: null, code: 'measure-definitions-disagree', detail: `measure ${measure.number} has inconsistent lengths across parts` })
      }
      continue
    }
    seenMeasures.add(measure.number)
    const length = measure.lengthQuarters ?? measure.endQuarters - measure.startQuarters
    const lanes = new Set(events
      .filter((e) => e.source.measure === measure.number)
      .map((e) => `${e.source.partId}|${e.time.voice}|${e.time.staff}`))
    for (const lane of lanes) {
      const [partId, voice, staff] = lane.split('|')
      const sounded = unionLength(spans.get(`${measure.number}|${partId}|${voice}|${staff}`) ?? [])
      const ok = sounded <= length + 1e-4 || isPickupOrCadenza(measure, sounded, length)
      if (!ok) {
        quarantined.push({ eventId: null, code: 'voice-duration-mismatch', detail: `measure ${measure.number} part ${partId} voice ${voice} staff ${staff} sounds ${sounded} quarters vs ${length} expected` })
      }
      checks.push({ measure: measure.number, partId, voice: Number(voice), staff: Number(staff), soundedQuarters: sounded, expectedQuarters: round6(length), ok })
    }
  }

  const totalQuarters = round6(events.reduce(
    (sum, e) => sum + (e.time.isGrace || e.time.isCue || e.time.isChordTone ? 0 : e.time.durationQuarters), 0))
  return { totalQuarters, eventCount: events.length, measureChecks: checks, timingPreserved: checks.every((c) => c.ok) }
}

function isPickupOrCadenza(measure, sounded, length) {
  if (measure.implicit) return true // pickup/anacrusis is short by definition
  if (sounded <= length + 1e-4) return true // rests may be unwritten in TAB voices; under-full is not corruption
  return false
}

function positionKindOf(note, tabStaves) {
  if (note.string == null) return 'none'
  if (note.fret != null) return 'tab-fret'
  // String with no fret: a circled string indication on the notation staff,
  // unless the staff itself is TAB (where a bare string is under-specified).
  if (note.staff == null) return 'unresolved'
  const tabs = tabStaves.get(note.partId)?.tabs
  if (tabs && tabs.has(note.staff)) return 'unresolved'
  return 'string-indication'
}

/**
 * A3 — cross-part TAB pairing.
 *
 * Notation and TAB often live in separate PARTS (BrookeWest-style: P1
 * notation without positions, P2 TAB with positions+pitch). Staff-mirror
 * reconciliation never sees these; link them here by onset+pitch with
 * tuning verification. Never guess: duplicate candidates on either side
 * quarantine every involved event and link nothing. TAB-only and
 * standard-only parts need no counterpart and quarantine nothing.
 */
export function pairCrossPartTab(events, parsed, { tuning, capoFret, tabStaves }, pairings, quarantined = []) {
  const partTuning = new Map()
  for (const part of parsed.parts ?? []) {
    if (Array.isArray(part.tuning) && part.tuning.length) partTuning.set(part.id, part.tuning)
  }
  const isTabStaff = (partId, staff) => {
    const tabs = tabStaves.get(partId)?.tabs
    return tabs ? tabs.has(staff) : false
  }
  const eligible = (event) =>
    !event.time.isRest && !event.time.isGrace && !event.time.isCue && Number.isFinite(event.pitch?.soundingMidi)

  // TAB-side: positioned events on known TAB staves. Standard-side: pitched
  // events carrying no position of their own. Events that already verified
  // (explicit positions) never need a cross-part link.
  const tabByKey = new Map()
  const stdByKey = new Map()
  for (const event of events) {
    if (!eligible(event)) continue
    const key = `${event.time.onsetQuarters.toFixed(6)}|${event.pitch.soundingMidi}`
    if (event.tab.string != null && event.tab.fret != null && isTabStaff(event.source.partId, event.time.staff)) {
      if (!tabByKey.has(key)) tabByKey.set(key, [])
      tabByKey.get(key).push(event)
    } else if (event.tab.string == null && event.tab.pairing !== 'verified') {
      if (!stdByKey.has(key)) stdByKey.set(key, [])
      stdByKey.get(key).push(event)
    }
  }

  for (const [key, tabs] of tabByKey) {
    const stds = stdByKey.get(key) ?? []
    if (stds.length === 0) continue // TAB-only music: valid class, nothing to link.
    if (stds.length > 1 || tabs.length > 1) {
      // Duplicate pitches (unisons, doubled chords): any association is a guess.
      for (const event of [...stds, ...tabs]) {
        quarantined.push({ eventId: event.id, code: 'ambiguous-cross-part-pairing', detail: `onset/pitch ${key} matches ${stds.length} notation + ${tabs.length} TAB events; linked none` })
      }
      continue
    }
    const std = stds[0]
    const tab = tabs[0]
    const partTune = partTuning.get(tab.source.partId) ?? tuning
    const expected = soundingFromTab(tab.tab.string, tab.tab.fret, { tuning: partTune, capoFret })
    if (expected == null) {
      quarantined.push({ eventId: tab.id, code: 'impossible-position', detail: `string ${tab.tab.string} fret ${tab.tab.fret} is unplayable` })
      tab.tab.pairing = 'quarantined'
      continue
    }
    if (expected !== std.pitch.soundingMidi) {
      quarantined.push({ eventId: tab.id, code: 'pairing-pitch-mismatch', detail: `string ${tab.tab.string} fret ${tab.tab.fret} sounds ${expected} but paired notation stores ${std.pitch.soundingMidi}` })
      tab.tab.pairing = 'quarantined'
      continue
    }
    std.tab = { string: tab.tab.string, fret: tab.tab.fret, pairing: 'verified', positionKind: 'tab-fret', source: 'cross-part' }
    pairings.push({
      scope: 'cross-part',
      eventId: std.id,
      tabEventId: tab.id,
      tabPartId: tab.source.partId,
      tabStaff: tab.time.staff,
      onsetQuarters: std.time.onsetQuarters,
      soundingMidi: std.pitch.soundingMidi,
      verified: true,
    })
  }
}

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6
}

/** Deterministic serialization: sorted keys, stable float formatting. */
export function serializeCanonicalEvents(canonical) {
  return JSON.stringify(canonical, null, 2)
}
