/**
 * Writes bundled demo score-follow anchors for Minuet in G (Mutopia PDF, 1 page).
 * Run: npm run fixtures:anchors  (or npm run fixtures)
 *
 * Strategy: per-measure anchors from MusicXML timing + Mutopia system bands.
 * Duration-weighted x within each staff system (not even spacing by measure count).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { DEMO_PIECE } from '../src/dev/fixturePaths.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'
import { buildTimingMeasureAnchorsForBands } from './timingMeasureAnchors.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDir = join(root, 'public', 'fixtures')
const xmlPath = join(fixturesDir, 'demo-minuet-in-g.musicxml')
const outPath = join(fixturesDir, 'demo-minuet-in-g.anchors.json')

/** Four systems × eight measures — Mutopia single-page minuet layout. */
const MUTOPIA_MINUET_SYSTEMS = [
  { page: 1, y: 0.31, yEnd: 0.34, measureStart: 1, measureEnd: 8, systemIndex: 0 },
  { page: 1, y: 0.45, yEnd: 0.48, measureStart: 9, measureEnd: 16, systemIndex: 1 },
  { page: 1, y: 0.59, yEnd: 0.62, measureStart: 17, measureEnd: 24, systemIndex: 2 },
  { page: 1, y: 0.73, yEnd: 0.76, measureStart: 25, measureEnd: 32, systemIndex: 3 },
]

function main() {
  const xml = readFileSync(xmlPath, 'utf8')
  const timingMap = parseMusicXml(xml, 'demo-minuet-in-g.musicxml')
  const anchors = buildTimingMeasureAnchorsForBands(timingMap, MUTOPIA_MINUET_SYSTEMS, {
    source: ANCHOR_SOURCE.DEMO,
    meta: { calibrated: 'mutopia-a4', bundled: true },
  })

  const payload = {
    version: 1,
    pieceId: DEMO_PIECE.id,
    pdfFile: 'Minuet in G.pdf',
    timingFile: 'Minuet in G.musicxml',
    generatedAt: new Date().toISOString(),
    alignmentNote:
      'Bundled demo anchors for Minuet in G: 32 per-measure positions from MusicXML timing ' +
      'and Mutopia staff-system bands (duration-weighted horizontal placement). ' +
      'Loaded only for the sample piece; never saved to user localStorage.',
    anchors,
  }

  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`Wrote ${anchors.length} per-measure demo anchors → ${outPath}`)
}

main()
