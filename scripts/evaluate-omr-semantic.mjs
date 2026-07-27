#!/usr/bin/env node
/**
 * Semantic MusicXML evaluation (ground truth vs generated).
 *
 * Usage:
 *   node scripts/evaluate-omr-semantic.mjs --truth score.musicxml --generated omr.musicxml
 *   node scripts/evaluate-omr-semantic.mjs --self-check score.musicxml
 *   node scripts/evaluate-omr-semantic.mjs --equivalent a.musicxml b.musicxml
 *   node scripts/evaluate-omr-semantic.mjs --truth score.mxl --pdf score.pdf --json report.json
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  assertSemanticSelfCheck,
  evaluateSemanticMusicXml,
  formatCompactSummary,
  formatSemanticMusicXmlReport,
} from '../src/features/omr/semanticMusicXmlEvaluator.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function usage() {
  return [
    'OMR semantic MusicXML evaluator',
    '',
    'Compares ground-truth MusicXML to generated MusicXML using musical semantics.',
    '',
    'Modes:',
    '  --truth <gt> --generated <omr>   Compare two MusicXML files.',
    '  --truth <gt> --pdf <score.pdf>   Run OMR, then compare.',
    '  --self-check <score>             Compare a file to itself (must be perfect).',
    '  --equivalent <a> <b>             Two encodings must produce zero defects.',
    '',
    'Optional:',
    '  --mode written|performed|both    Default: both.',
    '  --json <report.json>             Machine-readable report (schemaVersion 2).',
    '  --text <report.txt>              Full text report.',
    '  --compact                        Print one-line console summary.',
    '  --save-generated <out.xml>       Save OMR MusicXML when --pdf is used.',
    '  --max-pages <n>                  Limit PDF pages for OMR, default 24.',
    '  --instrument <id>                Instrument id for OMR. Default: piano.',
    '  --no-preprocess                  Disable OMR preprocessing.',
  ].join('\n')
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  let rootPath = null
  if (container) {
    const xml = await container.async('string')
    rootPath = xml.match(/full-path="([^"]+)"/)?.[1] ?? null
  }
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
  }
  if (!rootPath || !zip.file(rootPath)) {
    throw new Error(`MXL archive has no MusicXML root: ${scorePath}`)
  }
  return zip.file(rootPath).async('string')
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
}

async function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(usage())
    process.exit(0)
  }

  const selfCheckPath = argValue(args, '--self-check')
  const equivalentIndex = args.indexOf('--equivalent')
  const mode = argValue(args, '--mode') ?? 'both'
  const jsonPath = argValue(args, '--json')
  const textPath = argValue(args, '--text')
  const compact = hasFlag(args, '--compact')
  const commit = gitCommit()

  let groundTruthMusicXml
  let generatedMusicXml
  let groundTruthFileName
  let generatedFileName
  let requirePerfect = false

  if (selfCheckPath) {
    if (!existsSync(selfCheckPath)) {
      throw new Error(`Self-check file not found: ${selfCheckPath}`)
    }
    groundTruthMusicXml = await readScoreXml(selfCheckPath)
    generatedMusicXml = groundTruthMusicXml
    groundTruthFileName = basename(selfCheckPath)
    generatedFileName = basename(selfCheckPath)
    requirePerfect = true
  } else if (equivalentIndex >= 0) {
    const leftPath = args[equivalentIndex + 1]
    const rightPath = args[equivalentIndex + 2]
    if (!leftPath || !rightPath) {
      throw new Error('--equivalent requires two file paths')
    }
    if (!existsSync(leftPath) || !existsSync(rightPath)) {
      throw new Error('Equivalent-check files not found')
    }
    groundTruthMusicXml = await readScoreXml(leftPath)
    generatedMusicXml = await readScoreXml(rightPath)
    groundTruthFileName = basename(leftPath)
    generatedFileName = basename(rightPath)
    requirePerfect = true
  } else {
    const truthPath = argValue(args, '--truth')
    const generatedPath = argValue(args, '--generated')
    const pdfPath = argValue(args, '--pdf')
    const saveGeneratedPath = argValue(args, '--save-generated')
    const maxPages = Number(argValue(args, '--max-pages') ?? 24)
    const instrumentId = argValue(args, '--instrument') ?? 'piano'
    const preprocess = !hasFlag(args, '--no-preprocess')

    if (!truthPath || (!generatedPath && !pdfPath)) {
      console.error(usage())
      process.exit(1)
    }
    if (!existsSync(truthPath)) {
      throw new Error(`Truth file not found: ${truthPath}`)
    }
    groundTruthMusicXml = await readScoreXml(truthPath)
    groundTruthFileName = basename(truthPath)

    if (generatedPath) {
      if (!existsSync(generatedPath)) {
        throw new Error(`Generated file not found: ${generatedPath}`)
      }
      generatedMusicXml = await readScoreXml(generatedPath)
      generatedFileName = basename(generatedPath)
    } else {
      if (!existsSync(pdfPath)) {
        throw new Error(`PDF file not found: ${pdfPath}`)
      }
      const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages })
      const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
      const result = await runPdfOmrPipeline(pdfPath, {
        renderPage: makeRenderPageCallback(rendered.pages),
        extractPageText,
        numPages: rendered.numPages,
        maxPages,
        preprocessPages: preprocess,
        instrumentId,
        title: basename(pdfPath).replace(/\.pdf$/i, ''),
      })
      if (!result?.musicXml) {
        throw new Error(`OMR produced no MusicXML for ${pdfPath}`)
      }
      generatedMusicXml = result.musicXml
      generatedFileName = `${basename(pdfPath, '.pdf')}.omr.musicxml`
      if (saveGeneratedPath) {
        ensureParent(saveGeneratedPath)
        writeFileSync(saveGeneratedPath, generatedMusicXml)
      }
    }
  }

  const report = evaluateSemanticMusicXml({
    groundTruthMusicXml,
    generatedMusicXml,
    groundTruthFileName,
    generatedFileName,
    options: { mode },
    meta: { gitCommit: commit },
  })

  if (requirePerfect) {
    const check = assertSemanticSelfCheck(report)
    if (!check.ok) {
      console.error('Semantic self-check FAILED:')
      for (const problem of check.problems) {
        console.error(`- ${problem}`)
      }
      console.error('')
      console.error(formatSemanticMusicXmlReport(report))
      process.exit(2)
    }
  }

  const text = formatSemanticMusicXmlReport(report)
  if (jsonPath) {
    ensureParent(jsonPath)
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (textPath) {
    ensureParent(textPath)
    writeFileSync(textPath, `${text}\n`)
  }

  if (compact) {
    console.log(formatCompactSummary(report))
  } else {
    console.log(text)
  }
  if (requirePerfect) {
    console.log('\nSelf-check / equivalent-check PASSED')
  }
  if (jsonPath) {
    console.log(`Wrote JSON: ${jsonPath}`)
  }
  if (textPath) {
    console.log(`Wrote text: ${textPath}`)
  }
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
