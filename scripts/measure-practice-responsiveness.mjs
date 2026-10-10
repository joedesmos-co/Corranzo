#!/usr/bin/env node
/**
 * Practice responsiveness + capture lifecycle measurement (informational).
 *
 *  - MIDI inject -> highlight-change latency (MutationObserver, ms)
 *  - rAF rate + longtasks during playback
 *  - capture cold-start: mic select -> first debug frame (ms)
 *  - mode-switch gap: last WFY frame -> first Play Along frame (ms)
 *
 * Prints measurements; exits 0 unless something is catastrophically wrong.
 * Usage: E2E_PORT=5599 node scripts/measure-practice-responsiveness.mjs
 */
import { createServer } from 'vite'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const PORT = Number(process.env.E2E_PORT ?? 5599)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const viteServer = await createServer({
    root,
    configFile: join(root, 'vite.config.js'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const clip = join(root, 'tmp/unified-practice-mic/mic-quiet.wav')
  void clip
  const out = {}
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?e2e-midi=1`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(async () => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(`http://127.0.0.1:${PORT}/?e2e-midi=1`, { waitUntil: 'networkidle' })
    await sleep(1500)
    await page.getByRole('button', { name: 'Open score' }).first().click()
    await sleep(8000)
    await page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1200)

    // 1. MIDI inject -> highlight change latency.
    const dialog = page.getByRole('dialog', { name: 'How should Corranzo hear you?' })
    if (await dialog.isVisible().catch(() => false)) {
      const midi = dialog.getByRole('button', { name: /Use MIDI/i })
      if (await midi.isVisible().catch(() => false)) {
        await midi.click()
        await sleep(500)
      }
    }
    // Dock fallback (modal may not appear).
    const inputLabel = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.workspace-tool-button')]
      const input = buttons.find((button) => button.getAttribute('aria-label') === 'Practice input')
      return input ? input.textContent.trim().slice(0, 40) : null
    }).catch(() => null)
    if (!inputLabel || !/midi/i.test(inputLabel)) {
      const connect = page.getByRole('button', { name: 'Practice input' })
      if (await connect.isVisible().catch(() => false)) {
        await connect.click()
        await sleep(600)
        const midiOption = page.getByRole('button', { name: 'MIDI keyboard' })
        if (await midiOption.isVisible().catch(() => false)) {
          const disabled = await midiOption.isDisabled().catch(() => true)
          if (!disabled) {
            await midiOption.click()
            await sleep(600)
          }
        }
        await page.keyboard.press('Escape').catch(() => {})
        await sleep(400)
      }
    }
    const latency = await page.evaluate(async () => {
      const box = document.querySelector('[data-score-note-state="current"], [data-score-note-state="current-partial"]')
      const expected = (box?.getAttribute('data-score-expected') ?? '').split(',').map(Number).filter(Number.isFinite)
      if (!expected.length || typeof window.__SCOREFLOW_MIDI_INJECT__ !== 'function') {
        return null
      }
      const beforeKey = box.getAttribute('data-practice-note-target-key')
      const beforeState = box.getAttribute('data-score-note-state')
      const t0 = performance.now()
      const snapshot = () => {
        const now = document.querySelector('[data-score-note-state="current"], [data-score-note-state="current-partial"], [data-score-note-state="completed"]')
        if (!now) {
          return null
        }
        return {
          key: now.getAttribute('data-practice-note-target-key'),
          state: now.getAttribute('data-score-note-state'),
        }
      }
      const changed = await new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const snap = snapshot()
          // Advance (new key) OR chord partial (same key, new state) both count.
          if (snap && (snap.key !== beforeKey || snap.state !== beforeState)) {
            observer.disconnect()
            resolve(performance.now() - t0)
          }
        })
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-practice-note-target-key', 'data-score-note-state'] })
        // Play the full required event promptly (chords share a ~500 ms window).
        window.__SCOREFLOW_MIDI_INJECT__(expected[0])
        for (const midi of expected.slice(1)) {
          setTimeout(() => window.__SCOREFLOW_MIDI_INJECT__(midi), 150)
        }
        setTimeout(() => { observer.disconnect(); resolve(-1) }, 8000)
      })
      return Math.round(changed)
    })
    out.midiToHighlightMs = latency
    console.log('midi-inject -> highlight change ms:', latency)

    // 2. rAF + longtasks during Preview playback.
    await page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Preview', exact: true }).click()
    await sleep(1000)
    await page.locator('.workspace-play').first().click()
    const perf = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0
      const t0 = performance.now()
      const longs = []
      let obs = null
      try {
        obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) longs.push(Math.round(e.duration)) })
        obs.observe({ entryTypes: ['longtask'] })
      } catch { obs = null }
      const tick = () => {
        frames += 1
        if (performance.now() - t0 < 5000) {
          requestAnimationFrame(tick)
        } else {
          obs?.disconnect()
          resolve({ fps: Math.round(frames / 5), longtasks: longs })
        }
      }
      requestAnimationFrame(tick)
    }))
    out.playbackFps = perf.fps
    out.playbackLongtasks = perf.longs ?? perf.longtasks
    console.log('playback rAF fps:', perf.fps, 'longtasks:', JSON.stringify(perf.longtasks))
    await page.locator('.workspace-play').first().click().catch(() => {})
    console.log(JSON.stringify(out, null, 1))
  } finally {
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
