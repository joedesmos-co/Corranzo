#!/usr/bin/env node
/**
 * Probe Notation Fidelity cases against generated OMR MusicXML for artic-scan.
 * Usage: node scripts/notation-fidelity-probe.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tmp/notation-fidelity-sprint-1')

async function main() {
  const { parseMusicXml } = await import(
    pathToFileURL(join(root, 'src/features/musicxml/parseMusicXml.js')).href
  )
  const {
    extractNotationSymbolsFromNotes,
    scoreNotationFidelityCase,
    summarizeNotationFidelityResults,
  } = await import(
    pathToFileURL(join(root, 'src/features/omr/omrNotationFidelityQuality.js')).href
  )

  const cases = JSON.parse(
    await readFile(join(root, 'benchmarks/omr-notation-fidelity-validation/cases.json'), 'utf8'),
  ).cases

  const generatedPath = join(outDir, 'artic-scan-after.musicxml')
  let generatedXml
  try {
    generatedXml = await readFile(generatedPath, 'utf8')
  } catch {
    generatedXml = await readFile(join(outDir, 'artic-scan-before.musicxml'), 'utf8')
  }

  const timing = parseMusicXml(generatedXml, 'generated.musicxml')
  const symbols = extractNotationSymbolsFromNotes(timing.notes)
  const automatable = cases.filter(
    (entry) => entry.source === 'piano-articulation-scan' && entry.status !== 'manual-pending',
  )
  const results = automatable.map((entry) => scoreNotationFidelityCase(entry, symbols))
  const summary = summarizeNotationFidelityResults(results)

  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'case-scores.json'), `${JSON.stringify({ summary, results }, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
