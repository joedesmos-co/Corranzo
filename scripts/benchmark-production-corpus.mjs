#!/usr/bin/env node
/**
 * PRODUCTION microphone corpus benchmark — real Chromium, real app capture
 * code, real production hook (V3 performance expectations + V2 fallback),
 * real labeled recordings at the MediaStream boundary.
 *
 * This is the authoritative baseline: the offline module replay
 * (scripts/benchmark-spectral-corpus.mjs) does NOT include the hook's
 * monophonic corroboration, the V3 expectation path, calibration or the
 * attack latch, so it can mis-state production behaviour. Every number
 * quoted for the shipped recognizer must come from here.
 *
 * Usage:
 *   node scripts/benchmark-production-corpus.mjs --clips legacy [--json out.json]
 *   node scripts/benchmark-production-corpus.mjs --clips all
 *
 * Measures per scenario: advanced?, advance latency (onset -> WFY advance),
 * heard notes, wrong-note reports, engine mode.
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { wrongExpectations } from './lib/micFalseAwardScenarios.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOM_TONE_SECONDS = 4
const SETTLE_MS = 20_000
const DWELL_MS = 12_000

function arg(name, fallback = null) {
  const prefix = `--${name}`
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === prefix) {
      return process.argv[i + 1] ?? fallback
    }
    if (process.argv[i].startsWith(`${prefix}=`)) {
      return process.argv[i].slice(prefix.length + 1)
    }
  }
  return fallback
}

const CLIP_SET = arg('clips', 'legacy')
// Fast regression mode: true completions only (skip the wrong-expectation
// sweep). The full matrix is the default.
const TRUE_ONLY = arg('true-only', '0') === '1'
// Optional scenario-name filter (substring), e.g. octave-up for a fast
// focused regression of the odd-partial rule.
const SCENARIO_FILTER = arg('scenario', null)
const JSON_OUT = arg('json', null)

// ---- clip collection (same corpora and expectations as the A/B) ----------
const SPECS = {
  'mic-accuracy': (clip) => ({
    file: join(ROOT, 'benchmarks/mic-accuracy', clip.file),
    instrument: clip.instrument,
    expected: clip.expectedMidi != null ? [clip.expectedMidi] : (clip.expectedMidis ?? []),
    truth: null,
    startMs: clip.startMs,
    endMs: clip.endMs,
    onsetMs: Math.max(0, (clip.expectedOnsetMs ?? 120) - (clip.startMs ?? 0)),
  }),
  'mic-polyphony': (clip) => ({
    file: join(ROOT, 'benchmarks/mic-polyphony', clip.file),
    instrument: clip.instrument,
    expected: clip.expectedMidis ?? [],
    truth: null,
    startMs: clip.startMs,
    endMs: clip.endMs,
    onsetMs: Math.max(0, (clip.expectedOnsetMs ?? 120) - (clip.startMs ?? 0)),
  }),
  'mic-real': (clip) => ({
    file: join(ROOT, 'benchmarks/mic-real', clip.audio.file),
    instrument: clip.instrument,
    expected: clip.truth?.anchorTones ?? [],
    truth: (clip.truth?.notes ?? []).map((note) => note.midi),
    startMs: null,
    endMs: null,
    onsetMs: Math.round((clip.truth?.anchorOnset ?? 0.5) * 1000),
  }),
  'mic-composites': (clip) => ({
    file: join(ROOT, 'benchmarks/mic-composites', clip.audio.file),
    instrument: clip.instrument,
    expected: clip.truth.anchorTones ?? [],
    truth: (clip.truth.notes ?? []).map((note) => note.midi),
    startMs: null,
    endMs: null,
    onsetMs: Math.round(Math.min(...(clip.truth.notes ?? [{ onset: 0.1 }]).map((note) => note.onset)) * 1000),
  }),
}

function collectClips() {
  const wanted = CLIP_SET === 'all'
    ? ['mic-accuracy', 'mic-polyphony', 'mic-composites']
    : CLIP_SET.split(',')
  const out = []
  const split = arg('split', null)
  for (const name of wanted) {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', name, 'manifest.json'), 'utf8'))
    const excluded = new Set((manifest.excluded ?? []).map((entry) => entry.id))
    for (const clip of manifest.clips ?? []) {
      if (excluded.has(clip.id)) {
        continue
      }
      if (name === 'mic-real' && split && clip.split !== split) {
        continue
      }
      if (!clip.file && !clip.audio?.file) {
        continue // synthetic/silence entries have no recording
      }
      const spec = SPECS[name]?.(clip)
      if (!spec?.file || !spec.expected.length) {
        continue
      }
      out.push({ id: clip.id, corpus: name, ...spec })
    }
  }
  return out
}

// ---- browser driver ------------------------------------------------------
const viteServer = await createServer({
  root: ROOT,
  configFile: resolve(ROOT, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
await viteServer.listen()
const baseUrl = `http://127.0.0.1:${viteServer.httpServer.address().port}`
const browser = await chromium.launch({
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
})

function loadSamples(clip) {
  const wav = readWavPcm(clip.file)
  const raw = wav.samples
  const from = clip.startMs != null ? Math.floor((clip.startMs / 1000) * wav.sampleRate) : 0
  const to = clip.endMs != null ? Math.floor((clip.endMs / 1000) * wav.sampleRate) : raw.length
  return { samples: Array.from(raw.subarray(from, Math.min(to, raw.length))), sampleRate: wav.sampleRate }
}

async function runScenario(pageUrl, clip, expected) {
  const page = await browser.newPage()
  try {
    await page.goto(pageUrl, { waitUntil: 'load' })
    const samples = loadSamples(clip)
    await page.evaluate(
      ({ samples: s, sampleRate, expected: e, instrument }) => window.__liveApi.inject({
        samples: s,
        sampleRate,
        expectedMidis: e,
        checkpointId: 'bench',
        instrumentId: instrument,
      }),
      { samples: samples.samples, sampleRate: samples.sampleRate, expected, instrument: clip.instrument },
    )
    // Wait until listening or a decision.
    const t0 = Date.now()
    let settled = null
    while (Date.now() - t0 < SETTLE_MS) {
      await page.waitForTimeout(400)
      const r = await page.evaluate(() => window.__liveResults)
      if (r && (r.matched.length >= 1 || r.wrong > 0)) {
        settled = r
        break
      }
    }
    if (!settled) {
      // Give the note time to land (calibration + room tone are already past).
      const dwellStart = Date.now()
      while (Date.now() - dwellStart < DWELL_MS) {
        await page.waitForTimeout(400)
        const r = await page.evaluate(() => window.__liveResults)
        if (r && (r.matched.length >= 1 || r.wrong > 0)) {
          settled = r
          break
        }
      }
    }
    const results = settled ?? (await page.evaluate(() => window.__liveResults))
    const injectedAt = await page.evaluate(() => window.__liveInjectedAt ?? null)
    const matched = results?.matched?.[0] ?? null
    // Onset = audio start + room-tone prelude + clip onset (sliced start
    // is 0, the labeled onset is relative to the sliced clip).
    const onsetAt = injectedAt != null
      ? injectedAt + ROOM_TONE_SECONDS * 1000 + clip.onsetMs
      : null
    return {
      advanced: (results?.matched?.length ?? 0) >= 1,
      wrong: results?.wrong ?? 0,
      matchedAt: matched?.atMs ?? null,
      latencyMs: matched?.atMs != null && onsetAt != null ? Math.round(matched.atMs - onsetAt) : null,
      outcome: results?.feedbackOutcome ?? null,
      mode: results?.micEngineMode ?? null,
      heard: (results?.trace ? null : null),
      phase: results?.phase ?? null,
    }
  } finally {
    await page.evaluate(() => window.__liveTeardown?.()).catch(() => {})
    await page.close()
  }
}

const clips = collectClips()
console.log(`production corpus benchmark: ${clips.length} clips (${CLIP_SET})`)

const rows = []
let scenarioCount = 0
let falseCompletes = 0
let trueCompletes = 0
const latencies = []

for (const clip of clips) {
  const trueResult = await runScenario(`${baseUrl}/scripts/mic-live/live.html`, clip, clip.expected)
  const allScenarios = TRUE_ONLY ? [] : wrongExpectations(clip.expected, clip.truth)
  const scenarios = SCENARIO_FILTER
    ? allScenarios.filter((scenario) => scenario.name.includes(SCENARIO_FILTER))
    : allScenarios
  const fps = []
  for (const scenario of scenarios) {
    const result = await runScenario(`${baseUrl}/scripts/mic-live/live.html`, clip, scenario.expected)
    scenarioCount += 1
    if (result.advanced) {
      fps.push(scenario.name)
    }
  }
  if (trueResult.advanced) {
    trueCompletes += 1
    if (trueResult.latencyMs != null) {
      latencies.push(trueResult.latencyMs)
    }
  }
  falseCompletes += fps.length
  rows.push({ id: clip.id, corpus: clip.corpus, expected: clip.expected, true: trueResult, fps })
  console.log(
    ` ${clip.id.padEnd(34)} true=${trueResult.advanced ? `ADV@${trueResult.latencyMs ?? '?'}ms` : 'no'}`
    + ` fp=[${fps.join(',') || '—'}] wrongReports=${trueResult.wrong} mode=${trueResult.mode ?? '?'}`,
  )
}

const summary = {
  clips: clips.length,
  trueComplete: trueCompletes,
  trueCompleteRate: clips.length ? trueCompletes / clips.length : 0,
  falseCompletes,
  scenarios: scenarioCount,
  latency: latencies.length
    ? {
      n: latencies.length,
      min: Math.min(...latencies),
      p50: [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length * 0.5)],
      max: Math.max(...latencies),
    }
    : null,
}
console.log('\n=== PRODUCTION (current main: V3 + V2) ===')
console.log(JSON.stringify(summary, null, 1))
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ summary, rows }, null, 1))
}

await browser.close()
await viteServer.close()
