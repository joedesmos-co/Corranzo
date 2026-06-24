#!/usr/bin/env node
/**
 * Merge barline label JSON files (e.g. from the static labeler) into one labels.json.
 *
 * Usage:
 *   node scripts/merge-barline-labels.mjs datasets/barline-training/labels.json partial.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { mergeBarlineLabels, validateBarlineLabelsFile } from '../src/features/score-follow/barlineDataset.js'

const targetPath = process.argv[2]
const sourcePaths = process.argv.slice(3)

if (!targetPath || sourcePaths.length === 0) {
  console.error('Usage: node scripts/merge-barline-labels.mjs <labels.json> <partial.json> [...]')
  process.exit(1)
}

let existing = { version: 1, labels: {} }
try {
  existing = JSON.parse(readFileSync(targetPath, 'utf8'))
} catch {
  // start fresh
}

let merged = existing
for (const path of sourcePaths) {
  const partial = JSON.parse(readFileSync(path, 'utf8'))
  const incoming = partial.labels ?? partial
  merged = mergeBarlineLabels(merged, incoming)
}

const validation = validateBarlineLabelsFile(merged)
if (!validation.ok) {
  console.error('Invalid merged labels:\n  - ' + validation.errors.join('\n  - '))
  process.exit(1)
}

writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`)
console.log(`Merged ${Object.keys(merged.labels).length} labels → ${targetPath}`)
