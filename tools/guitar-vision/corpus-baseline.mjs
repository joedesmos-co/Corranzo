#!/usr/bin/env node
/**
 * Guitar Vision — Phase 0 reproducible corpus baseline.
 *
 * Runs the *current* (heuristic) OMR over the real guitar corpus and emits a
 * single frozen baseline record. Purpose: make "how bad is it, exactly, and
 * why" re-derivable at any time instead of a claim in a document.
 *
 * It also records the systematic-pitch-offset analysis, which is what
 * separates a fixable transposition contract bug from genuine recognition
 * failure.
 *
 * Usage:
 *   node tools/guitar-vision/corpus-baseline.mjs --out baselines/guitar-v1.json
 *   node tools/guitar-vision/corpus-baseline.mjs --out ... --skip-omr
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { evaluateGuitarScore } from '../../src/features/omr/guitar/guitarMetrics.js'
import { extractNoteObjects } from '../../src/features/omr/guitar/guitarObjects.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Real-domain guitar corpus. These are matched PDF + MusicXML pairs of actual
 * published guitar scores (Mutopia / public domain), NOT synthetic fixtures.
 * Synthetic CC0 fixtures are audited separately — they are not representative.
 */
export const REAL_GUITAR_CORPUS = [
  'guitar-aguado-a-minor-study',
  'guitar-aguado-allegro-g',
  'guitar-aguado-favorites-1',
  'guitar-aguado-op03-1',
  'guitar-aguado-op03-2',
  'guitar-aguado-op03-3',
  'guitar-aguado-op03-4',
  'guitar-aguado-op03-5',
  'guitar-aguado-op03-6',
  'guitar-bach-menuet-bwv1006a',
  'guitar-bach-prelude-bwv997',
  'guitar-bach-prelude-bwv999',
  'guitar-spanish-romance',
]

const PRACTICE_DIR = join(ROOT, 'public/fixtures/practice-library')

function argValue(args, flag, fallback) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : fallback
}

function loadNotes(path) {
  const doc = parseMusicXml(readFileSync(path, 'utf8'), path)
  return (doc.notes ?? [])
    .filter((note) => !note.isRest && Number.isFinite(note.midi))
    .map((note) => ({ measure: note.measureNumber, time: note.quarterTime, midi: note.midi }))
}

/**
 * Index-pairs notes inside each measure and reports the semitone delta
 * histogram. A single dominant offset means a contract bug; a flat spread
 * means the recognizer genuinely cannot see the notation.
 */
function offsetAnalysis(truthNotes, genNotes) {
  const byMeasure = (notes) => {
    const map = new Map()
    for (const note of notes) {
      if (!map.has(note.measure)) map.set(note.measure, [])
      map.get(note.measure).push(note)
    }
    for (const list of map.values()) list.sort((a, b) => a.time - b.time || a.midi - b.midi)
    return map
  }
  const truthByMeasure = byMeasure(truthNotes)
  const genByMeasure = byMeasure(genNotes)
  const deltas = new Map()
  let compared = 0
  let exact = 0
  for (const [measure, truthList] of truthByMeasure) {
    const genList = genByMeasure.get(measure) ?? []
    const width = Math.min(truthList.length, genList.length)
    for (let index = 0; index < width; index += 1) {
      const delta = genList[index].midi - truthList[index].midi
      deltas.set(delta, (deltas.get(delta) ?? 0) + 1)
      compared += 1
      if (delta === 0) exact += 1
    }
  }
  const top = [...deltas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  return {
    compared,
    exact,
    exactRate: compared ? Number((exact / compared).toFixed(4)) : 0,
    dominantOffset: top[0]?.[0] ?? null,
    dominantOffsetShare: compared && top[0] ? Number((top[0][1] / compared).toFixed(4)) : 0,
    topOffsets: top.map(([delta, count]) => ({ delta, count })),
  }
}

/**
 * Strict per-object scoring, kept alongside the legacy bag metrics so the two
 * can be compared directly. The legacy numbers are retained because they are
 * what the existing benchmark thresholds are written against; the strict
 * numbers are what a product decision should rest on.
 */
function strictReport(truthPath, generatedPath) {
  const truthXml = readFileSync(truthPath, 'utf8')
  const generatedXml = readFileSync(generatedPath, 'utf8')
  const report = evaluateGuitarScore({ truthXml, generatedXml, parse: parseMusicXml })
  return {
    detection: report.detection,
    endToEndNoteAccuracy: report.endToEndNoteAccuracy,
    attributes: Object.fromEntries(
      Object.entries(report.attributes).map(([name, value]) => [
        name,
        {
          accuracy: value.accuracy,
          correct: value.correct,
          comparable: value.comparable,
          conditionalAccuracy: value.conditionalAccuracy ?? null,
          conditionalCorrect: value.conditionalCorrect ?? null,
          conditionalComparable: value.conditionalComparable ?? null,
        },
      ]),
    ),
    tabConsistency: report.tabConsistency,
    markingFamiliesWithTruth: Object.entries(report.markings)
      .filter(([, value]) => value.supported)
      .map(([family, value]) => ({
        family,
        truth: value.truth,
        generated: value.generated,
        matched: value.matched,
        recall: value.recall,
        precision: value.precision,
      })),
    unscoreableFamilies: report.unscoreableFamilies,
  }
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(4))
}

function mean(values) {
  if (!values.length) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
}

function main() {
  const args = process.argv.slice(2)
  const outPath = argValue(args, '--out', join(ROOT, 'baselines/guitar-v1-baseline.json'))
  const workDir = argValue(args, '--work', join(ROOT, 'tmp/guitar-vision/baseline'))
  const skipOmr = args.includes('--skip-omr')

  mkdirSync(workDir, { recursive: true })
  mkdirSync(dirname(outPath), { recursive: true })

  const records = []
  for (const id of REAL_GUITAR_CORPUS) {
    const dir = join(PRACTICE_DIR, id)
    const pdf = join(dir, `${id}.pdf`)
    const truth = join(dir, `${id}.musicxml`)
    if (!existsSync(pdf) || !existsSync(truth)) {
      records.push({ id, error: 'missing-pdf-or-truth' })
      continue
    }
    const reportPath = join(workDir, `${id}.json`)
    const generatedPath = join(workDir, `${id}.generated.musicxml`)

    if (!skipOmr || !existsSync(reportPath)) {
      try {
        execFileSync(
          'node',
          [
            join(ROOT, 'scripts/evaluate-omr-accuracy.mjs'),
            '--pdf', pdf,
            '--truth', truth,
            '--instrument', 'guitar',
            '--save-generated', generatedPath,
            '--json', reportPath,
            '--text', join(workDir, `${id}.txt`),
          ],
          { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] },
        )
      } catch {
        // A hard failure means the engine refused or crashed on a real score.
        // That is a real product outcome (the user gets no transcription), so
        // it is recorded rather than crashing the baseline.
        records.push({
          id,
          domain: 'real-mutopia-classical-guitar',
          staffType: 'standard-5-line-notation',
          engineOutcome: 'refused-or-crashed',
          metrics: {},
          totals: {},
          notationDetected: {},
          selfReportedQuality: {},
          pitchOffsetAnalysis: null,
        })
        process.stderr.write(`baseline: ${id} REFUSED\n`)
        continue
      }
    }

    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    const metrics = report.metrics ?? {}
    const totals = report.totals ?? {}
    const diagnostics = report.generatedOmrDiagnostics ?? {}

    let offsets = null
    let strict = null
    if (existsSync(generatedPath)) {
      offsets = offsetAnalysis(loadNotes(truth), loadNotes(generatedPath))
      try {
        strict = strictReport(truth, generatedPath)
      } catch (error) {
        strict = { error: String(error?.message ?? error) }
      }
    }

    records.push({
      id,
      domain: 'real-mutopia-classical-guitar',
      staffType: 'standard-5-line-notation',
      engineOutcome: 'transcribed',
      metrics: {
        pitchAccuracy: metrics.pitchAccuracy ?? null,
        orderSensitivePitchRecovery: metrics.orderSensitivePitchRecovery ?? null,
        durationAccuracy: metrics.durationAccuracy ?? null,
        onsetAccuracy: metrics.onsetAccuracy ?? null,
        timeAccuracy: metrics.timeAccuracy ?? null,
        noteDetectionF1: metrics.noteDetectionF1 ?? null,
        chordGroupingAccuracy: metrics.chordGroupingAccuracy ?? null,
        measureCountAccuracy: metrics.measureCountAccuracy ?? null,
      },
      totals: {
        truthNotes: totals.truthNoteCount ?? null,
        generatedNotes: totals.generatedNoteCount ?? null,
        missingNotes: totals.missingNoteCount ?? null,
        extraNotes: totals.extraNoteCount ?? null,
        wrongPitch: totals.wrongPitchCount ?? null,
        greedyCorrectPitch: totals.greedyCorrectPitchCount ?? null,
        correctTime: totals.correctTimeCount ?? null,
        chordMismatch: totals.chordMismatchCount ?? null,
      },
      notationDetected: {
        restsDetected: diagnostics.rests?.detectedRestGlyphCount ?? null,
        staccatoDetected: diagnostics.staccato?.detectedStaccatoCount ?? null,
        accentDetected: diagnostics.accent?.detectedAccentCount ?? null,
        articulationsDetected: diagnostics.notationArticulations?.detectedByType ?? null,
        tiesDetected: diagnostics.ties?.detectedTieCount ?? null,
        tabStavesDetected: diagnostics.tablature?.tabStaves ?? null,
      },
      selfReportedQuality: {
        acceptance: diagnostics.acceptance?.acceptance ?? null,
        confidenceBand: diagnostics.acceptance?.confidenceBand ?? null,
        overallConfidence: diagnostics.overallConfidence ?? null,
      },
      pitchOffsetAnalysis: offsets,
      strict,
    })
    process.stderr.write(`baseline: ${id}\n`)
  }

  const valid = records.filter((record) => !record.error && record.engineOutcome === 'transcribed')
  const refused = records.filter((record) => record.engineOutcome === 'refused-or-crashed')
  const collect = (key) =>
    valid.map((record) => record.metrics[key]).filter((value) => Number.isFinite(value))

  const strictValid = valid.filter((record) => record.strict && !record.strict.error)
  const strictMean = (path) =>
    mean(
      strictValid
        .map((record) => path.reduce((value, key) => value?.[key], record.strict))
        .filter(Number.isFinite),
    )
  /**
   * How many scores actually supplied comparable evidence for a metric.
   *
   * A metric with no comparable objects has an accuracy of `null`. Averaging
   * those into a 0% would be a lie of omission: the real 13-score corpus has zero
   * string/fret labels, so "string accuracy 0%" would read as "the engine got
   * every string wrong" when the truth is "this corpus cannot say".
   */
  const strictEvidence = (path) =>
    strictValid.filter((record) => {
      const value = path.reduce((node, key) => node?.[key], record.strict)
      return Number.isFinite(value)
    }).length
  const strictCell = (path) => {
    const evidence = strictEvidence(path)
    return { value: evidence ? strictMean(path) : null, scoresWithEvidence: evidence }
  }


  const summary = {
    scores: records.filter((record) => !record.error).length,
    transcribed: valid.length,
    refused: refused.length,
    // Share of the real corpus on which the engine produces ANY usable output.
    transcriptionSuccessRate: records.filter((record) => !record.error).length
      ? Number((valid.length / records.filter((record) => !record.error).length).toFixed(4))
      : 0,
    pitchAccuracy: { mean: mean(collect('pitchAccuracy')), median: median(collect('pitchAccuracy')) },
    orderSensitivePitchRecovery: {
      mean: mean(collect('orderSensitivePitchRecovery')),
      median: median(collect('orderSensitivePitchRecovery')),
    },
    durationAccuracy: { mean: mean(collect('durationAccuracy')), median: median(collect('durationAccuracy')) },
    onsetAccuracy: { mean: mean(collect('onsetAccuracy')), median: median(collect('onsetAccuracy')) },
    timeAccuracy: { mean: mean(collect('timeAccuracy')), median: median(collect('timeAccuracy')) },
    noteDetectionF1: { mean: mean(collect('noteDetectionF1')), median: median(collect('noteDetectionF1')) },
    chordGroupingAccuracy: {
      mean: mean(collect('chordGroupingAccuracy')),
      median: median(collect('chordGroupingAccuracy')),
    },
    measureCountAccuracy: {
      mean: mean(collect('measureCountAccuracy')),
      median: median(collect('measureCountAccuracy')),
    },
    meanSelfReportedConfidence: mean(
      valid.map((record) => record.selfReportedQuality?.overallConfidence).filter(Number.isFinite),
    ),
    scoresSelfReportedAccepted: valid.filter(
      (record) => record.selfReportedQuality?.acceptance === 'accepted',
    ).length,
    /**
     * Strict, identity-assigned metrics. These supersede the bag numbers above
     * for any product decision: every figure is conditional on having identified
     * the same musical object in both scores.
     */
    strict: {
      scoresScored: strictValid.length,
      noteDetectionF1: strictCell(['detection', 'f1']),
      noteDetectionPrecision: strictCell(['detection', 'precision']),
      noteDetectionRecall: strictCell(['detection', 'recall']),
      endToEndNoteAccuracy: strictCell(['endToEndNoteAccuracy']),
      soundingPitchAccuracy: strictCell(['attributes', 'soundingPitch', 'accuracy']),
      writtenPitchAccuracy: strictCell(['attributes', 'writtenPitch', 'accuracy']),
      onsetAccuracy: strictCell(['attributes', 'onset', 'accuracy']),
      durationAccuracy: strictCell(['attributes', 'duration', 'accuracy']),
      stringAccuracy: strictCell(['attributes', 'string', 'accuracy']),
      fretAccuracy: strictCell(['attributes', 'fret', 'accuracy']),
      voiceAccuracy: strictCell(['attributes', 'voice', 'accuracy']),
      staffAccuracy: strictCell(['attributes', 'staff', 'accuracy']),
      dotsAccuracy: strictCell(['attributes', 'dots', 'accuracy']),
      accidentalsAccuracy: strictCell(['attributes', 'accidentals', 'accuracy']),
      /**
       * Conditional figures answer "when the score actually contains this, does
       * the engine find it". Unconditional accuracy is dominated by the default
       * value for sparse attributes — almost every note has zero dots — and so
       * reads near 100% even when the recogniser finds none.
       */
      dotsAccuracyWhenDotted: strictCell(['attributes', 'dots', 'conditionalAccuracy']),
      tupletAccuracyWhenPresent: strictCell(['attributes', 'tuplet', 'conditionalAccuracy']),
      accidentalsAccuracyWhenPresent: strictCell([
        'attributes',
        'accidentals',
        'conditionalAccuracy',
      ]),
      tabConsistencyGenerated: strictCell(['tabConsistency', 'generatedRate']),
    },
  }

  const baseline = {
    version: 2,
    kind: 'guitar-vision-phase0-corpus-baseline',
    engine: 'heuristic-js-omr (pre-Guitar-Vision)',
    corpus: {
      source: 'public/fixtures/practice-library (Mutopia / public domain real guitar scores)',
      scoreCount: REAL_GUITAR_CORPUS.length,
      domain: 'vector PDF -> MusicXML',
      staffType: 'standard 5-line notation only; no TAB scores in this corpus',
    },
    caveat:
      'These numbers measure the EXISTING heuristic engine, not Guitar Vision. ' +
      'They are the floor that a learned model must beat to justify shipping.',
    summary,
    scores: records,
  }

  writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`)

  console.log('')
  console.log('Guitar Vision — Phase 0 corpus baseline (existing heuristic engine)')
  console.log('='.repeat(72))
  console.log(`scores: ${summary.scores}  transcribed: ${summary.transcribed}  refused: ${summary.refused}`)
  console.log(
    `transcription success rate: ${(summary.transcriptionSuccessRate * 100).toFixed(1)}% of real guitar scores`,
  )
  console.log('')
  const rows = [
    ['pitch accuracy', summary.pitchAccuracy],
    ['order-sensitive pitch', summary.orderSensitivePitchRecovery],
    ['duration', summary.durationAccuracy],
    ['onset', summary.onsetAccuracy],
    ['onset TIME', summary.timeAccuracy],
    ['note detection F1', summary.noteDetectionF1],
    ['chord grouping', summary.chordGroupingAccuracy],
    ['measure count', summary.measureCountAccuracy],
  ]
  console.log(`  ${'metric'.padEnd(24)}${'mean'.padStart(9)}${'median'.padStart(9)}`)
  console.log('  ' + '-'.repeat(42))
  for (const [label, value] of rows) {
    console.log(
      `  ${label.padEnd(24)}${(value.mean * 100).toFixed(1).padStart(8)}%${(value.median * 100).toFixed(1).padStart(8)}%`,
    )
  }
  console.log('')
  console.log(`  self-reported confidence:  ${(summary.meanSelfReportedConfidence * 100).toFixed(1)}% mean`)
  console.log(`  scores accepted as good:   ${summary.scoresSelfReportedAccepted}/${summary.scores}`)
  console.log('')
  console.log('  STRICT per-object metrics (identity-assigned; supersede the bag numbers above)')
  console.log(`  scored ${summary.strict.scoresScored}/${summary.scores} scores`)
  console.log('  ' + '-'.repeat(52))
  const strictRows = [
    ['note detection F1', summary.strict.noteDetectionF1],
    ['detection precision', summary.strict.noteDetectionPrecision],
    ['detection recall', summary.strict.noteDetectionRecall],
    ['end-to-end note acc', summary.strict.endToEndNoteAccuracy],
    ['sounding pitch', summary.strict.soundingPitchAccuracy],
    ['written pitch', summary.strict.writtenPitchAccuracy],
    ['onset', summary.strict.onsetAccuracy],
    ['duration', summary.strict.durationAccuracy],
    ['accidentals', summary.strict.accidentalsAccuracy],
    ['accidentals (when present)', summary.strict.accidentalsAccuracyWhenPresent],
    ['dots', summary.strict.dotsAccuracy],
    ['dots (when present)', summary.strict.dotsAccuracyWhenDotted],
    ['tuplet (when present)', summary.strict.tupletAccuracyWhenPresent],
    ['string', summary.strict.stringAccuracy],
    ['fret', summary.strict.fretAccuracy],
    ['voice', summary.strict.voiceAccuracy],
    ['staff', summary.strict.staffAccuracy],
    ['TAB consistency', summary.strict.tabConsistencyGenerated],
  ]
  for (const [label, cell] of strictRows) {
    // "n/a" means this corpus supplies no comparable evidence, which is a data
    // gap to report, not a zero to average in.
    const shown =
      cell.value == null
        ? `n/a (${cell.scoresWithEvidence} scores)`
        : `${(cell.value * 100).toFixed(1)}% (${cell.scoresWithEvidence} scores)`
    console.log(`  ${label.padEnd(24)}${shown.padStart(28)}`)
  }
  console.log('')
  console.log('  per-score dominant systematic pitch offset:')
  for (const record of valid) {
    const offset = record.pitchOffsetAnalysis
    if (!offset) continue
    console.log(
      `    ${record.id.padEnd(32)} offset ${String(offset.dominantOffset).padStart(4)}` +
        ` -> ${(offset.dominantOffsetShare * 100).toFixed(1).padStart(5)}% of notes`,
    )
  }
  if (refused.length) {
    console.log('')
    console.log('  scores the engine refused to transcribe at all:')
    for (const record of refused) console.log(`    ${record.id}`)
  }
  console.log('')
  console.log(`Wrote ${outPath}`)
}

main()
