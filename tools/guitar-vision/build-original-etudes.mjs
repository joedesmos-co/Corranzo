#!/usr/bin/env node
/**
 * Corranzo original guitar etudes (A6) — CONTROLLED_ORIGINAL_ETUDES tier.
 *
 * Short ORIGINAL studies (seeded diatonic figures; no copied material)
 * designed to carry specific guitar techniques with source-authoritative
 * relationships. Every string/fret is assigned by the composer, so pairing
 * verifies by construction; every technique is encoded explicitly.
 *
 * License: CC0-1.0 (original project compositions).
 * Collection: corranzo-original-etudes-v1.
 * Provenance: controlled-original (tracked SEPARATELY from real-world
 * coverage — valid targeted supervision, never misrepresented as
 * independent real-score evidence).
 *
 * Deterministic: mulberry32 streams; rebuilding is byte-identical.
 *
 * Usage:
 *   node tools/guitar-vision/build-original-etudes.mjs --out <dir>
 * Writes <name>.musicxml + manifest.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const ETUDE_COLLECTION = 'corranzo-original-etudes-v1'
export const ETUDE_LICENSE = 'CC0-1.0'
export const ETUDE_VERSION = 'corranzo-etudes/1.0'

const STD = [64, 59, 55, 50, 45, 40] // string-indexed tuning, 1 = highest
const DROP_D = [64, 59, 55, 50, 45, 38]
const DADGAD = [62, 57, 55, 50, 45, 38]
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pitchXml(midi) {
  const pc = NAMES[((midi % 12) + 12) % 12]
  const alter = pc.includes('#') ? 1 : 0
  return `<pitch><step>${pc.replace('#', '')}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`
}

/** Lowest-position string/fret assignment for a pitch under a tuning. */
export function assignPosition(midi, tuning = STD, maxFret = 12) {
  let best = null
  for (let string = 1; string <= tuning.length; string += 1) {
    const fret = midi - tuning[string - 1]
    if (fret < 0 || fret > maxFret) continue
    if (!best || fret < best.fret || (fret === best.fret && string < best.string)) best = { string, fret }
  }
  return best ?? { string: 1, fret: Math.max(0, midi - tuning[0]) }
}

/**
 * Playable chord voicing: highest pitch goes to string 1, descending to
 * higher-numbered strings, so no string is ever fretted twice. Throws nothing;
 * returns null for unvoiceable sets (the caller must not emit those).
 */
export function assignChord(midis, tuning = STD, maxFret = 12) {
  const ordered = [...midis].sort((a, b) => b - a)
  if (ordered.length > tuning.length) return null
  const positions = ordered.map((midi, i) => {
    const string = i + 1
    const fret = midi - tuning[string - 1]
    return { midi, string, fret }
  })
  if (positions.some((p) => p.fret < 0 || p.fret > maxFret)) return null
  return positions
}

const DUR_UNITS = { whole: 16, half: 8, quarter: 4, eighth: 2, '16th': 1 }
const DUR_Q = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }
function dotsMultiplier(dots) { return dots > 0 ? 2 - 1 / 2 ** dots : 1 }

function noteXml(spec, divisions = 4) {
  const {
    midi, string = null, fret = null, type = 'quarter', dots = 0, voice = 1,
    chord = false, rest = false, notations = '', staff = null, beams = '', extra = '',
  } = spec
  const dur = Math.round(DUR_UNITS[type] * (divisions / 4) * dotsMultiplier(dots))
  const tech = string != null || fret != null || notations
    ? `<technical>${string != null ? `<string>${string}</string>` : ''}${fret != null ? `<fret>${fret}</fret>` : ''}${notations}</technical>`
    : ''
  const notationsXml = tech || extra ? `<notations>${tech}${extra}</notations>` : ''
  return `<note>${chord ? '<chord/>' : ''}` +
    `${rest ? '<rest/>' : pitchXml(midi)}` +
    `<duration>${dur}</duration><voice>${voice}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}` +
    `${staff != null ? `<staff>${staff}</staff>` : ''}${beams}${notationsXml}</note>`
}

function headerXml({ divisions = 4, beats = 4, beatType = 4, clef = null, tuning = null } = {}) {
  return `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key>` +
    `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` +
    `${clef ?? '<clef><sign>G</sign><line>2</line></clef>'}${tuning ?? ''}</attributes>`
}

const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/**
 * staff-details with string tuning, declared like real exporters do.
 * Line 1 is the bottom line = lowest string. Declared tuning lets pairing
 * verify under alternate tunings without out-of-band options.
 */
export function tuningDetails(tuning) {
  const lines = []
  for (let line = 1; line <= tuning.length; line += 1) {
    const midi = tuning[tuning.length - line] // line 1 = lowest string
    const pc = NAMES[((midi % 12) + 12) % 12]
    const step = pc.replace('#', '')
    const alter = pc.includes('#') ? 1 : 0
    const octave = Math.floor(midi / 12) - 1
    lines.push(`<staff-tuning line="${line}"><tuning-step>${step}</tuning-step>` +
      `${alter ? `<tuning-alter>${alter}</tuning-alter>` : ''}<tuning-octave>${octave}</tuning-octave></staff-tuning>`)
  }
  return `<staff-details><staff-lines>6</staff-lines>${lines.join('')}</staff-details>`
}

function etudeScore(title, measures, header) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">` +
    `<work><work-title>${title}</work-title></work>` +
    `<identification><creator type="composer">Corranzo Etude Generator (original study)</creator>` +
    `<rights>CC0-1.0 — Corranzo original etude (project composition, no source material)</rights>` +
    `<encoding><software>corranzo-etude-composer/1.0</software></encoding></identification>` +
    `<part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>` +
    `<part id="P1">${measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? header : ''}${m}</measure>`).join('')}</part></score-partwise>`
}

/** Pack quarter-counted note XML strings into 4/4 bars on note boundaries. */
function packBars(noteXmls, quarters) {
  const bars = []
  let current = ''
  let total = 0
  for (let i = 0; i < noteXmls.length; i += 1) {
    current += noteXmls[i]
    total += quarters[i]
    if (total >= 4 - 1e-9) {
      bars.push(current)
      current = ''
      total = 0
    }
  }
  if (current) bars.push(current)
  return bars
}

function walk(rand, length, start, steps) {
  const out = [start]
  for (let i = 1; i < length; i += 1) {
    out.push(out[i - 1] + steps[Math.floor(rand() * steps.length)])
  }
  return out
}

function pitchedRun(rand, count, base, tuning, maxFret = 9) {
  return walk(rand, count, base, [-2, -1, 1, 2, 3]).map((midi) => ({ midi, ...assignPosition(midi, tuning, maxFret) }))
}

const ETUDES = []
function etude(name, families, build, extra = {}) {
  ETUDES.push({ name, families, build, tuning: STD, capo: 0, ...extra })
}

// Natural harmonic sounding pitch: 12th = +12, 7th = +19, 5th = +24 above open.
const HARMONIC_OFFSET = { 12: 12, 7: 19, 5: 24 }
function harmonicNote(openMidi, fret, dur = 'quarter') {
  const sounding = openMidi + (HARMONIC_OFFSET[fret] ?? 12)
  return `<note>${pitchXml(sounding)}<duration>${DUR_UNITS[dur]}</duration><voice>1</voice><type>${dur}</type><notehead>diamond</notehead>` +
    `<notations><technical><string>1</string><fret>${fret}</fret><harmonic/></technical></notations></note>`
}

function buildBendEtude(alter, pre, rel, title) {
  return (rand) => {
    const notes = pitchedRun(rand, 8, 62, STD)
    const xmls = notes.map((n, i) => noteXml({
      ...n, type: 'quarter',
      notations: i % 2 === 0 ? `<bend><bend-alter>${alter}</bend-alter>${pre ? '<pre-bend/>' : ''}${rel ? '<release/>' : ''}</bend>` : '',
    }))
    const bars = packBars(xmls, Array(8).fill(1))
    return etudeScore(title, bars, headerXml({}))
  }
}

etude('bend-half', ['bend', 'bend-amount'], buildBendEtude('1', false, false, 'Bend study (half)'))
etude('bend-full', ['bend', 'bend-amount'], buildBendEtude('2', false, false, 'Bend study (full)'))
etude('bend-pre', ['bend', 'bend-amount', 'pre-bend'], buildBendEtude('2', true, false, 'Pre-bend study'))
etude('bend-release', ['bend', 'bend-amount', 'bend-release'], buildBendEtude('1', false, true, 'Bend release study'))
etude('bend-chain', ['bend', 'bend-amount', 'bend-release'], buildBendEtude('2', false, true, 'Bend and release chain'))

etude('slide-chain', ['slide'], (rand) => {
  const notes = pitchedRun(rand, 8, 55, STD, 7)
  let num = 0
  const xmls = notes.map((n, i) => {
    let slide = ''
    if (i > 0) slide += `<slide type="stop" number="${num}"/>`
    if (i < notes.length - 1) { num += 1; slide += `<slide type="start" number="${num}"/>` }
    return noteXml({ ...n, type: 'quarter', extra: slide })
  })
  return etudeScore('Slide chain', packBars(xmls, Array(8).fill(1)), headerXml({}))
})

etude('slide-legato-gliss', ['slide', 'glissando'], () => {
  const a = assignPosition(57, STD)
  const b = assignPosition(60, STD)
  const c = assignPosition(62, STD)
  const d = assignPosition(64, STD)
  const xmls = [
    noteXml({ midi: 57, ...a, type: 'half', extra: '<slide type="start" number="1" line-type="solid"/>' }),
    noteXml({ midi: 60, ...b, type: 'half', extra: '<slide type="stop" number="1"/>' }),
    noteXml({ midi: 62, ...c, type: 'half', extra: '<glissando type="start" number="2" line-type="wavy"/>' }),
    noteXml({ midi: 64, ...d, type: 'half', extra: '<glissando type="stop" number="2"/>' }),
  ]
  return etudeScore('Legato slide and glissando', packBars(xmls, [2, 2, 2, 2]), headerXml({}))
})

for (const kind of ['hammer-on', 'pull-off']) {
  etude(`legato-${kind === 'hammer-on' ? 'hammer' : 'pull'}`, [kind], (rand) => {
    const notes = pitchedRun(rand, 8, 57, STD, 7)
    const other = kind === 'hammer-on' ? 'pull-off' : 'hammer-on'
    const xmls = notes.map((n, i) => noteXml({
      ...n, type: 'quarter',
      notations: i % 2 === 0 ? `<${kind} type="start" number="1"/>` : `<${other} type="stop" number="1"/>`,
    }))
    return etudeScore(`Legato (${kind})`, packBars(xmls, Array(8).fill(1)), headerXml({}))
  })
}

etude('harmonic-natural', ['natural-harmonic'], () => {
  const frets = [12, 12, 7, 5, 12, 7, 5, 12]
  const xmls = frets.map((fret) => harmonicNote(STD[0], fret))
  return etudeScore('Natural harmonics', packBars(xmls, Array(8).fill(1)), headerXml({}))
})

etude('harmonic-artificial', ['artificial-harmonic'], () => {
  // Stopped A4 (string 1 fret 5), touched D5, sounding A6.
  const xmls = [0, 1].flatMap(() => [
    `<note>${pitchXml(69)}<duration>8</duration><voice>1</voice><type>half</type>` +
    `<notations><technical><string>1</string><fret>5</fret><harmonic><artificial/>` +
    `<touching-pitch><step>D</step><octave>5</octave></touching-pitch>` +
    `<sounding-pitch><step>A</step><octave>6</octave></sounding-pitch>` +
    `</harmonic></technical></notations></note>`,
    noteXml({ midi: 67, ...assignPosition(67, STD), type: 'half' }),
  ])
  return etudeScore('Artificial harmonics', packBars(xmls, [2, 2, 2, 2]), headerXml({}))
})

etude('tapping-phrase', ['tapping'], (rand) => {
  const notes = pitchedRun(rand, 8, 64, STD, 12)
  const xmls = notes.map((n, i) => noteXml({
    ...n, type: 'quarter',
    notations: i % 2 === 1 ? `<tapped hand="${i % 4 === 1 ? 'right' : 'left'}"/>` : '',
  }))
  return etudeScore('Tapping phrase', packBars(xmls, Array(8).fill(1)), headerXml({}))
})

etude('tapping-tap-fret', ['tapping'], (rand) => {
  const notes = pitchedRun(rand, 4, 69, STD, 15)
  const xmls = notes.map((n) => noteXml({
    ...n, type: 'half',
    notations: `<tap hand="right"><fret>${n.fret}</fret></tap>`,
  }))
  return etudeScore('Fretboard taps', packBars(xmls, [2, 2, 2, 2]), headerXml({}))
})

etude('palm-mute-span', ['palm-mute'], (rand) => {
  const notes = pitchedRun(rand, 8, 50, STD, 5)
  const xmls = notes.map((n, i) => {
    let pm = ''
    if (i === 0) pm = '<palm-mute type="start"/>'
    else if (i === notes.length - 1) pm = '<palm-mute type="stop"/>'
    return noteXml({ ...n, type: 'quarter', notations: pm })
  })
  return etudeScore('Palm mute span', packBars(xmls, Array(8).fill(1)), headerXml({}))
})

etude('let-ring-arpeggio', ['let-ring', 'arpeggio'], (rand) => {
  const chord = [48, 55, 60, 64].map((midi) => ({ midi, ...assignPosition(midi, STD) }))
  const bars = []
  for (let b = 0; b < 4; b += 1) {
    void rand
    const xmls = chord.map((n, i) => noteXml({
      ...n, type: 'quarter', chord: i > 0,
      notations: `${b === 0 && i === 0 ? '<let-ring type="start"/>' : ''}${b === 3 && i === 3 ? '<let-ring type="stop"/>' : ''}`,
      extra: i === 0 ? '<arpeggiate direction="up"/>' : '',
    }))
    bars.push(xmls.join(''))
  }
  return etudeScore('Let ring arpeggio', bars, headerXml({}))
})

etude('dead-ghost-strum', ['dead-note', 'ghost-note', 'muted-dead-x', 'notehead-variant'], () => {
  const live = assignPosition(64, STD)
  const xmls = [
    `<note>${pitchXml(64)}<duration>4</duration><voice>1</voice><type>quarter</type><notehead>x</notehead></note>`,
    `<note>${pitchXml(62)}<duration>4</duration><voice>1</voice><type>quarter</type><notehead parentheses="yes">normal</notehead></note>`,
    noteXml({ midi: 64, ...live, type: 'quarter' }),
    noteXml({ midi: 62, ...assignPosition(62, STD), type: 'quarter' }),
  ]
  return etudeScore('Dead and ghost strum', packBars([...xmls, ...xmls], Array(8).fill(1)), headerXml({}))
})

etude('vibrato-lines', ['vibrato'], (rand) => {
  const notes = pitchedRun(rand, 4, 64, STD, 8)
  const xmls = notes.map((n, i) => i % 2 === 0
    ? noteXml({ ...n, type: 'whole', extra: '<ornaments><wavy-line/></ornaments>' })
    : noteXml({ ...n, type: 'whole', notations: '<other-technical>vibrato</other-technical>' }))
  return etudeScore('Vibrato lines', packBars(xmls, [4, 4, 4, 4]), headerXml({}))
})

etude('tremolo-picking-run', ['tremolo', 'tremolo-picking'], (rand) => {
  const notes = pitchedRun(rand, 16, 64, STD, 7)
  const xmls = notes.map((n) => noteXml({
    ...n, type: '16th',
    extra: '<tremolo type="single">3</tremolo>',
  }, 8))
  return etudeScore('Tremolo picking run', packBars(xmls, Array(16).fill(0.25)), headerXml({ divisions: 8 }))
})

etude('golpe-accent', ['golpe'], (rand) => {
  const notes = pitchedRun(rand, 8, 60, STD, 7)
  const xmls = notes.map((n, i) => noteXml({
    ...n, type: 'quarter', notations: i % 4 === 0 ? '<golpe/>' : '',
  }))
  return etudeScore('Golpe accent', packBars(xmls, Array(8).fill(1)), headerXml({}))
})

etude('capo-two', ['capo'], (rand) => {
  const notes = pitchedRun(rand, 8, 66, STD, 5)
  const xmls = notes.map((n) => {
    const pos = assignPosition(n.midi - 2, STD, 5)
    return noteXml({ midi: n.midi, ...pos, type: 'quarter' })
  })
  const head = `<direction><direction-type><words>Capo 2</words></direction-type></direction>`
  return etudeScore('Capo two study', [head + xmls.slice(0, 4).join(''), xmls.slice(4).join('')], headerXml({}))
}, { capo: 2 })

etude('capo-five-position', ['capo', 'position-indication', 'barre'], () => {
  const notes = [69, 71, 72, 74, 72, 71, 69, 67].map((midi) => {
    const pos = assignPosition(midi - 5, STD, 7)
    return noteXml({ midi, ...pos, type: 'quarter' })
  })
  const head = `<direction><direction-type><words>Capo 5</words></direction-type></direction>` +
    `<direction><direction-type><words>V</words></direction-type></direction>`
  const head2 = `<direction><direction-type><words>BIII</words></direction-type></direction>`
  return etudeScore('Capo five position study', [head + notes.slice(0, 4).join(''), head2 + notes.slice(4).join('')], headerXml({}))
}, { capo: 5 })

etude('drop-d-riff', ['alternate-tuning', 'tuning'], (rand) => {
  const notes = pitchedRun(rand, 8, 45, DROP_D, 7)
  const xmls = notes.map((n) => noteXml({ ...n, type: 'quarter' }))
  return etudeScore('Drop D riff', packBars(xmls, Array(8).fill(1)), headerXml({ tuning: tuningDetails(DROP_D) }))
}, { tuning: DROP_D })

etude('dadgad-drone', ['alternate-tuning', 'tuning'], (rand) => {
  const notes = pitchedRun(rand, 8, 50, DADGAD, 7)
  const xmls = notes.map((n) => noteXml({ ...n, type: 'quarter' }))
  return etudeScore('DADGAD drone', packBars(xmls, Array(8).fill(1)), headerXml({ tuning: tuningDetails(DADGAD) }))
}, { tuning: DADGAD })

etude('fingering-position', ['left-hand-fingering', 'right-hand-fingering', 'fingering-tab', 'pick-direction'], () => {
  const fingers = ['1', '2', '3', '4', '3', '2', '1', '2']
  const picks = ['P', 'I', 'M', 'A', 'M', 'I', 'P', 'I']
  const midis = [52, 53, 55, 57, 55, 53, 52, 50]
  const xmls = midis.map((midi, i) => {
    const pos = assignPosition(midi, STD, 5)
    return noteXml({
      midi, ...pos, type: 'quarter',
      notations: `<fingering>${fingers[i]}</fingering><pluck>${picks[i]}</pluck>${i % 2 === 0 ? '<down-bow/>' : '<up-bow/>'}`,
    })
  })
  return etudeScore('Fingering position study', packBars(xmls, Array(8).fill(1)), headerXml({}))
})

etude('chord-diagrams', ['chord-diagram', 'chord-symbol'], () => {
  const mkBar = (root, kind, strings, frets, frameNotes, chordMidis) => {
    const frame = `<frame><frame-strings>${strings}</frame-strings><frame-frets>${frets}</frame-frets>` +
      frameNotes.map((fn) => `<frame-note><string>${fn[0]}</string><fret>${fn[1]}</fret>${fn[2] != null ? `<fingering>${fn[2]}</fingering>` : ''}</frame-note>`).join('') + `</frame>`
    const voicing = assignChord(chordMidis, STD)
    const notes = voicing.map((n, i) => noteXml({ ...n, type: 'whole', chord: i > 0 })).join('')
    return `<harmony><root><root-step>${root}</root-step></root><kind>${kind}</kind>${frame}</harmony>` + notes
  }
  // Whole-note chords: one bar each (the frame spans its bar).
  const bar1 = mkBar('G', 'major', 6, 4,
    [[1, 3, 4], [2, 2, 3], [3, 0, 0], [4, 0, 0], [5, 2, 1], [6, 3, 2]], [62, 67, 71, 74])
  const bar2 = mkBar('C', 'major', 6, 4,
    [[1, 0, 0], [2, 1, 1], [3, 0, 0], [4, 2, 2], [5, 3, 3]], [60, 64, 67, 72])
  return etudeScore('Chord diagrams', [bar1, bar2], headerXml({}))
})

etude('repeats-endings', ['repeat', 'ending'], () => {
  const a = [60, 62, 64, 65].map((midi) => noteXml({ midi, ...assignPosition(midi, STD), type: 'quarter' })).join('')
  const b = [67, 65, 64, 62].map((midi) => noteXml({ midi, ...assignPosition(midi, STD), type: 'quarter' })).join('')
  const c = [64, 62, 60, 60].map((midi) => noteXml({ midi, ...assignPosition(midi, STD), type: 'quarter' })).join('')
  return etudeScore('Repeats and endings', [
    `${a}<barline location="left"><repeat direction="forward"/></barline>`,
    `${b}<barline location="right"><ending type="start" number="1"/><repeat direction="backward" times="2"/></barline>`,
    `${c}<barline location="right"><ending type="stop" number="2"/></barline>`,
  ], headerXml({}))
})

etude('segno-coda-roadmap', ['segno', 'coda', 'ds-dc-navigation', 'fine', 'to-coda'], () => {
  const line = (midi) => noteXml({ midi, ...assignPosition(midi, STD), type: 'whole' })
  return etudeScore('Segno coda roadmap', [
    `<direction><direction-type><segno/></direction-type></direction>` + line(60),
    `<direction><direction-type><coda/></direction-type></direction><direction><direction-type><words>To Coda</words></direction-type></direction>` + line(62),
    `<direction><direction-type><words>D.S. al Coda</words></direction-type></direction>` + line(64),
    `<direction><direction-type><words>Fine</words></direction-type></direction><sound fine="yes"/>` + line(65),
  ], headerXml({}))
})

etude('grace-cue-figures', ['grace-note', 'acciaccatura-appoggiatura', 'cue-note'], () => {
  const grace = (midi, slash) => `<note><grace${slash ? ' slash="yes"' : ''}/>${pitchXml(midi)}<voice>1</voice><type>eighth</type></note>`
  const bar1 = grace(74, true) + noteXml({ midi: 72, ...assignPosition(72, STD), type: 'half' }) +
    grace(71, false) + noteXml({ midi: 69, ...assignPosition(69, STD), type: 'quarter' }) +
    noteXml({ midi: 67, ...assignPosition(67, STD), type: 'quarter' })
  const bar2 = `<note><cue/>${pitchXml(79)}<duration>4</duration><voice>1</voice><type>quarter</type></note>` +
    noteXml({ midi: 72, ...assignPosition(72, STD), type: 'half' }) +
    noteXml({ midi: 67, ...assignPosition(67, STD), type: 'quarter' })
  return etudeScore('Grace and cue figures', [bar1, bar2], headerXml({}))
})

etude('tuplet-figures', ['tuplet'], (rand) => {
  const trip = (base) => [0, 2, 4].map((iv) => {
    const midi = base + iv
    const pos = assignPosition(midi, STD, 8)
    return `<note>${pitchXml(midi)}<duration>4</duration><voice>1</voice><type>eighth</type>` +
      `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` +
      `<notations><technical><string>${pos.string}</string><fret>${pos.fret}</fret></technical></notations></note>`
  }).join('')
  const q = (midi) => noteXml({ midi, ...assignPosition(midi, STD) }, 12)
  const bar1 = trip(60) + q(65) + q(67) + q(69)
  const bar2 = [60, 62, 64, 65].map((midi) => noteXml({ midi, ...assignPosition(midi, STD) }, 12)).join('')
  void rand
  return etudeScore('Tuplet figures', [bar1, bar2], headerXml({ divisions: 12 }))
})

etude('multivoice-tab', ['multi-voice-rhythm', 'tab-rhythm'], (rand) => {
  const top = pitchedRun(rand, 4, 64, STD, 7)
  const low = [48, 50, 52, 53].map((midi) => ({ midi, ...assignPosition(midi, STD) }))
  const upper = top.map((n) => noteXml({ ...n, type: 'quarter', voice: 1 })).join('')
  const lower = `<backup><duration>16</duration></backup>` + low.map((n) => noteXml({ ...n, type: 'quarter', voice: 2 })).join('')
  return etudeScore('Two-voice TAB', [upper + lower], headerXml({}))
})

etude('ornament-trills', ['ornament-trill', 'staccatissimo', 'breath-mark', 'accent', 'staccato', 'tenuto'], () => {
  const xmls = [
    `<note>${pitchXml(72)}<duration>8</duration><voice>1</voice><type>half</type><notations><articulations><staccatissimo/></articulations><ornaments><trill-mark/></ornaments></notations></note>`,
    `<note>${pitchXml(69)}<duration>8</duration><voice>1</voice><type>half</type><notations><articulations><breath-mark/><accent/></articulations></notations></note>`,
    noteXml({ midi: 67, ...assignPosition(67, STD), type: 'quarter' }),
    `<note>${pitchXml(65)}<duration>4</duration><voice>1</voice><type>quarter</type><notations><articulations><staccato/><tenuto/></articulations></notations></note>`,
    noteXml({ midi: 64, ...assignPosition(64, STD), type: 'quarter' }),
    noteXml({ midi: 62, ...assignPosition(62, STD), type: 'quarter' }),
  ]
  return etudeScore('Ornaments and touch', packBars(xmls, [2, 2, 1, 1, 1, 1]), headerXml({}))
})

etude('dynamics-hairpins', ['dynamic', 'hairpin', 'tempo-marking', 'slur', 'fermata'], () => {
  const xmls = [
    `<note>${pitchXml(60)}<duration>4</duration><voice>1</voice><type>quarter</type><notations><slur type="start" number="1"/></notations></note>`,
    `<note>${pitchXml(62)}<duration>4</duration><voice>1</voice><type>quarter</type><notations><slur type="stop" number="1"/><fermata type="upright"/></notations></note>`,
    noteXml({ midi: 64, ...assignPosition(64, STD), type: 'quarter' }),
    noteXml({ midi: 65, ...assignPosition(65, STD), type: 'quarter' }),
  ]
  const head = `<direction><direction-type><dynamics><pp/></dynamics></direction-type><sound tempo="90"/></direction>` +
    `<direction><direction-type><wedge type="crescendo"/></direction-type></direction>`
  const tail = `<direction><direction-type><wedge type="stop"/></direction-type></direction>`
  return etudeScore('Dynamics and hairpins', [head + xmls.join('') + tail], headerXml({}))
})

etude('cross-part-etude', ['standard-tab-pairing'], (rand) => {
  const notes = pitchedRun(rand, 4, 60, STD, 8)
  const p1 = `<measure number="1">${headerXml({})}` +
    notes.map((n) => noteXml({ midi: n.midi, type: 'quarter' })).join('') + `</measure>`
  const p2 = `<measure number="1">${headerXml({ clef: '<clef><sign>TAB</sign><line>5</line></clef>' })}` +
    notes.map((n) => noteXml({ midi: n.midi, string: n.string, fret: n.fret, type: 'quarter', staff: 1 })).join('') + `</measure>`
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">` +
    `<work><work-title>Cross-part pairing etude</work-title></work>` +
    `<identification><creator type="composer">Corranzo Etude Generator (original study)</creator>` +
    `<rights>CC0-1.0 — Corranzo original etude (project composition, no source material)</rights>` +
    `<encoding><software>corranzo-etude-composer/1.0</software></encoding></identification>` +
    `<part-list><score-part id="P1"><part-name>Guitar</part-name></score-part>` +
    `<score-part id="P2"><part-name>Guitar TAB</part-name></score-part></part-list>` +
    `<part id="P1">${p1}</part><part id="P2">${p2}</part></score-partwise>`
})

export function etudeManifest() {
  return {
    version: ETUDE_VERSION,
    collection: ETUDE_COLLECTION,
    license: ETUDE_LICENSE,
    count: ETUDES.length,
    etudes: ETUDES.map((e) => ({ name: e.name, families: e.families, tuning: e.tuning, capo: e.capo })),
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const outIndex = process.argv.indexOf('--out')
  const outDir = resolve(ROOT, outIndex >= 0 ? process.argv[outIndex + 1] : 'datasets/guitar-vision/etudes')
  mkdirSync(outDir, { recursive: true })
  let written = 0
  for (const et of ETUDES) {
    const built = et.build(mulberry32([...et.name].reduce((a, c) => a + c.charCodeAt(0), 7)))
    writeFileSync(join(outDir, `${et.name}.musicxml`), built)
    written += 1
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(etudeManifest(), null, 1))
  console.log(`wrote ${written} etudes to ${outDir}`)
}
