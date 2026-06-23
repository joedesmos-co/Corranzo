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
import { DEMO_PIECE } from '../src/dev/fixturePaths.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'

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
    y: 0.1631, // mid of treble(103.2-124.1) + bass(150.5-171.5) = 137.35/841.9
    endX: 0.9515, // final barline at 566.4/595.3
    measures: [
      { n: 1,  x: 0.1194 }, // staff left edge after clef/key/time = 71.1/595.3
      { n: 2,  x: 0.3563 }, // barline at 212.1
      { n: 3,  x: 0.4942 }, // barline at 294.2
      { n: 4,  x: 0.6548 }, // barline at 389.8
      { n: 5,  x: 0.7911 }, // barline at 470.9
    ],
  },
  {
    systemIndex: 1,
    y: 0.2937, // 247.3/841.9
    endX: 0.9515, // final barline at 566.4/595.3
    measures: [
      { n: 6,  x: 0.0480 }, // staff left = 28.6
      { n: 7,  x: 0.2792 }, // 166.2
      { n: 8,  x: 0.4443 }, // 264.5
      { n: 9,  x: 0.6305 }, // 375.3
      { n: 10, x: 0.8023 }, // 477.6
    ],
  },
  {
    systemIndex: 2,
    y: 0.4242, // 357.1/841.9
    endX: 0.9499, // double bar right edge at 565.4/595.3
    measures: [
      { n: 11, x: 0.0480 }, // 28.6
      { n: 12, x: 0.2493 }, // 148.4
      { n: 13, x: 0.3933 }, // 234.1
      { n: 14, x: 0.5404 }, // 321.7
      { n: 15, x: 0.6903 }, // 410.9
      { n: 16, x: 0.8401 }, // 500.1 (section A ends with double bar at 561.9/565.4)
    ],
  },
  {
    systemIndex: 3,
    y: 0.5547, // 467.0/841.9
    endX: 0.9515, // final barline at 566.4/595.3
    measures: [
      { n: 17, x: 0.1132 }, // 67.4 (after repeat-open bar at 63.9/67.4)
      { n: 18, x: 0.2814 }, // 167.5
      { n: 19, x: 0.4415 }, // 262.8
      { n: 20, x: 0.6039 }, // 359.5
      { n: 21, x: 0.7684 }, // 457.4
    ],
  },
  {
    systemIndex: 4,
    y: 0.6902, // 581.1/841.9
    endX: 0.9515, // final barline at 566.4/595.3
    measures: [
      { n: 22, x: 0.0480 }, // 28.6
      { n: 23, x: 0.2701 }, // 160.8
      { n: 24, x: 0.4351 }, // 259.0
      { n: 25, x: 0.5989 }, // 356.5
      { n: 26, x: 0.7753 }, // 461.5
    ],
  },
  {
    systemIndex: 5,
    y: 0.8259, // 695.3/841.9
    endX: 0.9499, // double bar right edge at 565.4/595.3
    measures: [
      { n: 27, x: 0.0480 }, // 28.6
      { n: 28, x: 0.2320 }, // 138.1
      { n: 29, x: 0.3815 }, // 227.1
      { n: 30, x: 0.5444 }, // 324.1
      { n: 31, x: 0.6730 }, // 400.6
      { n: 32, x: 0.8136 }, // 484.3 (section B ends with double bar at 561.9/565.4)
    ],
  },
]

function main() {
  const anchors = []
  for (const sys of SYSTEMS) {
    for (let index = 0; index < sys.measures.length; index += 1) {
      const { n, x } = sys.measures[index]
      const nextMeasure = sys.measures[index + 1]
      const playableEndX = nextMeasure?.x ?? sys.endX
      anchors.push({
        page: 1,
        x,
        y: sys.y,
        measureNumber: n,
        source: ANCHOR_SOURCE.DEMO,
        meta: {
          role: 'measure',
          density: 'pdf-extracted',
          systemIndex: sys.systemIndex,
          calibrated: 'pymupdf-barline',
          bundled: true,
          measureStartX: x,
          playableStartX: x,
          playableEndX,
          systemEndX: sys.endX,
        },
      })
    }
  }

  const payload = {
    version: 1,
    pieceId: DEMO_PIECE.id,
    pdfFile: 'Minuet in G.pdf',
    timingFile: 'Minuet in G.musicxml',
    generatedAt: new Date().toISOString(),
    alignmentNote:
      'Bundled demo anchors for Minuet in G: 32 per-measure positions extracted from ' +
      'the actual PDF using PyMuPDF bar-line detection (6 systems, not 4). ' +
      'System-end metadata is included so the cursor can glide through the final measure of each staff. ' +
      'Loaded only for the sample piece; never saved to user localStorage.',
    anchors,
  }

  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`Wrote ${anchors.length} per-measure demo anchors → ${outPath}`)
}

main()
