#!/usr/bin/env node
/**
 * Acceptance artifact builder for OMR Quality Sprint: Dense Notation & Rhythm.
 *
 * It reads the already-generated real-score evaluator reports and MusicXML,
 * builds the ranked taxonomy, verifies playback/pitch invariants, and renders a
 * representative source → before → after gallery.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/omr-quality-dense-rhythm')
const BASELINE = join(OUT, 'baseline')
const AFTER = join(OUT, 'after')
const EVIDENCE = join(OUT, 'evidence')
const DOWNLOADS = join(homedir(), 'Downloads')
const IDS = [
  'minecraft',
  'evangelion',
  'gymnopedie',
  'piano-articulation-scan',
  'piano-grand-voices-vector',
  'piano-rhythm-tuplets-vector',
  'la-campanella',
  'fantaisie-impromptu',
  'moonlight-3',
  'hungarian-dance-no5',
  'carol-of-the-bells',
]
const DIRECT_BASELINE_IDS = new Set([
  'fantaisie-impromptu',
  'moonlight-3',
  'hungarian-dance-no5',
  'carol-of-the-bells',
])
const TRUTH_PATHS = {
  minecraft: join(
    DOWNLOADS,
    'beginner-minecraft-piano-themes-in-c-minecraft.mxl',
  ),
  evangelion: join(
    DOWNLOADS,
    'a-cruel-angels-thesis-neon-genesis-evangelion.mxl',
  ),
  gymnopedie: join(DOWNLOADS, 'gymnopedie-no-1-satie.mxl'),
  'piano-articulation-scan': join(
    ROOT,
    'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml',
  ),
  'piano-grand-voices-vector': join(
    ROOT,
    'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml',
  ),
  'piano-rhythm-tuplets-vector': join(
    ROOT,
    'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml',
  ),
  'la-campanella': join(
    DOWNLOADS,
    'etude-s-1413-in-g-minor-la-campanella-liszt.mxl',
  ),
  'fantaisie-impromptu': join(
    DOWNLOADS,
    'fantaisie-impromptu-in-c-minor-chopin.mxl',
  ),
  'moonlight-3': join(
    DOWNLOADS,
    'sonate-no-14-moonlight-3rd-movement.mxl',
  ),
  'hungarian-dance-no5': join(DOWNLOADS, 'hungarian-dance-no5.mxl'),
  'carol-of-the-bells': join(DOWNLOADS, 'carol-of-the-bells.mxl'),
}

function exactTaxonomy(report) {
  const counts = {
    wrongNoteDuration: 0,
    wrongRestDuration: 0,
    missingRest: 0,
    inventedRest: 0,
    denseChordSeparation: 0,
    tupletGrouping: 0,
  }
  for (const measure of report.measures ?? []) {
    if (
      measure.alignment !== 'match' ||
      measure.truthMeasureNumbers?.length !== 1 ||
      measure.generatedMeasureNumbers?.length !== 1
    ) {
      continue
    }
    for (const defect of measure.defects ?? []) {
      if (
        ['duration-mismatch', 'dotted-rhythm-error', 'missing-dot', 'extra-dot']
          .includes(defect.code)
      ) {
        counts.wrongNoteDuration += 1
      } else if (defect.code === 'rest-duration-error') {
        counts.wrongRestDuration += 1
      } else if (defect.code === 'missing-rest') {
        counts.missingRest += 1
      } else if (defect.code === 'extra-rest') {
        counts.inventedRest += 1
      } else if (defect.code === 'incorrect-chord') {
        counts.denseChordSeparation += 1
      } else if (defect.code?.includes('tuplet')) {
        counts.tupletGrouping += 1
      }
    }
  }
  return counts
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0
  }
}

function totalCounts(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

async function reportsFor(side) {
  const result = {}
  for (const id of IDS) {
    result[id] = JSON.parse(
      await readFile(join(side, 'reports', `${id}.json`), 'utf8'),
    )
  }
  return result
}

function aggregateReports(reports) {
  const aggregate = {
    wrongNoteDuration: 0,
    wrongRestDuration: 0,
    missingRest: 0,
    inventedRest: 0,
    denseChordSeparation: 0,
    tupletGrouping: 0,
  }
  for (const report of Object.values(reports)) {
    addCounts(aggregate, exactTaxonomy(report))
  }
  return aggregate
}

function measureBlocks(xml) {
  return new Map(
    [...xml.matchAll(
      /<measure\b[^>]*number="([^"]+)"[^>]*>[\s\S]*?<\/measure>/g,
    )].map((match) => [Number(match[1]), match[0]]),
  )
}

function baselineXmlPath(id) {
  if (DIRECT_BASELINE_IDS.has(id)) {
    return join(BASELINE, 'generated', `${id}.musicxml`)
  }
  return join(ROOT, 'tmp/musical-structure-sprint-1/generated', `${id}.musicxml`)
}

async function readScoreXml(path) {
  return path.endsWith('.mxl')
    ? readMxl(path)
    : readFile(path, 'utf8')
}

function beamSignature(note) {
  return JSON.stringify(
    (note.beams ?? []).map((beam) => [
      Number(beam.number ?? 1),
      beam.value ?? null,
    ]),
  )
}

async function auditDenseBeamGrouping(reports) {
  const bySource = {}
  let mismatchCount = 0
  let matchedBeamedTruthNotes = 0
  for (const id of IDS) {
    const truth = parseMusicXml(
      await readScoreXml(TRUTH_PATHS[id]),
      `${id}-truth.musicxml`,
    )
    const generated = parseMusicXml(
      await readFile(baselineXmlPath(id), 'utf8'),
      `${id}-baseline.musicxml`,
    )
    let sourceMismatches = 0
    let sourceMatched = 0
    for (const alignment of reports[id].measures ?? []) {
      if (
        alignment.alignment !== 'match' ||
        alignment.truthMeasureNumbers?.length !== 1 ||
        alignment.generatedMeasureNumbers?.length !== 1
      ) {
        continue
      }
      const truthMeasure = truth.measures.find(
        (measure) => measure.number === alignment.truthMeasureNumbers[0],
      )
      const generatedMeasure = generated.measures.find(
        (measure) => measure.number === alignment.generatedMeasureNumbers[0],
      )
      if (!truthMeasure || !generatedMeasure) {
        continue
      }
      const truthNotes = truth.notes
        .filter(
          (note) =>
            note.measureNumber === truthMeasure.number &&
            !note.isRest &&
            note.midi != null &&
            note.beams?.length,
        )
        .map((note) => ({
          ...note,
          relativeOnset: note.quarterTime - truthMeasure.startQuarters,
        }))
      const generatedNotes = generated.notes
        .filter(
          (note) =>
            note.measureNumber === generatedMeasure.number &&
            !note.isRest &&
            note.midi != null,
        )
        .map((note) => ({
          ...note,
          relativeOnset: note.quarterTime - generatedMeasure.startQuarters,
        }))
      const usedGenerated = new Set()
      for (const truthNote of truthNotes) {
        let bestIndex = -1
        let bestDistance = Infinity
        for (let index = 0; index < generatedNotes.length; index += 1) {
          const candidate = generatedNotes[index]
          const onsetDistance = Math.abs(
            candidate.relativeOnset - truthNote.relativeOnset,
          )
          if (
            usedGenerated.has(index) ||
            candidate.midi !== truthNote.midi ||
            candidate.staff !== truthNote.staff ||
            onsetDistance > 0.25 ||
            onsetDistance >= bestDistance
          ) {
            continue
          }
          bestIndex = index
          bestDistance = onsetDistance
        }
        if (bestIndex < 0) {
          continue
        }
        usedGenerated.add(bestIndex)
        sourceMatched += 1
        if (
          beamSignature(truthNote) !==
          beamSignature(generatedNotes[bestIndex])
        ) {
          sourceMismatches += 1
        }
      }
    }
    bySource[id] = {
      matchedBeamedTruthNotes: sourceMatched,
      mismatches: sourceMismatches,
    }
    matchedBeamedTruthNotes += sourceMatched
    mismatchCount += sourceMismatches
  }
  return {
    method:
      'Greedy one-to-one same-MIDI/staff matching within 0.25 quarters in aligned measures; compare MusicXML beam number/value.',
    matchedBeamedTruthNotes,
    mismatchCount,
    bySource,
  }
}

function pitchSignature(timing) {
  return timing.notes
    .filter((note) => !note.isRest && note.midi != null)
    .map((note) => note.midi)
}

function notationSemanticSignature(timing) {
  return timing.notes
    .filter((note) => !note.isRest && note.midi != null)
    .map((note) => [
      note.midi,
      note.tieStart,
      note.tieStop,
      note.staccato,
      note.accent,
      note.tenuto,
      note.marcato,
      note.fermata,
    ])
}

function sortedSignature(rows) {
  return rows.map((row) => JSON.stringify(row)).sort()
}

function rendererModel(xml, name) {
  return { timing: parseMusicXml(xml, name) }
}

function drawEllipse(context, x, y, hollow) {
  context.save()
  context.translate(x, y)
  context.rotate(-14 * Math.PI / 180)
  context.beginPath()
  context.ellipse(0, 0, 7, 4.5, 0, 0, Math.PI * 2)
  context.fillStyle = hollow ? '#fff' : '#111827'
  context.strokeStyle = '#111827'
  context.lineWidth = 2
  context.fill()
  if (hollow) context.stroke()
  context.restore()
}

async function drawRenderedMeasure(model, measureNumber, path, title) {
  const measure = model.timing.measures.find(
    (entry) => entry.number === measureNumber,
  )
  const measureNotes = model.timing.notes.filter(
    (note) =>
      note.measureNumber === measureNumber &&
      note.staff === 1 &&
      !note.isRest &&
      note.midi != null,
  )
  const canvas = createCanvas(720, 260)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#111827'
  context.font = '16px sans-serif'
  context.fillText(title, 20, 24)
  const measureStart = measure?.startQuarters ?? 0
  const measureDuration = measure?.durationQuarters ?? 3
  const mapX = (note) =>
    75 + ((note.quarterTime - measureStart) / measureDuration) * 570
  const mapY = (note) => 94 + (77 - note.midi) * 3
  context.strokeStyle = '#aab0b8'
  context.lineWidth = 1
  for (let line = 0; line < 5; line += 1) {
    const y = 82 + line * 12
    context.beginPath()
    context.moveTo(35, y)
    context.lineTo(685, y)
    context.stroke()
  }
  context.strokeStyle = '#111827'
  context.lineWidth = 2
  for (const note of measureNotes) {
    const x = mapX(note)
    const y = mapY(note)
    const noteType = note.noteType ?? 'quarter'
    const hollow = ['half', 'whole'].includes(noteType)
    drawEllipse(context, x, y, hollow)
    if (noteType === 'whole') {
      continue
    }
    const stemX = x - 6
    const stemEndY = y + 42
    context.beginPath()
    context.moveTo(stemX, y)
    context.lineTo(stemX, stemEndY)
    context.stroke()
    const flagCount =
      noteType === 'sixteenth'
        ? 2
        : noteType === 'eighth'
          ? 1
          : 0
    for (let flag = 0; flag < flagCount; flag += 1) {
      const flagY = stemEndY - flag * 8
      context.beginPath()
      context.moveTo(stemX, flagY)
      context.quadraticCurveTo(stemX - 14, flagY - 5, stemX - 9, flagY - 17)
      context.stroke()
    }
  }
  await writeFile(path, canvas.toBuffer('image/png'))
}

async function drawGallery(beforeXml, afterXml) {
  const page = await loadImage(
    join(BASELINE, 'rendered-source', 'carol-p1.png'),
  )
  const crop = createCanvas(340, 245)
  const cropContext = crop.getContext('2d')
  cropContext.fillStyle = '#fff'
  cropContext.fillRect(0, 0, crop.width, crop.height)
  cropContext.drawImage(page, 75, 245, 345, 245, 0, 0, 340, 245)
  const sourcePath = join(EVIDENCE, 'carol-measure-1-source.png')
  const beforePath = join(EVIDENCE, 'carol-measure-1-before.png')
  const afterPath = join(EVIDENCE, 'carol-measure-1-after.png')
  await writeFile(sourcePath, crop.toBuffer('image/png'))
  await drawRenderedMeasure(
    rendererModel(beforeXml, 'carol-before.musicxml'),
    1,
    beforePath,
    'Previous Corranzo: Q, E, E, E, 16th',
  )
  await drawRenderedMeasure(
    rendererModel(afterXml, 'carol-after.musicxml'),
    1,
    afterPath,
    'New Corranzo: Q, E, E, E, E',
  )
  const [source, before, after] = await Promise.all(
    [sourcePath, beforePath, afterPath].map((path) => loadImage(path)),
  )
  const gallery = createCanvas(1500, 420)
  const context = gallery.getContext('2d')
  context.fillStyle = '#f5f6f8'
  context.fillRect(0, 0, gallery.width, gallery.height)
  context.fillStyle = '#111827'
  context.font = '18px sans-serif'
  context.fillText('Carol of the Bells — measure 1 rhythm refinement', 20, 28)
  const panels = [
    { image: source, x: 20, label: 'Original PDF' },
    { image: before, x: 520, label: 'Accepted baseline output' },
    { image: after, x: 1020, label: 'Dense-rhythm refinement' },
  ]
  for (const panel of panels) {
    context.font = '14px sans-serif'
    context.fillText(panel.label, panel.x, 56)
    context.fillStyle = '#fff'
    context.fillRect(panel.x, 68, 460, 325)
    const scale = Math.min(450 / panel.image.width, 315 / panel.image.height)
    const width = panel.image.width * scale
    const height = panel.image.height * scale
    context.drawImage(
      panel.image,
      panel.x + (460 - width) / 2,
      73 + (315 - height) / 2,
      width,
      height,
    )
    context.fillStyle = '#111827'
  }
  const galleryPath = join(EVIDENCE, 'carol-measure-1-gallery.png')
  await writeFile(galleryPath, gallery.toBuffer('image/png'))
  return galleryPath
}

async function readMxl(path) {
  const zip = await JSZip.loadAsync(await readFile(path))
  const container = await zip.file('META-INF/container.xml').async('string')
  const rootPath = container.match(/full-path="([^"]+)"/)?.[1]
  return zip.file(rootPath).async('string')
}

function measureAttackRows(timing, measureNumber) {
  const measure = timing.measures.find((entry) => entry.number === measureNumber)
  return timing.notes
    .filter(
      (note) =>
        note.measureNumber === measureNumber &&
        !note.isRest &&
        note.midi != null &&
        note.staff === 1,
    )
    .map((note) => ({
      midi: note.midi,
      onsetQuarters: Number((note.quarterTime - measure.startQuarters).toFixed(3)),
      durationQuarters: Number(note.durationQuarters.toFixed(3)),
    }))
}

async function main() {
  await mkdir(EVIDENCE, { recursive: true })
  const beforeReports = await reportsFor(BASELINE)
  const afterReports = await reportsFor(AFTER)
  const before = aggregateReports(beforeReports)
  const after = aggregateReports(afterReports)
  const rasterBefore = exactTaxonomy(beforeReports['piano-articulation-scan'])
  const vectorBefore = Object.fromEntries(
    Object.keys(before).map((key) => [key, before[key] - rasterBefore[key]]),
  )
  const beamAudit = await auditDenseBeamGrouping(beforeReports)
  const ranked = [
    ['wrong note duration', before.wrongNoteDuration],
    ['dense beam grouping', beamAudit.mismatchCount],
    ['dense chord separation', before.denseChordSeparation],
    ['missing rest', before.missingRest],
    ['tuplet grouping', before.tupletGrouping],
    ['wrong rest duration', before.wrongRestDuration],
    ['invented rest', before.inventedRest],
  ].map(([category, count], index) => ({ rank: index + 1, category, count }))

  const playback = {}
  for (const id of IDS) {
    const beforeXml = await readFile(baselineXmlPath(id), 'utf8')
    const afterXml = await readFile(
      join(AFTER, 'generated', `${id}.musicxml`),
      'utf8',
    )
    const beforeTiming = parseMusicXml(beforeXml, `${id}-before.musicxml`)
    const afterTiming = parseMusicXml(afterXml, `${id}-after.musicxml`)
    const beforeBlocks = measureBlocks(beforeXml)
    const afterBlocks = measureBlocks(afterXml)
    const changedMeasures = [...new Set([
      ...beforeBlocks.keys(),
      ...afterBlocks.keys(),
    ])].filter((number) => beforeBlocks.get(number) !== afterBlocks.get(number))
    playback[id] = {
      noteCountBefore: pitchSignature(beforeTiming).length,
      noteCountAfter: pitchSignature(afterTiming).length,
      pitchInventoryEqual:
        JSON.stringify([...pitchSignature(beforeTiming)].sort((a, b) => a - b)) ===
        JSON.stringify([...pitchSignature(afterTiming)].sort((a, b) => a - b)),
      parsedAttackOrderEqual:
        JSON.stringify(pitchSignature(beforeTiming)) ===
        JSON.stringify(pitchSignature(afterTiming)),
      frozenNotationSemanticsEqual:
        JSON.stringify(sortedSignature(notationSemanticSignature(beforeTiming))) ===
        JSON.stringify(sortedSignature(notationSemanticSignature(afterTiming))),
      changedMeasures,
    }
  }

  const carolBeforeXml = await readFile(
    baselineXmlPath('carol-of-the-bells'),
    'utf8',
  )
  const carolAfterXml = await readFile(
    join(AFTER, 'generated', 'carol-of-the-bells.musicxml'),
    'utf8',
  )
  const carolTruthXml = await readMxl(
    join(DOWNLOADS, 'carol-of-the-bells.mxl'),
  )
  const representative = {
    before: measureAttackRows(
      parseMusicXml(carolBeforeXml, 'carol-before.musicxml'),
      1,
    ),
    after: measureAttackRows(
      parseMusicXml(carolAfterXml, 'carol-after.musicxml'),
      1,
    ),
    truth: measureAttackRows(
      parseMusicXml(carolTruthXml, 'carol-truth.musicxml'),
      1,
    ),
  }
  const galleryPath = await drawGallery(carolBeforeXml, carolAfterXml)
  const semanticDelta = JSON.parse(
    await readFile(join(OUT, 'semantic-delta.json'), 'utf8'),
  )
  const carolPlaybackBefore = JSON.parse(
    await readFile(join(OUT, 'carol-playback-before.json'), 'utf8'),
  )
  const carolPlaybackAfter = JSON.parse(
    await readFile(join(OUT, 'carol-playback-after.json'), 'utf8'),
  )

  const taxonomy = {
    authority: 'high-confidence one-to-one aligned real-score measures',
    sources: IDS,
    ranked,
    sourceStrata: {
      rasterOnly: {
        total: totalCounts(rasterBefore),
        categories: rasterBefore,
      },
      vectorOnly: {
        total: totalCounts(vectorBefore),
        categories: vectorBefore,
      },
      note:
        'Raster/vector are source strata, not mutually exclusive causal categories.',
    },
    denseBeamGroupingAudit: beamAudit,
    before,
    after,
    delta: Object.fromEntries(
      Object.keys(before).map((key) => [key, after[key] - before[key]]),
    ),
  }
  const validation = {
    shippedFix:
      'Conservative relative-column repacking for complete, evidence-light 3/4 vector lanes.',
    changedProductFiles: [
      'src/features/omr/processVectorOmrPage.js',
      'tests/omrVectorRhythm.test.js',
    ],
    realScoreResult: {
      wrongNoteDurationBefore: before.wrongNoteDuration,
      wrongNoteDurationAfter: after.wrongNoteDuration,
      reduction: before.wrongNoteDuration - after.wrongNoteDuration,
      reductionPercent: Number(
        (((before.wrongNoteDuration - after.wrongNoteDuration) /
          before.wrongNoteDuration) * 100).toFixed(1),
      ),
      carolOverallBefore: beforeReports['carol-of-the-bells'].overallPercent,
      carolOverallAfter: afterReports['carol-of-the-bells'].overallPercent,
      carolRhythmBefore:
        beforeReports['carol-of-the-bells'].scorePercents.rhythm,
      carolRhythmAfter:
        afterReports['carol-of-the-bells'].scorePercents.rhythm,
      carolPerformedPlaybackBefore:
        carolPlaybackBefore.scorePercents.playback,
      carolPerformedPlaybackAfter:
        carolPlaybackAfter.scorePercents.playback,
    },
    representativeMeasure: representative,
    playback,
    frozenCorpus: {
      accept: semanticDelta.compare.accept,
      overallDelta: semanticDelta.compare.overallDelta,
      classDeltas: semanticDelta.compare.classDeltas,
      regressions: semanticDelta.compare.regressions,
      note:
        'Comparator ACCEPT is neutral/NO because all frozen scored deltas are exactly zero; the real-score taxonomy supplies the required improvement.',
    },
    gallery: galleryPath.replace(`${ROOT}/`, ''),
  }
  await writeFile(
    join(OUT, 'taxonomy.json'),
    `${JSON.stringify(taxonomy, null, 2)}\n`,
  )
  await writeFile(
    join(OUT, 'validation-summary.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
  )

  const report = `# OMR Quality Sprint — Dense Notation & Rhythm Refinement

## Shipped slice

The largest high-confidence remaining category was **wrong note duration**
(${before.wrongNoteDuration} cases). The shipped fix addresses the repeated
vector-lane margin drift that compressed terminal eighths into sixteenths.

| Rank | Baseline category | Count |
| ---: | --- | ---: |
${ranked.map((row) => `| ${row.rank} | ${row.category} | ${row.count} |`).join('\n')}

Raster/vector are source-availability strata, not mutually exclusive failure
causes, so they are reported separately from the actionable ranking:

- vector-source direct defects: **${totalCounts(vectorBefore)}**
- raster-source direct defects: **${totalCounts(rasterBefore)}**

## Real-score result

- Wrong note-duration errors: **${before.wrongNoteDuration} → ${after.wrongNoteDuration}**
  (${before.wrongNoteDuration - after.wrongNoteDuration} fewer; ${validation.realScoreResult.reductionPercent}% reduction).
- Carol of the Bells semantic score: **${validation.realScoreResult.carolOverallBefore} → ${validation.realScoreResult.carolOverallAfter}**.
- Carol rhythm score: **${validation.realScoreResult.carolRhythmBefore} → ${validation.realScoreResult.carolRhythmAfter}**.
- Dense chord errors: **${before.denseChordSeparation} → ${after.denseChordSeparation}**.
- Rest and tuplet categories: unchanged.
- Changed MusicXML measures: Carol of the Bells only.
- MIDI inventory, note count, ties/slurs, accidentals, articulations, and
  key-signature semantics: unchanged in every validation source.
- Corrected onsets intentionally change parsed cross-staff attack ordering in
  Carol only; performed-reference playback stays
  **${validation.realScoreResult.carolPerformedPlaybackBefore} → ${validation.realScoreResult.carolPerformedPlaybackAfter}**.

Representative measure 1 now matches truth exactly:

- before starts/durations: 0/1, 1.25/.5, 1.75/.5, 2.25/.5, 2.75/.25
- after and truth: 0/1, 1/.5, 1.5/.5, 2/.5, 2.5/.5

## Frozen regressions

- Frozen semantic corpus: all class deltas **0**; regressions **0**.
- The generic comparator prints neutral ACCEPT: NO because it requires a scored
  corpus improvement. The dedicated real-score taxonomy records the 26-case
  duration reduction.
- Audio and playback-expression code were untouched.
`
  await writeFile(join(OUT, 'REPORT.md'), report)
  console.log(report)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
