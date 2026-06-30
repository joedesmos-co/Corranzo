#!/usr/bin/env node
/**
 * Categorize wrong-duration mismatches from OMR accuracy JSON reports.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { categorizeDurationError } from '../src/features/omr/omrDurationErrorAnalysis.js'

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
}

function readReport(path, exampleLimit = 99999) {
  const report = JSON.parse(readFileSync(path, 'utf8'))
  return {
    path,
    metrics: report.metrics ?? {},
    totals: report.totals ?? {},
    wrongDurations: report.debug?.wrongDurations ?? [],
    truncated: report.debug?.truncated?.wrongDurations ?? 0,
    exampleLimit: report.options?.exampleLimit ?? 40,
  }
}

function summarizeWrongDurations(entries = []) {
  const histogram = {}
  const signed = {}
  for (const entry of entries) {
    const delta = Number(entry.durationDiffQuarters) || 0
    const category = categorizeDurationError(entry)
    histogram[category] = (histogram[category] ?? 0) + 1
    const key = String(Math.round(delta * 100) / 100)
    signed[key] = (signed[key] ?? 0) + 1
  }
  return {
    total: entries.length,
    histogram,
    signed,
    sample: entries.slice(0, 40).map((entry) => ({
      m: entry.measureNumber,
      d: entry.durationDiffQuarters,
      truth: `${entry.truth?.label ?? '?'}@${entry.truth?.onsetQuarters ?? '?'}/${entry.truth?.durationQuarters ?? '?'}`,
      gen: `${entry.generated?.label ?? '?'}@${entry.generated?.onsetQuarters ?? '?'}/${entry.generated?.durationQuarters ?? '?'}`,
      pitchDelta: entry.pitchDeltaSemitones ?? 0,
      onsetDelta: entry.onsetDiffQuarters ?? 0,
    })),
  }
}

async function main() {
  const args = process.argv.slice(2)
  const reportPath = argValue(args, '--report')
  const outPath = argValue(args, '--out')
  if (!reportPath || !outPath) {
    throw new Error('Usage: node scripts/analyze-omr-duration-errors.mjs --report <json> --out <json>')
  }

  const report = readReport(reportPath)
  const payload = {
    path: reportPath,
    metrics: report.metrics,
    totals: report.totals,
    truncatedWrongDurations: report.truncated,
    analysis: summarizeWrongDurations(report.wrongDurations),
  }
  ensureParent(outPath)
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.error(`Wrote ${outPath}`)
  console.log(JSON.stringify(payload.analysis, null, 2))
}

main()
