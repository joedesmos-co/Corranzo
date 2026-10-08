#!/usr/bin/env node
/**
 * Streaming-window accuracy sweep (Stage 7, M3) — test-only.
 * Chromium + Metal WebGL, 0.5/1/2 s windows on real clips, full note
 * payloads saved for anchor-recall / edge-artifact / FP analysis.
 *
 * Usage:
 *   CORRANZO_NEURAL_VENDOR=/tmp/tfjs-probe/node_modules node scripts/neural-window-sweep.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startNeuralBrowserServer } from './neural-browser/server.mjs'
import { preparePatchedVendor } from './neural-browser/prepare-vendor.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WINDOWS = ['0.5', '1', '2']
const CLIPS = [
  'piano-mozart-triad.wav',
  'piano-schubert-dense.wav',
  'acoustic-power-dyad.wav',
  'acoustic-strum-dense.wav',
  'electric-eg07-dyad.wav',
  'electric-eg10-dense.wav',
  'electric-gtechs-quiet.wav',
]

async function main() {
  preparePatchedVendor(ROOT)
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', 'mic-real', 'manifest.json'), 'utf8'))
  const truthByFile = new Map()
  for (const clip of manifest.clips) {
    truthByFile.set(clip.audio.file.split('/').pop(), clip)
  }
  const server = await startNeuralBrowserServer(0)
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal'] })
  const out = []
  for (const window of WINDOWS) {
    for (const clip of CLIPS) {
      const page = await browser.newPage()
      await page.goto(`${baseUrl}/harness/page.html?clip=${clip}&chunked=1&window=${window}&backend=webgl`, { waitUntil: 'load' })
      try {
        await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 240_000 })
        const results = await page.evaluate(() => window.__neuralResults)
        const truth = truthByFile.get(clip)
        out.push({
          clip,
          windowSeconds: Number(window),
          backend: results.backend,
          status: results.status,
          anchorTones: truth?.truth.anchorTones ?? [],
          anchorOnset: truth?.truth.anchorOnset ?? null,
          truthMidis: [...new Set((truth?.truth.notes ?? []).map((n) => n.midi))].sort((a, b) => a - b),
          windows: (results.chunked?.windows ?? []).map((w) => ({
            start: w.windowStartSeconds,
            inferMs: Math.round(w.inferMs * 10) / 10,
            notes: w.notes,
          })),
        })
        console.log(`${window}s ${clip}: ${(results.chunked?.windows ?? []).length} windows ok`)
      } catch {
        out.push({ clip, windowSeconds: Number(window), status: 'timeout' })
        console.log(`${window}s ${clip}: TIMEOUT`)
      }
      await page.close()
    }
  }
  await browser.close()
  await new Promise((done) => server.close(done))
  mkdirSync(join(ROOT, 'tmp'), { recursive: true })
  writeFileSync(join(ROOT, 'tmp', 'neural-window-sweep.json'), JSON.stringify(out, null, 2))
  console.log('wrote tmp/neural-window-sweep.json')
}

main()
