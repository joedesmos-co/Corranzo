#!/usr/bin/env node
/**
 * PDMX pilot candidate builder.
 *
 * Joins streamed MXL files with their PDMX.csv rows (license + composer
 * evidence) and emits ingest candidates for the license-cleared,
 * PD-composer subset only.
 *
 * Usage:
 *   node tools/guitar-vision/pdmx-pilot-candidates.mjs --mxl <dir> --out <candidates.json>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const LICENSE_MAP = { 'cc-zero': 'CC0-1.0', 'publicdomain': 'public-domain' }

const args = process.argv.slice(2)
const get = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}

const mxlDir = resolve(ROOT, get('--mxl', '/tmp/pdmx/mxl'))
const outPath = resolve(ROOT, get('--out', 'tools/guitar-vision/dataset-pdmx-candidates.json'))
const eligiblePath = resolve(ROOT, get('--eligible', '/tmp/pdmx/guitar_eligible.json'))

const eligible = JSON.parse(readFileSync(eligiblePath, 'utf8'))
const byMember = new Map()
for (const row of eligible) {
  const member = String(row.mxl || '').replace(/^\.\//, '')
  byMember.set(member.split('/').pop(), row)
}

const candidates = []
const skipped = []
for (const [file, row] of byMember) {
  const local = join(mxlDir, file)
  if (!existsSync(local)) {
    skipped.push(file)
    continue
  }
  const license = LICENSE_MAP[String(row.license || '').toLowerCase()] ?? null
  if (!license) {
    skipped.push(`${file} (license ${row.license})`)
    continue
  }
  candidates.push({
    id: `pdmx-${file.replace(/\.mxl$/, '').slice(0, 12)}`,
    path: `/tmp/pdmx/mxl/${file}`,
    collection: 'pdmx-guitar',
    license,
    provenance: 'real-printed',
    tier: 'real',
    pdmx: {
      title: row.title,
      composer: row.composer,
      artist: row.artist,
      licenseDeclared: row.license,
      genres: row.genres,
      member: row.mxl,
    },
  })
}

writeFileSync(outPath, JSON.stringify(candidates, null, 1))
console.log(`candidates: ${candidates.length}, missing/unlicensed: ${skipped.length}`)
