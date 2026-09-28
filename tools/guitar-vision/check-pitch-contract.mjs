#!/usr/bin/env node
/**
 * Guitar Vision — pitch-contract conformance audit.
 *
 * Checks every guitar score in the repository against the frozen
 * written-pitch/sounding-pitch contract, so a convention drift is visible
 * immediately rather than showing up later as an unexplained accuracy cliff.
 *
 * Usage:
 *   node tools/guitar-vision/check-pitch-contract.mjs
 *   node tools/guitar-vision/check-pitch-contract.mjs --json out.json
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { validateGuitarMusicXml } from '../../src/features/omr/guitar/pitchContract.js'

function argValue(args, flag, fallback) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : fallback
}

function walk(root, out = [], depth = 0) {
  if (depth > 8) return out
  let entries = []
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue
    const full = join(root, name)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) walk(full, out, depth + 1)
    else if (/\.(musicxml|xml)$/i.test(name)) out.push(full)
  }
  return out
}

function isGuitarScore(xml) {
  return /<part-name>([^<]*)<\/part-name>/i.test(xml) && /guitar|tab|lute|guitarra/i.test(xml)
}

/** OMR output is machine-written; its provenance is what we are auditing. */
function looksGenerated(xml) {
  return /Generated from PDF/.test(xml) || /<identification>/.test(xml) === false
}

const args = process.argv.slice(2)
const root = argValue(args, '--root', process.cwd())
const jsonOut = argValue(args, '--json', null)

const files = walk(root)
const rows = []

for (const file of files) {
  let xml = ''
  try {
    xml = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (!xml.includes('<score-partwise')) continue
  if (!isGuitarScore(xml)) continue
  const report = validateGuitarMusicXml(xml)
  rows.push({
    file: relative(root, file),
    generated: looksGenerated(xml),
    ok: report.ok,
    violationCount: report.violations.length,
    rules: [...new Set(report.violations.map((violation) => violation.rule))],
  })
}

const groundTruth = rows.filter((row) => !row.generated)
const generated = rows.filter((row) => row.generated)
const failingTruth = groundTruth.filter((row) => !row.ok)
const failingGenerated = generated.filter((row) => !row.ok)

console.log('Guitar Vision — pitch-contract conformance')
console.log('='.repeat(72))
console.log(`guitar scores audited:        ${rows.length}`)
console.log(`ground truth:                ${groundTruth.length} (${failingTruth.length} non-conforming)`)
console.log(`OMR-generated:               ${generated.length} (${failingGenerated.length} non-conforming)`)
console.log('')

if (failingTruth.length) {
  console.log('GROUND TRUTH VIOLATIONS (these are the labels a model would learn from):')
  for (const row of failingTruth) {
    console.log(`  ${row.file}  [${row.rules.join(', ')}]`)
  }
  console.log('')
} else {
  console.log('All ground truth conforms to guitar-pitch/1.0 (sounding pitch in <pitch>).')
  console.log('')
}

if (failingGenerated.length) {
  console.log(`OMR OUTPUT VIOLATIONS (${failingGenerated.length} of ${generated.length}):`)
  const ruleTally = new Map()
  for (const row of failingGenerated) {
    for (const rule of row.rules) ruleTally.set(rule, (ruleTally.get(rule) ?? 0) + 1)
  }
  for (const [rule, count] of [...ruleTally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)} x ${rule}`)
  }
  console.log('')
  console.log('  examples:')
  for (const row of failingGenerated.slice(0, 8)) {
    console.log(`    ${row.file}`)
  }
} else {
  console.log('All OMR-generated guitar scores conform.')
}

if (jsonOut) {
  writeFileSync(jsonOut, `${JSON.stringify({ root, rows }, null, 2)}\n`)
  console.log('')
  console.log(`Wrote ${jsonOut}`)
}
