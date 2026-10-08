#!/usr/bin/env node
/**
 * Hardware-backend TF.js probe (Stage 7, M1) — test-only.
 * Launches full Chromium with Metal ANGLE (verified Apple M4 renderer),
 * runs Basic Pitch inference + chunked windows, reports timings/notes.
 * Compares against the SwiftShader/CPU baseline from Stage 6.
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { startNeuralBrowserServer } from './neural-browser/server.mjs'
import { preparePatchedVendor } from './neural-browser/prepare-vendor.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CLIPS = [
  'acoustic-power-dyad.wav',
  'piano-mozart-triad.wav',
  'acoustic-strum-dense.wav',
  'electric-eg10-dense.wav',
]

async function runClip(browser, baseUrl, clip, backend) {
  const page = await browser.newPage()
  await page.goto(`${baseUrl}/harness/page.html?clip=${clip}&chunked=1&backend=${backend}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 240_000 })
  const results = await page.evaluate(() => window.__neuralResults)
  await page.close()
  return results
}

async function main() {
  preparePatchedVendor(ROOT)
  const server = await startNeuralBrowserServer(0)
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  for (const backend of ['cpu', 'webgl']) {
    const browser = await chromium.launch({
      headless: true,
      channel: 'chromium',
      args: ['--use-angle=metal'],
    })
    // Verify the backend under the hood before trusting timings.
    const probe = await browser.newPage()
    const renderer = await probe.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
    })
    await probe.close()
    console.log(`# backend=${backend} renderer=${renderer}`)
    for (const clip of CLIPS) {
      const results = await runClip(browser, baseUrl, clip, backend)
      if (results.status !== 'done') {
        console.log(`${clip}: ERROR ${(results.message ?? '').slice(0, 120)}`)
        continue
      }
      console.log(`${clip}: tfBackend=${results.backend} initMs=${results.initMs} ` +
        `fullInferMs=${results.fullInferMs} notes=${results.fullNotes.length} ` +
        `chunks=${(results.chunked?.windows ?? []).map((w) => Math.round(w.inferMs)).join('/')}`)
    }
    await browser.close()
  }
  await new Promise((done) => server.close(done))
}

main()
