#!/usr/bin/env node
/**
 * Export barline candidate crops from alignment benchmark corpus PDFs.
 *
 * Usage:
 *   node scripts/export-barline-dataset.mjs
 *   node scripts/export-barline-dataset.mjs --all --download
 *   node scripts/export-barline-dataset.mjs --dry-run --json /tmp/manifest.json
 *   node scripts/export-barline-dataset.mjs --piece minuet-in-g,synthetic-dense
 *
 * See docs/barline-dataset.md
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../src/features/score-follow/alignmentBenchmark.js'
import { exportBarlineDataset } from './lib/barlineDatasetExport.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultManifest = join(root, 'benchmarks/alignment-corpus.manifest.json')
const defaultOut = join(root, 'datasets/barline-training')

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

async function main() {
  const args = process.argv.slice(2)
  const manifestPath = argValue(args, '--manifest') ?? defaultManifest
  const outDir = argValue(args, '--out') ?? defaultOut
  const jsonOut = argValue(args, '--json')
  const ciOnly = hasFlag(args, '--ci-only') || !hasFlag(args, '--all')
  const download = hasFlag(args, '--download')
  const dryRun = hasFlag(args, '--dry-run')
  const includeMargin = hasFlag(args, '--include-margin')
  const maxPerSystem = Number(argValue(args, '--max-per-system') ?? 48)
  const pieceArg = argValue(args, '--piece')
  const pieceIds = pieceArg ? pieceArg.split(',').map((s) => s.trim()).filter(Boolean) : null

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const validation = validateManifest(manifest)
  if (!validation.ok) {
    console.error('Invalid corpus manifest:\n  - ' + validation.errors.join('\n  - '))
    process.exit(1)
  }

  console.log(
    `Exporting barline dataset${dryRun ? ' (dry-run)' : ''} → ${outDir}${ciOnly ? ' [CI subset]' : ''}…`,
  )

  const result = await exportBarlineDataset(manifest, root, outDir, {
    ciOnly,
    download,
    dryRun,
    maxPerSystem,
    includeMargin,
    pieceIds,
  })

  const exported = result.samples.length
  const skipped = result.pieces.filter((p) => p.status === 'skipped').length
  console.log(`Samples: ${exported} | pieces ok: ${result.pieces.filter((p) => p.status === 'ok').length} | skipped: ${skipped}`)

  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`)
    console.log(`Wrote manifest JSON → ${jsonOut}`)
  }

  if (exported === 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
