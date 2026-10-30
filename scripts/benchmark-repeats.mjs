#!/usr/bin/env node
/**
 * Repeatable production benchmark: runs the verified production harness N
 * times and reports per-clip and aggregate distributions (true/false
 * advance frequency, latency p50/p95 across runs).
 *
 * The single-run benchmark answers "did it complete?"; this answers "how
 * often, and how stable?" — the mission's Phase-1 requirement for repeated
 * trials instead of one run.
 *
 * Usage:
 *   node scripts/benchmark-repeats.mjs --clips mic-accuracy --repeats 3
 *   node scripts/benchmark-repeats.mjs --clips mic-real --split eval-fresh \
 *     --scenario octave-up,neighbor --repeats 3
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
const CLIPS = arg('clips', 'mic-accuracy')
const SPLIT = arg('split', null)
const SCENARIO = arg('scenario', null)
const JSON_OUT = arg('json', null)

const workDir = mkdtempSync(join(tmpdir(), 'mic-repeats-'))
const runs = []

try {
  for (let run = 1; run <= REPEATS; run += 1) {
    const out = join(workDir, `run-${run}.json`)
    const args = ['scripts/benchmark-production-corpus.mjs', '--clips', CLIPS, '--json', out]
    if (SPLIT) args.push('--split', SPLIT)
    if (SCENARIO) args.push('--scenario', SCENARIO)
    process.stdout.write(`run ${run}/${REPEATS} … `)
    const result = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' })
    if (result.status !== 0) {
      console.error(`\nrun ${run} failed:\n${result.stderr?.slice(-800) ?? ''}`)
      process.exit(1)
    }
    const data = JSON.parse(readFileSync(out, 'utf8'))
    runs.push(data)
    console.log(`true=${data.summary.trueComplete}/${data.summary.clips} false=${data.summary.falseCompletes}/${data.summary.scenarios}`)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

// Aggregate per clip.
const byClip = new Map()
for (const run of runs) {
  for (const row of run.rows) {
    if (row.silenceClip) continue
    const entry = byClip.get(row.id) ?? {
      id: row.id,
      trueRuns: 0,
      runs: 0,
      falseRuns: 0,
      latencies: [],
      fps: new Set(),
    }
    entry.runs += 1
    const advanced = row.trueAdvanced ?? row.true?.advanced ?? false
    const advanceMs = row.trueAdvanceMs ?? row.true?.advanceTimeMs ?? null
    const falseCompletes = row.falseCompletes ?? row.fps ?? []
    if (advanced) {
      entry.trueRuns += 1
      if (Number.isFinite(advanceMs)) entry.latencies.push(advanceMs)
    }
    if (falseCompletes.length) {
      entry.falseRuns += 1
      for (const fp of falseCompletes) entry.fps.add(fp.name ?? String(fp))
    }
    byClip.set(row.id, entry)
  }
}

const rate = (n, d) => `${n}/${d}`
const aggregate = {
  repeats: REPEATS,
  clips: byClip.size,
  trueRate: Array.from(byClip.values()).reduce((sum, entry) => sum + entry.trueRuns, 0) / Math.max(1, byClip.size * REPEATS),
  falseRate: Array.from(byClip.values()).reduce((sum, entry) => sum + entry.falseRuns, 0) / Math.max(1, byClip.size * REPEATS),
  unstableClips: Array.from(byClip.values()).filter((entry) => entry.trueRuns > 0 && entry.trueRuns < entry.runs).map((entry) => entry.id),
  falseCases: Array.from(byClip.values()).filter((entry) => entry.falseRuns > 0).map((entry) => ({ id: entry.id, falseRuns: entry.falseRuns, runs: entry.runs, scenarios: [...entry.fps] })),
}

console.log('\nper clip (true completions / runs):')
for (const entry of [...byClip.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  const lat = entry.latencies.length
    ? ` p50=${entry.latencies[Math.floor(entry.latencies.length * 0.5)]}ms`
    : ''
  console.log(
    `  ${entry.id.padEnd(32)} ${rate(entry.trueRuns, entry.runs)}${lat}`
    + (entry.falseRuns ? `  FALSE ${rate(entry.falseRuns, entry.runs)} [${[...entry.fps].join(',')}]` : ''),
  )
}
console.log('\naggregate:', JSON.stringify({
  repeats: aggregate.repeats,
  clips: aggregate.clips,
  trueRate: Number(aggregate.trueRate.toFixed(3)),
  falseRate: Number(aggregate.falseRate.toFixed(3)),
  unstableClips: aggregate.unstableClips,
  falseCases: aggregate.falseCases,
}, null, 1))

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ aggregate, clips: [...byClip.values()].map((entry) => ({ ...entry, fps: [...entry.fps] })) }, null, 1))
}
