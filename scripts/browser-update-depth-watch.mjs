#!/usr/bin/env node
/**
 * Update-depth regression watch (P0 stability).
 *
 * Extended MIC-DRIVEN Play Along session asserting ZERO React
 * "Maximum update depth exceeded" warnings.
 *
 * Root cause it guards: usePlayAlongLaneFeedback returned a fresh object
 * literal on every session render, so every Tone progress tick rebuilt
 * the session + provider identity and re-ran the whole practice tree.
 * Combined with per-frame mic feedback and the 80 ms miss interval, the
 * render/effect cascade intermittently exceeded React's nested-update
 * budget (22–83 warnings per 80–100 s, only with Play Along + playing +
 * an active input). The fix memoizes the feedback return identity, so
 * downstream memos only recompute on real changes (version bumps).
 *
 * Prerequisite: node scripts/render-unified-mic-clips.mjs
 * Usage: E2E_PORT=5597 node scripts/browser-update-depth-watch.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'update-depth-watch')
const PORT = Number(process.env.E2E_PORT ?? 5597)
const WATCH_MS = Number(process.env.WATCH_MS ?? 100000)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), watchMs: WATCH_MS, depthWarnings: 0, heard: null, playing: false }
  const viteServer = await createServer({
    root,
    configFile: join(root, 'vite.config.js'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()
  const { chromium } = await import('playwright')
  const clip = join(root, 'tmp/unified-practice-mic/mic-melody8.wav')
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--use-file-for-fake-audio-capture=${clip}`,
    ],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.grantPermissions(['microphone'], { origin: `http://127.0.0.1:${PORT}` })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Maximum update depth/.test(msg.text())) {
      report.depthWarnings += 1
    }
  })
  page.on('pageerror', (error) => {
    report.pageError = (report.pageError ?? '') + error.message.slice(0, 200)
  })
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(async () => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
    await sleep(1500)
    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(800)
    await page.locator('.cz-piece-row').first().waitFor({ state: 'visible', timeout: 20000 })
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const t = buttons.find((b) => {
        if (!/open score|start practice/i.test(b.textContent)) return false
        const row = b.closest('.cz-piece-row')
        return (row ? row.textContent : '').includes('Prelude')
      })
      if (t) t.click()
    })
    await sleep(8000)
    await page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1500)
    await page.getByRole('button', { name: 'Practice input' }).click()
    await sleep(800)
    await page.getByRole('button', { name: 'Microphone', exact: true }).click()
    await sleep(1000)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(3000)
    await page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Play Along', exact: true }).click()
    await sleep(1500)
    await page.locator('.workspace-play').first().click()
    await sleep(2000)
    const playing = await page.evaluate(() => {
      const btn = document.querySelector('.workspace-play')
      return btn ? btn.getAttribute('aria-label') : null
    })
    report.playing = /pause/i.test(playing ?? '')
    if (!report.playing) {
      console.error(`FAIL  transport did not start (${playing})`)
      process.exitCode = 1
    }
    await sleep(WATCH_MS)
    const heard = await page.evaluate(() => {
      const dbg = window.__SCOREFLOW_MIC_DEBUG__
      return (dbg?.lastDetectedMidis ?? []).join(',') || null
    })
    report.heard = heard
    await page.screenshot({ path: join(outDir, 'watch.png') }).catch(() => {})
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`watch: playing=${report.playing} heard=${report.heard} depthWarnings=${report.depthWarnings}`)
    if (report.depthWarnings > 0) {
      console.error(`FAIL  ${report.depthWarnings} update-depth warnings during extended mic-driven Play Along`)
      process.exitCode = 1
    } else {
      console.log('PASS  zero update-depth warnings during extended mic-driven Play Along')
    }
  } finally {
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
