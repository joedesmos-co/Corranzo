#!/usr/bin/env node
/** Count SMuFL rest glyphs in PDF text layers for the campaign sources. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { makePdfTextExtractor } from '../../scripts/lib/renderPdfPages.mjs'

const DOWNLOADS = homedir() + '/Downloads'
const FIXTURES = 'benchmarks/omr-fixtures'

const SOURCES = [
  ['minecraft', join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.pdf'), 1],
  ['evangelion', join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'), 1],
  ['gymnopedie', join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'), 1],
  ['piano-articulation-scan', join(FIXTURES, 'piano-articulation-scan/piano-articulation-scan.pdf'), 1],
  ['piano-grand-voices-vector', join(FIXTURES, 'piano-grand-voices-vector/piano-grand-voices-vector.pdf'), 1],
  ['piano-rhythm-tuplets-vector', join(FIXTURES, 'piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf'), 1],
  ['piano-dense-advanced-vector', join(FIXTURES, 'piano-dense-advanced-vector/piano-dense-advanced-vector.pdf'), 1],
  ['la-campanella', join(DOWNLOADS, 'etude-s-1413-in-g-minor-la-campanella-liszt.pdf'), 2],
  ['fantaisie-impromptu', join(DOWNLOADS, 'fantaisie-impromptu-in-c-minor-chopin.pdf'), 2],
  ['moonlight-3', join(DOWNLOADS, 'sonate-no-14-moonlight-3rd-movement.pdf'), 2],
  ['hungarian-dance-no5', join(DOWNLOADS, 'hungarian-dance-no5.pdf'), 2],
  ['carol-of-the-bells', join(DOWNLOADS, 'carol-of-the-bells.pdf'), 2],
]

// SMuFL rests: E4E1 longa..E4E7 32nd (detector supports E4E3..E4E7)
const REST_RANGE_START = 0xe4e0
const REST_RANGE_END = 0xe4ef
const SUPPORTED = new Set(['\ue4e3', '\ue4e4', '\ue4e5', '\ue4e6', '\ue4e7'])

for (const [id, pdfPath, pages] of SOURCES) {
  const counts = new Map()
  let supported = 0
  let unsupported = 0
  const extract = await makePdfTextExtractor(pdfPath)
  for (let page = 1; page <= pages; page += 1) {
    const items = await extract(null, page).catch(() => [])
    for (const item of items) {
      for (const char of item.text ?? '') {
        const code = char.codePointAt(0)
        if (code >= REST_RANGE_START && code <= REST_RANGE_END) {
          const label = 'U+' + code.toString(16).toUpperCase()
          counts.set(label, (counts.get(label) ?? 0) + 1)
          if (SUPPORTED.has(char)) supported += 1
          else unsupported += 1
        }
      }
    }
  }
  console.log(
    id.padEnd(30),
    'supported:', String(supported).padStart(4),
    'unsupported:', String(unsupported).padStart(3),
    counts.size ? JSON.stringify(Object.fromEntries([...counts].sort())) : '(none)',
  )
}
process.exit(0)
