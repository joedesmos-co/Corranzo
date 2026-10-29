#!/usr/bin/env node
/**
 * Repeat the multi-checkpoint sequence benchmark N times and aggregate.
 *
 * The single-run sequence harness answers "did these checkpoints advance?";
 * this wrapper answers "how often, and which step is unstable?" — the same
 * discipline as scripts/benchmark-repeats.mjs, applied to sequences.
 *
 * Usage:
 *   node scripts/benchmark-mic-sequences-repeats.mjs --repeats 3
 *   node scripts/benchmark-mic-sequences-repeats.mjs --repeats 5 --scenario repeat
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback = null) {
  const prefix = `--${name}`
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === prefix) return process.argv[i + 1] ?? fallback
    if (process.argv[i].startsWith(`${prefix}=`)) return process.argv[i].slice(prefix.length + 1)
  }
  return fallback
}

const REPEATS = Math.max(1, Number(arg('repeats', '3')))
const SCENARIO = arg('scenario', null)
const V3 = arg('v3', '1')
const JSON_OUT = arg('json', null)

const workDir = mkdtempSync(join(tmpdir(), 'mic-seq-repeats-'))
const runs = []
try {
  for (let run = 1; run <= REPEATS; run += 1) {
    const out = join(workDir, `run-${run}.json`)
    const args = ['scripts/benchmark-mic-sequences.mjs', '--json', out, '--v3', V3]
    if (SCENARIO) args.push('--scenario', SCENARIO)
    process.stdout.write(`run ${run}/${REPEATS} … `)
    const result = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' })
    if (result.status !== 0) {
      console.error(`\nrun ${run} failed:\n${result.stderr?.slice(-1200) ?? ''}`)
      process.exit(1)
    }
    const data = JSON.parse(readFileSync(out, 'utf8'))
    runs.push(data)
    console.log(`steps=${data.summary.passed}/${data.summary.steps} false=${data.summary.falseAdvances} missed=${data.summary.missed}`)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

const scenarios = new Map()
for (const run of runs) {
  for (const row of run.rows) {
    const entry = scenarios.get(row.id) ?? {
      id: row.id,
      kind: row.kind,
      runs: 0,
      passRuns: 0,
      stepTotal: 0,
      stepPassed: 0,
      falseAdvances: 0,
      earlyAdvances: 0,
      missed: 0,
      steps: new Map(),
      latencies: [],
      pageErrors: 0,
    }
    entry.runs += 1
    if (row.failed === 0 && !row.error && row.pageErrors.length === 0) entry.passRuns += 1
    entry.falseAdvances += row.falseAdvances
    entry.earlyAdvances += row.earlyAdvances ?? 0
    entry.missed += row.missed
    entry.pageErrors += row.pageErrors.length
    entry.stepTotal += row.stepCount
    for (const step of row.steps) {
      entry.stepPassed += step.pass ? 1 : 0
      const stepEntry = entry.steps.get(step.stepId) ?? {
        stepId: step.stepId,
        runs: 0,
        passed: 0,
        latencies: [],
        falseAdvances: 0,
        earlyAdvances: 0,
      }
      stepEntry.runs += 1
      if (step.pass) stepEntry.passed += 1
      if (!step.expectAdvance && step.advanced) stepEntry.falseAdvances += 1
      if (step.earlyAdvance) stepEntry.earlyAdvances += 1
      if (step.latencyMs != null && step.expectAdvance) {
        entry.latencies.push(step.latencyMs)
        stepEntry.latencies.push(step.latencyMs)
      }
      entry.steps.set(step.stepId, stepEntry)
    }
    scenarios.set(row.id, entry)
  }
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

const rows = [...scenarios.values()].map((entry) => {
  const steps = [...entry.steps.values()].map((step) => ({
    stepId: step.stepId,
    passRate: `${step.passed}/${step.runs}`,
    falseAdvances: step.falseAdvances,
    earlyAdvances: step.earlyAdvances,
    latencyP50: percentile(step.latencies, 0.5),
  }))
  const unstableSteps = steps.filter((step) => {
    const [passed, total] = step.passRate.split('/').map(Number)
    return passed !== total
  })
  return {
    id: entry.id,
    kind: entry.kind,
    runs: entry.runs,
    passRuns: entry.passRuns,
    steps: `${entry.stepPassed}/${entry.stepTotal}`,
    falseAdvances: entry.falseAdvances,
    earlyAdvances: entry.earlyAdvances,
    missed: entry.missed,
    pageErrors: entry.pageErrors,
    unstableSteps,
    latency: entry.latencies.length
      ? {
          n: entry.latencies.length,
          p50: percentile(entry.latencies, 0.5),
          p95: percentile(entry.latencies, 0.95),
        }
      : null,
  }
})

console.log('\nper scenario (scenario pass runs / repeats, step pass rate):')
for (const row of rows) {
  console.log(
    `  ${row.id.padEnd(40)} ${row.passRuns}/${row.runs}  steps=${row.steps}`
    + ` false=${row.falseAdvances} early=${row.earlyAdvances} missed=${row.missed}`
    + (row.latency ? ` p50=${row.latency.p50}ms p95=${row.latency.p95}ms` : ''),
  )
  for (const step of row.unstableSteps) {
    console.log(`     UNSTABLE ${step.stepId}: ${step.passRate} false=${step.falseAdvances} early=${step.earlyAdvances}`)
  }
}

const allSteps = rows.reduce(
  (acc, row) => {
    const [passed, total] = row.steps.split('/').map(Number)
    acc.passed += passed
    acc.total += total
    return acc
  },
  { passed: 0, total: 0 },
)
const summary = {
  repeats: REPEATS,
  scenarios: rows.length,
  scenarioPassRuns: rows.reduce((sum, row) => sum + row.passRuns, 0),
  scenarioRuns: rows.reduce((sum, row) => sum + row.runs, 0),
  stepPasses: allSteps.passed,
  stepTotal: allSteps.total,
  stepRate: allSteps.total ? Number((allSteps.passed / allSteps.total).toFixed(3)) : 0,
  falseAdvances: rows.reduce((sum, row) => sum + row.falseAdvances, 0),
  earlyAdvances: rows.reduce((sum, row) => sum + row.earlyAdvances, 0),
  missed: rows.reduce((sum, row) => sum + row.missed, 0),
  unstableScenarios: rows.filter((row) => row.passRuns !== row.runs).map((row) => row.id),
  pageErrors: rows.reduce((sum, row) => sum + row.pageErrors, 0),
}
console.log('\naggregate:', JSON.stringify(summary, null, 1))
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ summary, rows }, null, 1))
}
