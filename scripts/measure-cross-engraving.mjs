#!/usr/bin/env node
/**
 * Cross-engraving acceptance (FINAL mission items 1-3, 6).
 *
 * Pairs each repo MusicXML with an INDEPENDENTLY produced PDF of the same
 * piece (different engraver, different layout) and runs the REAL auto-setup
 * pipeline (PDF raster -> system detection -> anchor proposal -> trust
 * assessment) plus the shipped cursor stack. No synthetic anchors anywhere.
 *
 * Pairs (provenance in docs/cross-engraving-pairs.md):
 *  - Fur Elise: music21-processed Mutopia #931 MusicXML  vs  1888 Breitkopf
 *    plate scan (Wikimedia Commons, PD-old, uploader Yann)
 *  - BWV 846 prelude: music21-processed Mutopia #5 MusicXML  vs  OpenGoldberg
 *    MuseScore engraving (Wikimedia Commons, CC0, 2015)
 *
 * Reports per pair: auto-setup verdict (ready/approximate/needs-setup),
 * layoutMismatch, anchor counts by source, onset alignment, highlight
 * agreement, teleports, wrong-page placements, precision mix.
 *
 *   node scripts/measure-cross-engraving.mjs [--json out.json]
 *
 * PDFs live in tmp/cross-engraving/ (third-party binaries, not committed).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'
import { filterTrustedAnchors } from '../src/features/score-follow/trustedAnchors.js'
import { buildCursorMotionTimeline } from '../src/features/score-follow/cursorMotionTimeline.js'
import { resolveDisplayCursorAtTime } from '../src/features/score-follow/scoreFollowDisplayPosition.js'
import {
  measureCursorHighlightAgreement,
  measureCursorOnsetAlignment,
} from '../src/features/score-follow/scoreFollowPrecisionDiagnostics.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { resolveNoteTargetPosition } from '../src/features/practice/noteTargetPosition.js'
import {
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'cross-engraving')

const PAIRS = [
  {
    id: 'fur-elise',
    musicxml: join(root, 'public/fixtures/practice-library/piano-beethoven-fur-elise/piano-beethoven-fur-elise.musicxml'),
    pdf: join(root, 'tmp/cross-engraving/fur-elise-breitkopf-1888.pdf'),
  },
  {
    id: 'bwv846-prelude',
    musicxml: join(root, 'public/fixtures/practice-library/piano-bach-prelude-bwv846/piano-bach-prelude-bwv846.musicxml'),
    pdf: join(root, 'tmp/cross-engraving/bwv846-opengoldberg-cc0.pdf'),
  },
]

async function analyzePair(pair) {
  const xml = await readFile(pair.musicxml, 'utf8')
  const timingMap = parseMusicXml(xml, basename(pair.musicxml))
  const rendered = await renderPdfToPages(pair.pdf, { rootDir: root })
  const result = await analyzeSemiAutoScoreSetup({
    pdfSource: pair.pdf,
    numPages: rendered.numPages,
    timingMap,
    renderPage: makeRenderPageCallback(rendered.pages),
    maxDurationMs: 120_000,
  })
  const summary = {
    id: pair.id,
    measures: timingMap.measures?.length ?? 0,
    pdfPages: rendered.numPages,
    ok: result.ok,
    plausible: result.preview?.plausible ?? null,
    approximate: result.preview?.approximate ?? null,
    systemCount: result.preview?.systemCount ?? null,
    anchorCount: result.preview?.anchorCount ?? result.preview?.proposedAnchors?.length ?? 0,
    supplemental: result.preview?.supplementalMeasureAnchors?.length ?? 0,
    layoutMismatch: result.preview?.layoutMismatch ?? null,
    message: result.message ?? null,
  }
  if (!result.ok || !result.preview?.proposedAnchors?.length) {
    return { summary, metrics: null }
  }
  const anchors = [
    ...(result.preview.proposedAnchors ?? []),
    ...(result.preview.supplementalMeasureAnchors ?? []),
  ]
  const trust = assessScoreFollowTrust({ anchors, timingMap, isDemoSession: false })
  const trusted = filterTrustedAnchors(anchors)
  const checkpoints = buildNoteCheckpoints(timingMap)
  const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
  const trustArg = { showCursor: trust.showCursor, needsSetup: trust.needsSetup }
  const onset = measureCursorOnsetAlignment({
    timingMap, trustedAnchors: trusted, trust: trustArg, motionTimeline,
  })
  const agreement = measureCursorHighlightAgreement({
    checkpoints,
    resolveCursorAt: (time) => resolveDisplayCursorAtTime({
      timingMap, trustedAnchors: trusted, trust: trustArg, practiceTime: time, motionTimeline,
    }),
    resolveTarget: (checkpoint) => resolveNoteTargetPosition({
      checkpoint, timingMap, anchors: trusted, mode: 'wait-for-you', motionTimeline,
    }),
  })
  return {
    summary: {
      ...summary,
      trust: { showCursor: trust.showCursor, needsSetup: trust.needsSetup },
      trustedAnchors: trusted.length,
      checkpoints: checkpoints.length,
      phrases: motionTimeline?.phrases?.length ?? 0,
    },
    metrics: {
      onset: {
        samples: onset.sampleCount,
        avgErrorX: onset.averageErrorX,
        maxErrorX: onset.maxErrorX,
        jumps: onset.visibleJumps,
        explained: onset.explainedJumps,
        teleports: onset.midSystemTeleports,
        wrongPage: onset.wrongPagePlacements,
        precision: onset.precisionCounts,
      },
      agreement: {
        samples: agreement.sampleCount,
        skipped: agreement.skipped,
        avgErrorX: agreement.averageErrorX,
        maxErrorX: agreement.maxErrorX,
        inMeasureMax: agreement.inMeasureMaxErrorX,
        overflow: agreement.overflowSampleCount,
        wrongPage: agreement.wrongPagePlacements,
        wrongSystem: agreement.wrongSystemPlacements,
      },
    },
  }
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const results = []
  for (const pair of PAIRS) {
    try {
      const result = await analyzePair(pair)
      results.push({ ...result, ok: true })
      const s = result.summary
      console.log(
        `OK   ${s.id}: setup ok=${s.ok} plausible=${s.plausible} approx=${s.approximate} ` +
        `systems=${s.systemCount} anchors=${s.anchorCount}+${s.supplemental} ` +
        `mismatch=${JSON.stringify(s.layoutMismatch?.mismatch ?? null)}`,
      )
      if (result.metrics) {
        const m = result.metrics
        console.log(
          `     onset max=${m.onset.maxErrorX.toFixed(4)} teleports=${m.onset.teleports} wrongPage=${m.onset.wrongPage} ` +
          `agree max=${m.agreement.maxErrorX.toFixed(4)} inMeasure=${(m.agreement.inMeasureMax ?? 0).toFixed(4)} wrongPage=${m.agreement.wrongPage}`,
        )
      }
    } catch (error) {
      results.push({ id: pair.id, ok: false, reason: error?.message ?? String(error) })
      console.error(`FAIL ${pair.id}: ${error?.message ?? error}`)
    }
  }
  const report = { generatedAt: new Date().toISOString(), results }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  const hardFail = results.some(
    (r) => r.ok && r.metrics && (r.metrics.onset.teleports > 0 || r.metrics.onset.wrongPage > 0 || r.metrics.agreement.wrongPage > 0),
  )
  process.exit(hardFail ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
