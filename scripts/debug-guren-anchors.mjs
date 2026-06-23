/**
 * Guren visual-anchor trace.
 *
 * Builds per-measure visual anchors two ways and prints the compact debug table
 * (page, systemIndex, measure, xSource, measureStartX, playableStartX,
 * playableEndX, x, nearest barline, error):
 *
 *   A) MusicXML system-break allocation  — what falls out when detected barline
 *      counts are NOT usable (Guren's MusicXML breaks disagree with the print).
 *   B) Printed per-system counts          — the real PDF layout (page 1: 1,6,11,
 *      15,19; page 2: 23,27,31,35,38,41 …), via allocateSpansByCounts.
 *
 * Run: node scripts/debug-guren-anchors.mjs [path-to-mxl]
 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildPerMeasureSystemAnchors } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  allocateSpansByCounts,
  groupMeasuresBySystemBreaks,
} from '../src/features/score-follow/allocateMeasuresToSystems.js'
import { buildAnchorDebugTable } from '../src/features/score-follow/scoreFollowDebug.js'

const DEFAULTS = [
  'uploads/attack-on-titan-opening-1-guren-no-yumiya.mxl',
  '/sessions/gallant-jolly-hypatia/mnt/uploads/attack-on-titan-opening-1-guren-no-yumiya.mxl',
]

// Printed system starts the user verified from the actual PDF.
const PRINTED_STARTS = [1, 6, 11, 15, 19, 23, 27, 31, 35, 38, 41]

async function readXml(filePath) {
  const buf = fs.readFileSync(filePath)
  if (!filePath.toLowerCase().endsWith('.mxl')) {
    return buf.toString('utf8')
  }
  const zip = await JSZip.loadAsync(buf)
  let rootPath = Object.keys(zip.files).find(
    (p) => p.toLowerCase().endsWith('.xml') && !p.startsWith('__MACOSX') && !/container/i.test(p),
  )
  const container = zip.file('META-INF/container.xml')
  if (container) {
    const xml = await container.async('string')
    const m = xml.match(/full-path="([^"]+)"/)
    if (m) rootPath = m[1]
  }
  return zip.file(rootPath).async('string')
}

function syntheticEntries(count) {
  const bounds = { x0: 0.06, x1: 0.96 }
  return Array.from({ length: count }, (_, i) => ({
    page: i < 5 ? 1 : 2,
    imageData: null,
    contentBounds: bounds,
    system: { y0: 0.1 + (i % 5) * 0.16, y1: 0.16 + (i % 5) * 0.16, center: 0.13 + (i % 5) * 0.16 },
  }))
}

function startsOf(spans) {
  return spans.map((s) => s.measureStart)
}

async function main() {
  const filePath = process.argv[2] || DEFAULTS.find((p) => fs.existsSync(p))
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('No Guren score found. Pass a path: node scripts/debug-guren-anchors.mjs <file>')
    process.exit(1)
  }
  const timingMap = parseMusicXml(await readXml(filePath), path.basename(filePath))
  const measureNumbers = timingMap.measures.map((m) => m.number)

  // A) MusicXML system-break allocation.
  const breakGroups = groupMeasuresBySystemBreaks(measureNumbers, timingMap)
  const breakSpans = breakGroups.map((g, i) => ({
    systemIndex: i,
    page: i < 5 ? 1 : 2,
    measureStart: g[0],
    measureEnd: g.at(-1),
    measuresInSpan: g.length,
    measureNumbers: g,
  }))

  // B) Printed per-system counts → allocateSpansByCounts.
  const printedCounts = PRINTED_STARTS.map((start, i) => {
    const end = i + 1 < PRINTED_STARTS.length ? PRINTED_STARTS[i + 1] - 1 : measureNumbers.at(-1)
    return end - start + 1
  })
  const printedEntries = syntheticEntries(PRINTED_STARTS.length)
  const printedSpans = allocateSpansByCounts(printedEntries, measureNumbers, printedCounts)

  console.log('Score:', filePath, '| measures:', measureNumbers.length)
  console.log('\nMusicXML system-break starts :', JSON.stringify(startsOf(breakSpans)))
  console.log('Printed   system starts      :', JSON.stringify(PRINTED_STARTS))
  console.log('allocateSpansByCounts starts :', JSON.stringify(startsOf(printedSpans)))
  console.log(
    'match printed?               :',
    JSON.stringify(startsOf(printedSpans)) === JSON.stringify(PRINTED_STARTS),
  )

  const breakAnchors = buildPerMeasureSystemAnchors(syntheticEntries(breakSpans.length), breakSpans, timingMap)
  const printedAnchors = buildPerMeasureSystemAnchors(printedEntries, printedSpans, timingMap)

  console.log('\n=== A) anchors via MusicXML breaks (WRONG for Guren) — first 14 ===')
  console.log(buildAnchorDebugTable(breakAnchors.slice(0, 14)).text)

  console.log('\n=== B) anchors via printed per-system counts (CORRECT layout) — first 14 ===')
  console.log(buildAnchorDebugTable(printedAnchors.slice(0, 14)).text)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
