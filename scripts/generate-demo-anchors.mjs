/**
 * Writes bundled demo score-follow anchors for Minuet in G (Mutopia PDF, 1 page).
 * Run: npm run fixtures:anchors  (or npm run fixtures)
 *
 * Strategy: per-measure anchors derived directly from PDF bar-line positions extracted
 * with PyMuPDF (see scripts/extract-pdf-barlines.py). The PDF has SIX grand-staff
 * systems (not four as the original estimate assumed). Measure counts per system:
 *   sys 0: M1-5   sys 1: M6-10   sys 2: M11-16
 *   sys 3: M17-21 sys 4: M22-26  sys 5: M27-32
 *
 * x values are the normalised x-position of the START barline of each measure.
 * y values are the mid-point of the grand staff (between treble top and bass bottom).
 * Both are normalised to [0,1] over the page dimensions (595.3 × 841.9 pt, A4).
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_PIECE, FIXTURE_FILENAMES } from '../src/dev/fixturePaths.js'
import { buildBundledAnchorsFromManualSystems } from '../src/features/score-follow/demoAnchorCalibration.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDir = join(root, 'public', 'fixtures')
const outPath = join(fixturesDir, 'demo-minuet-in-g.anchors.json')

/**
 * Six systems extracted from PDF staff-line and bar-line analysis (PyMuPDF).
 * Page dimensions: w=595.3, h=841.9 pts (A4).
 *
 * Each entry: { systemIndex, y (normalised grand-staff midpoint), endX, measures: [{ n, x }] }
 * x = normalised x of the START of that measure (left barline or staff left edge).
 * endX = normalised x of the final visible barline / system right edge.
 */
const SYSTEMS = [
  {
    systemIndex: 0,
    y: 0.1631,
    endX: 0.9515,
    measures: [
      { n: 1, x: 0.1194 },
      { n: 2, x: 0.3563 },
      { n: 3, x: 0.4942 },
      { n: 4, x: 0.6548 },
      { n: 5, x: 0.7911 },
    ],
  },
  {
    systemIndex: 1,
    y: 0.2937,
    endX: 0.9515,
    measures: [
      { n: 6, x: 0.0480 },
      { n: 7, x: 0.2792 },
      { n: 8, x: 0.4443 },
      { n: 9, x: 0.6305 },
      { n: 10, x: 0.8023 },
    ],
  },
  {
    systemIndex: 2,
    y: 0.4242,
    endX: 0.9499,
    measures: [
      { n: 11, x: 0.0480 },
      { n: 12, x: 0.2493 },
      { n: 13, x: 0.3933 },
      { n: 14, x: 0.5404 },
      { n: 15, x: 0.6903 },
      { n: 16, x: 0.8401 },
    ],
  },
  {
    systemIndex: 3,
    y: 0.5547,
    endX: 0.9515,
    measures: [
      { n: 17, x: 0.1132 },
      { n: 18, x: 0.2814 },
      { n: 19, x: 0.4415 },
      { n: 20, x: 0.6039 },
      { n: 21, x: 0.7684 },
    ],
  },
  {
    systemIndex: 4,
    y: 0.6902,
    endX: 0.9515,
    measures: [
      { n: 22, x: 0.0480 },
      { n: 23, x: 0.2701 },
      { n: 24, x: 0.4351 },
      { n: 25, x: 0.5989 },
      { n: 26, x: 0.7753 },
    ],
  },
  {
    systemIndex: 5,
    y: 0.8259,
    endX: 0.9499,
    measures: [
      { n: 27, x: 0.0480 },
      { n: 28, x: 0.2320 },
      { n: 29, x: 0.3815 },
      { n: 30, x: 0.5444 },
      { n: 31, x: 0.6730 },
      { n: 32, x: 0.8136 },
    ],
  },
]

function main() {
  const payload = buildBundledAnchorsFromManualSystems(SYSTEMS, {
    pieceId: DEMO_PIECE.id,
    pdfFile: FIXTURE_FILENAMES.pdf,
    timingFile: FIXTURE_FILENAMES.musicXml,
    calibrated: 'pymupdf-barline',
    alignmentNote:
      'Bundled demo anchors for Minuet in G: 32 per-measure positions extracted from ' +
      'the actual PDF using PyMuPDF bar-line detection (6 systems, not 4). ' +
      'System-end metadata is included so the cursor can glide through the final measure of each staff. ' +
      'Loaded only for the sample piece; never saved to user localStorage.',
  })

  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`Wrote ${payload.anchors.length} per-measure demo anchors → ${outPath}`)
}

main()
