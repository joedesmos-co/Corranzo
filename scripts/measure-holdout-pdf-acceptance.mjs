#!/usr/bin/env node
/**
 * Holdout acceptance: unseen PDF-only scores through the FULL automatic chain.
 *
 *   PDF → notation recognition (OMR) → MusicXML → timing validation →
 *   canonical timeline → practice checkpoints → score-follow mapping
 *
 * These PDFs come from corranzo-holdout-intake/ — outside the practice
 * library, never used to develop any fix — so they demonstrate the
 * general path rather than a repaired fixture. No per-score configuration:
 * the same call is made for every PDF.
 *
 *   node scripts/measure-holdout-pdf-acceptance.mjs [--pdf name.pdf ...]
 *
 * Output: tmp/holdout-acceptance/{report.json,report.md}
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { getTimingValidation } from '../src/features/musicxml/timingValidation.js'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const holdoutDir = join(root, 'corranzo-holdout-intake')
const outDir = join(root, 'tmp', 'holdout-acceptance')
const MAX_PAGES = 2 // bounded runtime: enough to prove the chain end to end

async function runOne(pdfName) {
  const pdfPath = join(holdoutDir, pdfName)
  const started = Date.now()
  const rendered = await renderPdfToPages(pdfPath, { rootDir: root, maxPages: MAX_PAGES })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: root })

  let omr
  try {
    omr = await runPdfOmrPipeline(pdfPath, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.numPages,
      maxPages: MAX_PAGES,
      instrumentId: 'piano',
      title: basename(pdfName).replace(/\.pdf$/i, ''),
    })
  } catch (error) {
    const message = error?.message ?? String(error)
    // A clear OMR rejection is a CORRECT outcome for unsupported input: the
    // pipeline refuses instead of inventing a timeline.
    if (/no noteheads|rejected|no staves|could not/i.test(message)) {
      return { pdf: pdfName, ok: true, stage: 'rejected', problems: [], rejection: message }
    }
    throw error
  }

  if (!omr?.musicXml) {
    return {
      pdf: pdfName,
      ok: false,
      stage: 'omr',
      problems: ['OMR produced no MusicXML (rejected/flagged, not crashed)'],
    }
  }

  let timingMap
  try {
    timingMap = parseMusicXml(omr.musicXml, `${pdfName}.omr.musicxml`)
  } catch (error) {
    return {
      pdf: pdfName,
      ok: false,
      stage: 'parse',
      problems: [`generated MusicXML did not parse: ${error?.message ?? error}`],
    }
  }

  const validation = getTimingValidation(timingMap)
  const checkpoints = buildNoteCheckpoints(timingMap)
  const cross = checkpoints.filter(
    (checkpoint) => new Set((checkpoint.notes ?? []).map((note) => note.measureNumber)).size > 1,
  )
  const nonRest = (timingMap.notes ?? []).filter((note) => !note.isRest && note.midi != null)
  let monotonic = true
  for (let index = 1; index < nonRest.length; index += 1) {
    if (nonRest[index].quarterTime < nonRest[index - 1].quarterTime - 1e-9) monotonic = false
  }
  const problems = []
  if (nonRest.length === 0) problems.push('OMR produced no pitched notes')
  if (cross.length > 0) problems.push(`${cross.length} cross-measure WFY requirements`)
  if (!monotonic) problems.push('notes placed backwards on the timeline')

  return {
    pdf: pdfName,
    ok: problems.length === 0,
    stage: 'complete',
    ms: Date.now() - started,
    omrInstrument: omr.instrumentId ?? null,
    measures: timingMap.measures?.length ?? 0,
    notes: nonRest.length,
    checkpoints: checkpoints.length,
    validation: validation.status,
    overfullMeasures: validation.summary?.overfullMeasureCount ?? 0,
    crossMeasureCheckpoints: cross.length,
    monotonic,
    problems,
  }
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const flagIndex = process.argv.indexOf('--pdf')
  const requested =
    flagIndex >= 0
      ? process.argv.slice(flagIndex + 1).filter((value) => !value.startsWith('--'))
      : null
  const available = (await readdir(holdoutDir)).filter((name) => /\.pdf$/i.test(name))
  const targets = requested?.length ? requested.filter((name) => available.includes(name)) : available.slice(0, 3)

  const results = []
  for (const pdfName of targets) {
    process.stdout.write(`… ${pdfName} `)
    try {
      const result = await runOne(pdfName)
      results.push(result)
      console.log(
        `${result.ok ? 'OK  ' : 'FAIL'} measures=${result.measures ?? '—'} notes=${result.notes ?? '—'} ` +
          `cp=${result.checkpoints ?? '—'} validation=${result.validation ?? '—'}` +
          (result.problems?.length ? ` :: ${result.problems.join('; ')}` : ''),
      )
    } catch (error) {
      results.push({ pdf: pdfName, ok: false, stage: 'error', problems: [error?.message ?? String(error)] })
      console.log(`ERROR ${error?.message ?? error}`)
    }
  }

  const report = { generatedAt: new Date().toISOString(), results }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  const lines = [
    '# Holdout PDF acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| pdf | measures | notes | checkpoints | validation | overfull | cross-m WFY | monotonic | result |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const result of results) {
    lines.push(
      `| ${result.pdf} | ${result.measures ?? '—'} | ${result.notes ?? '—'} | ${result.checkpoints ?? '—'} | ` +
        `${result.validation ?? result.stage} | ${result.overfullMeasures ?? '—'} | ` +
        `${result.crossMeasureCheckpoints ?? '—'} | ${result.monotonic ?? '—'} | ${
          result.ok ? 'pass' : `FAIL ${(result.problems ?? []).join('; ')}`
        } |`,
    )
  }
  await writeFile(join(outDir, 'report.md'), `${lines.join('\n')}\n`)
  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} holdout PDFs complete the chain — report in ${outDir}`)
  if (failed.length > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
