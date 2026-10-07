#!/usr/bin/env node
/**
 * Guitar Vision — deterministic notation coverage fixtures (G8).
 *
 * Declared-by-construction corpus: each fixture is built by a pure function
 * (no randomness, no clock), so rebuilding yields byte-identical MusicXML.
 * Fixtures are truth first: every pitched TAB position is computed from
 * sounding pitch = tuning[string-1] + fret, so verified pairings hold by
 * construction and mismatches are deliberate.
 *
 * Usage:
 *   node tools/guitar-vision/build-notation-fixtures.mjs --out datasets/guitar-vision/fixtures/notation-v1
 *
 * Tests import the builders directly (no disk dependency); the written files
 * are the inspectable corpus deliverable plus a manifest.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Standard tuning, string-indexed (1 = highest): E4 B3 G3 D3 A2 E2
const STD = [64, 59, 55, 50, 45, 40]
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midiToPitch(midi) {
  const step = NAMES[((midi % 12) + 12) % 12].replace('#', '')
  const alter = NAMES[((midi % 12) + 12) % 12].includes('#') ? 1 : 0
  return { step, alter, octave: Math.floor(midi / 12) - 1 }
}
function pitchXml(midi) {
  const { step, alter, octave } = midiToPitch(midi)
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`
}
const TYPE_Q = { quarter: 1, half: 2, whole: 4, eighth: 0.5, '16th': 0.25, '32nd': 0.125 }

function noteXml({ midi = null, rest = false, type = 'quarter', divisions = 4, dots = 0, voice = 1, staff = null, chord = false, string = null, fret = null, notations = '', grace = false, timeMod = null }) {
  // MusicXML <duration> is actual divisions: dots extend it.
  const dur = Math.round(TYPE_Q[type] * divisions * (dots > 0 ? 2 - 1 / 2 ** dots : 1))
  const dotXml = '<dot/>'.repeat(dots)
  const tech = string != null || fret != null
    ? `<notations><technical>${string != null ? `<string>${string}</string>` : ''}${fret != null ? `<fret>${fret}</fret>` : ''}</technical>${notations ? '' : ''}</notations>`
    : ''
  // notations param merges into technical block when present
  const notationsXml = notations && !tech ? `<notations>${notations}</notations>`
    : notations && tech ? `<notations><technical>${string != null ? `<string>${string}</string>` : ''}${fret != null ? `<fret>${fret}</fret>` : ''}${notations}</technical></notations>`
    : tech
  return `<note>${grace ? '<grace slash="yes"/>' : ''}${chord ? '<chord/>' : ''}` +
    `${rest ? '<rest/>' : pitchXml(midi)}` +
    `${grace ? '' : `<duration>${dur}</duration>`}` +
    `<voice>${voice}</voice><type>${type}</type>${dotXml}` +
    `${staff != null ? `<staff>${staff}</staff>` : ''}` +
    `${timeMod ? `<time-modification><actual-notes>${timeMod[0]}</actual-notes><normal-notes>${timeMod[1]}</normal-notes></time-modification>` : ''}` +
    `${notationsXml}</note>`
}

function measureXml(number, inner, { divisions = 4, beats = 4, beatType = 4, attrs = '', clef = null } = {}) {
  const attrXml = number === 1 || clef
    ? `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key>` +
      `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` +
      `${clef ?? '<clef><sign>G</sign><line>2</line></clef>'}</attributes>`
    : ''
  return `<measure number="${number}"${attrs}>${attrXml}${inner}</measure>`
}

function scoreXml(measures, { partName = 'Guitar' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">` +
    `<part-list><score-part id="P1"><part-name>${partName}</part-name></score-part></part-list>` +
    `<part id="P1">${measures.join('')}</part></score-partwise>`
}

function tabStaffClef() {
  return `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>TAB</sign><line>5</line></clef>`
}
function dropDTuning() {
  // staff-tuning line 1 = bottom line = lowest string (string 6). Drop-D.
  const lines = [
    [1, 'D', 2], [2, 'A', 2], [3, 'D', 3], [4, 'G', 3], [5, 'B', 3], [6, 'E', 4],
  ]
  return `<staff-details number="2"><staff-lines>6</staff-lines>${lines.map(([line, step, oct]) => `<staff-tuning line="${line}"><tuning-step>${step}</tuning-step><tuning-octave>${oct}</tuning-octave></staff-tuning>`).join('')}</staff-details>`
}

// string/fret sounding target helper: midi for position under tuning
const sound = (tuning, string, fret) => tuning[string - 1] + fret

export const FIXTURES = [
  { name: 'simple-4-4-rhythm', families: ['staff-standard', 'duration-quarter', 'duration-half', 'measure', 'voice', 'pitch'],
    expect: { events: 3, quarantined: 0, timingPreserved: true },
    build: () => scoreXml([measureXml(1,
      noteXml({ midi: 60, type: 'quarter' }) + noteXml({ midi: 62, type: 'quarter' }) + noteXml({ midi: 64, type: 'half' }))]) },
  { name: 'dotted-rhythm', families: ['dots', 'double-dots', 'duration-quarter', 'duration-half', 'duration-eighth'],
    expect: { events: 6, quarantined: 0, timingPreserved: true, dotsSeen: [1, 2] },
    build: () => scoreXml([
      measureXml(1, noteXml({ midi: 60, type: 'quarter', dots: 1 }) + noteXml({ midi: 62, type: 'eighth' }) + noteXml({ midi: 64, type: 'quarter' }) + noteXml({ midi: 65, type: 'quarter' })),
      measureXml(2, noteXml({ midi: 67, type: 'half', dots: 2 }) + noteXml({ midi: 69, type: 'eighth' })),
    ]) },
  { name: 'tuplets', families: ['tuplet', 'duration-eighth'],
    expect: { events: 6, quarantined: 0, timingPreserved: true, tupletSeen: '3:2' },
    build: () => {
      const divisions = 12
      const t = (midi) => noteXml({ midi, type: 'eighth', divisions, timeMod: [3, 2] }).replace('<duration>6</duration>', '<duration>4</duration>')
      return scoreXml([
        measureXml(1, t(60) + t(62) + t(64) + noteXml({ midi: 65, type: 'quarter', divisions }) + noteXml({ midi: 67, type: 'quarter', divisions }) + noteXml({ midi: 69, type: 'quarter', divisions }), { divisions }),
      ])
    } },
  { name: 'nested-tuplet-unsupported', families: ['nested-tuplet'],
    expect: { events: 5, quarantined: 0, timingPreserved: true, vocabularySupport: 'EXPLICITLY_UNSUPPORTED', note: 'flat time-modification only; nesting unrepresentable' },
    build: () => scoreXml([measureXml(1,
      noteXml({ midi: 60, type: 'eighth', timeMod: [3, 2] }) + `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>5</actual-notes><normal-notes>4</normal-notes></time-modification></note>` +
      noteXml({ midi: 64, type: 'quarter' }) + noteXml({ midi: 65, type: 'quarter' }) + noteXml({ midi: 67, type: 'quarter' }),
    )]) },
  { name: 'multi-voice', families: ['multi-voice-rhythm', 'voice', 'layer', 'unison'],
    expect: { events: 6, quarantined: 0, timingPreserved: true },
    build: () => scoreXml([measureXml(1,
      noteXml({ midi: 64, type: 'half', voice: 1 }) + noteXml({ midi: 67, type: 'half', voice: 1 }) +
      `<backup><duration>16</duration></backup>` +
      // Second voice doubles the same pitches: unisons, not new attacks.
      noteXml({ midi: 64, type: 'quarter', voice: 2 }) + noteXml({ midi: 64, type: 'quarter', voice: 2 }) + noteXml({ midi: 67, type: 'quarter', voice: 2 }) + noteXml({ midi: 67, type: 'quarter', voice: 2 }))]) },
  { name: 'tab-chord-verified', families: ['string-number', 'fret-number', 'tab-chord', 'chord', 'standard-tab-pairing', 'pitch'],
    expect: { events: 5, quarantined: 0, timingPreserved: true, tabVerified: 5 },
    build: () => scoreXml([measureXml(1,
      noteXml({ midi: sound(STD, 1, 0), type: 'quarter', string: 1, fret: 0 }) +
      noteXml({ midi: sound(STD, 2, 1), type: 'quarter', chord: true, string: 2, fret: 1 }) +
      noteXml({ midi: sound(STD, 3, 0), type: 'quarter', chord: true, string: 3, fret: 0 }) +
      noteXml({ midi: sound(STD, 4, 2), type: 'half', string: 4, fret: 2 }) +
      noteXml({ midi: sound(STD, 5, 3), type: 'quarter', string: 5, fret: 3 }))]) },
  { name: 'pairing-mismatch-quarantine', families: ['standard-tab-pairing'],
    expect: { events: 1, quarantined: 1, quarantineCodes: ['pairing-pitch-mismatch'], playabilityCode: 'unverified-pairing' },
    build: () => scoreXml([measureXml(1, noteXml({ midi: 60, type: 'whole', string: 1, fret: 0 }) /* string1/fret0 sounds E4=64, not C4=60 */)]) },
  { name: 'bend-partial', families: ['bend'],
    expect: { events: 2, quarantined: 0, timingPreserved: true, techniqueKind: 'bend', bendSemitonesNull: true },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notations><technical><string>2</string><fret>3</fret><bend/></technical></notations></note>` +
      noteXml({ midi: 64, type: 'half' }))]) },
  { name: 'hammer-pull-chain', families: ['hammer-on', 'pull-off'],
    expect: { events: 3, quarantined: 0, timingPreserved: true },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><technical><string>3</string><fret>2</fret><hammer-on type="start" number="1"/></technical></notations></note>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><technical><string>3</string><fret>5</fret><pull-off type="stop" number="1"/></technical></notations></note>` +
      noteXml({ midi: 57, type: 'half', string: 3, fret: 2 }))]) },
  { name: 'slide-pair', families: ['slide'],
    expect: { events: 2, quarantined: 0, timingPreserved: true, techniqueKind: 'slide' },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notations><slide type="start" number="1"/><technical><string>3</string><fret>0</fret></technical></notations></note>` +
      `<note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notations><slide type="stop" number="1"/><technical><string>3</string><fret>2</fret></technical></notations></note>`)])},
  { name: 'harmonics-unsupported', families: ['natural-harmonic'],
    expect: { events: 1, quarantined: 2, quarantineCodes: ['unmodelled-technique-flag', 'notehead-variant'], vocabularySupport: 'EXPLICITLY_UNSUPPORTED' },
    build: () => scoreXml([measureXml(1,
      // 12th-fret harmonic sounds the octave above open string 1: E5 = 76.
      `<note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><notehead>diamond</notehead><notations><technical><string>1</string><fret>12</fret><harmonic/></technical></notations></note>`)])},
  { name: 'palm-mute-tapping-unsupported', families: ['palm-mute', 'tapping'],
    expect: { events: 2, quarantined: 2, quarantineCodes: ['unmodelled-technique-flag'] },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notations><technical><string>4</string><fret>2</fret><palm-mute type="start"/></technical></notations></note>` +
      `<note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notations><technical><string>3</string><fret>2</fret><tapped/></technical></notations></note>`)])},
  { name: 'alternate-tuning-drop-d', families: ['alternate-tuning', 'tuning', 'standard-tab-pairing'],
    expect: { events: 2, quarantined: 0, timingPreserved: true, tabVerified: 2 },
    tuning: [64, 59, 55, 50, 45, 38],
    build: () => {
      const tuning = [64, 59, 55, 50, 45, 38]
      return scoreXml([measureXml(1,
        noteXml({ midi: sound(tuning, 6, 2), type: 'half', string: 6, fret: 2 }) +
        noteXml({ midi: sound(tuning, 1, 0), type: 'half', string: 1, fret: 0 }),
        { clef: tabStaffClef() + dropDTuning() })])
    } },
  { name: 'capo-text-ambiguous', families: ['capo'],
    expect: { events: 1, quarantined: 1, quarantineCodes: ['ignored-text-direction'], vocabularySupport: 'AMBIGUOUS' },
    build: () => scoreXml([measureXml(1,
      `<direction><direction-type><words>Capo 2</words></direction-type></direction>` +
      noteXml({ midi: 64, type: 'whole' }))]) },
  { name: 'chord-symbol-plain', families: ['chord-symbol'],
    expect: { events: 4, harmonyEvents: 1 },
    build: () => scoreXml([measureXml(1,
      // Four real pitched quarters: the chord-sheet synthesizer only fires
      // when pitched notes are outnumbered by harmony-derived notes.
      `<harmony><root><root-step>G</root-step></root><kind text="m">minor</kind></harmony>` +
      noteXml({ midi: 67 }) + noteXml({ midi: 70 }) + noteXml({ midi: 74 }) + noteXml({ midi: 79 }))]) },
  { name: 'chord-diagram-frame-gap', families: ['chord-diagram'],
    expect: { events: 4, quarantined: 1, quarantineCodes: ['unsupported-element'], vocabularySupport: 'EXPLICITLY_UNSUPPORTED', parserGap: 'frame-dropped-silently' },
    build: () => scoreXml([measureXml(1,
      `<harmony><root><root-step>C</root-step></root><kind>major</kind><frame><frame-strings>6</frame-strings><frame-frets>4</frame-frets><frame-note><string>1</string><fret>0</fret></frame-note></frame></harmony>` +
      noteXml({ midi: 60 }) + noteXml({ midi: 64 }) + noteXml({ midi: 67 }) + noteXml({ midi: 72 }))]) },
  { name: 'repeat-endings', families: ['repeat', 'ending', 'barline'],
    expect: { events: 3, quarantined: 0, timingPreserved: true, repeatsSeen: true },
    build: () => scoreXml([
      `<measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${noteXml({ midi: 60, type: 'whole' })}<barline location="left"><repeat direction="forward"/></barline></measure>`,
      `<measure number="2">${noteXml({ midi: 62, type: 'whole' })}<barline location="right"><ending type="start" number="1"/><repeat direction="backward" times="2"/></barline></measure>`,
      `<measure number="3">${noteXml({ midi: 64, type: 'whole' })}<barline location="right"><ending type="stop" number="2"/></barline></measure>`,
    ]) },
  { name: 'ds-coda-unsupported', families: ['segno', 'coda', 'ds-dc-navigation'],
    expect: { events: 2, quarantined: 2, quarantineCodes: ['unsupported-element'], vocabularySupport: 'EXPLICITLY_UNSUPPORTED', parserGap: 'segno-coda-dropped-silently' },
    build: () => scoreXml([
      measureXml(1, `<direction><direction-type><segno/></direction-type></direction>` + noteXml({ midi: 60, type: 'whole' })),
      measureXml(2, `<direction><direction-type><coda/></direction-type></direction>` + noteXml({ midi: 62, type: 'whole' })),
    ]) },
  { name: 'grace-note-gap', families: ['grace-note', 'acciaccatura-appoggiatura'],
    expect: { events: 1, quarantined: 1, quarantineCodes: ['grace-dropped'], vocabularySupport: 'AMBIGUOUS', parserGap: 'grace-dropped-silently' },
    build: () => scoreXml([measureXml(1,
      `<note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type></note>` +
      noteXml({ midi: 64, type: 'whole' }))]) },
  { name: 'rests', families: ['rest', 'dots'],
    expect: { events: 3, quarantined: 0, timingPreserved: true, allRests: true },
    build: () => scoreXml([measureXml(1,
      `<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>` +
      `<note><rest/><duration>8</duration><voice>1</voice><type>half</type></note>` +
      `<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>`)])},
  { name: 'dynamics-expression', families: ['dynamic', 'hairpin', 'staccato', 'accent', 'marcato', 'tenuto', 'fermata', 'tempo-marking', 'slur'],
    expect: { events: 4, quarantined: 0, timingPreserved: true },
    build: () => scoreXml([measureXml(1,
      `<direction><direction-type><dynamics><pp/></dynamics></direction-type><sound tempo="90"/></direction>` +
      `<direction><direction-type><wedge type="crescendo"/></direction-type></direction>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><articulations><staccato placement="above"/></articulations></notations></note>` +
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><articulations><accent placement="below"/><strong-accent placement="below"/></articulations></notations></note>` +
      `<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><articulations><tenuto/></articulations><slur type="start" number="1"/></notations></note>` +
      `<note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><fermata type="upright"/><slur type="stop" number="1"/></notations></note>` +
      `<direction><direction-type><wedge type="stop"/></direction-type></direction>`)])},
  { name: 'ties-across-measures', families: ['tie', 'sustained-note', 'cross-measure-continuity'],
    expect: { events: 4, quarantined: 0, timingPreserved: true, tieContinuations: 1 },
    build: () => scoreXml([
      measureXml(1, `<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><tie type="start"/><notations><tied type="start"/></notations></note>` + noteXml({ midi: 62, type: 'quarter' }) + noteXml({ midi: 64, type: 'half' })),
      measureXml(2, `<note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><tie type="stop"/><notations><tied type="stop"/></notations></note>`),
    ]) },
  { name: 'paired-staff-tab', families: ['staff-pairing', 'standard-tab-pairing', 'string-number', 'fret-number'],
    expect: { events: 1, quarantined: 0, timingPreserved: true, tabVerified: 1, pairings: 1 },
    build: () => scoreXml([
      `<measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>TAB</sign><line>5</line></clef></attributes>` +
      // Same E4 engraved twice: notation staff + TAB staff. The TAB copy is a
      // mirror; its string/fret lands on the surviving standard event.
      // A <backup> rewinds the cursor, as real paired-staff exporters write it.
      `<note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>` +
      `<backup><duration>16</duration></backup>` +
      `<note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>2</staff><notations><technical><string>1</string><fret>0</fret></technical></notations></note></measure>`,
    ]) },
  { name: 'unknown-notation-quarantine', families: [],
    expect: { events: 1, quarantined: 2, quarantineCodes: ['unmodelled-technique-flag', 'impossible-position'], vocabularySupport: 'AMBIGUOUS', playabilityCode: 'string-out-of-range' },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><notations><technical><string>9</string><fret>3</fret><squiggle/></technical></notations></note>`)])},
  { name: 'beams-stems-durations', families: ['beam', 'beam-group', 'stem-direction', 'duration-whole', 'duration-16th', 'duration-32nd', 'duration-64th', 'syncopation'],
    expect: { events: 18, quarantined: 0, timingPreserved: true,
      noteTypes: ['eighth', 'eighth', '16th', '16th', '16th', '16th', '32nd', '32nd', '32nd', '32nd', '64th', '64th', '64th', '64th', 'quarter', '32nd', '32nd', 'whole'] },
    build: () => {
      const divisions = 16
      const units = { eighth: 8, '16th': 4, '32nd': 2, '64th': 1, quarter: 16 }
      const plan = ['eighth', 'eighth', '16th', '16th', '16th', '16th', '32nd', '32nd', '32nd', '32nd', '64th', '64th', '64th', '64th', 'quarter', '32nd', '32nd']
      const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E']
      const beamLevels = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4, quarter: 0 }
      let midi = 60
      const notes = plan.map((type, i) => {
        const at = (m) => { const s = NAMES[((m % 12) + 12) % 12]; return { step: s.replace('#', ''), alter: s.includes('#') ? 1 : 0, octave: Math.floor(m / 12) - 1 } }
        const p = at(midi)
        const levels = beamLevels[type]
        let beams = ''
        if (levels > 0) {
          const prev = plan[i - 1]
          const next = plan[i + 1]
          const continues = prev === type || next === type
          const pos = prev === type ? (next === type ? 'continue' : 'end') : 'begin'
          if (continues || levels === 1 || prev === type || next === type) {
            const firstOfGroup = prev !== type
            const lastOfGroup = next !== type
            const value = firstOfGroup ? 'begin' : lastOfGroup ? 'end' : 'continue'
            for (let level = 1; level <= levels; level += 1) beams += `<beam number="${level}">${value}</beam>`
          }
        }
        const stem = i % 2 === 0 ? 'up' : 'down'
        const xml = `<note><pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>` +
          `<duration>${units[type]}</duration><voice>1</voice><type>${type}</type><stem>${stem}</stem>${beams}</note>`
        midi += 1
        return xml
      }).join('')
      return scoreXml([
        measureXml(1, notes, { divisions }),
        measureXml(2, noteXml({ midi: 72, type: 'whole', divisions })),
      ])
    } },
  { name: 'accidentals-key-ledger', families: ['accidental', 'enharmonic-spelling', 'ledger-line', 'key-signature', 'clef', 'key-change', 'time-sig-change', 'clef-change'],
    expect: { events: 5, quarantined: 0, timingPreserved: true,
      spellings: [['F', 1, 4], ['B', -1, 3], ['C', null, 6], ['G', 1, 3], ['D', null, 4]],
      accidentals: ['sharp', 'flat', null, 'natural', null] },
    build: () => scoreXml([
      measureXml(1,
        `<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><accidental>sharp</accidental></note>` +
        `<note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><accidental>flat</accidental></note>` +
        `<note><pitch><step>C</step><octave>6</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>` +
        `<note><pitch><step>G</step><alter>1</alter><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><accidental>natural</accidental></note>`),
      `<measure number="2"><attributes><key><fifths>2</fifths><mode>major</mode></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>D</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note></measure>`,
    ]) },
  { name: 'pickup-anacrusis', families: ['pickup-anacrusis', 'measure-number', 'measure'],
    expect: { events: 2, quarantined: 0, timingPreserved: true, pickupSeen: true },
    build: () => scoreXml([
      `<measure number="1" implicit="yes"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${noteXml({ midi: 64, type: 'quarter' })}</measure>`,
      measureXml(2, noteXml({ midi: 65, type: 'whole' })),
    ]) },
  { name: 'tab-staff-rests-digits', families: ['staff-tab', 'tab-rest', 'tab-rhythm', 'multi-digit-fret', 'string-indication', 'tab-line-identity'],
    expect: { events: 5, quarantined: 0, timingPreserved: true, tabVerified: 3 },
    build: () => scoreXml([measureXml(1,
      // Notation-staff circled string number (string, no fret) + TAB staff events.
      `<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical><string>1</string></technical></notations></note>` +
      // 12th fret sounds the octave above the open string: E5.
      `<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>2</staff><notations><technical><string>1</string><fret>12</fret></technical></notations></note>` +
      `<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type><staff>2</staff></note>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>eighth</type><staff>2</staff><notations><technical><string>2</string><fret>1</fret></technical></notations></note>` +
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>eighth</type><staff>2</staff><notations><technical><string>2</string><fret>3</fret></technical></notations></note>`,
      { clef: tabStaffClef() })]) },
  { name: 'measure-rest-gap', families: ['measure-rest'],
    expect: { events: 2, quarantined: 1, quarantineCodes: ['unsupported-element'], vocabularySupport: 'SUPPORTED_BUT_NOT_YET_MODELED', parserGap: 'multiple-rest-unhandled' },
    build: () => scoreXml([
      measureXml(1, noteXml({ midi: 60, type: 'whole' })),
      `<measure number="2"><measure-style><multiple-rest>4</multiple-rest></measure-style><note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note></measure>`,
    ]) },
  { name: 'text-directions-gap', families: ['text-direction', 'position-indication', 'barre', 'rehearsal-mark', 'lyrics'],
    expect: { events: 2, quarantined: 3, quarantineCodes: ['ignored-text-direction', 'unsupported-element'] },
    build: () => scoreXml([measureXml(1,
      `<direction><direction-type><rehearsal>A</rehearsal></direction-type></direction>` +
      `<direction><direction-type><words>III</words></direction-type></direction>` +
      `<direction><direction-type><words>1/2BII</words></direction-type></direction>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><lyric number="1"><syllabic>single</syllabic><text>la</text></lyric></note>` +
      noteXml({ midi: 64, type: 'half' }))]) },
  { name: 'bend-params-gap', families: ['bend-amount', 'pre-bend', 'bend-release'],
    expect: { events: 1, quarantined: 3, quarantineCodes: ['unsupported-element'], vocabularySupport: 'SUPPORTED_BUT_NOT_YET_MODELED' },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><notations><technical><string>2</string><fret>3</fret><bend><bend-alter>2</bend-alter><pre-bend/><release/></bend></technical></notations></note>`)])},
  { name: 'glissando-gap', families: ['glissando'],
    expect: { events: 2, quarantined: 1, quarantineCodes: ['unsupported-element'], vocabularySupport: 'SUPPORTED_BUT_NOT_YET_MODELED' },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notations><glissando type="start" number="1" line-type="wavy"/></notations></note>` +
      noteXml({ midi: 62, type: 'half' }))]) },
  { name: 'notation-gaps-quarantine', families: ['tremolo', 'octave-shift', 'left-hand-fingering', 'right-hand-fingering', 'fingering-tab', 'arpeggio', 'ornament-trill', 'pick-direction', 'let-ring', 'breath-mark', 'staccatissimo'],
    expect: { events: 3, quarantined: 9, quarantineCodes: ['unsupported-element', 'unmodelled-technique-flag'] },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><arpeggiate/><technical><fingering>2</fingering><pluck>P</pluck><up-bow/><let-ring type="start"/></technical></notations></note>` +
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notations><articulations><staccatissimo/><breath-mark/></articulations><ornaments><trill-mark/></ornaments><tremolo type="single">3</tremolo></notations></note>` +
      `<direction><direction-type><octave-shift type="down" size="8"/></direction-type></direction>` +
      noteXml({ midi: 64, type: 'half' }))]) },
  { name: 'artificial-pinch-gap', families: ['artificial-harmonic', 'pinch-harmonic'],
    expect: { events: 2, quarantined: 3, quarantineCodes: ['unmodelled-technique-flag'], vocabularySupport: 'EXPLICITLY_UNSUPPORTED' },
    build: () => scoreXml([measureXml(1,
      // Touched-5th artificial harmonic notated at sounding pitch A4 = string 1 fret 5.
      `<note><pitch><step>A</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notations><technical><string>1</string><fret>5</fret><harmonic><artificial/></harmonic></technical></notations></note>` +
      `<note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notations><technical><string>1</string><fret>0</fret><other-technical>P.H.</other-technical></technical></notations></note>`)])},
  { name: 'dead-ghost-gap', families: ['dead-note', 'ghost-note', 'muted-dead-x', 'notehead-variant'],
    expect: { events: 2, quarantined: 1, quarantineCodes: ['notehead-variant'],
      vocabularySupport: { 'dead-note': 'EXPLICITLY_UNSUPPORTED', 'ghost-note': 'EXPLICITLY_UNSUPPORTED', 'muted-dead-x': 'SUPPORTED_BUT_NOT_YET_MODELED', 'notehead-variant': 'EXPLICITLY_UNSUPPORTED' } },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notehead>x</notehead></note>` +
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notehead filled="no">diamond</notehead></note>`)])},
  { name: 'cue-gap', families: ['cue-note'],
    expect: { events: 3, quarantined: 1, quarantineCodes: ['cue-misread'], vocabularySupport: 'AMBIGUOUS', parserGap: 'cue-parses-as-sounding' },
    build: () => scoreXml([measureXml(1,
      `<note><cue/><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>` +
      noteXml({ midi: 64, type: 'half' }) + noteXml({ midi: 65, type: 'quarter' }))]) },
  { name: 'whammy-gap', families: ['whammy-bar'],
    expect: { events: 1, quarantined: 1, quarantineCodes: ['unmodelled-technique-flag'], vocabularySupport: 'EXPLICITLY_UNSUPPORTED' },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><notations><technical><string>1</string><fret>0</fret><other-technical>whammy</other-technical></technical></notations></note>`)])},
  { name: 'vibrato-wavy', families: ['vibrato'],
    expect: { events: 1, quarantined: 0, timingPreserved: true },
    build: () => scoreXml([measureXml(1,
      `<note><pitch><step>A</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><notations><ornaments><wavy-line/></ornaments></notations></note>`)])},
]

export function fixtureManifest() {
  return {
    version: 'guitar-fixtures/1.0',
    count: FIXTURES.length,
    fixtures: FIXTURES.map((f) => ({ name: f.name, families: f.families, expect: f.expect, tuning: f.tuning ?? null })),
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const outIndex = process.argv.indexOf('--out')
  const outDir = resolve(ROOT, outIndex >= 0 ? process.argv[outIndex + 1] : 'datasets/guitar-vision/fixtures/notation-v1')
  mkdirSync(outDir, { recursive: true })
  for (const fixture of FIXTURES) {
    writeFileSync(join(outDir, `${fixture.name}.musicxml`), fixture.build())
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(fixtureManifest(), null, 2))
  console.log(`wrote ${FIXTURES.length} fixtures to ${outDir}`)
}
