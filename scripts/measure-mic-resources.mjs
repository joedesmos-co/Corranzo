#!/usr/bin/env node
/**
 * Microphone resource measurement (Step 5 launch sprint) — browser-side
 * CPU/memory for BOTH recognizers, on the same real clip, at the real
 * MediaStream boundary.
 *
 * Spectral (production): scripts/mic-live/live.html (real capture code,
 * real v2 score-informed detector).
 * Neural (experimental): scripts/neural-live/live.html (real TF.js model).
 *
 * Reports: JS heap (performance.memory), page-level CPU proxy
 * (performance.now timing), inference/window cost, and process RSS of the
 * browser (via CDP Performance metrics where available).
 *
 * Usage: node scripts/measure-mic-resources.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CLIP = join(projectRoot, 'benchmarks/mic-accuracy/clips/real-piano-c4.wav')

function loadClip() {
  const wav = readWavPcm(CLIP)
  return { samples: Array.from(wav.samples), sampleRate: wav.sampleRate }
}

async function measurePage(browser, baseUrl, path, inject) {
  const page = await browser.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'load' })
  const before = await page.evaluate(() => ({
    heap: performance.memory?.usedJSHeapSize ?? null,
    total: performance.memory?.totalJSHeapSize ?? null,
  }))
  const t0 = Date.now()
  await inject(page)
  // Let the engine settle (first inference includes model load + compile on
  // SwiftShader; the confirmation needs a few windows).
  await page.waitForTimeout(30_000)
  const metrics = await cdp.send('Performance.getMetrics').catch(() => null)
  const after = await page.evaluate(() => ({
    heap: performance.memory?.usedJSHeapSize ?? null,
    total: performance.memory?.totalJSHeapSize ?? null,
    results: window.__liveResults
      ? {
        matched: window.__liveResults.matched?.length ?? 0,
        wrong: window.__liveResults.wrong ?? 0,
        inferMs: window.__liveResults.debug?.lastInferMs ?? null,
        windowsRun: window.__liveResults.debug?.windowsRun ?? null,
        hops: window.__liveResults.debug?.hops ?? null,
        backend: window.__liveResults.backend ?? null,
      }
      : null,
  }))
  await page.evaluate(() => window.__liveTeardown?.())
  await page.close()
  const metricByName = new Map((metrics?.metrics ?? []).map((entry) => [entry.name, entry.value]))
  return {
    wallMs: Date.now() - t0,
    heapBeforeMb: before.heap != null ? Math.round(before.heap / 1048576) : null,
    heapAfterMb: after.heap != null ? Math.round(after.heap / 1048576) : null,
    heapDeltaMb: before.heap != null && after.heap != null ? Math.round((after.heap - before.heap) / 1048576) : null,
    totalHeapMb: after.total != null ? Math.round(after.total / 1048576) : null,
    rendererCpuSeconds: metricByName.has('TaskDuration') ? Number((metricByName.get('TaskDuration') * 1000).toFixed(0)) : null,
    jsHeapMb: metricByName.has('JSHeapUsedSize') ? Math.round(metricByName.get('JSHeapUsedSize') / 1048576) : null,
    results: after.results,
  }
}

const viteServer = await createServer({
  root: projectRoot,
  configFile: resolve(projectRoot, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
await viteServer.listen()
const baseUrl = `http://127.0.0.1:${viteServer.httpServer.address().port}`
const browser = await chromium.launch({
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
})
const clip = loadClip()

const spectral = await measurePage(browser, baseUrl, '/scripts/mic-live/live.html', (page) =>
  page.evaluate(
    ({ samples, sampleRate }) => window.__liveApi.inject({ samples, sampleRate, expectedMidis: [60], checkpointId: 'res-spectral' }),
    { samples: clip.samples, sampleRate: clip.sampleRate },
  ),
)

const neural = await measurePage(browser, baseUrl, '/scripts/neural-live/live.html', (page) =>
  page.evaluate(
    ({ samples, sampleRate }) => window.__liveApi.inject({ samples, sampleRate, expectedMidis: [60], checkpointId: 'res-neural', forceListen: true }),
    { samples: clip.samples, sampleRate: clip.sampleRate },
  ),
)

console.log(JSON.stringify({
  clip: 'real-piano-c4',
  environment: 'headless Chromium, SwiftShader WebGL, 44.1 kHz injected MediaStream',
  spectral: { ...spectral, engine: 'production v2 score-informed' },
  neural: { ...neural, engine: 'experimental TF.js Basic Pitch (webgl)' },
}, null, 1))

await browser.close()
await viteServer.close()
