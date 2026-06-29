#!/usr/bin/env node
/**
 * Summarize pitch-error buckets from OMR accuracy JSON reports.
 *
 * Usage:
 *   node scripts/analyze-omr-pitch-errors.mjs --report tmp/before-dense.json --out tmp/pitch-errors.json
 *   node scripts/analyze-omr-pitch-errors.mjs --before before.json --after after.json --out comparison.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { summarizePitchErrors } from '../src/features/omr/omrPitchErrorAnalysis.js'

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function readReport(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'))
  return {
    path,
    title: report.summary?.generatedTitle ?? report.summary?.groundTruthTitle ?? path,
    metrics: report.metrics ?? {},
    totals: report.totals ?? {},
    analysis: summarizePitchErrors(report.debug?.wrongPitches ?? []),
  }
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
}

function main() {
  const args = process.argv.slice(2)
  const reportPath = argValue(args, '--report')
  const beforePath = argValue(args, '--before')
  const afterPath = argValue(args, '--after')
  const outPath = argValue(args, '--out')

  if (!outPath) {
    throw new Error('Provide --out <path.json>')
  }

  let payload
  if (reportPath) {
    payload = readReport(reportPath)
  } else if (beforePath && afterPath) {
    const before = readReport(beforePath)
    const after = readReport(afterPath)
    payload = {
      before: {
        title: before.title,
        metrics: before.metrics,
        totals: before.totals,
        pitchErrors: before.analysis,
      },
      after: {
        title: after.title,
        metrics: after.metrics,
        totals: after.totals,
        pitchErrors: after.analysis,
      },
      delta: {
        pitchAccuracy: (after.metrics.pitchAccuracy ?? 0) - (before.metrics.pitchAccuracy ?? 0),
        wrongPitches: (after.totals.wrongPitches ?? 0) - (before.totals.wrongPitches ?? 0),
        onsetAccuracy: (after.metrics.onsetAccuracy ?? 0) - (before.metrics.onsetAccuracy ?? 0),
        durationAccuracy: (after.metrics.durationAccuracy ?? 0) - (before.metrics.durationAccuracy ?? 0),
      },
    }
  } else {
    throw new Error('Provide --report <json> or --before/--after pair.')
  }

  ensureParent(outPath)
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.error(`Wrote ${outPath}`)
}

main()
