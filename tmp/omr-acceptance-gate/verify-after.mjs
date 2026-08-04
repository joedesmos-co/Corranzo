#!/usr/bin/env node
/**
 * After-change acceptance outcomes for control scores.
 */
import { access, writeFile, mkdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'
import { validateOmrGeneratedPlayback } from '../../src/features/omr/validateOmrGeneratedPlayback.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/omr-acceptance-gate')
const DOWNLOADS = join(process.env.HOME, 'Downloads')

const CONTROLS = [
  { id: 'brahms-lullaby', role: 'PASSING', expect: 'accepted', pdf: join(ROOT, 'public/fixtures/practice-library/piano-brahms-lullaby/piano-brahms-lullaby.pdf') },
  { id: 'evangelion', role: 'PASSING', expect: 'accepted', pdf: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'), optional: true },
  { id: 'guitar-paired-scan', role: 'PASSING', expect: 'accepted', pdf: join(ROOT, 'benchmarks/omr-fixtures/guitar-paired-scan/guitar-paired-scan.pdf') },
  { id: 'guitar-techniques-tab', role: 'PASSING', expect: 'accepted', pdf: join(ROOT, 'benchmarks/omr-fixtures/guitar-techniques-paired-vector/guitar-techniques-paired-vector.pdf'), instrument: 'guitar' },
  { id: 'iris-out', role: 'PASSING', expect: 'accepted', pdf: join(DOWNLOADS, 'iris-out-piano-arragement.pdf'), optional: true, maxPages: 2 },
  { id: 'bach-chorale-bwv259', role: 'FALSE_REJECT', expect: 'warning', pdf: join(ROOT, 'public/fixtures/practice-library/piano-bach-chorale-bwv259/piano-bach-chorale-bwv259.pdf') },
  { id: 'turkish-march', role: 'FALSE_REJECT', expect: 'warning', pdf: join(ROOT, 'public/fixtures/practice-library/piano-mozart-turkish-march/piano-mozart-turkish-march.pdf'), maxPages: 5 },
  { id: 'fur-elise', role: 'FALSE_REJECT', expect: 'warning', pdf: join(ROOT, 'public/fixtures/practice-library/piano-beethoven-fur-elise/piano-beethoven-fur-elise.pdf') },
  { id: 'handel-gavotte', role: 'FALSE_REJECT', expect: 'warning', pdf: join(ROOT, 'public/fixtures/practice-library/piano-handel-gavotte/piano-handel-gavotte.pdf') },
  { id: 'demo-minuet', role: 'FALSE_REJECT', expect: 'warning', pdf: join(ROOT, 'public/fixtures/demo-minuet-in-g.pdf') },
  { id: 'chopin-mazurka', role: 'FALSE_REJECT', expect: 'warning', pdf: join(ROOT, 'public/fixtures/practice-library/piano-chopin-mazurka-op6-1/piano-chopin-mazurka-op6-1.pdf') },
  { id: 'pathetique', role: 'FALSE_REJECT', expect: 'warning', pdf: join(ROOT, 'benchmarks/omr-stress/beethoven-pathetique-mutopia/beethoven-pathetique-mutopia.pdf'), maxPages: 4 },
  { id: 'twinkle-1880-loc', role: 'TRUE_REJECT', expect: 'rejected', pdf: join(ROOT, 'benchmarks/omr-stress/twinkle-1880-loc/twinkle-1880-loc-music-p2.pdf') },
]

async function exists(path) {
  try {
    await access(path, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

async function runOne(entry) {
  if (!(await exists(entry.pdf))) {
    return { id: entry.id, role: entry.role, expect: entry.expect, skipped: true }
  }
  const rendered = await renderPdfToPages(entry.pdf, { rootDir: ROOT, maxPages: entry.maxPages ?? null })
  const extractPageText = await makePdfTextExtractor(entry.pdf, { rootDir: ROOT })
  try {
    const result = await runPdfOmrPipeline(entry.pdf, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.pages.length,
      maxPages: entry.maxPages,
      instrumentId: entry.instrument ?? 'piano',
      title: entry.id,
    })
    const playback = validateOmrGeneratedPlayback(result.musicXml, `${entry.id}.omr.musicxml`)
    return {
      id: entry.id,
      role: entry.role,
      expect: entry.expect,
      outcome: result.acceptance,
      match: result.acceptance === entry.expect,
      noteCount: result.noteCount,
      measureCount: result.measureCount,
      overallConfidence: result.overallConfidence,
      quality: result.quality,
      playbackOk: playback.ok,
      playbackDuration: playback.durationSeconds,
      playbackNotes: playback.noteCount,
      warningReasons: result.quality?.warningReasons ?? [],
    }
  } catch (error) {
    const outcome = error.acceptance?.acceptance ?? error.quality?.acceptance ?? 'rejected'
    return {
      id: entry.id,
      role: entry.role,
      expect: entry.expect,
      outcome,
      match: outcome === entry.expect,
      noteCount: error.diagnostics?.notes ?? null,
      measureCount: error.diagnostics?.measures ?? null,
      overallConfidence: error.diagnostics?.overallConfidence ?? null,
      quality: error.quality ?? null,
      failureMessage: error.message,
      playbackOk: false,
    }
  }
}

await mkdir(OUT, { recursive: true })
const rows = []
for (const entry of CONTROLS) {
  process.stderr.write(`after ${entry.id}...\n`)
  const row = await runOne(entry)
  rows.push(row)
  process.stderr.write(`  → ${row.outcome ?? 'SKIP'} expect=${row.expect} match=${row.match}\n`)
}
await writeFile(join(OUT, 'AFTER_OUTCOMES.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2))
const mismatches = rows.filter((r) => !r.skipped && !r.match)
console.log(JSON.stringify({ mismatches: mismatches.map((m) => m.id), rows: rows.map((r) => ({
  id: r.id, role: r.role, expect: r.expect, outcome: r.outcome, match: r.match, notes: r.noteCount, conf: r.overallConfidence, playbackOk: r.playbackOk,
})) }, null, 2))
process.exit(mismatches.length ? 1 : 0)
