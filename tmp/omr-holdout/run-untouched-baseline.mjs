/**
 * Untouched holdout baseline — regenerate OMR from source PDFs only.
 * No production changes. Private paths from intake-paths.json (tmp only).
 */
import { createHash } from 'crypto'
import { execFileSync, execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { performance } from 'perf_hooks'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'

const ROOT = process.cwd()
const OUT = join(ROOT, 'tmp/omr-holdout')
mkdirSync(join(OUT, 'baseline-generated'), { recursive: true })

const manifest = JSON.parse(readFileSync(join(OUT, 'HOLDOUT_MANIFEST.json'), 'utf8'))
const split = JSON.parse(readFileSync(join(OUT, 'HOLDOUT_SPLIT.json'), 'utf8'))
const pathFile = JSON.parse(readFileSync(join(OUT, 'intake-paths.json'), 'utf8'))
const paths = pathFile.paths
const HOME = process.env.HOME

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function rssMb() {
  try {
    return Math.round((Number(execSync(`ps -o rss= -p ${process.pid}`, { encoding: 'utf8' }).trim()) / 1024) * 10) / 10
  } catch {
    return null
  }
}

function summarizeXml(xml) {
  if (!xml) return {}
  return {
    slurCount: (xml.match(/<slur /g) || []).length,
    tieCount: (xml.match(/<tie /g) || []).length,
    accentCount: (xml.match(/<accent/g) || []).length,
    staccatoCount: (xml.match(/<staccato/g) || []).length,
    endingCount: (xml.match(/<ending /g) || []).length,
    repeatCount: (xml.match(/<repeat /g) || []).length,
    tupletCount: (xml.match(/<tuplet /g) || []).length,
  }
}

async function runOne(entry, { preprocessPages = false, maxPages = 8 } = {}) {
  const started = performance.now()
  const peakBefore = rssMb()
  const pdf = paths[entry.holdoutId]?.pdf
  if (!pdf || !existsSync(pdf)) {
    return {
      holdoutId: entry.holdoutId,
      ok: false,
      error: 'missing-pdf',
      elapsedMs: Math.round(performance.now() - started),
      split: entry.split,
    }
  }
  const pdfSha = sha256File(pdf)
  if (entry.sha256 && pdfSha !== entry.sha256) {
    return {
      holdoutId: entry.holdoutId,
      ok: false,
      error: `sha-mismatch expected=${entry.sha256} got=${pdfSha}`,
      elapsedMs: Math.round(performance.now() - started),
      split: entry.split,
    }
  }

  let rendered = null
  let error = null
  let result = null
  try {
    rendered = await renderPdfToPages(pdf, { rootDir: ROOT, maxPages })
    const extractPageText = await makePdfTextExtractor(pdf, { rootDir: ROOT })
    result = await runPdfOmrPipeline(pdf, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.pages.length,
      maxPages,
      preprocessPages,
      instrumentId: entry.instrument || paths[entry.holdoutId]?.instrumentId || 'piano',
      title: entry.title || entry.holdoutId,
    })
  } catch (err) {
    error = String(err?.message || err)
  }

  const elapsedMs = Math.round(performance.now() - started)
  const xml = result?.musicXml || ''
  if (xml) writeFileSync(join(OUT, 'baseline-generated', `${entry.holdoutId}.musicxml`), xml)
  const xmlStats = summarizeXml(xml)

  let passageChecks = null
  const truthPath = join(OUT, 'truth/passages', `${entry.holdoutId}.json`)
  if (existsSync(truthPath) && entry.split === 'development' && xml) {
    const truth = JSON.parse(readFileSync(truthPath, 'utf8'))
    const facts = Object.assign({}, ...(truth.passages || []).map((p) => p.facts || {}))
    passageChecks = {
      tier: truth.tier,
      generatedHasTuplets: xmlStats.tupletCount > 0,
      expectTuplets: !!(facts.tupletsPresent || facts.tripletBrackets),
      generatedHasStaccato: xmlStats.staccatoCount > 0,
      expectStaccato: !!(facts.staccatoPresent || facts.staccatoChords || facts.lhStaccatoEighthPedal),
      generatedHasRepeats: xmlStats.repeatCount > 0,
      expectRepeats: !!(facts.repeatsPresent || facts.endRepeatNearM8),
      generatedHasTies: xmlStats.tieCount > 0,
      expectTies: !!facts.tiesPresent,
      note: 'Feature presence only — not pitch/rhythm Overall',
    }
  }

  return {
    holdoutId: entry.holdoutId,
    title: entry.title || entry.holdoutId,
    instrumentId: entry.instrument || paths[entry.holdoutId]?.instrumentId,
    rendering: entry.rendering,
    scoreType: entry.scoreType,
    split: entry.split,
    pdfSha256: pdfSha,
    ok: !error && result?.acceptance === 'accepted',
    acceptance: result?.acceptance ?? null,
    error,
    pageCount: rendered?.pages?.length ?? null,
    noteCount: result?.noteCount ?? null,
    measureCount: result?.measureCount ?? null,
    systems: result?.diagnostics?.systems ?? null,
    confidence: result?.diagnostics?.overallConfidence ?? result?.overallConfidence ?? null,
    uncertainMeasures: result?.diagnostics?.uncertainMeasures ?? null,
    warnings: result?.diagnostics?.warnings ?? result?.warnings ?? null,
    failureReasons: result?.diagnostics?.failureReasons ?? null,
    difficulty: result?.diagnostics?.difficulty ?? null,
    tablature: result?.diagnostics?.tablature ?? null,
    ...xmlStats,
    elapsedMs,
    peakRssMbBefore: peakBefore,
    peakRssMbAfter: rssMb(),
    generatedXmlPath: xml ? `tmp/omr-holdout/baseline-generated/${entry.holdoutId}.musicxml` : null,
    hasReferenceMusicXml: !!entry.hasReferenceMusicXml,
    semanticScores: null,
    passageChecks,
  }
}

function summarize(rows) {
  return {
    ok: rows.filter((r) => r.ok).length,
    total: rows.length,
    notes: rows.reduce((s, r) => s + (r.noteCount || 0), 0),
    elapsedMs: rows.reduce((s, r) => s + (r.elapsedMs || 0), 0),
    crashes: rows.filter((r) => r.error).length,
    rejected: rows.filter((r) => !r.ok && !r.error).length,
  }
}

const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const prodTree = execFileSync(
  'git',
  ['diff', '--stat', 'f091ee7..HEAD', '--', 'src/features/omr', 'tests'],
  { cwd: ROOT, encoding: 'utf8' },
).trim()

const strictResults = []
for (const entry of manifest.strictHoldouts) {
  console.error(`[strict/${entry.split}] ${entry.holdoutId}`)
  const maxPages = Math.max(8, entry.pageCount || 8)
  strictResults.push(await runOne(entry, { preprocessPages: false, maxPages }))
}

if (!paths['piano-iris-out-arrangement']) {
  paths['piano-iris-out-arrangement'] = {
    pdf: join(HOME, 'Downloads/iris-out-piano-arragement.pdf'),
    instrumentId: 'piano',
  }
}

const weakResults = []
const weakEntry = {
  holdoutId: 'piano-iris-out-arrangement',
  title: 'Iris Out — piano arrangement',
  instrument: 'piano',
  split: 'weak',
  sha256: '94002e4d7e84604f0f1ae31752c1525c669280b10d21a920ea9ffeaf7712e365',
}
console.error(`[weak] ${weakEntry.holdoutId}`)
weakResults.push(await runOne(weakEntry, { preprocessPages: true, maxPages: 8 }))

let frozenControl = null
const phase0Path = join(OUT, 'phase0-frozen-corpus.json')
if (existsSync(phase0Path)) {
  const p0 = JSON.parse(readFileSync(phase0Path, 'utf8'))
  frozenControl = {
    source: 'tmp/omr-holdout/phase0-frozen-corpus.json',
    overall: p0.aggregate?.meanOverall ?? null,
    pitch: p0.aggregate?.classes?.pitch?.meanScore ?? null,
    articulation: p0.aggregate?.classes?.articulation?.meanScore ?? null,
    fixtureCount: p0.fixtures?.length ?? null,
    note: 'Control from Phase 0 at same HEAD; not re-tuned',
  }
}

const bySplit = (splitName) => strictResults.filter((r) => r.split === splitName)

const payload = {
  kind: 'omr-strict-holdout-untouched-baseline',
  createdAt: new Date().toISOString(),
  gitHead: head,
  productionOmrBaseline: 'f091ee7',
  freezeTestCommit: '613fa73',
  productionTreeVsF091ee7: prodTree || '(no src/omr diff)',
  evaluatorVersion: '2.0.0',
  schemaVersion: 2,
  split: {
    method: split.method,
    evaluationHoldoutIds: split.evaluationHoldoutIds,
    developmentHoldoutIds: split.developmentHoldoutIds,
  },
  strict: strictResults,
  weak: weakResults,
  frozenCorpusControl: frozenControl,
  aggregates: {
    strict: summarize(strictResults),
    development: summarize(bySplit('development')),
    evaluation: summarize(bySplit('evaluation')),
    weak: summarize(weakResults),
  },
}

writeFileSync(join(OUT, 'UNTOUCHED_BASELINE.json'), JSON.stringify(payload, null, 2))

const summary = {
  aggregates: payload.aggregates,
  strict: strictResults.map((r) => ({
    id: r.holdoutId,
    split: r.split,
    ok: r.ok,
    acceptance: r.acceptance,
    error: r.error,
    pages: r.pageCount,
    notes: r.noteCount,
    measures: r.measureCount,
    ms: r.elapsedMs,
    warns: (r.warnings || []).slice(0, 3),
    tab: r.tablature
      ? {
          pairingConfidence: r.tablature.pairingConfidence,
          unpaired: r.tablature.unpairedNotationNotes,
          unused: r.tablature.unusedTabDigits,
          tabOnly: r.tablature.tabOnly,
          rhythmApproximate: r.tablature.rhythmApproximate,
        }
      : null,
    passageChecks: r.passageChecks,
    repeats: r.repeatCount,
    tuplets: r.tupletCount,
    staccato: r.staccatoCount,
  })),
  weak: weakResults.map((r) => ({
    id: r.holdoutId,
    ok: r.ok,
    error: r.error,
    notes: r.noteCount,
    ms: r.elapsedMs,
  })),
  frozenControl,
}

writeFileSync(join(OUT, 'UNTOUCHED_BASELINE_SUMMARY.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
