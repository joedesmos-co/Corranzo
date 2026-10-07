/**
 * Guitar Vision — canonical notation vocabulary (versioned).
 *
 * G1/G2 of the Corranzo notation foundation: every notation family Guitar
 * Vision must ultimately reconstruct, with exactly one support state (G0) and
 * the MusicXML source mapping that justifies it.
 *
 * ## G0 — never silently discard notation
 *
 * Every source element resolves to one of SUPPORTED_AND_LABELED,
 * SUPPORTED_BUT_NOT_YET_MODELED, EXPLICITLY_UNSUPPORTED:<reason>,
 * AMBIGUOUS:<reason>, or INVALID_SOURCE:<reason>. Unknown notation must never
 * quietly become "none". {@link classifySourceElement} enforces this: anything
 * not in the registry returns AMBIGUOUS, never a silent drop.
 *
 * ## Parser-status honesty
 *
 * `parser` describes what `src/features/musicxml/parseMusicXml.js` populates
 * TODAY (verified by reading the parser, not by assumption):
 * - `extracted` — the parser populates the field and `guitarObjects.js` surfaces it.
 * - `partial`   — the parser keeps presence but drops parameters, or drops the
 *                 note entirely (grace notes), or only fires on a text heuristic.
 * - `absent`    — the parser ignores the element; the canonical layer must
 *                 quarantine it rather than score it as a recognition failure.
 *
 * `support` describes the modelling state for the NEXT training campaign:
 * - SUPPORTED_AND_LABELED — parser-extracted AND honest labels exist in
 *   train/validation/held-out (the 9 claimable families per the acquisition plan).
 * - SUPPORTED_BUT_NOT_YET_MODELED — representable in source+truth, but no
 *   model head or honest labels yet. Training must not claim it.
 */

export const GUITAR_VOCABULARY_VERSION = 'guitar-vocab/1.0'

export const SUPPORT = Object.freeze({
  SUPPORTED_AND_LABELED: 'SUPPORTED_AND_LABELED',
  SUPPORTED_BUT_NOT_YET_MODELED: 'SUPPORTED_BUT_NOT_YET_MODELED',
  EXPLICITLY_UNSUPPORTED: 'EXPLICITLY_UNSUPPORTED',
  AMBIGUOUS: 'AMBIGUOUS',
  INVALID_SOURCE: 'INVALID_SOURCE',
})

export const PARSER_STATUS = Object.freeze({
  EXTRACTED: 'extracted',
  PARTIAL: 'partial',
  ABSENT: 'absent',
})

/**
 * One entry per notation family. `musicXml.elements` are the literal element
 * names as they appear in a score-partwise document; `relations` names the
 * cross-note linkage (ties, slurs, mirrors) the truth layer must resolve.
 */
export const VOCABULARY = Object.freeze([
  // ---------- A. MUSICAL STRUCTURE ----------
  { family: 'score', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['score-partwise', 'part-list', 'score-part'], attributes: ['id'], relations: 'part-list order defines parts' } },
  { family: 'part', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['part', 'part-name'], attributes: ['id'], relations: 'part id joins part-list declaration to part content' } },
  { family: 'system', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['print'], attributes: ['new-system', 'new-page'], relations: 'print flags on measure start new systems/pages' } },
  { family: 'measure', category: 'structure', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['measure'], attributes: ['number', 'width', 'implicit'], relations: 'measures order time; implicit=yes marks pickup/anacrusis' } },
  { family: 'staff-standard', category: 'structure', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['staff', 'clef', 'staff-details', 'staff-lines'], attributes: ['number'], relations: 'staff number joins notes to clef/staff-details declarations' } },
  { family: 'staff-tab', category: 'structure', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['clef(sign=TAB)', 'staff-lines(6)'], attributes: [], relations: 'TAB clef sign marks a TAB staff; line 1 is the highest string' } },
  { family: 'staff-pairing', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['clef', 'staff-details'], attributes: [], relations: 'notation+TAB staves in one part engrave each note twice; parser tags TAB copies as mirrors (reconcileTabMirrorNotes)' } },
  { family: 'barline', category: 'structure', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['barline', 'bar-style'], attributes: ['location'], relations: 'barlines bound measures' } },
  { family: 'measure-number', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['measure@number'], attributes: [], relations: 'parser falls back to document order when absent' } },
  { family: 'pickup-anacrusis', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['measure@implicit', 'divisions'], attributes: [], relations: 'implicit=yes or short first bar vs time signature' } },
  { family: 'voice', category: 'structure', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['voice'], attributes: [], relations: 'voices share a staff via backup/forward cursor movement' } },
  { family: 'layer', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    musicXml: { elements: ['voice', 'staff'], attributes: [], relations: 'staff+voice jointly identify a layer; parser keeps both but never names layers' } },
  { family: 'cross-measure-continuity', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['tie', 'tied', 'slur'], attributes: ['type=start|stop'], relations: 'tie chains span measures; slur numbers span phrases' } },

  // ---------- B. RHYTHM ----------
  { family: 'duration-whole', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['type', 'duration', 'divisions'], attributes: [], relations: 'duration/divisions gives quarters; type is the engraved glyph' } },
  { family: 'duration-half', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['type', 'duration', 'divisions'], attributes: [], relations: '' } },
  { family: 'duration-quarter', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['type', 'duration', 'divisions'], attributes: [], relations: '' } },
  { family: 'duration-eighth', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['type', 'duration', 'beam'], attributes: [], relations: 'beams group eighths and smaller' } },
  { family: 'duration-16th', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['type', 'duration', 'beam'], attributes: [], relations: '' } },
  { family: 'duration-32nd', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['type', 'duration', 'beam'], attributes: [], relations: '' } },
  { family: 'duration-64th', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['type', 'duration', 'beam'], attributes: [], relations: 'parser reads any type string; engraving support is what is unverified' } },
  { family: 'dots', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['dot'], attributes: [], relations: 'dot count multiplies duration; double-dots are two dot elements' } },
  { family: 'double-dots', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['dot', 'dot'], attributes: [], relations: 'parser counts dots so 2 works; labelled data is what is missing' } },
  { family: 'rest', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['rest', 'display-step', 'display-octave'], attributes: [], relations: 'rests advance the cursor like notes' } },
  { family: 'measure-rest', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'measure-style count is parsed into measures; span application to timing is explicit future work',
    musicXml: { elements: ['measure-style(multiple-rest)'], attributes: [], relations: '' } },
  { family: 'beam', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['beam'], attributes: ['number'], relations: 'beam number+value (begin/continue/end) groups notes' } },
  { family: 'beam-group', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['beam', 'stem'], attributes: [], relations: 'stem direction + beams jointly define the group' } },
  { family: 'tuplet', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['time-modification', 'actual-notes', 'normal-notes', 'tuplet'], attributes: ['type=start|stop'], relations: 'time-modification gives the ratio; tuplet element is the bracket' } },
  { family: 'nested-tuplet', category: 'rhythm', support: SUPPORT.EXPLICITLY_UNSUPPORTED, parser: PARSER_STATUS.ABSENT,
    reason: 'time-modification is flat (one ratio per note); nested ratios have no representation in the parser',
    musicXml: { elements: ['time-modification'], attributes: [], relations: '' } },
  { family: 'tie', category: 'rhythm', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['tie', 'tied'], attributes: ['type=start|stop'], relations: 'tie chains merge into one sounding event (mergeTiedNotesForPlayback)' } },
  { family: 'grace-note', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'parsed as zero-duration events with includeNonSoundingNotes; dropped by default (historical behavior)',
    musicXml: { elements: ['grace', 'slash'], attributes: [], relations: 'grace notes steal no time; slash marks acciaccatura' } },
  { family: 'cue-note', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'isCue is always marked; cue notes never attack and count no time',
    musicXml: { elements: ['cue'], attributes: [], relations: 'cue notes are small-print guides, not sounded events' } },
  { family: 'acciaccatura-appoggiatura', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'grace slash=yes vs absent distinguishes acciaccatura from appoggiatura (flag-gated)',
    musicXml: { elements: ['grace@slash'], attributes: [], relations: '' } },
  { family: 'tremolo', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'tremolo subdivision marks preserved as tremolo-picking parameters',
    musicXml: { elements: ['tremolo'], attributes: ['type'], relations: '' } },
  { family: 'multi-voice-rhythm', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['voice', 'backup', 'forward', 'chord'], attributes: [], relations: 'backup/forward move independent voice cursors' } },
  { family: 'syncopation', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['note', 'beam', 'tuplet'], attributes: [], relations: 'syncopation is a pattern over onsets, not an element; timing truth preserves it exactly' } },
  { family: 'sustained-note', category: 'rhythm', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['tie', 'tied'], attributes: [], relations: 'tie chains carry one pitch across beats and measures' } },

  // ---------- C. PITCH / STANDARD NOTATION ----------
  { family: 'pitch', category: 'pitch', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['pitch', 'step', 'octave', 'alter'], attributes: [], relations: 'pitch is SOUNDING per guitar-pitch/1.0; printed position is derived at draw time' } },
  { family: 'accidental', category: 'pitch', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['accidental', 'alter'], attributes: ['cautionary', 'editorial', 'parentheses'], relations: 'printed accidental vs sounding alter are kept separately' } },
  { family: 'enharmonic-spelling', category: 'pitch', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['step', 'alter'], attributes: [], relations: 'step+alter preserves spelling; MIDI alone would lose it' } },
  { family: 'clef', category: 'pitch', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['clef', 'sign', 'line'], attributes: ['number'], relations: 'guitar parts MUST NOT carry clef-octave-change (pitch contract rule 2)' } },
  { family: 'key-signature', category: 'pitch', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['key', 'fifths', 'mode', 'cancel'], attributes: ['number'], relations: 'key events are staff-scoped and ordered in time' } },
  { family: 'key-change', category: 'pitch', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['key'], attributes: [], relations: 'a later key element replaces the active signature (cancel handled)' } },
  { family: 'time-sig-change', category: 'structure', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['time', 'beats', 'beat-type'], attributes: [], relations: 'measure lengths follow the active signature' } },
  { family: 'clef-change', category: 'pitch', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['clef', 'sign', 'line'], attributes: ['number'], relations: 'clefs are keyed by staff number and update mid-part' } },
  { family: 'ledger-line', category: 'pitch', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['pitch'], attributes: [], relations: 'ledger lines are rendering; pitch truth is step/octave so nothing is lost' } },
  { family: 'chord', category: 'pitch', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['chord'], attributes: [], relations: 'chord notes share the onset of the preceding note' } },
  { family: 'unison', category: 'pitch', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['chord', 'notehead'], attributes: [], relations: 'two voices on one pitch; parser keeps both notes, pairing must not collapse them' } },
  { family: 'notehead-variant', category: 'pitch', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'notehead value/filled/parentheses preserved per event',
    musicXml: { elements: ['notehead'], attributes: [], relations: '' } },
  { family: 'stem-direction', category: 'pitch', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['stem'], attributes: [], relations: 'up/down only; anything else normalises to null' } },

  // ---------- D. TAB CORE ----------
  { family: 'string-number', category: 'tab', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['technical', 'string'], attributes: [], relations: '1 = highest string, matching STANDARD_GUITAR_TUNING index' } },
  { family: 'fret-number', category: 'tab', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['technical', 'fret'], attributes: [], relations: '0 is an open string and is a real value, never "no fret"' } },
  { family: 'multi-digit-fret', category: 'tab', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['fret'], attributes: [], relations: 'symbolic truth stores the integer; digit-splitting is a render concern only' } },
  { family: 'muted-dead-x', category: 'tab', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'x notehead maps to deadNote on the event',
    musicXml: { elements: ['notehead(x)', 'technical(dead-note)'], attributes: [], relations: '' } },
  { family: 'tab-chord', category: 'tab', support: SUPPORT.SUPPORTED_AND_LABELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['chord', 'string', 'fret'], attributes: [], relations: 'simultaneous notes share onset; same-string doubles are quarantined (G6)' } },
  { family: 'tab-rhythm', category: 'tab', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['type', 'stem', 'beam', 'tuplet'], attributes: [], relations: 'TAB staves carry the same rhythm elements as notation staves' } },
  { family: 'tab-rest', category: 'tab', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['rest'], attributes: [], relations: 'rests on a TAB staff advance the shared cursor' } },
  { family: 'standard-tab-pairing', category: 'tab', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['pitch', 'string', 'fret'], attributes: [], relations: 'sounding = tuning[string-1]+fret+capo must equal <pitch> (G4 verification)' } },
  { family: 'tab-line-identity', category: 'tab', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['staff-tuning(line)', 'staff-lines'], attributes: [], relations: 'staff-tuning line 1 = lowest string; string numbering is the reverse' } },
  { family: 'string-indication', category: 'tab', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'parser reads the string value but never distinguishes it; the canonical layer resolves positionKind (tab-fret vs string-indication) from staff role',
    musicXml: { elements: ['technical(string)'], attributes: [], relations: '' } },
  { family: 'fingering-tab', category: 'tab', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'fingering values preserved per event',
    musicXml: { elements: ['technical(fingering)'], attributes: [], relations: '' } },

  // ---------- E. GUITAR TECHNIQUES ----------
  { family: 'bend', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'parser records bend presence only; bend-amount, release, pre-bend flags are dropped',
    musicXml: { elements: ['technical(bend)', 'bend-alter', 'release', 'pre-bend'], attributes: [], relations: 'bend resolves to a later target note' } },
  { family: 'bend-amount', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'bend-alter semitones preserved (raw text retained)',
    musicXml: { elements: ['bend-alter'], attributes: [], relations: '' } },
  { family: 'pre-bend', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'pre-bend flag preserved',
    musicXml: { elements: ['pre-bend'], attributes: [], relations: '' } },
  { family: 'bend-release', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'release flag preserved',
    musicXml: { elements: ['release'], attributes: [], relations: '' } },
  { family: 'slide', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'type/number/line-type preserved; shift-vs-legato style is not encoded in MusicXML',
    musicXml: { elements: ['slide', 'glissando'], attributes: ['type=start|stop', 'line-type'], relations: 'slide start/stop notes pair by number' } },
  { family: 'glissando', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'present in generated fixtures and architecture but parser has no glissando reader distinct from slide',
    musicXml: { elements: ['glissando'], attributes: ['line-type'], relations: '' } },
  { family: 'hammer-on', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['technical(hammer-on)'], attributes: ['type=start|stop', 'number'], relations: 'start/stop pair by number across adjacent notes' } },
  { family: 'pull-off', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['technical(pull-off)'], attributes: ['type=start|stop', 'number'], relations: '' } },
  { family: 'vibrato', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'presence via wavy-line/other-technical heuristic; width unencoded',
    musicXml: { elements: ['ornaments(wavy-line)', 'other-technical', 'vibrato'], attributes: [], relations: '' } },
  { family: 'natural-harmonic', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'harmonic kind + pitch triple preserved',
    musicXml: { elements: ['technical(harmonic)', 'notehead(diamond)'], attributes: [], relations: '' } },
  { family: 'artificial-harmonic', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'artificial flag + base/touching/sounding pitches preserved',
    musicXml: { elements: ['harmonic(natural|artificial)', 'base-pitch', 'touching-pitch', 'sounding-pitch'], attributes: [], relations: '' } },
  { family: 'pinch-harmonic', category: 'technique', support: SUPPORT.EXPLICITLY_UNSUPPORTED, parser: PARSER_STATUS.ABSENT,
    reason: 'no MusicXML encoding distinguished from artificial harmonic; engraver text only',
    musicXml: { elements: ['other-technical(P.H.)'], attributes: [], relations: '' } },
  { family: 'tapping', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'tap (fret/hand) and tapped (hand) preserved',
    musicXml: { elements: ['technical(tapped)'], attributes: [], relations: '' } },
  { family: 'palm-mute', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'span type preserved',
    musicXml: { elements: ['technical(palm-mute)'], attributes: ['type'], relations: '' } },
  { family: 'dead-note', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'x notehead maps to deadNote on the event',
    musicXml: { elements: ['notehead(x)'], attributes: [], relations: '' } },
  { family: 'ghost-note', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'parenthesised notehead maps to ghostNote on the event',
    musicXml: { elements: ['notehead(parentheses)'], attributes: [], relations: '' } },
  { family: 'let-ring', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'span type preserved',
    musicXml: { elements: ['technical(let-ring)'], attributes: ['type'], relations: '' } },
  { family: 'tremolo-picking', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'stroke marks + single/measured type preserved',
    musicXml: { elements: ['tremolo'], attributes: [], relations: '' } },
  { family: 'pick-direction', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'up-bow/down-bow preserved as pick direction',
    musicXml: { elements: ['technical(up-bow)', 'technical(down-bow)'], attributes: [], relations: '' } },
  { family: 'arpeggio', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'arpeggiate direction preserved',
    musicXml: { elements: ['notations(arpeggiate)'], attributes: [], relations: '' } },
  { family: 'rasgueado', category: 'technique', support: SUPPORT.AMBIGUOUS, parser: PARSER_STATUS.ABSENT,
    reason: 'no structured MusicXML encoding found (4.x reference, music21, exporter behavior); arrives as staff text',
    musicXml: { elements: ['direction-type(words: rasg.)', 'other-technical'], attributes: [], relations: '' } },
  { family: 'golpe', category: 'technique', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'structured MusicXML 3.1 technical element; preserved',
    musicXml: { elements: ['direction-type(words: golpe)'], attributes: [], relations: '' } },
  { family: 'whammy-bar', category: 'technique', support: SUPPORT.EXPLICITLY_UNSUPPORTED, parser: PARSER_STATUS.ABSENT,
    reason: 'whammy/dive encodings vary by exporter and are never read',
    musicXml: { elements: ['other-technical'], attributes: [], relations: '' } },

  // ---------- F. ARTICULATION / EXPRESSION ----------
  { family: 'staccato', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['articulations(staccato)'], attributes: ['placement'], relations: '' } },
  { family: 'staccatissimo', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'distinct element preserved',
    musicXml: { elements: ['articulations(staccatissimo)'], attributes: [], relations: '' } },
  { family: 'breath-mark', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'element preserved',
    musicXml: { elements: ['articulations(breath-mark)'], attributes: [], relations: '' } },
  { family: 'accent', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['articulations(accent)', 'articulations(strong-accent)'], attributes: ['placement'], relations: 'strong-accent reads as marcato' } },
  { family: 'marcato', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['articulations(strong-accent)'], attributes: ['placement'], relations: '' } },
  { family: 'tenuto', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['articulations(tenuto)'], attributes: ['placement'], relations: '' } },
  { family: 'fermata', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['notations(fermata)'], attributes: ['type'], relations: '' } },
  { family: 'dynamic', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['direction-type(dynamics)', 'sound@dynamics'], attributes: [], relations: 'dynamics map to performed velocity; subito/text dynamics keep their text' } },
  { family: 'hairpin', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['wedge'], attributes: ['type=crescendo|diminuendo'], relations: 'wedges span start/stop directions and reshape velocity' } },
  { family: 'slur', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['slur'], attributes: ['type', 'number', 'placement'], relations: 'slur spans phrase legato; distinct from ties' } },
  { family: 'ornament-trill', category: 'expression', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'trill/mordent/turn/shake preserved by kind',
    musicXml: { elements: ['ornaments(trill-mark|mordent|turn)'], attributes: [], relations: '' } },

  // ---------- G. PERFORMANCE INFORMATION ----------
  { family: 'tuning', category: 'performance', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['staff-details', 'staff-tuning', 'tuning-step', 'tuning-octave', 'tuning-alter'], attributes: ['line'], relations: 'line 1 = lowest string; reversed into string-indexed tuning' } },
  { family: 'alternate-tuning', category: 'performance', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['staff-details(staff-tuning)'], attributes: [], relations: 'any non-standard tuning vector; pairing math takes it as input' } },
  { family: 'capo', category: 'performance', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'MusicXML has no capo element; direction-text mining with confidence tag drives pitch math',
    musicXml: { elements: ['direction-type(words: Capo N)'], attributes: [], relations: '' } },
  { family: 'position-indication', category: 'performance', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'Roman-numeral text mining with source text retained',
    musicXml: { elements: ['direction-type(words: III, V, VII...)'], attributes: [], relations: '' } },
  { family: 'barre', category: 'performance', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'barre text mining (B/1-2B/C + numeral) with source text retained',
    musicXml: { elements: ['direction-type(words)'], attributes: [], relations: '' } },
  { family: 'left-hand-fingering', category: 'performance', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'fingering values + substitution/alternate preserved',
    musicXml: { elements: ['technical(fingering)'], attributes: [], relations: '' } },
  { family: 'right-hand-fingering', category: 'performance', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'pluck p-i-m-a preserved',
    musicXml: { elements: ['technical(pluck)'], attributes: [], relations: '' } },
  { family: 'octave-shift', category: 'performance', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'shift spans recorded as score marks',
    musicXml: { elements: ['octave-shift'], attributes: ['type', 'size'], relations: '' } },

  // ---------- H. HARMONY / TEXT ----------
  { family: 'chord-symbol', category: 'harmony', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['harmony', 'root', 'kind', 'bass'], attributes: ['text'], relations: 'harmony events carry measure+quarterTime anchors' } },
  { family: 'chord-diagram', category: 'harmony', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'frame strings/frets/first-fret/notes/barre preserved',
    musicXml: { elements: ['harmony(frame)', 'frame-strings', 'frame-frets', 'frame-note'], attributes: [], relations: '' } },
  { family: 'lyrics', category: 'harmony', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'lyric number/syllabic/text preserved per note',
    musicXml: { elements: ['lyric', 'syllabic', 'text'], attributes: ['number'], relations: '' } },
  { family: 'tempo-marking', category: 'harmony', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['metronome', 'beat-unit', 'per-minute', 'sound@tempo'], attributes: [], relations: 'sound tempo wins; else scaled metronome' } },
  { family: 'rehearsal-mark', category: 'harmony', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'rehearsal text recorded as score mark',
    musicXml: { elements: ['direction-type(rehearsal)'], attributes: [], relations: '' } },
  { family: 'text-direction', category: 'harmony', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'mined patterns resolve; unmatched words quarantine as unresolved-text',
    musicXml: { elements: ['direction-type(words)'], attributes: [], relations: '' } },

  // ---------- I. NAVIGATION ----------
  { family: 'repeat', category: 'navigation', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['barline(repeat)'], attributes: ['direction=forward|backward', 'times', 'location'], relations: 'forward/backward pairs bound repeated spans; times gives the count' } },
  { family: 'ending', category: 'navigation', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    musicXml: { elements: ['barline(ending)'], attributes: ['type=start|stop|discontinue', 'number'], relations: 'volta numbers select passes' } },
  { family: 'segno', category: 'navigation', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'segno position recorded as score mark',
    musicXml: { elements: ['direction-type(segno)'], attributes: [], relations: '' } },
  { family: 'coda', category: 'navigation', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'coda position recorded as score mark',
    musicXml: { elements: ['direction-type(coda)'], attributes: [], relations: '' } },
  { family: 'ds-dc-navigation', category: 'navigation', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.PARTIAL,
    reason: 'sound-jump attrs + D.C./D.S./Fine/To-Coda text mining; free variants quarantine as unresolved-text',
    musicXml: { elements: ['direction-type(words: D.S. al Coda...)'], attributes: [], relations: '' } },
  { family: 'fine', category: 'navigation', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'Fine word + sound@fine recorded as score marks',
    musicXml: { elements: ['direction-type(words: Fine)', 'sound@fine'], attributes: [], relations: 'fine terminates D.C./D.S. spans' } },
  { family: 'to-coda', category: 'navigation', support: SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED, parser: PARSER_STATUS.EXTRACTED,
    reason: 'To Coda word + sound@tocoda recorded as score marks',
    musicXml: { elements: ['direction-type(words: To Coda)', 'sound@tocoda'], attributes: [], relations: 'jump target is the coda mark' } },
])

/** All families must have unique names; duplicates would let two reports disagree. */
export function vocabularyFamilies() {
  return VOCABULARY.map((entry) => entry.family)
}

export function vocabularyByFamily(family) {
  return VOCABULARY.find((entry) => entry.family === family) ?? null
}

/**
 * G0 enforcement: resolve one source element name to its vocabulary entry.
 * Unknown elements return an AMBIGUOUS verdict — never a silent "none".
 */
export function classifySourceElement(elementName) {
  const normalized = String(elementName ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (!normalized) {
    return { support: SUPPORT.INVALID_SOURCE, reason: 'empty element name', family: null }
  }
  const hit = VOCABULARY.find(
    (entry) =>
      entry.family === normalized ||
      (entry.musicXml?.elements ?? []).some((element) =>
        String(element).toLowerCase().includes(normalized),
      ),
  )
  if (hit) return { support: hit.support, reason: hit.reason ?? null, family: hit.family }
  return {
    support: SUPPORT.AMBIGUOUS,
    reason: `no vocabulary entry covers <${elementName}>; quarantined pending schema review`,
    family: null,
  }
}

/** Machine-readable summary for the coverage gate (G16). */
export function vocabularySummary() {
  const counts = {}
  for (const entry of VOCABULARY) {
    counts[entry.support] = (counts[entry.support] ?? 0) + 1
  }
  return {
    version: GUITAR_VOCABULARY_VERSION,
    families: VOCABULARY.length,
    counts,
    parserExtracted: VOCABULARY.filter((e) => e.parser === PARSER_STATUS.EXTRACTED).length,
    parserPartial: VOCABULARY.filter((e) => e.parser === PARSER_STATUS.PARTIAL).length,
    parserAbsent: VOCABULARY.filter((e) => e.parser === PARSER_STATUS.ABSENT).length,
  }
}
