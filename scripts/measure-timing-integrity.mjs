#!/usr/bin/env node
/**
 * Timing-integrity trace — H1/H2 overfull-measure investigation.
 *
 * Traces a SMALL FROZEN SET from source MusicXML through the shipped pipeline:
 *   parsed onsets → written measure windows → performed timeline → WFY note
 *   checkpoints → (grouping) requirements, and quantifies:
 *
 *   - overfull measures: notated content vs time-signature window (per part)
 *   - incorrect cross-measure grouping: WFY checkpoints whose notes are
 *     written in more than one written measure (impossible simultaneous
 *     requirements for a player reading the print)
 *   - cumulative drift: how far each written measure's notes sound past its
 *     own window, and how far the LAST note sounds past the written end
 *
 * WRITTEN measure identity is kept distinct from PERFORMED time everywhere:
 * note.measureNumber (written) vs the performed window a time falls in.
 *
 *   node scripts/measure-timing-integrity.mjs [--label before|after] [--json path]
 *
 * Output: tmp/timing-integrity/{report-<label>.json, report-<label>.md}
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'timing-integrity')

const EPSILON_QUARTERS = 1e-6

/**
 * The frozen set. Controls first (valid polyphony / voice-backup / tuplets /
 * pickup / ties / repeats), then the documented H1/H2 offenders.
 */
const FROZEN_SET = [
  {
    id: 'guitar-spanish-romance',
    role: 'control-valid-polyphony',
    why: 'real score: voices + backup + tuplets, zero overfull measures',
    path: 'public/fixtures/practice-library/guitar-spanish-romance/guitar-spanish-romance.musicxml',
  },
  {
    id: 'piano-mozart-turkish-march',
    role: 'control-valid-polyphony',
    why: 'real piano score: voices + backup + tuplets, zero overfull measures',
    path: 'public/fixtures/practice-library/piano-mozart-turkish-march/piano-mozart-turkish-march.musicxml',
  },
  {
    id: 'piano-brahms-lullaby',
    role: 'control-ties',
    why: 'single-voice ties, no backups — tie continuation must not be grouped wrongly',
    path: 'public/fixtures/practice-library/piano-brahms-lullaby/piano-brahms-lullaby.musicxml',
  },
  {
    id: 'piano-bach-prelude-bwv846',
    role: 'malformed-voice-flattened (H2)',
    why: 'music21-flattened Mutoria #5: 34/35 measures hold 7.5q in 4/4 windows',
    path: 'public/fixtures/practice-library/piano-bach-prelude-bwv846/piano-bach-prelude-bwv846.musicxml',
  },
  {
    id: 'guitar-aguado-a-minor-study',
    role: 'malformed-voice-flattened (H1)',
    why: 'bass+arpeggio flattened to one sequential stream: 16/16 measures overfull',
    path: 'public/fixtures/practice-library/guitar-aguado-a-minor-study/guitar-aguado-a-minor-study.musicxml',
  },
  {
    id: 'guitar-bach-prelude-bwv999',
    role: 'malformed-voice-flattened (scope check)',
    why: 'same flattening class; bundled MIDI present — evaluated for repair scope',
    path: 'public/fixtures/practice-library/guitar-bach-prelude-bwv999/guitar-bach-prelude-bwv999.musicxml',
  },
]

/** Synthetic control covering pickup, repeat, tie across barline, tuplet, voices/backup, chord. */
function syntheticControlXml() {
  const attributes =
    '<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef></attributes>'
  const n = (step, octave, dur, extra = '') =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration>${extra}</note>`
  const voicen = (voice, step, octave, dur, extra = '') =>
    `<note><voice>${voice}</voice><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration>${extra}</note>`
  const voicer = (voice, dur) => `<note><voice>${voice}</voice><rest/><duration>${dur}</duration></note>`
  const tuplet = (voice, step, octave) =>
    `<note><voice>${voice}</voice><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>1</duration><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>`
  const measure = (num, body) => `<measure number="${num}">${body}</measure>`
  const forwardRepeat = '<barline location="left"><repeat direction="forward"/></barline>'
  const backwardRepeat = '<barline location="right"><repeat direction="backward"/></barline>'

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Synthetic</part-name></score-part></part-list>
  <part id="P1">
    ${measure(0, attributes + n('G', 4, 2))}
    ${measure(
      1,
      forwardRepeat +
        voicen(1, 'C', 5, 2, '<tie type="start"/>') +
        voicen(1, 'C', 5, 2, '<tie type="stop"/>') +
        '<backup><duration>4</duration></backup>' +
        voicer(2, 1) +
        voicen(2, 'E', 4, 1) +
        voicen(2, 'C', 4, 1) +
        voicen(2, 'G', 4, 1),
    )}
    ${measure(
      2,
      tuplet(1, 'E', 5) +
        tuplet(1, 'D', 5) +
        tuplet(1, 'E', 5) +
        n('F', 5, 4) +
        '<backup><duration>6</duration></backup>' +
        voicer(2, 1) +
        voicen(2, 'A', 4, 1) +
        voicen(2, 'G', 4, 4),
    )}
    ${measure(3, voicen(1, 'D', 5, 2, '<tie type="start"/>') + voicen(1, 'E', 5, 2, '<tie type="stop"/>') + backwardRepeat)}
    ${measure(
      4,
      n('C', 5, 4) +
        '<note><chord/><voice>1</voice><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration></note>' +
        '<barline location="right"><bar-style>light-heavy</bar-style></barline>',
    )}
  </part>
</score-partwise>`
}

async function readScoreXml(scorePath) {
  const data = await readFile(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  let rootPath = container ? (await container.async('string')).match(/full-path="([^"]+)"/)?.[1] : null
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find((e) => e.toLowerCase().endsWith('.xml') && !e.startsWith('META-INF/'))
  }
  if (!rootPath) throw new Error(`MXL archive has no MusicXML root: ${scorePath}`)
  return zip.file(rootPath).async('string')
}

/** Independent measure-timing audit straight from the parsed measure table. */
function auditMeasureTiming(timingMap) {
  const overfull = []
  const boundaries = timingMap.measures ?? []
  const boundaryByIndex = new Map(boundaries.map((boundary) => [boundary.index, boundary]))
  const partEnds = timingMap.partMeasureNoteEnds instanceof Map ? timingMap.partMeasureNoteEnds : new Map()
  for (const [partId, entries] of partEnds) {
    for (const entry of entries) {
      const boundary = boundaryByIndex.get(entry.index)
      if (!boundary) continue
      const nominal = boundary.lengthQuarters
      if (entry.endQuarters > nominal + EPSILON_QUARTERS) {
        overfull.push({
          measureNumber: boundary.number,
          partId,
          noteEndQuarters: round(entry.endQuarters),
          nominalQuarters: nominal,
          excessQuarters: round(entry.endQuarters - nominal),
          noteCount: entry.noteCount,
          voiceTags: entry.voices ?? [],
          classification: classifyOverfull(entry),
        })
      }
    }
  }
  return overfull
}

function classifyOverfull(entry) {
  const voiced = (entry.voices ?? []).length > 0
  if (voiced) return entry.hasBackup ? 'voiced-with-backup' : 'voiced-without-backup'
  return entry.hasBackup ? 'backup-without-voices' : 'unvoiced-flattened'
}

/** Checkpoint-level cross-measure grouping over the SHIPPED WFY stream. */
function auditCheckpointGrouping(timingMap) {
  const checkpoints = buildNoteCheckpoints(timingMap)
  const cross = []
  let multiNote = 0
  let split = 0
  for (const checkpoint of checkpoints) {
    const measures = [...new Set((checkpoint.notes ?? []).map((note) => note.measureNumber))]
    if (measures.length > 1) cross.push(checkpoint)
    if (checkpoint.splitFromCrossMeasureGroup) split += 1
    if ((checkpoint.notes ?? []).length > 1) multiNote += 1
  }
  return { checkpoints, crossMeasure: cross, multiNoteCheckpoints: multiNote, split }
}

/**
 * Cumulative drift on the WRITTEN timeline: for each written measure, the
 * furthest written note end past its own window (from the parser's per-part
 * note-extent record — written durations, so legitimate ties across the
 * barline do not count) and how many notes onset past the barline.
 */
function auditDrift(timingMap) {
  const rows = []
  const boundaryByIndex = new Map((timingMap.measures ?? []).map((b) => [b.index, b]))
  const partEnds = timingMap.partMeasureNoteEnds instanceof Map ? timingMap.partMeasureNoteEnds : new Map()
  for (const [partId, entries] of partEnds) {
    for (const entry of entries) {
      const boundary = boundaryByIndex.get(entry.index)
      if (!boundary) continue
      const onsets = (timingMap.notes ?? [])
        .filter((note) => note.measureNumber === boundary.number && note.partId === partId)
        .map((note) => note.quarterTime - boundary.startQuarters)
      rows.push({
        partId,
        measureNumber: boundary.number,
        window: [round(boundary.startQuarters), round(boundary.endQuarters)],
        lastNoteEndQuarters: round(boundary.startQuarters + entry.endQuarters),
        pastOwnBarlineQuarters: round(Math.max(0, entry.endQuarters - boundary.lengthQuarters)),
        spilloverNoteCount: onsets.filter((onset) => onset >= boundary.lengthQuarters - EPSILON_QUARTERS).length,
      })
    }
  }
  rows.sort((a, b) => a.measureNumber - b.measureNumber || String(a.partId).localeCompare(String(b.partId)))
  const worst = rows.reduce((max, row) => Math.max(max, row.pastOwnBarlineQuarters), 0)
  const last = rows[rows.length - 1]
  return {
    rows,
    worstPastBarlineQuarters: round(worst),
    finalNoteSoundsPastWrittenEndQuarters: last ? round(last.pastOwnBarlineQuarters) : 0,
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

async function traceOne(entry, label) {
  const xml =
    entry.id === 'synthetic-control'
      ? syntheticControlXml()
      : await readScoreXml(join(root, entry.path))
  const timingMap = parseMusicXml(xml, basename(entry.id))
  const overfull = auditMeasureTiming(timingMap)
  const grouping = auditCheckpointGrouping(timingMap)
  const drift = auditDrift(timingMap)
  const perPartOverfull = overfull.reduce((acc, row) => {
    acc[row.partId] = (acc[row.partId] ?? 0) + 1
    return acc
  }, {})

  const result = {
    id: entry.id,
    role: entry.role,
    why: entry.why,
    measures: timingMap.measures?.length ?? 0,
    notes: (timingMap.notes ?? []).filter((note) => !note.isRest).length,
    parts: timingMap.parts?.length ?? 0,
    validationStatus: timingMap.timingValidation?.status ?? 'unknown',
    validationSummary: timingMap.timingValidation?.summary ?? null,
    overfullMeasures: overfull.length,
    overfullPerPart: perPartOverfull,
    overfullWorstExcessQuarters: overfull.reduce((max, row) => Math.max(max, row.excessQuarters), 0),
    overfullDetail: overfull.slice(0, 40),
    checkpoints: grouping.checkpoints.length,
    crossMeasureCheckpoints: grouping.crossMeasure.length,
    crossMeasureShare: grouping.checkpoints.length
      ? round(grouping.crossMeasure.length / grouping.checkpoints.length)
      : 0,
    splitFallbackCheckpoints: grouping.split,
    multiNoteCheckpoints: grouping.multiNote,
    crossMeasureExamples: grouping.crossMeasure.slice(0, 12).map((checkpoint) => ({
      id: checkpoint.id,
      timeSeconds: round(checkpoint.timeSeconds),
      writtenMeasures: [...new Set((checkpoint.notes ?? []).map((note) => note.measureNumber))],
      labels: (checkpoint.notes ?? []).map((note) => `${note.label}@m${note.measureNumber}`),
      expectedMidis: checkpoint.expectedMidis,
    })),
    drift: {
      worstPastBarlineQuarters: drift.worstPastBarlineQuarters,
      finalNoteSoundsPastWrittenEndQuarters: drift.finalNoteSoundsPastWrittenEndQuarters,
      rows: drift.rows.slice(0, 40),
    },
  }
  console.log(
    `${label.padEnd(6)} ${entry.id.padEnd(34)} m=${result.measures} cp=${result.checkpoints} ` +
      `overfull=${result.overfullMeasures} worstExcess=${result.overfullWorstExcessQuarters}q ` +
      `validation=${result.validationStatus} crossMeasureCp=${result.crossMeasureCheckpoints} (${(result.crossMeasureShare * 100).toFixed(1)}%) ` +
      `splitCp=${result.splitFallbackCheckpoints} driftPastBarline=${result.drift.worstPastBarlineQuarters}q`,
  )
  return result
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const labelArgIndex = process.argv.indexOf('--label')
  const label = labelArgIndex >= 0 ? process.argv[labelArgIndex + 1] : 'run'
  const jsonArgIndex = process.argv.indexOf('--json')

  const entries = [
    ...FROZEN_SET,
    {
      id: 'synthetic-control',
      role: 'control-synthetic-structures',
      why: 'pickup, repeat, tie across bar, tuplet, two voices with backup, chord',
      path: null,
    },
  ]
  const results = []
  for (const entry of entries) {
    try {
      results.push(await traceOne(entry, label))
    } catch (error) {
      console.error(`FAIL ${entry.id}: ${error?.message ?? error}`)
      results.push({ id: entry.id, ok: false, reason: error?.message ?? String(error) })
    }
  }

  const report = { label, generatedAt: new Date().toISOString(), results }
  await writeFile(join(outDir, `report-${label}.json`), JSON.stringify(report, null, 2))

  const lines = [
    `# Timing integrity trace (${label})`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| score | role | measures | checkpoints | overfull | worst excess | cross-measure checkpoints | drift past barline |',
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const r of results) {
    if (r.ok === false) {
      lines.push(`| ${r.id} | FAILED | ${r.reason} | | | | | |`)
      continue
    }
    lines.push(
      `| ${r.id} | ${r.role} | ${r.measures} | ${r.checkpoints} | ${r.overfullMeasures} ` +
        `| ${r.overfullWorstExcessQuarters}q | ${r.crossMeasureCheckpoints} (${(r.crossMeasureShare * 100).toFixed(1)}%) ` +
        `| ${r.drift.worstPastBarlineQuarters}q |`,
    )
  }
  await writeFile(join(outDir, `report-${label}.md`), `${lines.join('\n')}\n`)
  if (jsonArgIndex >= 0) {
    await writeFile(process.argv[jsonArgIndex + 1], JSON.stringify(report, null, 2))
  }
  console.log(`\nreport in ${outDir}/report-${label}.{json,md}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
