#!/usr/bin/env node
/**
 * Write Piano Realism Sprint 1 audio-benchmark report (renderer only).
 * Usage: node scripts/piano-realism-benchmark.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tmp/piano-realism-sprint-1')

async function main() {
  const { runAllPianoAudioFixtures } = await import(
    pathToFileURL(join(root, 'src/features/playback/pianoAudioBenchmark.js')).href
  )
  const { __resetSharedPianoBuffers } = await import(
    pathToFileURL(join(root, 'src/features/playback/pianoInstrument.js')).href
  )
  __resetSharedPianoBuffers()
  const suite = await runAllPianoAudioFixtures()
  await mkdir(outDir, { recursive: true })
  const jsonPath = join(outDir, 'audio-benchmark.json')
  await writeFile(jsonPath, `${JSON.stringify(suite, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${jsonPath}`)
  console.log(JSON.stringify(suite.summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
