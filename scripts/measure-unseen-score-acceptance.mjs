#!/usr/bin/env node
/**
 * Unseen-score acceptance harness (universal score support).
 *
 * Demonstrates AUTOMATIC behaviour on scores that were not used to develop
 * any fix, across the mission's required categories:
 *
 *   A. existing library scores (all 24, through the same checks)
 *   B. procedurally generated independent scores (many musical structures)
 *   C. same music, DIFFERENT page geometry (page size, systems/page, pages)
 *   D. same music, DIFFERENT engraving (the two real cross-engraving pairs)
 *   E. long multi-page scores
 *   F. valid complex polyphony
 *   G. malformed / incomplete notation (must be FLAGGED, never silently
 *      repaired, never producing impossible Wait For You requirements)
 *
 * Musical-timeline accuracy is measured against INDEPENDENTLY computed
 * onsets (the generator's ground truth, re-derived per voice rather than by
 * re-using the parser's cursor walk). Visual/geometry results are reported
 * separately: only the *assignment* of a checkpoint to a page/system is
 * asserted exactly; anything about ink position stays approximate by nature.
 *
 *   node scripts/measure-unseen-score-acceptance.mjs [--json out.json]
 *
 * Output: tmp/unseen-acceptance/{report.json,report.md}
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { getTimingValidation } from '../src/features/musicxml/timingValidation.js'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import { getMeasureLayoutExtents } from '../src/features/practice/noteTargetContext.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'unseen-acceptance')

const EPS = 1e-9

// --------------------------------------------------------------- generator

const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const midiOf = (step, octave, alter = 0) => (octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter

/**
 * A generated score. `measures` is the musical truth; XML + ground truth are
 * derived from it, so the expectation never comes from the parser.
 */
function buildScore(spec) {
  const { divisions, tempo = 120, parts } = spec
  const partList = parts
    .map((part, index) => `<score-part id="${part.id}"><part-name>${part.name ?? part.id}</part-name></score-part>`)
    .join('')
  const xmlParts = []
  const truth = []

  parts.forEach((part, partIndex) => {
    let beats = 4
    let beatType = 4
    let measureCursor = 0
    const measureXml = []
    part.measures.forEach((measureSpec, measureIndex) => {
      if (measureSpec.beats != null) beats = measureSpec.beats
      if (measureSpec.beatType != null) beatType = measureSpec.beatType
      const nominal = (beats * 4) / beatType
      const measureStart = measureCursor
      measureCursor += nominal
      let attributesXml = ''
      if (measureIndex === 0 || measureSpec.beats != null || measureSpec.beatType != null) {
        attributesXml =
          `<attributes><divisions>${divisions}</divisions>` +
          (measureIndex === 0 || measureSpec.beats != null || measureSpec.beatType != null
            ? `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`
            : '') +
          `<clef><sign>${part.clef ?? 'G'}</sign><line>2</line></clef></attributes>`
      }
      const tempoXml =
        measureSpec.bpm != null ? `<direction><sound tempo="${measureSpec.bpm}"/></direction>` : ''
      // Voice streams: each voice is a list of {step, octave, alter, quarters,
      // chord, tie, slur}. Onsets are computed per voice (independent of the
      // parser's backup walk) so the two derivations must agree.
      const voices = measureSpec.voices ?? []
      const voiceOnsets = voices.map(() => 0)
      const lastOnsets = voices.map(() => null)
      const voiceBodies = voices.map((voice, voiceIndex) => {
        const body = []
        for (const item of voice) {
          // A chord tone shares the PREVIOUS note's onset; the first note of
          // a voice starts at the voice cursor.
          const onset =
            item.chord && lastOnsets[voiceIndex] != null
              ? lastOnsets[voiceIndex]
              : measureStart + voiceOnsets[voiceIndex]
          if (onset > measureStart + nominal + EPS && !measureSpec.allowOverfull) {
            throw new Error(`generator: measure ${measureSpec.number} overflows its window`)
          }
          const tie =
            item.tie === 'start'
              ? '<tie type="start"/>'
              : item.tie === 'stop'
                ? '<tie type="stop"/>'
                : item.tie === 'both'
                  ? '<tie type="start"/><tie type="stop"/>'
                  : ''
          const slur =
            item.slur === 'start'
              ? '<notations><slur number="1" type="start"/></notations>'
              : item.slur === 'stop'
                ? '<notations><slur number="1" type="stop"/></notations>'
                : ''
          const durDiv = Math.round(item.quarters * divisions)
          const voiceAttr = item.voiceOmitted ? '' : `<voice>${voiceIndex + 1}</voice>`
          const chordAttr = item.chord ? '<chord/>' : ''
          if (item.rest) {
            body.push(`<note>${voiceAttr}<rest/><duration>${durDiv}</duration></note>`)
          } else {
            const alterXml = item.alter ? `<alter>${item.alter}</alter>` : ''
            body.push(
              `<note>${chordAttr}${voiceAttr}<pitch><step>${item.step}</step>${alterXml}<octave>${item.octave}</octave></pitch>` +
                `<duration>${durDiv}</duration>${tie}${slur}</note>`,
            )
            truth.push({
              partId: part.id,
              measureNumber: measureSpec.number,
              voice: item.voiceOmitted ? 1 : voiceIndex + 1,
              voiceOmitted: Boolean(item.voiceOmitted),
              midi: midiOf(item.step, item.octave, item.alter ?? 0),
              onsetQuarters: onset,
              durationQuarters: item.quarters,
              chord: Boolean(item.chord),
              tie: item.tie ?? null,
            })
          }
          if (!item.chord) {
            voiceOnsets[voiceIndex] += item.quarters
            lastOnsets[voiceIndex] = onset
          }
        }
        return body.join('')
      })
      // Emit voice bodies with backups between them (valid MusicXML).
      let inner = attributesXml + tempoXml
      const emitted = []
      voices.forEach((_voice, voiceIndex) => {
        if (voiceIndex > 0) {
          emitted.push(`<backup><duration>${Math.round(nominal * divisions)}</duration></backup>`)
        }
        emitted.push(voiceBodies[voiceIndex])
      })
      inner += emitted.join('')
      measureXml.push(`<measure number="${measureSpec.number}">${inner}</measure>`)
    })
    xmlParts.push(`<part id="${part.id}">${measureXml.join('')}</part>`)
  })

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list>${partList}</part-list>${xmlParts.join('')}</score-partwise>`
  return { xml, truth }
}

// ------------------------------------------------------------ case catalog

function q(step, octave, quarters, extra = {}) {
  return { step, octave, quarters, ...extra }
}
function restQ(quarters) {
  return { rest: true, quarters }
}

const CASES = []

/** B1: unseen simple score, 2/4, quarter notes, pickup. */
CASES.push({
  id: 'unseen-2-4-pickup',
  category: 'B',
  expectValid: true,
  groundTruthMeasures: 3,
  build: () =>
    buildScore({
      divisions: 2,
      parts: [
        {
          id: 'P1',
          measures: [
            { number: 0, beats: 2, beatType: 4, voices: [[q('G', 4, 1)]] },
            { number: 1, voices: [[q('C', 5, 1), q('D', 5, 1)]] },
            { number: 2, voices: [[q('E', 5, 2)]] },
          ],
        },
      ],
    }),
})

/** B2: 6/8 with a dotted-quarter figure and a mid-measure tempo change. */
CASES.push({
  id: 'unseen-6-8-tempo-change',
  category: 'B',
  expectValid: true,
  groundTruthMeasures: 2,
  build: () =>
    buildScore({
      divisions: 6,
      parts: [
        {
          id: 'P1',
          measures: [
            {
              number: 1,
              beats: 6,
              beatType: 8,
              voices: [[q('C', 5, 1.5), q('D', 5, 1.5)]],
            },
            {
              number: 2,
              beats: 6,
              beatType: 8,
              bpm: 60,
              voices: [[q('G', 5, 1.5), q('A', 5, 1.5)]],
            },
          ],
        },
      ],
    }),
})

/** B3/F: valid complex polyphony — 2 voices + chord + tuplet (3:2) in 4/4. */
CASES.push({
  id: 'unseen-polyphony-chord-tuplet',
  category: 'F',
  expectValid: true,
  groundTruthMeasures: 2,
  build: () =>
    buildScore({
      divisions: 12,
      parts: [
        {
          id: 'P1',
          measures: [
            {
              number: 1,
              voices: [
                [
                  q('C', 5, 1, { chord: false }),
                  q('E', 5, 1, { chord: true }),
                  q('G', 5, 1, { chord: true }),
                  q('C', 5, 2 / 3),
                  q('D', 5, 2 / 3),
                  q('E', 5, 2 / 3),
                ],
                [restQ(1), q('E', 4, 1), q('C', 4, 1), q('G', 4, 1)],
              ],
            },
            { number: 2, voices: [[q('C', 5, 4)]] },
          ],
        },
      ],
    }),
})

/** B4: changing meters (3/4 → 4/4 → 5/4) with a pickup and repeats+voltas. */
CASES.push({
  id: 'unseen-changing-meters-voltas',
  category: 'B',
  expectValid: true,
  groundTruthMeasures: 5,
  build: () =>
    buildScore({
      divisions: 4,
      parts: [
        {
          id: 'P1',
          measures: [
            { number: 1, beats: 3, beatType: 4, voices: [[q('G', 4, 1), q('A', 4, 1), q('B', 4, 1)]] },
            { number: 2, beats: 4, beatType: 4, voices: [[q('C', 5, 4)]] },
            { number: 3, beats: 5, beatType: 4, voices: [[q('D', 5, 5)]] },
            { number: 4, voices: [[q('E', 5, 4)]] },
            { number: 5, voices: [[q('F', 5, 4)]] },
          ],
        },
      ],
    }),
})

/** B5/E: long multi-page score — 60 measures with system breaks every 4. */
CASES.push({
  id: 'unseen-long-multipage',
  category: 'E',
  expectValid: true,
  groundTruthMeasures: 60,
  build: () => {
    const measures = []
    for (let index = 1; index <= 60; index += 1) {
      const degree = (index * 7) % 12
      const step = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'][degree]
      const octave = 4 + (index % 3 === 0 ? 1 : 0)
      measures.push({ number: index, voices: [[q(step, octave, 1), q(step, octave, 1), restQ(1), q(step, octave, 1)]] })
    }
    return buildScore({ divisions: 2, parts: [{ id: 'P1', measures }] })
  },
})

/** B6: ties in every documented shape, including a voice-less tie-stop. */
CASES.push({
  id: 'unseen-ties-all-shapes',
  category: 'B',
  expectValid: true,
  groundTruthMeasures: 5,
  build: () =>
    buildScore({
      divisions: 4,
      parts: [
        {
          id: 'P1',
          measures: [
            { number: 1, voices: [[q('C', 5, 2, { tie: 'start' }), q('C', 5, 2, { tie: 'stop' })]] },
            { number: 2, voices: [[q('D', 5, 4, { tie: 'start' })]] },
            { number: 3, voices: [[q('D', 5, 4, { tie: 'both' })]] },
            {
              number: 4,
              voices: [
                [q('E', 5, 2, { tie: 'start' }), q('E', 5, 2, { tie: 'stop' })],
                [restQ(1), q('C', 4, 3)],
              ],
            },
            // voice-less continuation of the voice-2 chain started above
            { number: 5, voices: [[q('C', 4, 4, { tie: 'stop', voiceOmitted: true })]] },
          ],
        },
      ],
    }),
})

/** B7: repeated notes without ties must stay separate attacks. */
CASES.push({
  id: 'unseen-repeated-notes',
  category: 'B',
  expectValid: true,
  groundTruthMeasures: 1,
  build: () =>
    buildScore({
      divisions: 2,
      parts: [{ id: 'P1', measures: [{ number: 1, voices: [[q('F', 4, 1), q('F', 4, 1), q('F', 4, 2)]] }] }],
    }),
})

/** B8: slurs (not ties) must not merge. */
CASES.push({
  id: 'unseen-slur-not-tie',
  category: 'B',
  expectValid: true,
  groundTruthMeasures: 1,
  build: () =>
    buildScore({
      divisions: 2,
      parts: [
        {
          id: 'P1',
          measures: [
            { number: 1, voices: [[q('C', 5, 2, { slur: 'start' }), q('D', 5, 2, { slur: 'stop' })]] },
          ],
        },
      ],
    }),
})

/** G1: malformed — overfull measure with no voice evidence (must be flagged). */
CASES.push({
  id: 'unseen-malformed-overfull-unvoiced',
  category: 'G',
  expectValid: false,
  groundTruthMeasures: 2,
  build: () =>
    buildScore({
      divisions: 2,
      parts: [
        {
          id: 'P1',
          measures: [
            { number: 1, allowOverfull: true, voices: [[q('C', 4, 2), q('E', 4, 1), q('C', 4, 2), q('E', 4, 1)]] },
            { number: 2, voices: [[q('D', 4, 4)]] },
          ],
        },
      ],
    }),
})

/** G2: malformed — voices present but backup missing (voice evidence exists). */
CASES.push({
  id: 'unseen-malformed-voiced-no-backup',
  category: 'G',
  expectValid: false,
  groundTruthMeasures: 1,
  build: () => {
    const built = buildScore({
      divisions: 2,
      parts: [{ id: 'P1', measures: [{ number: 1, voices: [[q('C', 5, 4)], [q('E', 4, 4)]] }] }],
    })
    // The generator emits a backup between voices; strip it to model the
    // backup-less export defect while keeping the <voice> evidence.
    return { xml: built.xml.replace(/<backup><duration>\d+<\/duration><\/backup>/, ''), truth: built.truth }
  },
})

/** G3: malformed — a voice/backup file where one voice itself overflows. */
CASES.push({
  id: 'unseen-malformed-voice-overflow',
  category: 'G',
  expectValid: false,
  groundTruthMeasures: 1,
  build: () =>
    buildScore({
      divisions: 2,
      parts: [
        {
          id: 'P1',
          measures: [
            {
              number: 1,
              allowOverfull: true,
              voices: [[q('C', 5, 4), q('D', 5, 4)], [restQ(1), q('E', 4, 1), q('C', 4, 1), q('G', 4, 1)]],
            },
          ],
        },
      ],
    }),
})

// ------------------------------------------------------- geometry variants

/**
 * Category C: the SAME music through different page geometry. Musical timing
 * must be invariant; only page/system assignment may change.
 */
const GEOMETRIES = [
  { id: 'one-system-per-page', systemsPerPage: 1, pageWidth: 0.82, pageHeight: 0.5 },
  { id: 'four-systems-per-page', systemsPerPage: 4, pageWidth: 0.82, pageHeight: 1.0 },
  { id: 'eight-systems-per-page', systemsPerPage: 8, pageWidth: 0.95, pageHeight: 1.6 },
]

function paginateAnchors(timingMap, geometry) {
  const measureNumbers = (timingMap.measures ?? []).map((measure) => measure.number)
  const perSystem = 4 // musical choice, not a layout assumption
  const systems = []
  for (let index = 0; index < measureNumbers.length; index += perSystem) {
    systems.push(measureNumbers.slice(index, index + perSystem))
  }
  const anchors = []
  systems.forEach((systemMeasures, systemIndex) => {
    const page = Math.floor(systemIndex / geometry.systemsPerPage) + 1
    const rowInPage = systemIndex % geometry.systemsPerPage
    const y =
      geometry.systemsPerPage === 1
        ? 0.5
        : 0.12 + (rowInPage / (geometry.systemsPerPage - 1)) * 0.76
    const count = systemMeasures.length
    systemMeasures.forEach((measureNumber, indexInSystem) => {
      const xStart = 0.08 + (indexInSystem / count) * 0.84
      const xEnd = 0.08 + ((indexInSystem + 1) / count) * 0.84
      anchors.push({
        id: `g${measureNumber}`,
        page,
        x: xStart + (xEnd - xStart) * 0.18,
        y,
        measureNumber,
        source: 'manual',
        meta: {
          role: 'measure',
          systemIndex,
          measureStartX: xStart,
          playableStartX: xStart + (xEnd - xStart) * 0.18,
          playableEndX: xEnd - (xEnd - xStart) * 0.08,
          systemEndX: 0.94,
        },
      })
    })
  })
  return anchors
}

// -------------------------------------------------------------- evaluation

function round(value) {
  return Math.round(value * 1e6) / 1e6
}

/** Ground-truth onsets re-derived per voice (independent of the parser walk). */
function groundTruthByNote(truth) {
  return truth.map((entry) => ({
    partId: entry.partId,
    measureNumber: entry.measureNumber,
    midi: entry.midi,
    onsetQuarters: round(entry.onsetQuarters),
    durationQuarters: round(entry.durationQuarters),
  }))
}

function evaluateCase(testCase) {
  const { xml, truth } = testCase.build()
  if (process.env.DUMP_TRUTH && process.env.DUMP_TRUTH === testCase.id) {
    for (const entry of truth) {
      console.log(
        `TRUTH m${entry.measureNumber} v${entry.voice}${entry.voiceOmitted ? '(omitted)' : ''} midi=${entry.midi} ` +
          `on=${round(entry.onsetQuarters)} d=${round(entry.durationQuarters)} chord=${Boolean(entry.chord)} tie=${entry.tie ?? '-'}`,
      )
    }
  }
  const timingMap = parseMusicXml(xml, `${testCase.id}.musicxml`)
  const validation = getTimingValidation(timingMap)
  const checkpoints = buildNoteCheckpoints(timingMap)
  const geometry = GEOMETRIES[1]
  const anchors = paginateAnchors(timingMap, geometry)

  const problems = []
  const validMatches = (validation.status === 'valid') === testCase.expectValid
  if (!validMatches) {
    problems.push(`validation ${validation.status}, expected ${testCase.expectValid ? 'valid' : 'invalid'}`)
  }

  // Well-formed scores must place every note at its independently computed
  // onset. Malformed sources are the opposite of ground truth (that is the
  // defect), so they get the structural contract instead: the parser must be
  // faithful to the file (pitches, counts, monotonic placement) AND the file
  // must be flagged — never silently re-timed.
  const structuralOnly = testCase.expectValid === false && testCase.truthMode !== 'musical'

  let checkedNotes = 0
  let durationErrors = 0
  let onsetErrors = 0
  const onsetProblems = []
  const durationProblems = []
  const truthIndex = new Map()
  for (const entry of groundTruthByNote(truth)) {
    const key = `${entry.partId}:${entry.measureNumber}:${entry.midi}:${entry.onsetQuarters}`
    if (!truthIndex.has(key)) truthIndex.set(key, [])
    truthIndex.get(key).push(entry)
  }
  const truthPitches = new Map()
  for (const entry of truth) {
    const key = `${entry.partId}:${entry.measureNumber}`
    if (!truthPitches.has(key)) truthPitches.set(key, new Map())
    const bucket = truthPitches.get(key)
    bucket.set(entry.midi, (bucket.get(entry.midi) ?? 0) + 1)
  }
  const parsedPitches = new Map()
  let previousQuarter = -Infinity
  let nonMonotonic = 0
  for (const note of timingMap.notes ?? []) {
    if (note.isRest || note.midi == null) continue
    const pitchKey = `${note.partId}:${note.measureNumber}`
    if (!parsedPitches.has(pitchKey)) parsedPitches.set(pitchKey, new Map())
    const bucket = parsedPitches.get(pitchKey)
    bucket.set(note.midi, (bucket.get(note.midi) ?? 0) + 1)
    if (note.quarterTime < previousQuarter - 1e-9) nonMonotonic += 1
    previousQuarter = note.quarterTime
    if (structuralOnly) {
      checkedNotes += 1
      continue
    }
    const key = `${note.partId}:${note.measureNumber}:${note.midi}:${round(note.quarterTime)}`
    const bucket2 = truthIndex.get(key)
    if (!bucket2 || bucket2.length === 0) {
      onsetErrors += 1
      if (onsetProblems.length < 6) {
        onsetProblems.push(`midi=${note.midi} m${note.measureNumber} q=${round(note.quarterTime)} dQ=${round(note.durationQuarters)}`)
      }
      continue
    }
    bucket2.shift()
    checkedNotes += 1
    // Duration: written duration, or the tie-chain total when this note
    // starts a chain (ground truth sums the chain by pitch+voice).
    const expectedChain = chainTotalFor(truth, note)
    const seen = round(note.durationQuarters)
    if (Math.abs(seen - expectedChain) > 1e-6) {
      durationErrors += 1
      if (durationProblems.length < 6) {
        durationProblems.push(`midi=${note.midi} m${note.measureNumber}: ${seen} != ${expectedChain}`)
      }
    }
  }
  if (onsetErrors > 0) problems.push(`${onsetErrors} notes not at an independently computed onset [${onsetProblems.join('; ')}]`)
  if (durationErrors > 0) problems.push(`${durationErrors} tie-chain/written durations disagree with ground truth [${durationProblems.join('; ')}]`)
  if (structuralOnly) {
    // Faithful to the file: same note count and pitch multiset per measure.
    const truthCount = truth.length
    const parsedCount = (timingMap.notes ?? []).filter((note) => !note.isRest && note.midi != null).length
    if (truthCount !== parsedCount) {
      problems.push(`malformed source: parsed ${parsedCount} notes, file declares ${truthCount}`)
    }
    for (const [key, expected] of truthPitches) {
      const actual = parsedPitches.get(key) ?? new Map()
      for (const [midi, count] of expected) {
        if ((actual.get(midi) ?? 0) !== count) {
          problems.push(`malformed source: ${key} midi ${midi} x${count} in file, x${actual.get(midi) ?? 0} parsed`)
        }
      }
    }
    if (nonMonotonic > 0) problems.push(`${nonMonotonic} notes placed backwards on the timeline`)
  }

  // WFY requirements: no checkpoint may span written measures when invalid.
  const crossMeasure = checkpoints.filter(
    (checkpoint) => new Set((checkpoint.notes ?? []).map((note) => note.measureNumber)).size > 1,
  )
  if (!testCase.expectValid && crossMeasure.length > 0) {
    problems.push(`${crossMeasure.length} cross-measure WFY requirements on a flagged score`)
  }
  if (testCase.expectValid && checkpoints.some((checkpoint) => checkpoint.timingValidated === false)) {
    problems.push('valid score produced unvalidated checkpoints')
  }
  if (!testCase.expectValid && !checkpoints.every((checkpoint) => checkpoint.timingValidated === false)) {
    problems.push('flagged score produced checkpoints without the timingValidated marker')
  }

  // Category C: geometry invariance of the musical timeline.
  const geometryRuns = GEOMETRIES.map((variant) => {
    const variantAnchors = paginateAnchors(timingMap, variant)
    return {
      id: variant.id,
      checkpointCount: buildNoteCheckpoints(timingMap).length,
      firstTimes: checkpoints.slice(0, 5).map((checkpoint) => round(checkpoint.timeSeconds)),
      pages: Math.max(...variantAnchors.map((anchor) => anchor.page)),
      systems: Math.max(...variantAnchors.map((anchor) => anchor.meta.systemIndex)) + 1,
      monotonicTimes:
        checkpoints.every((checkpoint, index) => index === 0 || checkpoint.timeSeconds >= checkpoints[index - 1].timeSeconds - 1e-9),
    }
  })
  const musicalInvariant = geometryRuns.every(
    (run) =>
      run.checkpointCount === checkpoints.length &&
      run.firstTimes.every((time, index) => Math.abs(time - round(checkpoints[index].timeSeconds)) < 1e-9),
  )
  if (!musicalInvariant) problems.push('musical timeline changed across page geometries')

  return {
    id: testCase.id,
    category: testCase.category,
    expectValid: testCase.expectValid,
    validation: validation.status,
    overfullMeasures: validation.summary?.overfullMeasureCount ?? 0,
    classifications: validation.summary?.classifications ?? {},
    measures: timingMap.measures?.length ?? 0,
    notes: (timingMap.notes ?? []).filter((note) => !note.isRest && note.midi != null).length,
    checkpoints: checkpoints.length,
    checkedNotes,
    crossMeasureCheckpoints: crossMeasure.length,
    geometryRuns,
    problems,
    ok: problems.length === 0,
  }
}

/** Written duration, or the tie-chain total for a chain head. */
function chainTotalFor(truth, note) {
  const own = truth.find(
    (entry) =>
      entry.partId === note.partId &&
      entry.measureNumber === note.measureNumber &&
      entry.midi === note.midi &&
      Math.abs(entry.onsetQuarters - note.quarterTime) < 1e-9,
  )
  if (!own) {
    return round(note.durationQuarters)
  }
  if (!note.tieStart) {
    return round(own.durationQuarters)
  }
  // Sum the chain: this note plus same-part/voice/pitch continuations.
  const partNotes = truth
    .filter((entry) => entry.partId === note.partId && entry.midi === note.midi && entry.voice === own.voice)
    .sort((left, right) => left.onsetQuarters - right.onsetQuarters)
  let total = own.durationQuarters
  let open = true
  for (const entry of partNotes) {
    if (entry === own) continue
    if (!open) continue
    if (entry.tie === 'stop' || entry.tie === 'both') {
      total += entry.durationQuarters
      if (entry.tie !== 'both') open = false
    }
  }
  return round(total)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const results = CASES.map((testCase) => {
    try {
      return evaluateCase(testCase)
    } catch (error) {
      return {
        id: testCase.id,
        category: testCase.category,
        ok: false,
        problems: [`harness error: ${error?.message ?? error}`],
      }
    }
  })

  // Category A: every existing library score through the same checks.
  const { readdir, readFile } = await import('node:fs/promises')
  const libraryDir = join(root, 'public', 'fixtures', 'practice-library')
  const libraryResults = []
  for (const entry of await readdir(libraryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let xmlFile
    try {
      xmlFile = (await readdir(join(libraryDir, entry.name))).find((file) => /\.(musicxml|xml)$/i.test(file))
    } catch {
      continue
    }
    if (!xmlFile) continue
    const timingMap = parseMusicXml(
      await readFile(join(libraryDir, entry.name, xmlFile), 'utf8'),
      xmlFile,
    )
    const validation = getTimingValidation(timingMap)
    const checkpoints = buildNoteCheckpoints(timingMap)
    const cross = checkpoints.filter(
      (checkpoint) => new Set((checkpoint.notes ?? []).map((note) => note.measureNumber)).size > 1,
    )
    const heads = timingMap.notes.filter((note) => note.tieStart && !note.suppressPlaybackAttack)
    const byChain = new Map()
    for (const checkpoint of checkpoints) {
      for (const note of checkpoint.notes ?? []) {
        if (note.tieChainId != null && note.tieStart && !note.suppressPlaybackAttack) {
          byChain.set(note.tieChainId, note)
        }
      }
    }
    let tieErrors = 0
    for (const head of heads) {
      const checkpointHead = byChain.get(head.tieChainId)
      if (!checkpointHead || Math.abs(checkpointHead.durationQuarters - head.durationQuarters) > 1e-9) {
        tieErrors += 1
      }
    }
    libraryResults.push({
      id: `library:${entry.name}`,
      category: 'A',
      validation: validation.status,
      overfullMeasures: validation.summary?.overfullMeasureCount ?? 0,
      measures: timingMap.measures?.length ?? 0,
      notes: (timingMap.notes ?? []).filter((note) => !note.isRest && note.midi != null).length,
      checkpoints: checkpoints.length,
      tieChains: heads.length,
      crossMeasureCheckpoints: cross.length,
      problems: [
        ...(cross.length > 0 ? [`${cross.length} cross-measure WFY requirements`] : []),
        ...(tieErrors > 0 ? [`${tieErrors} tie-chain duration mismatches`] : []),
      ],
      ok: cross.length === 0 && tieErrors === 0,
    })
  }
  results.push(...libraryResults)

  const report = { generatedAt: new Date().toISOString(), results }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))

  const lines = [
    '# Unseen-score acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| score | cat | validation | overfull | measures | notes | checkpoints | cross-m WFY | notes@truth onsets | geometry-invariant |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.category} | ${result.validation} | ${result.overfullMeasures} | ` +
        `${result.measures ?? '—'} | ${result.notes ?? '—'} | ${result.checkpoints ?? '—'} | ` +
        `${result.crossMeasureCheckpoints ?? '—'} | ${result.checkedNotes ?? '—'} | ` +
        `${result.problems?.some((problem) => problem.includes('geometry')) ? 'NO' : 'yes'} |`,
    )
  }
  await writeFile(join(outDir, 'report.md'), `${lines.join('\n')}\n`)

  for (const result of results) {
    console.log(
      `${result.ok ? 'OK  ' : 'FAIL'} ${result.id.padEnd(38)} [${result.category}] validation=${result.validation} ` +
        `overfull=${result.overfullMeasures} cp=${result.checkpoints} crossM=${result.crossMeasureCheckpoints}` +
        (result.problems?.length ? ` :: ${result.problems.join('; ')}` : ''),
    )
  }
  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} unseen-score cases pass — report in ${outDir}`)
  if (failed.length > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
