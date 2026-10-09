#!/usr/bin/env node
/**
 * Full-set browser transcription sweep (Stage 6, N4/N6) — test-only.
 * Runs every benchmark clip through TF.js Basic Pitch in real Chromium
 * (CPU backend) and writes per-clip pitch sets for CoreML-vs-browser
 * agreement analysis. Slow (~15 s/clip, model reloads per page).
 *
 * Usage:
 *   CORRANZO_NEURAL_VENDOR=/tmp/tfjs-probe/node_modules node scripts/neural-browser-sweep.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startNeuralBrowserServer } from './neural-browser/server.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', 'mic-real', 'manifest.json'), 'utf8'))
  const server = await startNeuralBrowserServer(0)
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ headless: true })
  const rows = []
  for (const clip of manifest.clips) {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/harness/page.html?clip=${clip.audio.file.split('/').pop()}`, { waitUntil: 'load' })
    try {
      await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 180_000 })
      const results = await page.evaluate(() => window.__neuralResults)
      if (results.status !== 'done') {
        rows.push({ id: clip.id, error: results.message ?? 'unknown' })
      } else {
        const anchor = clip.truth.anchorTones
        let detected = []
        let first = {}
        if (clip.truth.anchorOnset != null) {
          const lo = clip.truth.anchorOnset - 0.3
          const hi = clip.truth.anchorOnset + 1.0
          const inWindow = results.fullNotes.filter((n) => n.start < hi && n.end > lo)
          detected = [...new Set(inWindow.map((n) => n.midi))].sort((a, b) => a - b)
          for (const n of inWindow) {
            if (!(n.midi in first) || n.start < first[n.midi]) {
              first[n.midi] = n.start
            }
          }
        } else {
          detected = [...new Set(results.fullNotes.map((n) => n.midi))].sort((a, b) => a - b)
        }
        const anchorHit = anchor.filter((m) => detected.includes(m)).length
        rows.push({
          id: clip.id,
          anchor,
          detected,
          anchorRecall: anchor.length ? anchorHit / anchor.length : null,
          inferMs: Math.round(results.fullInferMs),
          noteCount: results.fullNotes.length,
        })
      }
      console.log(`${clip.id}: ${JSON.stringify(rows[rows.length - 1].detected)}`)
    } catch {
      rows.push({ id: clip.id, error: 'timeout' })
      console.log(`${clip.id}: TIMEOUT`)
    }
    await page.close()
  }
  await browser.close()
  await new Promise((done) => server.close(done))
  mkdirSync(join(ROOT, 'tmp'), { recursive: true })
  writeFileSync(join(ROOT, 'tmp', 'neural-browser-full.json'), JSON.stringify(rows, null, 2))
  console.log('wrote tmp/neural-browser-full.json')
}

main()
