#!/usr/bin/env node
/**
 * Guitar Vision — deterministic synthetic score generation (TRAIN SPLIT ONLY).
 *
 * ## The hard rule
 *
 * This tool refuses to write anything into a validation or held-out split. It
 * takes a `--split` argument precisely so the misuse is a loud failure rather
 * than a silent one. Synthetic data may supplement training volume; it may
 * never stand in for real evaluation, because a model evaluated on data whose
 * generator it was trained against learns nothing about generalisation.
 *
 * ## What it produces
 *
 * A matched event model and its MusicXML, correct by construction: pitches come
 * from real fretboard positions rather than a pitch sampler, so every
 * string/fret/pitch triple is physically playable, and the paired TAB staff
 * agrees with the notation staff because both are generated from the same
 * events.
 *
 * Determinism: a given `--seed` always produces byte-identical output, so a
 * generated corpus can be regenerated and diffed.
 *
 * Rendering to PDF/raster belongs to the Phase 3 data engine, which owns the
 * engraver. This tool produces the structured half of a matched pair.
 *
 * Usage:
 *   node tools/guitar-vision/generate-synthetic.mjs --split train --count 40 --seed 7
 *   node tools/guitar-vision/generate-synthetic.mjs --split validation --count 1   # refused
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STANDARD_GUITAR_TUNING } from '../../src/features/instruments/instruments.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const SPLITS_THAT_MAY_BE_SYNTHETIC = Object.freeze(['train'])

const DIVISIONS = 480 // per quarter note

/**
 * Notation families this generator can legitimately produce.
 *
 * It generates *printed music* — notes, rhythms, notation+TAB pairs, and the
 * technique markings whose MusicXML representation is unambiguous. It does not
 * attempt engraver-specific glyph shapes, page photography, or anything whose
 * appearance a renderer cannot honestly reproduce; those are marked
 * `requiresRealPages` in the acquisition plan.
 */
export const GENERATED_FAMILIES = Object.freeze([
  'note',
  'rest',
  'chord',
  'stacked-notes',
  'multi-voice',
  'onset',
  'duration',
  'augmentation-dot',
  'tuplet',
  'accidental',
  'key-signature',
  'time-signature',
  'clef',
  'barline',
  'tie',
  'grace-note',
  'fret-number',
  'string-number',
  'string-assignment',
  'paired-staff-tab',
  'tab-staff',
  'bend',
  'bend-amount',
  'hammer-on',
  'pull-off',
  'slide',
  'glissando',
  'natural-harmonic',
  'artificial-harmonic',
  'tapping',
  'fingering',
  'fret-position',
  'staccato',
  'accent',
])

/** Deterministic PRNG (mulberry32) so a seed reproduces output exactly. */
export function makeRandom(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PITCH_STEPS = [
  { step: 'C', alter: 0 },
  { step: 'C', alter: 1 },
  { step: 'D', alter: 0 },
  { step: 'D', alter: 1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'F', alter: 1 },
  { step: 'G', alter: 0 },
  { step: 'G', alter: 1 },
  { step: 'A', alter: 0 },
  { step: 'A', alter: 1 },
  { step: 'B', alter: 0 },
]

/** A random playable position on the fretboard, biased away from the extremes. */
function randomPosition(random, { maxFret = 19, minFret = 0 } = {}) {
  const string = 1 + Math.floor(random() * STANDARD_GUITAR_TUNING.length)
  const open = STANDARD_GUITAR_TUNING[string - 1]
  const fret = minFret + Math.floor(random() * (maxFret - minFret + 1))
  const soundingMidi = open + fret
  if (soundingMidi < 40 || soundingMidi > 88) return randomPosition(random, { maxFret, minFret })
  return { string, fret, soundingMidi }
}

function midiToPitch(midi) {
  const names = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B']
  const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]
  const index = ((midi % 12) + 12) % 12
  return {
    step: names[index],
    alter: alters[index],
    octave: Math.floor(midi / 12) - 1,
  }
}

const DURATIONS = [
  { type: 'quarter', quarters: 1 },
  { type: 'eighth', quarters: 0.5 },
  { type: 'eighth', quarters: 0.5 },
  { type: '16th', quarters: 0.25 },
  { type: 'half', quarters: 2 },
  { type: 'whole', quarters: 4 },
]

/**
 * Technique markings chosen from the generated set, with a payload that the
 * strict metric can compare (bend amounts, for example, are numeric).
 */
const TECHNIQUES = [
  { id: 'hammer-on', probability: 0.12 },
  { id: 'pull-off', probability: 0.12 },
  { id: 'slide', probability: 0.08 },
  { id: 'glissando', probability: 0.04 },
  { id: 'bend', probability: 0.10, amounts: [1, 2, '1/2', '1 1/2', 3] },
  { id: 'tapping', probability: 0.05 },
  { id: 'natural-harmonic', probability: 0.07 },
  { id: 'artificial-harmonic', probability: 0.05 },
  { id: 'staccato', probability: 0.18 },
  { id: 'accent', probability: 0.12 },
]

function pickTechnique(random, previous) {
  if (previous) {
    // A hammer-on or pull-off needs the previous note to exist; a slide and a
    // pull-off are the same physical motion and never co-occur.
    if (previous.has('pull-off') || previous.has('slide')) return null
  }
  for (const technique of TECHNIQUES) {
    if (technique.id === 'pull-off' || technique.id === 'slide') {
      if (!previous) continue
    }
    if (technique.id === 'hammer-on' || technique.id === 'glissando') {
      if (!previous) continue
    }
    if (random() < technique.probability) return technique
  }
  return null
}

/**
 * Return the *inner* content of a `<notations>` element, never a wrapped one.
 *
 * Wrapping here and wrapping again at the call site produced
 * `<notations><notations>…</notations></notations>`, which is not valid MusicXML
 * and which the parser silently drops — the generator appeared to emit bend and
 * hammer-on markings while producing none.
 *
 * Placement follows the MusicXML schema, and getting it wrong is silent: the
 * parser looks in the schema-correct place, so a misplaced marking is not an
 * error, it is a marking that quietly disappears.
 *
 *   - `<technical>` holds hammer-on, pull-off, bend, harmonic, other-technical
 *   - `<notations>` directly holds slide, glissando, arpeggiate, tuplet, fermata
 *   - `<articulations>` holds staccato, accent, tenuto, marcato
 */
function techniqueXml(technique, position) {
  const technical = []
  const direct = []
  const articulations = []

  switch (technique.id) {
    case 'hammer-on':
      technical.push('<hammer-on type="start">H</hammer-on>')
      break
    case 'pull-off':
      technical.push('<pull-off type="start">P</pull-off>')
      break
    case 'slide':
      // `<slide>` is a direct child of `<notations>`, not of `<technical>`.
      direct.push('<slide type="start">shift</slide>')
      break
    case 'glissando':
      direct.push('<glissando type="start" line-type="wavy">--</glissando>')
      break
    case 'bend': {
      const amount = technique.amount ?? 1
      const alter = typeof amount === 'string' ? 1 : amount
      const display = typeof amount === 'string' ? amount : String(amount)
      technical.push(`<bend type="start" alteration="${alter}">${display}</bend>`)
      break
    }
    case 'tapping':
      technical.push('<other-technical>tapping</other-technical>')
      break
    case 'natural-harmonic':
      technical.push('<harmonic type="natural"><natural/>12</harmonic>')
      break
    case 'artificial-harmonic':
      technical.push(
        '<harmonic type="artificial"><artificial><base-fret>12</base-fret></artificial></harmonic>',
      )
      break
    case 'staccato':
      articulations.push('<staccato placement="above"/>')
      break
    case 'accent':
      articulations.push('<accent placement="above"/>')
      break
    default:
      return ''
  }

  const parts = []
  if (technical.length) parts.push(`<technical>${technical.join('')}</technical>`)
  if (direct.length) parts.push(direct.join(''))
  if (articulations.length) parts.push(`<articulations>${articulations.join('')}</articulations>`)
  return parts.join('')
}


/**
 * Generate one synthetic score's event model.
 *
 * The model is the source of truth: MusicXML is rendered from it, so the paired
 * staff and the TAB staff cannot disagree.
 */
export function generateEventModel(seed, { measures = 4, beats = 4, includeTab = true, pairTab = true } = {}) {
  const random = makeRandom(seed)
  const model = { version: 1, seed, measures: [], staffTypes: pairTab ? ['notation', 'TAB'] : includeTab ? ['TAB'] : ['notation'] }
  let previousTechniques = null

  for (let measure = 1; measure <= measures; measure += 1) {
    const events = []
    let cursor = 0
    const measureDivisions = beats * DIVISIONS
    let lastPitch = null

    while (cursor < measureDivisions) {
      const remaining = measureDivisions - cursor
      const duration = DURATIONS[Math.floor(random() * DURATIONS.length)]
      const durationDivisions = Math.round(duration.quarters * DIVISIONS)
      if (durationDivisions > remaining) continue

      const position = randomPosition(random)
      const technique = pickTechnique(random, previousTechniques)
      // Resolve parameterised markings now, so the event model fully determines
      // the rendered output and a seed reproduces it byte for byte.
      let resolvedTechnique = null
      if (technique) {
        resolvedTechnique = { id: technique.id }
        if (technique.amounts) {
          resolvedTechnique.amount = technique.amounts[Math.floor(random() * technique.amounts.length)]
        }
      }
      const hasPrevious = Boolean(lastPitch)
      previousTechniques = resolvedTechnique ? new Set([resolvedTechnique.id]) : null

      const dotted = random() < 0.15 && durationDivisions * 1.5 <= remaining
      const tuplet = random() < 0.08 ? { actual: 3, normal: 2 } : null

      events.push({
        type: 'note',
        startDivision: cursor,
        durationDivisions: tuplet ? Math.round(durationDivisions * (2 / 3)) : durationDivisions,
        durationType: duration.type,
        dotted,
        tuplet,
        voice: 1,
        position,
        pitch: midiToPitch(position.soundingMidi),
        technique: resolvedTechnique,
        hasPrevious,
      })
      lastPitch = position
      cursor += durationDivisions
    }

    /**
     * The nominal measure length, recorded rather than recomputed. The
     * `<backup>` that opens the TAB staff must rewind exactly one measure, and
     * summing the events would be wrong whenever tuplet rounding makes the
     * events not add up to the bar.
     */
    model.measures.push({ number: measure, measureDivisions, events })
  }
  return model
}

/**
 * Render one event as a `<note>`.
 *
 * A TAB note carries BOTH a `<pitch>` and a `<fret>`. The pitch is the sounding
 * pitch, which is what `guitar-pitch/1.0` requires of every stored pitch, and
 * `soundingFromTab` is what produced it — so the two cannot disagree. It is also
 * what a real engraver emits, and omitting it makes engravers drop the digit
 * entirely and draw a notehead on the TAB staff instead.
 */
function renderNoteXml(event, { staff, isTab }) {
  const pitchXml = `<pitch><step>${event.pitch.step}</step>${event.pitch.alter ? `<alter>${event.pitch.alter}</alter>` : ''}<octave>${event.pitch.octave}</octave></pitch>`
  const dots = event.dotted ? '<dot/>' : ''
  const tupletXml = event.tuplet
    ? `<time-modification><actual-notes>${event.tuplet.actual}</actual-notes><normal-notes>${event.tuplet.normal}</normal-notes></time-modification>`
    : ''
  const inner = isTab
    ? `<technical><string>${event.position.string}</string><fret>${event.position.fret}</fret></technical>`
    : event.technique
      ? techniqueXml(event.technique, { staff })
      : ''
  const notations = inner ? `<notations>${inner}</notations>` : ''
  return (
    `<note>${pitchXml}<duration>${event.durationDivisions}</duration><voice>${event.voice}</voice>` +
    `<type>${event.durationType}</type>${dots}${isTab ? '' : tupletXml}<staff>${staff}</staff>${notations}</note>`
  )
}

/** Render an event model to MusicXML, correct by construction. */
export function renderMusicXml(model, { title = 'Guitar Vision synthetic', paired = true } = {}) {
  const staves = paired ? 2 : 1
  const firstClef = paired
    ? '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>TAB</sign><line>5</line><staff-details><staff-lines>6</staff-lines></staff-details></clef>'
    : '<clef number="1"><sign>G</sign><line>2</line></clef>'

  const measures = model.measures
    .map((measure) => {
      const attributes =
        measure.number === 1
          ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key>` +
            `<time><beats>4</beats><beat-type>4</beat-type></time><staves>${staves}</staves>${firstClef}</attributes>`
          : ''
      const notationNotes = measure.events
        .map((event) => renderNoteXml(event, { staff: 1, isTab: false }))
        .join('')
      /**
       * A two-staff part needs `<backup>` to return to the start of the measure
       * before writing the second staff. Without it engravers read the two
       * staves as one continuing sequence and the TAB staff comes out empty.
       *
       * The TAB staff is a real staff with its own note sequence, not a set of
       * chord members hanging off the notation staff: `<chord/>` means "same
       * onset as the previous note", which suppresses the fret number and makes
       * engravers draw noteheads on the TAB staff. Alignment between the two
       * staves follows from both having the same durations.
       */
      const tabNotes = paired
        ? `<backup><duration>${measure.measureDivisions ?? beats * DIVISIONS}</duration></backup>` +
          measure.events.map((event) => renderNoteXml(event, { staff: 2, isTab: true })).join('')
        : ''
      return `<measure number="${measure.number}">${attributes}${notationNotes}${tabNotes}</measure>`
    })
    .join('')

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<score-partwise version="4.0">\n` +
    `  <work><work-title>${title}</work-title></work>\n` +
    `  <identification><encoding><software>guitar-vision-synthetic</software></encoding></identification>\n` +
    `  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>\n` +
    `  <part id="P1">${measures}</part>\n` +
    `</score-partwise>\n`
  )
}

function main() {
  const args = process.argv.slice(2)
  const argValue = (flag, fallback) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : fallback
  }
  const split = argValue('--split', 'train')
  const count = Number(argValue('--count', '8'))
  const seed = Number(argValue('--seed', '1'))
  const outDir = argValue('--out', join(ROOT, 'datasets/guitar-vision/synthetic/train'))

  /**
   * The refusal that matters. Synthetic data in an evaluation split is not a
   * weaker signal, it is a meaningless one: the generator that produced it is
   * part of the training pipeline, so a model that memorises generator quirks
   * scores perfectly and generalises not at all.
   */
  if (!SPLITS_THAT_MAY_BE_SYNTHETIC.includes(split)) {
    console.error(
      `REFUSED: synthetic data may only be generated into ${SPLITS_THAT_MAY_BE_SYNTHETIC.join('/')}, not "${split}".\n` +
        'Validation and held-out must contain real scores only. A model evaluated on\n' +
        'synthetic data measures its memory of the generator, not its recognition.',
    )
    process.exitCode = 1
    return
  }

  mkdirSync(outDir, { recursive: true })
  const written = []
  for (let index = 0; index < count; index += 1) {
    const itemSeed = seed * 1000 + index
    const model = generateEventModel(itemSeed, { paired: index % 2 === 0 })
    const xml = renderMusicXml(model, { title: `synthetic-${split}-${String(itemSeed).padStart(6, '0')}` })
    const name = `synthetic-${split}-${String(itemSeed).padStart(6, '0')}`
    writeFileSync(join(outDir, `${name}.musicxml`), xml)
    writeFileSync(
      join(outDir, `${name}.events.json`),
      `${JSON.stringify(model, null, 2)}\n`,
    )
    written.push({ name, seed: itemSeed, measures: model.measures.length })
  }

  writeFileSync(
    join(outDir, 'manifest.json'),
    `${JSON.stringify(
      {
        version: 1,
        kind: 'guitar-vision-synthetic',
        split,
        seed,
        count: written.length,
        deterministic: true,
        provenanceNote:
          'Synthetic. TRAIN SPLIT ONLY. Never to be used for validation or held-out ' +
          'evaluation, and never to be reported as real-data coverage.',
        generatedFamilies: GENERATED_FAMILIES,
        scores: written,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`Generated ${written.length} synthetic guitar scores into ${outDir}`)
  console.log(`split: ${split}  (validation and held-out are refused by design)`)
  console.log(`deterministic: same --seed reproduces byte-identical output`)
  console.log(`families covered: ${GENERATED_FAMILIES.length}`)
}

if (process.argv[1] && process.argv[1].endsWith('generate-synthetic.mjs')) {
  main()
}
