/**
 * Phase 2b — license-safe alignment fixture catalog + golden reconciliation
 * snapshots.
 *
 * Two groups:
 *
 *  RUNNABLE_FIXTURES — we have a redistributable input (the bundled public-domain
 *    Minuet, or synthetic MusicXML we generate here), so the real reconciliation
 *    model runs and its output is asserted against an explicit golden snapshot.
 *
 *  METADATA_FIXTURES — named real pieces we cannot redistribute in-repo (license
 *    or simply not bundled). These carry a documented snapshot + the reason they
 *    are metadata-only, per the Phase 2b rules (no random MuseScore uploads; if a
 *    fixture cannot be safely redistributed, document it instead of faking it).
 *
 * Nothing here changes runtime behaviour — it is test data + expectations.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { LAYOUT_CONFIDENCE } from '../../src/features/score-follow/layoutAssessment.js'
import {
  scoreWrap,
  attributes,
  soundTempo,
  fourQuarters,
  secondSectionVoltas,
  systemsAndPages,
} from '../helpers/buildXml.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'fixtures')

// --- Runnable input builders -------------------------------------------------

/** Real bundled Minuet (Mutopia, public domain). Per-system counts come from the
 *  calibrated bundled anchors; layout is EXACT by construction. */
function minuetInputs() {
  const xml = readFileSync(join(fixturesDir, 'demo-minuet-in-g.musicxml'), 'utf8')
  const anchors = JSON.parse(readFileSync(join(fixturesDir, 'demo-minuet-in-g.anchors.json'), 'utf8'))
  const bySystem = new Map()
  for (const anchor of anchors.anchors ?? []) {
    const index = anchor.meta?.systemIndex ?? 0
    bySystem.set(index, (bySystem.get(index) ?? 0) + 1)
  }
  const perSystemBarlineCounts = [...bySystem.keys()].sort((a, b) => a - b).map((k) => bySystem.get(k))
  return {
    timingMap: parseMusicXml(xml, 'demo-minuet-in-g.musicxml'),
    perSystemBarlineCounts,
    pdfPageCount: 1,
    layoutConfidence: LAYOUT_CONFIDENCE.EXACT,
  }
}

/** Repeats + voltas across two systems (system break injected before m3). */
function repeatsVoltasInputs() {
  const xml = secondSectionVoltas().replace(
    '<measure number="3">',
    '<measure number="3"><print new-system="yes"/>',
  )
  return {
    timingMap: parseMusicXml(xml, 'repeats-voltas'),
    perSystemBarlineCounts: [2, 3],
    pdfPageCount: 1,
    layoutConfidence: LAYOUT_CONFIDENCE.GOOD,
  }
}

/** Multi-page: 6 measures, system breaks before m3/m5, page break before m5. */
function multiPageInputs() {
  return {
    timingMap: parseMusicXml(systemsAndPages(), 'multi-page'),
    perSystemBarlineCounts: [2, 2, 2],
    pdfPageCount: 2,
    layoutConfidence: LAYOUT_CONFIDENCE.GOOD,
  }
}

/** Dense/fast proxy: 12 fast measures over 3 systems with a tempo change at m7.
 *  (Note density is a cursor/visual concern, not a reconciliation signal, so the
 *  snapshot focuses on structure: systems, measures, tempo change.) */
function denseFastInputs() {
  let body = ''
  for (let n = 1; n <= 12; n += 1) {
    let pre = ''
    if (n === 5 || n === 9) pre += '<print new-system="yes"/>'
    if (n === 1) pre += attributes() + soundTempo(168)
    if (n === 7) pre += soundTempo(132)
    body += `<measure number="${n}">${pre}${fourQuarters()}</measure>`
  }
  return {
    timingMap: parseMusicXml(scoreWrap(`<part id="P1">${body}</part>`), 'dense-fast'),
    perSystemBarlineCounts: [4, 4, 4],
    pdfPageCount: 1,
    layoutConfidence: LAYOUT_CONFIDENCE.GOOD,
  }
}

// --- Page-layout geometry (for Phase 3 anchor generation) --------------------

/** Real Minuet geometry, reconstructed from the bundled (calibrated) anchors. */
function minuetPageLayout() {
  const anchors = JSON.parse(
    readFileSync(join(fixturesDir, 'demo-minuet-in-g.anchors.json'), 'utf8'),
  ).anchors
  const bySystem = new Map()
  for (const anchor of anchors) {
    const systemIndex = anchor.meta?.systemIndex ?? 0
    if (!bySystem.has(systemIndex)) {
      bySystem.set(systemIndex, {
        systemIndex,
        page: anchor.page,
        y: anchor.y,
        endX: anchor.meta.systemEndX,
        barlineXs: [],
      })
    }
    bySystem.get(systemIndex).barlineXs.push(anchor.meta.measureStartX)
  }
  const systems = [...bySystem.values()].sort((a, b) => a.systemIndex - b.systemIndex)
  for (const system of systems) {
    system.barlineXs.sort((a, b) => a - b)
    system.startX = system.barlineXs[0]
  }
  return { pageCount: 1, layoutConfidence: LAYOUT_CONFIDENCE.EXACT, systems }
}

/** Even-spaced synthetic geometry (no PDF) from per-system counts + page map. */
function syntheticPageLayout({ perSystemCounts, pageOf, layoutConfidence }) {
  const startX = 0.08
  const endX = 0.92
  const perPage = {}
  const systems = perSystemCounts.map((count, i) => {
    const page = pageOf[i]
    const idxOnPage = (perPage[page] = (perPage[page] ?? -1) + 1)
    const barlineXs = Array.from({ length: count }, (_, j) =>
      Number((startX + (endX - startX) * (j / count)).toFixed(4)),
    )
    return {
      systemIndex: i,
      page,
      y: Number((0.16 + idxOnPage * 0.16).toFixed(4)),
      startX,
      endX,
      barlineXs,
    }
  })
  return { pageCount: Math.max(...pageOf), layoutConfidence, systems }
}

// --- Runnable fixtures (model runs; golden asserted) -------------------------

export const RUNNABLE_FIXTURES = [
  {
    id: 'minuet-in-g',
    title: 'Minuet in G',
    source: 'Mutopia Project (BWV Anh. 114)',
    license: 'Public Domain',
    redistributable: true,
    makeInputs: minuetInputs,
    makePageLayout: minuetPageLayout,
    golden: {
      writtenMeasures: 32,
      pdfPageCount: 1,
      systemCount: 6,
      perSystemExpected: [5, 5, 6, 5, 5, 6],
      systemStarts: [1, 6, 11, 17, 22, 27],
      hasRepeats: false,
      performedDiffersFromWritten: false,
      tempoChangeCount: 0,
      timeSignatureChangeCount: 0,
      hasPickup: false,
      systemCountMismatch: false,
      action: 'auto',
    },
  },
  {
    id: 'repeats-voltas',
    title: 'Repeats + voltas (synthetic)',
    source: 'Generated MusicXML',
    license: 'N/A (generated)',
    redistributable: true,
    makeInputs: repeatsVoltasInputs,
    makePageLayout: () =>
      syntheticPageLayout({ perSystemCounts: [2, 3], pageOf: [1, 1], layoutConfidence: LAYOUT_CONFIDENCE.GOOD }),
    golden: {
      writtenMeasures: 5,
      pdfPageCount: 1,
      systemCount: 2,
      perSystemExpected: [2, 3],
      systemStarts: [1, 3],
      hasRepeats: true,
      performedDiffersFromWritten: true,
      tempoChangeCount: 0,
      timeSignatureChangeCount: 0,
      hasPickup: false,
      systemCountMismatch: false,
      action: 'auto',
    },
  },
  {
    id: 'multi-page',
    title: 'Multi-page (synthetic)',
    source: 'Generated MusicXML',
    license: 'N/A (generated)',
    redistributable: true,
    makeInputs: multiPageInputs,
    makePageLayout: () =>
      syntheticPageLayout({ perSystemCounts: [2, 2, 2], pageOf: [1, 1, 2], layoutConfidence: LAYOUT_CONFIDENCE.GOOD }),
    golden: {
      writtenMeasures: 6,
      pdfPageCount: 2,
      systemCount: 3,
      perSystemExpected: [2, 2, 2],
      systemStarts: [1, 3, 5],
      hasRepeats: false,
      performedDiffersFromWritten: false,
      tempoChangeCount: 0,
      timeSignatureChangeCount: 0,
      hasPickup: false,
      systemCountMismatch: false,
      action: 'auto',
    },
  },
  {
    id: 'dense-fast',
    title: 'Dense / fast (synthetic)',
    source: 'Generated MusicXML',
    license: 'N/A (generated)',
    redistributable: true,
    makeInputs: denseFastInputs,
    makePageLayout: () =>
      syntheticPageLayout({ perSystemCounts: [4, 4, 4], pageOf: [1, 1, 1], layoutConfidence: LAYOUT_CONFIDENCE.GOOD }),
    golden: {
      writtenMeasures: 12,
      pdfPageCount: 1,
      systemCount: 3,
      perSystemExpected: [4, 4, 4],
      systemStarts: [1, 5, 9],
      hasRepeats: false,
      performedDiffersFromWritten: false,
      tempoChangeCount: 1,
      tempoChangeMeasures: [7],
      timeSignatureChangeCount: 0,
      hasPickup: false,
      systemCountMismatch: false,
      action: 'auto',
    },
  },
]

// --- Metadata-only fixtures (documented; not redistributed in-repo) ----------
//
// `documented` mirrors the golden-snapshot shape; unknown numeric fields are null
// because we have not processed the actual asset here. `expectedAction` records
// the classification we expect once the asset is processed in a later phase.

export const FOLLOW_ACTIONS = ['auto', 'confirm', 'manual']

export const METADATA_FIXTURES = [
  {
    id: 'gymnopedie-1',
    title: 'Gymnopédie No. 1',
    composer: 'Erik Satie (1866–1925)',
    source: 'IMSLP / Mutopia (public domain)',
    license: 'Public Domain',
    redistributable: true,
    bundled: false,
    reason:
      'Public domain, but no verified engraving is bundled in-repo yet. Metadata-only ' +
      'until a PD source file is added. A Gymnopédie-style synthetic page already exists ' +
      'for detector tests (tests/helpers/syntheticScore.js: lightClassicalPage).',
    documented: {
      writtenMeasures: null,
      pdfPageCount: null,
      systemCount: null,
      perSystemExpected: null,
      systemStarts: null,
      hasRepeats: false,
      tempoChangeCount: 0,
      timeSignatureChangeCount: 0,
      hasPickup: false,
      expectedAction: 'auto',
      rationale:
        'Slow, sparse, light-classical layout with clean barlines — expected to auto-follow ' +
        'once detected; the challenge is light staff lines (detector), not reconciliation.',
    },
  },
  {
    id: 'guren',
    title: 'Guren',
    composer: 'Contemporary (copyrighted)',
    source: 'User-supplied score (not redistributable)',
    license: 'Copyrighted — not redistributable',
    redistributable: false,
    bundled: false,
    reason:
      'Copyrighted score cannot be redistributed. Documented from existing repo analysis ' +
      '(tests/gurenAnchors.test.js, scripts/debug-guren-anchors.mjs): the MusicXML system ' +
      'breaks (~19 systems) disagree with the printed PDF (~11 systems over 2 pages), so the ' +
      'PDF barline counts are authoritative. Only numeric layout facts are used — no score content.',
    documented: {
      writtenMeasures: 75,
      pdfPageCount: 2,
      systemCount: 11, // printed PDF systems
      musicXmlSystemCount: 19, // MusicXML break hints — the source of the mismatch
      perSystemExpected: null, // PDF-derived; not asserted here (asset unavailable)
      systemStarts: null,
      hasRepeats: false,
      tempoChangeCount: 0,
      timeSignatureChangeCount: 0,
      hasPickup: false,
      expectedAction: 'auto',
      rationale:
        'PDF is the source of truth; reconciliation flags the system-count mismatch (19 vs 11) ' +
        'as informational while following the confident PDF barline layout (assessLayoutConfidence: ' +
        'BARLINE_COUNTS + mismatch → GOOD → auto).',
    },
  },
  {
    id: 'carol',
    title: 'Traditional Carol',
    composer: 'Traditional',
    source: 'Traditional melody (public domain)',
    license: 'Public Domain (melody)',
    redistributable: true,
    bundled: false,
    reason:
      'Traditional carols are public domain, but no specific verified engraving is bundled. ' +
      'Metadata-only until a concrete PD source file is chosen and added.',
    documented: {
      writtenMeasures: null,
      pdfPageCount: 1,
      systemCount: null,
      perSystemExpected: null,
      systemStarts: null,
      hasRepeats: false,
      tempoChangeCount: 0,
      timeSignatureChangeCount: 0,
      hasPickup: true, // many carols start with an anacrusis
      expectedAction: 'auto',
      rationale:
        'Short, single-page, simple layout — expected to auto-follow. Listed to exercise the ' +
        'pickup case once a concrete PD source is added.',
    },
  },
  {
    id: 'turkish-march',
    title: 'Rondo Alla Turca (Turkish March)',
    composer: 'W. A. Mozart, K. 331 mvt 3',
    source: 'Mutopia Project (id=108)',
    license: 'Public Domain',
    redistributable: true,
    bundled: false,
    reason:
      'Mutopia public-domain engraving exists and is safe to use, but is not bundled here to ' +
      'avoid adding large binaries before anchor generation changes. Metadata-only for now; see ' +
      'the demo-replacement evaluation for the density/reliability assessment.',
    documented: {
      writtenMeasures: null, // ~127 in the full rondo; not asserted without the asset
      pdfPageCount: 3, // typical Mutopia A4 engraving
      systemCount: null,
      perSystemExpected: null,
      systemStarts: null,
      hasRepeats: true, // rondo form revisits sections
      tempoChangeCount: 0,
      timeSignatureChangeCount: 0,
      hasPickup: false,
      expectedAction: 'confirm',
      rationale:
        'Dense, fast, multi-page with running sixteenths. Even with clean detection, the ' +
        'safety-first stance is to confirm before auto-follow; weak systems would drop to manual.',
    },
  },
]
