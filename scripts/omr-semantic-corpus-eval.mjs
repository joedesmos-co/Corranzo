#!/usr/bin/env node
/**
 * Run semantic MusicXML evaluation across enforced OMR benchmark fixtures.
 *
 * Usage:
 *   node scripts/omr-semantic-corpus-eval.mjs --label before --json tmp/semantic-corpus-before.json
 *   node scripts/omr-semantic-corpus-eval.mjs --label after --json tmp/semantic-corpus-after.json
 *   node scripts/omr-semantic-corpus-eval.mjs --compare before.json after.json --json tmp/semantic-corpus-delta.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { evaluateSemanticMusicXml } from '../src/features/omr/semanticMusicXmlEvaluator.js'
import {
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVALUATOR_VERSION,
} from '../src/features/omr/semanticEvalTolerances.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Phase-1 recognition scoreboard (frozen evaluator categories). */
const CLASS_KEYS = [
  'pitch',
  'rhythm',
  'sustain',
  'articulation',
  'measureStructure',
  'interpretation',
  'playback',
]

/** Printed / gated categories for recognition sprints (written mode). */
const PHASE1_SCOREBOARD = [
  'overall',
  'pitch',
  'rhythm',
  'sustain',
  'articulation',
  'measureStructure',
  'interpretation',
]

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function expandHome(pathValue) {
  if (!pathValue) {
    return pathValue
  }
  if (pathValue.startsWith('~/')) {
    return join(homedir(), pathValue.slice(2))
  }
  return pathValue
}

function resolveFixturePath(relativePath, searchPaths) {
  for (const root of searchPaths) {
    const candidate = resolve(expandHome(root), relativePath)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
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

function mean(values) {
  const nums = values.filter((value) => Number.isFinite(value))
  if (!nums.length) {
    return null
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

function summarizeFixture(id, report, meta = {}) {
  const classes = Object.fromEntries(
    CLASS_KEYS.map((key) => [
      key,
      {
        score: report.classes[key].score,
        percent: report.classes[key].percent,
        numerator: report.classes[key].numerator,
        denominator: report.classes[key].denominator,
        coverage: report.classes[key].coverage,
        reliable: report.classes[key].reliable,
      },
    ]),
  )
  return {
    id,
    ok: true,
    ...meta,
    overall: report.overall,
    overallPercent: report.overallPercent ?? null,
    classes,
    totals: report.totals,
    alignmentConfidence: report.alignment?.confidence ?? null,
    topDefects: (report.topDefects ?? []).slice(0, 12),
    topDefectClasses: (report.topDefectClasses ?? []).slice(0, 8),
    worstMeasures: (report.worstMeasures ?? []).slice(0, 8).map((measure) => ({
      measureNumber: measure.measureNumber ?? measure.number ?? null,
      severity: measure.severity ?? null,
      summary: measure.summary ?? null,
      defectCodes: (measure.defects ?? []).map((d) => d.code ?? d).slice(0, 8),
    })),
    firstDivergence: report.firstDivergence,
  }
}

function rollupTopDefects(fixtures, limit = 20) {
  const counts = new Map()
  for (const fixture of fixtures.filter((entry) => entry.ok)) {
    for (const defect of fixture.topDefects ?? []) {
      const code = defect.code ?? 'unknown'
      const prev = counts.get(code) ?? {
        code,
        class: defect.class ?? null,
        count: 0,
        fixtures: new Set(),
      }
      prev.count += Number(defect.count) || 0
      prev.fixtures.add(fixture.id)
      counts.set(code, prev)
    }
  }
  return [...counts.values()]
    .map((entry) => ({
      code: entry.code,
      class: entry.class,
      count: entry.count,
      fixtureCount: entry.fixtures.size,
      fixtures: [...entry.fixtures].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, limit)
}

function aggregate(fixtures) {
  const ok = fixtures.filter((entry) => entry.ok)
  const byClass = {}
  for (const key of CLASS_KEYS) {
    byClass[key] = {
      meanScore: mean(ok.map((entry) => entry.classes[key].score)),
      meanCoverage: mean(ok.map((entry) => entry.classes[key].coverage)),
    }
  }
  return {
    fixtureCount: fixtures.length,
    okCount: ok.length,
    failedCount: fixtures.length - ok.length,
    meanOverall: mean(ok.map((entry) => entry.overall)),
    classes: byClass,
    topDefects: rollupTopDefects(ok),
  }
}

function compareReports(before, after) {
  const beforeById = new Map(before.fixtures.map((entry) => [entry.id, entry]))
  const afterById = new Map(after.fixtures.map((entry) => [entry.id, entry]))
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])]
  const perFixture = []
  const improvements = []
  const regressions = []
  const gateFailures = []

  for (const id of ids) {
    const left = beforeById.get(id)
    const right = afterById.get(id)
    if (!left?.ok || !right?.ok) {
      perFixture.push({
        id,
        status: !left ? 'missing-before' : !right ? 'missing-after' : 'failed-run',
      })
      continue
    }
    const deltas = Object.fromEntries(
      CLASS_KEYS.map((key) => [
        key,
        Number((right.classes[key].score - left.classes[key].score).toFixed(4)),
      ]),
    )
    const overallDelta = Number((right.overall - left.overall).toFixed(4))
    const row = {
      id,
      beforeOverall: left.overall,
      afterOverall: right.overall,
      overallDelta,
      deltas,
      before: left.classes,
      after: right.classes,
    }
    perFixture.push(row)

    const rhythmUp = deltas.rhythm > 0.0001
    const pitchOk = deltas.pitch >= -0.01
    const measureOk = deltas.measureStructure >= -0.01
    const noBigRegression = CLASS_KEYS.every((key) => deltas[key] >= -0.01)
    if (rhythmUp) {
      improvements.push({
        id,
        rhythmDelta: deltas.rhythm,
        overallDelta,
      })
    }
    // Per-fixture: any class drop >1% fails. Small rhythm dips within 1% are
    // allowed when mean rhythm still rises (see accept gates below).
    if (!pitchOk || !measureOk || !noBigRegression) {
      const reasons = []
      if (!pitchOk) {
        reasons.push(`pitch ${deltas.pitch}`)
      }
      if (!measureOk) {
        reasons.push(`measure ${deltas.measureStructure}`)
      }
      for (const key of CLASS_KEYS) {
        if (deltas[key] < -0.01) {
          reasons.push(`${key} ${deltas[key]}`)
        }
      }
      regressions.push({ id, reasons, deltas, overallDelta })
      gateFailures.push({ id, reasons })
    } else if (deltas.rhythm < -0.0001) {
      regressions.push({
        id,
        reasons: [`rhythm ${deltas.rhythm} (within 1% budget)`],
        deltas,
        overallDelta,
        withinBudget: true,
      })
    }
  }

  improvements.sort((a, b) => b.rhythmDelta - a.rhythmDelta || b.overallDelta - a.overallDelta)
  regressions.sort((a, b) => a.overallDelta - b.overallDelta)

  const beforeAgg = before.aggregate
  const afterAgg = after.aggregate
  const classDeltas = Object.fromEntries(
    CLASS_KEYS.map((key) => [
      key,
      Number(
        (
          (afterAgg.classes[key].meanScore ?? 0) - (beforeAgg.classes[key].meanScore ?? 0)
        ).toFixed(4),
      ),
    ]),
  )

  const accept =
    classDeltas.rhythm > 0 &&
    classDeltas.pitch >= -0.01 &&
    classDeltas.measureStructure >= -0.01 &&
    CLASS_KEYS.every((key) => classDeltas[key] >= -0.01) &&
    gateFailures.length === 0

  return {
    accept,
    classDeltas,
    overallDelta: Number(
      ((afterAgg.meanOverall ?? 0) - (beforeAgg.meanOverall ?? 0)).toFixed(4),
    ),
    improvements,
    regressions,
    gateFailures,
    perFixture,
  }
}

function pct(score) {
  if (!Number.isFinite(score)) {
    return 'n/a'
  }
  return `${(score * 100).toFixed(1)}%`
}

function formatBaselineText(report) {
  const lines = []
  lines.push('OMR semantic corpus — baseline')
  lines.push('==============================')
  lines.push(`label: ${report.label}`)
  lines.push(`mode: ${report.mode}`)
  lines.push(`evaluator: frozen ${report.evaluatorVersion ?? '2.0.0'} / schema ${report.schemaVersion ?? 2}`)
  lines.push(`git: ${report.gitCommit ?? 'nogit'}`)
  lines.push(`createdAt: ${report.createdAt}`)
  lines.push(
    `fixtures: ${report.aggregate.okCount}/${report.aggregate.fixtureCount} ok`,
  )
  lines.push('')
  lines.push('Scoreboard (mean across fixtures)')
  lines.push(`- overall: ${pct(report.aggregate.meanOverall)}`)
  for (const key of CLASS_KEYS) {
    if (key === 'playback' && report.mode === 'written') {
      continue
    }
    lines.push(`- ${key}: ${pct(report.aggregate.classes[key].meanScore)}`)
  }
  lines.push('')
  lines.push('Top recurring recognition errors')
  const defects = report.aggregate.topDefects ?? []
  if (!defects.length) {
    lines.push('(none)')
  } else {
    for (const defect of defects.slice(0, 15)) {
      lines.push(
        `- ${defect.code} [${defect.class}] ×${defect.count} across ${defect.fixtureCount} fixtures`,
      )
    }
  }
  lines.push('')
  lines.push('Per-fixture summary')
  for (const fixture of report.fixtures) {
    if (!fixture.ok) {
      lines.push(`- ${fixture.id}: FAIL ${fixture.error}`)
      continue
    }
    lines.push(
      `- ${fixture.id}: overall=${pct(fixture.overall)} ` +
        `R=${fixture.classes.rhythm.percent} P=${fixture.classes.pitch.percent} ` +
        `S=${fixture.classes.sustain.percent} A=${fixture.classes.articulation.percent} ` +
        `M=${fixture.classes.measureStructure.percent} I=${fixture.classes.interpretation.percent}`,
    )
    const worst = (fixture.worstMeasures ?? []).slice(0, 3)
    if (worst.length) {
      lines.push(
        `  worst measures: ${worst
          .map((m) => `#${m.measureNumber}(${(m.defectCodes ?? []).slice(0, 3).join('|')})`)
          .join(', ')}`,
      )
    }
  }
  return lines.join('\n')
}

function formatCompareText(compare, before, after) {
  const lines = []
  lines.push('OMR semantic corpus — before/after')
  lines.push('=================================')
  lines.push(`before: ${before.label} (${before.gitCommit ?? 'nogit'})`)
  lines.push(`after:  ${after.label} (${after.gitCommit ?? 'nogit'})`)
  lines.push(`ACCEPT: ${compare.accept ? 'YES' : 'NO'}`)
  lines.push('')
  lines.push('Scoreboard deltas (mean)')
  lines.push(
    `- overall: ${compare.overallDelta >= 0 ? '+' : ''}${compare.overallDelta}  ` +
      `(${before.aggregate.meanOverall?.toFixed(4)} → ${after.aggregate.meanOverall?.toFixed(4)})`,
  )
  for (const key of CLASS_KEYS) {
    if (key === 'playback' && (before.mode === 'written' || after.mode === 'written')) {
      continue
    }
    const delta = compare.classDeltas[key]
    const sign = delta > 0 ? '+' : ''
    lines.push(
      `- ${key}: ${sign}${delta}  ` +
        `(${before.aggregate.classes[key].meanScore?.toFixed(4)} → ${after.aggregate.classes[key].meanScore?.toFixed(4)})`,
    )
  }
  lines.push('')
  lines.push('Largest rhythm improvements')
  if (!compare.improvements.length) {
    lines.push('(none)')
  } else {
    for (const row of compare.improvements.slice(0, 10)) {
      lines.push(`- ${row.id}: rhythm ${row.rhythmDelta >= 0 ? '+' : ''}${row.rhythmDelta}`)
    }
  }
  lines.push('')
  lines.push('Regressions / gate failures')
  const hard = compare.regressions.filter((row) => !row.withinBudget)
  const soft = compare.regressions.filter((row) => row.withinBudget)
  if (!hard.length && !soft.length) {
    lines.push('(none)')
  } else {
    for (const row of hard) {
      lines.push(`- ${row.id}: ${row.reasons.join('; ')}`)
    }
    for (const row of soft) {
      lines.push(`- ${row.id}: ${row.reasons.join('; ')}`)
    }
  }
  lines.push('')
  lines.push('Phase-1 scoreboard keys: ' + PHASE1_SCOREBOARD.join(', '))
  return lines.join('\n')
}

async function evaluateCorpus({ label, mode, only }) {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'),
  )
  const roots = [
    join(ROOT, 'benchmarks/omr-fixtures'),
    join(ROOT, 'benchmarks/omr-stress'),
    join(ROOT, 'tmp/sprint1'),
    join(homedir(), 'Downloads'),
  ]

  const fixtures = (manifest.fixtures ?? []).filter((fixture) => {
    if (fixture.expectedRejectionCodes?.length) {
      return false
    }
    if (!fixture.truth || !fixture.pdf) {
      return false
    }
    if (only?.length && !only.includes(fixture.id)) {
      return false
    }
    // Enforced CC0 corpus lives under omr-fixtures with thresholds
    return Boolean(fixture.thresholds) && !String(fixture.tier ?? '').startsWith('real-') &&
      !String(fixture.tier ?? '').startsWith('legacy')
  })

  const results = []
  for (const fixture of fixtures) {
    const pdfPath = resolveFixturePath(fixture.pdf, roots)
    const truthPath = resolveFixturePath(fixture.truth, roots)
    if (!pdfPath || !truthPath) {
      results.push({
        id: fixture.id,
        ok: false,
        error: `missing files pdf=${Boolean(pdfPath)} truth=${Boolean(truthPath)}`,
      })
      continue
    }
    process.stderr.write(`Evaluating ${fixture.id}...\n`)
    try {
      const rendered = await renderPdfToPages(pdfPath, {
        rootDir: ROOT,
        maxPages: fixture.maxPages ?? 4,
      })
      const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
      const omr = await runPdfOmrPipeline(pdfPath, {
        renderPage: makeRenderPageCallback(rendered.pages),
        extractPageText,
        numPages: rendered.numPages,
        maxPages: fixture.maxPages ?? 4,
        preprocessPages: true,
        instrumentId: fixture.instrumentId ?? 'piano',
        title: fixture.id,
      })
      if (!omr?.musicXml) {
        results.push({ id: fixture.id, ok: false, error: 'OMR produced no MusicXML' })
        continue
      }
      const truthXml = await readScoreXml(truthPath)
      const report = evaluateSemanticMusicXml({
        groundTruthMusicXml: truthXml,
        generatedMusicXml: omr.musicXml,
        groundTruthFileName: basename(truthPath),
        generatedFileName: `${fixture.id}.omr.musicxml`,
        options: { mode },
        meta: { gitCommit: gitCommit() },
      })
      results.push(
        summarizeFixture(fixture.id, report, {
          instrumentId: fixture.instrumentId,
          tier: fixture.tier,
        }),
      )
    } catch (error) {
      results.push({
        id: fixture.id,
        ok: false,
        error: error?.message || String(error),
      })
    }
  }

  return {
    kind: 'semantic-corpus-evaluation',
    label,
    mode,
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    frozen: true,
    gitCommit: gitCommit(),
    createdAt: new Date().toISOString(),
    fixtures: results,
    aggregate: aggregate(results),
  }
}

async function main() {
  const args = process.argv.slice(2)
  const compareBefore = argValue(args, '--compare')
  const jsonPath = argValue(args, '--json')
  const textPath = argValue(args, '--text')
  const mode = argValue(args, '--mode') ?? 'written'
  const label = argValue(args, '--label') ?? 'run'
  const only = (argValue(args, '--only') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (compareBefore) {
    const afterPath = args[args.indexOf('--compare') + 2]
    if (!afterPath) {
      throw new Error('--compare requires <before.json> <after.json>')
    }
    const before = JSON.parse(readFileSync(compareBefore, 'utf8'))
    const after = JSON.parse(readFileSync(afterPath, 'utf8'))
    const compare = compareReports(before, after)
    const payload = {
      kind: 'semantic-corpus-delta',
      beforeLabel: before.label,
      afterLabel: after.label,
      compare,
      beforeAggregate: before.aggregate,
      afterAggregate: after.aggregate,
    }
    const text = formatCompareText(compare, before, after)
    if (jsonPath) {
      mkdirSync(dirname(jsonPath), { recursive: true })
      writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`)
    }
    if (textPath) {
      mkdirSync(dirname(textPath), { recursive: true })
      writeFileSync(textPath, `${text}\n`)
    }
    console.log(text)
    process.exit(compare.accept ? 0 : 3)
  }

  const report = await evaluateCorpus({ label, mode, only })
  const text = formatBaselineText(report)

  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (textPath) {
    mkdirSync(dirname(textPath), { recursive: true })
    writeFileSync(textPath, `${text}\n`)
  }
  console.log(text)
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
