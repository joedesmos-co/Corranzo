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

export const GUITAR_EVENT_SCHEMA_VERSION = 'guitar-event/1.0'

/** Technique kinds the canonical model represents with parameters. */
export const TECHNIQUE_KINDS = Object.freeze([
  'bend', 'slide', 'hammer-on', 'pull-off', 'vibrato',
  'harmonic', 'tapping', 'palm-mute', 'let-ring', 'tremolo-picking',
])

function techniqueFromParsed(raw) {
  if (!raw) return null
  const kind = String(raw.kind ?? '').toLowerCase()
  switch (kind) {
    case 'bend':
      // Parser keeps presence only; amount stays null until the parser learns
      // <bend-alter>. Null is honest; inventing 2 semitones would be fake truth.
      return { kind: 'bend', semitones: null, prebend: false, release: false, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'slide':
      return { kind: 'slide', direction: raw.type === 'stop' ? 'into' : 'out', style: null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'hammer-on':
      return { kind: 'hammer-on', fromNote: null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'pull-off':
      return { kind: 'pull-off', fromNote: null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    case 'vibrato':
      return { kind: 'vibrato', width: null, support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED }
    default: {
      // G0: an unrecognised technique kind is AMBIGUOUS, never dropped.
      const verdict = classifySourceElement(kind)
      return { kind, support: verdict.support, reason: verdict.reason ?? 'unmodelled technique kind', params: null }
    }
  }
}

/**
 * G0 gap audit over the RAW source XML.
 *
 * The symbolic parser drops several elements without populating any field
 * (grace notes, <frame>, <segno>/<coda>, unmodelled <technical> children,
 * non-standard noteheads, free-text directions). A canonical layer built only
 * on parsed output would inherit those silent drops. When the caller passes
 * `rawXml`, every such element becomes a quarantine entry instead.
 *
 * One entry per distinct element name per score: the audit answers "what was
 * dropped", per-event pairing answers "where".
 */
const KNOWN_TECHNICAL_CHILDREN = new Set([
  'string', 'fret', 'hammer-on', 'pull-off', 'bend', 'other-technical',
])
const UNSUPPORTED_SCORE_ELEMENTS = new Set([
  // Note: technical children (fingering, pluck, up-bow, down-bow, harmonic,
  // palm-mute, let-ring, tapped, heel, toe, ...) are covered by the
  // technical-children scan above and must NOT be listed here, or one element
  // would quarantine twice.
  'frame', 'segno', 'coda', 'rehearsal', 'lyric', 'octave-shift',
  'arpeggiate', 'tremolo', 'measure-style',
  'trill-mark', 'mordent', 'turn', 'accidental-mark',
  // Bend parameters are children of <bend>, not <technical>, so the
  // technical-children scan above cannot see them. Presence-only bends are
  // honest; silent amounts would be fake truth.
  'bend-alter', 'pre-bend', 'release',
  // Glissando, breath marks and cue notes are real elements the parser never
  // reads (<cue/> is worse: the note parses as a full-sounding note).
  'glissando', 'breath-mark',
])

export function auditRawXmlGaps(xml) {
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
    // Bend parameters are children of <bend>, handled by the score-level scan
    // below; strip the whole bend subtree so one element is never flagged twice.
    const withoutBend = block.replace(/<bend>[\s\S]*?<\/bend>/g, '<bend/>')
    for (const tag of withoutBend.match(/<([a-z-]+)(?=[\s/>])/g) ?? []) {
      const name = tag.slice(1)
      if (name === 'technical' || KNOWN_TECHNICAL_CHILDREN.has(name)) continue
      const verdict = classifySourceElement(name)
      flag('unmodelled-technique-flag', name,
        `<${name}> inside <technical> is not populated by the parser (${verdict.support})`)
    }
    // <other-technical> is only interpreted when its text matches vibrato.
    // Any other free-text technique (whammy, P.H., S.V.) is silently ignored.
    for (const match of block.match(/<other-technical>([^<]*)<\/other-technical>/g) ?? []) {
      const text = match.replace(/<\/?other-technical>/g, '')
      if (!/vib(?:rato)?/i.test(text)) {
        flag('unmodelled-technique-flag', 'other-technical',
          `<other-technical>${text}</other-technical> matches no parser heuristic and is ignored`)
      }
    }
  }
  for (const element of UNSUPPORTED_SCORE_ELEMENTS) {
    if (new RegExp(`<${element}(?=[\\s/>])`).test(source)) {
      const verdict = classifySourceElement(element)
      flag('unsupported-element', element,
        `<${element}> is parsed as absent (${verdict.support}${verdict.reason ? `: ${verdict.reason}` : ''})`)
    }
  }

  for (const match of source.match(/<notehead>([^<]*)<\/notehead>/g) ?? []) {
    const value = match.replace(/<\/?notehead>/g, '').trim().toLowerCase()
    if (value && value !== 'normal') {
      flag('notehead-variant', 'notehead', `notehead "${value}" is never read; harmonic/dead-note shape is lost`)
    }
  }

  if (/<grace(?=[\s/>])/.test(source)) {
    flag('grace-dropped', 'grace', 'grace notes are dropped from the parsed note list; stolen-time semantics are lost')
  }
  if (/<cue(?=[\s/>])/.test(source)) {
    flag('cue-misread', 'cue', 'cue notes parse as full-sounding notes; cue semantics are lost and timing is overstated')
  }
  if (/<direction-type>[\s\S]*?<words>/.test(source)) {
    flag('ignored-text-direction', 'words', 'free-text <words> directions (capo, positions, D.S./D.C.) are not interpreted')
  }
  return gaps
}

/**
 * Build canonical events from parsed MusicXML.
 *
 * @param {object} parsed  parseMusicXml() output
 * @param {object} [options] { tuning, capoFret, sourceId, rawXml }
 * @returns {{ version, events, pairings, quarantined, rhythm }}
 */
export function canonicalEventsFromParsed(parsed, options = {}) {
  const tuning = options.tuning ?? firstTuning(parsed) ?? STANDARD_GUITAR_TUNING
  const capoFret = options.capoFret ?? 0
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
    if (note.isGrace) {
      // Parser-level grace notes never reach here (they are dropped upstream);
      // a grace flag surviving means ambiguous timing — quarantine, don't guess.
      quarantined.push({ eventId, code: 'grace-timing-ambiguous', detail: 'grace note has no stolen-time semantics in rhythm truth' })
    }
    const techniques = (note.guitarTechniques ?? []).map(techniqueFromParsed).filter(Boolean)
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
        tuplet: note.timeModification ? `${note.timeModification.actualNotes}:${note.timeModification.normalNotes}` : null,
        dots: note.dots ?? 0,
        noteType: note.noteType ?? null,
        beams: (note.beams ?? []).map((b) => `${b.number}:${b.value}`),
        stemDirection: note.stemDirection ?? null,
        isGrace: Boolean(note.isGrace),
        isChordTone: Boolean(note.isChord),
        isRest: Boolean(note.isRest),
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
      tab: note.string != null || note.fret != null
        ? { string: note.string ?? null, fret: note.fret ?? null, pairing: 'explicit', positionKind: positionKindOf(note, tabStaves) }
        : { string: null, fret: null, pairing: 'none', positionKind: 'none' },
      techniques,
      articulations: {
        staccato: Boolean(note.staccato),
        accent: Boolean(note.accent),
        tenuto: Boolean(note.tenuto),
        marcato: Boolean(note.marcato),
        fermata: Boolean(note.fermata),
        slurs: (note.slurs ?? []).map((s) => ({ type: s.type, number: s.number ?? '1' })),
      },
      dynamics: { velocity: note.velocity ?? null },
      support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED,
    }

    // G4: verify string/fret implies the sounding pitch.
    if (!note.isRest && event.tab.string != null && event.tab.fret != null && Number.isFinite(note.midi)) {
      const expected = soundingFromTab(event.tab.string, event.tab.fret, { tuning, capoFret })
      if (expected == null) {
        quarantined.push({ eventId, code: 'impossible-position', detail: `string ${event.tab.string} fret ${event.tab.fret} is unplayable on ${tuning.length}-string tuning` })
        event.tab.pairing = 'quarantined'
      } else if (expected !== note.midi) {
        quarantined.push({ eventId, code: 'pairing-pitch-mismatch', detail: `string ${event.tab.string} fret ${event.tab.fret} sounds ${expected} but notation stores ${note.midi} (off by ${note.midi - expected})` })
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

  // Measure-relative positions + rhythm round-trip (G5).
  const rhythm = rhythmTruth(events, parsed.measures ?? [], quarantined)

  // G0: audit the raw source for elements the parser drops silently.
  if (options.rawXml) {
    quarantined.push(...auditRawXmlGaps(options.rawXml))
  }

  return { version: GUITAR_EVENT_SCHEMA_VERSION, events, pairings, quarantined, rhythm, tuning: [...tuning], capoFret }
}

function firstTuning(parsed) {
  for (const part of parsed.parts ?? []) {
    if (Array.isArray(part.tuning) && part.tuning.length) return part.tuning
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
    map.set(part.id, new Set(part.tabStaves ?? []))
  }
  return map
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

  const totals = new Map() // `${measure}|${voice}|${staff}` -> sounded quarters
  for (const event of events) {
    if (event.time.isGrace) continue
    // Chord tones share their chord head's onset: counting them would
    // double-count one attack as two durations. Tie segments (heads restored
    // to notated length above, continuations in their own measures) count
    // normally — each occupies its own measure exactly once.
    if (event.time.isChordTone) continue
    const key = `${event.source.measure}|${event.time.voice}|${event.time.staff}`
    totals.set(key, (totals.get(key) ?? 0) + event.time.durationQuarters)
  }

  const checks = []
  for (const measure of measures) {
    const length = measure.lengthQuarters ?? measure.endQuarters - measure.startQuarters
    const voices = new Set(events.filter((e) => e.source.measure === measure.number).map((e) => `${e.time.voice}|${e.time.staff}`))
    for (const voiceStaff of voices) {
      const [voice, staff] = voiceStaff.split('|').map(Number)
      const sounded = round6(totals.get(`${measure.number}|${voice}|${staff}`) ?? 0)
      const ok = Math.abs(sounded - length) < 1e-4 || isPickupOrCadenza(measure, sounded, length)
      if (!ok) {
        quarantined.push({ eventId: null, code: 'voice-duration-mismatch', detail: `measure ${measure.number} voice ${voice} staff ${staff} sounds ${sounded} quarters vs ${length} expected` })
      }
      checks.push({ measure: measure.number, voice, staff, soundedQuarters: sounded, expectedQuarters: round6(length), ok })
    }
  }

  const totalQuarters = round6(events.reduce(
    (sum, e) => sum + (e.time.isGrace || e.time.isChordTone ? 0 : e.time.durationQuarters), 0))
  return { totalQuarters, eventCount: events.length, measureChecks: checks, timingPreserved: checks.every((c) => c.ok) }
}

function isPickupOrCadenza(measure, sounded, length) {
  if (measure.implicit) return true // pickup/anacrusis is short by definition
  if (sounded <= length + 1e-4) return true // rests may be unwritten in TAB voices; under-full is not corruption
  return false
}

function positionKindOf(note, tabStaves) {
  if (note.fret != null) return 'tab-fret'
  if (note.string == null) return 'none'
  // String with no fret: a circled string indication on the notation staff,
  // unless the staff itself is TAB (where a bare string is under-specified).
  if (note.staff == null) return 'unresolved'
  const tabs = tabStaves.get(note.partId)
  if (tabs && tabs.has(note.staff)) return 'unresolved'
  return 'string-indication'
}

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6
}

/** Deterministic serialization: sorted keys, stable float formatting. */
export function serializeCanonicalEvents(canonical) {
  return JSON.stringify(canonical, null, 2)
}
