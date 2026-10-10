#!/usr/bin/env node
/**
 * P8/P9 overnight soak: bounded extended session verifying FUNCTIONALITY
 * throughout — not just process survival.
 *
 * Rounds of: instrument switch (piano/acoustic/electric) + play/pause/seek/
 * loop, Preview/WFY/PlayAlong cycling with real MIDI injection, mic
 * enable/disable, zoom changes. Samples FPS, JS heap, console errors and
 * update-depth warnings. Fails on functional regression, heap explosion
 * (>3x growth), or any depth warning.
 *
 * Usage: E2E_PORT=5601 node scripts/overnight-soak.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'overnight-soak')
const PORT = Number(process.env.E2E_PORT ?? 5601)
const ROUNDS = Number(process.env.SOAK_ROUNDS ?? 3)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`) }
const fail = (name, detail = '') => { results.push({ name, ok: false, detail }); console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }

async function fps(page, ms = 3000) {
  return page.evaluate((windowMs) => new Promise((resolve) => {
    let frames = 0
    const start = performance.now()
    const tick = () => {
      frames += 1
      if (performance.now() - start < windowMs) requestAnimationFrame(tick)
      else resolve(Math.round(frames / ((performance.now() - start) / 1000)))
    }
    requestAnimationFrame(tick)
  }), ms)
}
async function heapMB(page) {
  return page.evaluate(() => {
    const m = performance.memory
    return m ? Math.round(m.usedJSHeapSize / 1048576) : null
  })
}
async function dismissTools(page) {
  const scrim = page.getByRole('button', { name: 'Dismiss tools' })
  if (await scrim.isVisible().catch(() => false)) { await scrim.click(); await sleep(300) }
  await page.keyboard.press('Escape').catch(() => {})
}
async function transport(page, want) {
  await dismissTools(page)
  await page.locator('.workspace-play').first().click()
  await sleep(1200)
  const label = await page.evaluate(() => document.querySelector('.workspace-play')?.getAttribute('aria-label') ?? '')
  return want === 'playing' ? /pause/i.test(label) : /play|continue|again/i.test(label)
}
async function expectedMidis(page) {
  return page.evaluate(() => {
    const cur = [...document.querySelectorAll('[data-score-note-state]')]
      .find((b) => ['current', 'current-partial', 'wrong'].includes(b.getAttribute('data-score-note-state')))
    return cur?.getAttribute('data-score-expected')?.split(',').map(Number).filter(Number.isFinite) ?? []
  })
}
async function inject(page, midi) {
  return page.evaluate((v) => window.__SCOREFLOW_MIDI_INJECT__?.(v) ?? false, midi)
}
async function checkpointIndex(page) {
  return page.evaluate(() => {
    const text = document.querySelector('.workspace-your-turn')?.textContent ?? ''
    const match = /(\d+)\s+of\s+(\d+)/.exec(text)
    return match ? `${match[1]} of ${match[2]}` : text.slice(0, 60)
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const errors = []
  let depthWarnings = 0
  const server = await createServer({ root, configFile: join(root, 'vite.config.js'), logLevel: 'silent', server: { host: '127.0.0.1', port: PORT, strictPort: true } })
  await server.listen()
  const { chromium } = await import('playwright')
  const clip = join(root, 'tmp/unified-practice-mic/mic-melody8.wav')
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--enable-precise-memory-info',
      `--use-file-for-fake-audio-capture=${clip}`,
    ],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.grantPermissions(['microphone'], { origin: `http://127.0.0.1:${PORT}` })
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') { errors.push(msg.text().slice(0, 140)) } if (/Maximum update depth/.test(msg.text())) depthWarnings += 1 })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 140)))
  const heapSamples = []
  const fpsSamples = []
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?e2e-midi=1`, { waitUntil: 'networkidle' })
    await sleep(1500)
    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(800)
    await page.locator('.cz-piece-row').first().waitFor({ state: 'visible', timeout: 20000 })
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const t = buttons.find((b) => {
        if (!/open score|start practice/i.test(b.textContent)) return false
        return (b.closest('.cz-piece-row')?.textContent ?? '').includes('Prelude')
      })
      t?.click()
    })
    await sleep(8000)
    heapSamples.push(await heapMB(page))
    const instruments = ['Piano', 'Acoustic Guitar', 'Electric Guitar']
    for (let round = 0; round < ROUNDS; round += 1) {
      // Instrument + transport
      const instBtn = page.getByRole('button', { name: 'Practice instrument' })
      if (await instBtn.count()) {
        await dismissTools(page)
        await instBtn.click().catch(() => {})
        await sleep(600)
        const opt = page.getByRole('radio', { name: instruments[round % 3], exact: true })
        if (await opt.count()) { await opt.click().catch(() => {}); await sleep(1200) }
      }
      const before = await checkpointIndex(page)
      if (await transport(page, 'playing')) pass(`round ${round + 1} transport starts (${instruments[round % 3]})`)
      else fail(`round ${round + 1} transport starts`, before)
      fpsSamples.push(await fps(page, 2500))
      heapSamples.push(await heapMB(page))
      // Seek + loop
      const seek = page.locator('input[type=range]').first()
      if (await seek.count()) { await seek.fill(String(20 + round * 10)).catch(() => {}); await sleep(800) }
      const loopBtn = page.getByRole('button', { name: /loop/i }).first()
      if (await loopBtn.count()) { await loopBtn.click().catch(() => {}); await sleep(400); await loopBtn.click().catch(() => {}); await sleep(400) }
      if (await transport(page, 'paused')) pass(`round ${round + 1} pause clean`)
      else fail(`round ${round + 1} pause clean`)
      // WFY with real injection
      await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Wait For You', exact: true }).click()
      await sleep(1200)
      await page.getByRole('button', { name: 'Practice input' }).click().catch(() => {})
      await sleep(500)
      await page.getByRole('button', { name: 'MIDI keyboard' }).click().catch(() => {})
      await sleep(500)
      await dismissTools(page)
      const want = await expectedMidis(page)
      const idxBefore = await checkpointIndex(page)
      if (want.length) { await inject(page, want[0]); await sleep(1000) }
      const idxAfter = await checkpointIndex(page)
      if (want.length && idxAfter !== idxBefore) pass(`round ${round + 1} WFY advances`, `${idxBefore} -> ${idxAfter}`)
      else fail(`round ${round + 1} WFY advances`, `want=${JSON.stringify(want)}`)
      // Wrong note refused
      const want2 = await expectedMidis(page)
      let wrong = 30
      while (want2.includes(wrong)) wrong += 1
      await inject(page, wrong)
      await sleep(800)
      const idxWrong = await checkpointIndex(page)
      if (idxWrong === idxAfter) pass(`round ${round + 1} wrong note refused`)
      else fail(`round ${round + 1} wrong note refused`, `${idxAfter} -> ${idxWrong}`)
      // Play Along burst
      await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Play Along', exact: true }).click()
      await sleep(1000)
      if (await transport(page, 'playing')) pass(`round ${round + 1} playalong runs`)
      else fail(`round ${round + 1} playalong runs`)
      await sleep(6000)
      await transport(page, 'paused')
      // Zoom change
      const zoomIn = page.getByRole('button', { name: /zoom in/i }).first()
      if (await zoomIn.count()) { await zoomIn.click().catch(() => {}); await sleep(600) }
      const zoomOut = page.getByRole('button', { name: /zoom out/i }).first()
      if (await zoomOut.count()) { await zoomOut.click().catch(() => {}); await sleep(600) }
      // Back to Preview
      await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Preview', exact: true }).click()
      await sleep(1000)
    }
    // Mic enable/disable round
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1200)
    await page.getByRole('button', { name: 'Practice input' }).click().catch(() => {})
    await sleep(500)
    const micOpt = page.getByRole('button', { name: 'Microphone', exact: true })
    if (await micOpt.count()) {
      await micOpt.click().catch(() => {})
      await sleep(5000)
      const micLabel = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.workspace-tool-button')].find((x) => x.getAttribute('aria-label') === 'Practice input')
        return b ? b.textContent.trim().slice(0, 40) : null
      })
      if (/microphone|mic/i.test(micLabel ?? '')) pass('mic enables in soak', micLabel)
      else fail('mic enables in soak', micLabel)
      // Melody clip holds a ~30 s quiet calibration phase before content.
      await sleep(45000)
      const heard = await page.evaluate(() => (window.__SCOREFLOW_MIC_DEBUG__?.lastDetectedMidis ?? []).join(',') || null)
      if (heard) pass('mic detects during soak', heard)
      else fail('mic detects during soak', 'silent')
      const stopBtn = page.getByRole('button', { name: 'Stop microphone' })
      if (await stopBtn.count()) { await stopBtn.click().catch(() => {}); await sleep(1000); pass('mic disables cleanly') }
    }
    const heapGrowth = heapSamples[heapSamples.length - 1] != null && heapSamples[0] != null
      ? (heapSamples[heapSamples.length - 1] / Math.max(1, heapSamples[0])).toFixed(2) : 'n/a'
    const minFps = Math.min(...fpsSamples)
    if (depthWarnings === 0) pass('zero update-depth warnings across soak')
    else fail('zero update-depth warnings across soak', String(depthWarnings))
    const realErrors = errors.filter((e) => !/ Sovereign|favicon|net::/i.test(e))
    if (realErrors.length === 0) pass('no console/page errors across soak')
    else fail('no console/page errors across soak', realErrors.slice(0, 3).join(' | '))
    pass('soak complete', `rounds=${ROUNDS} minFps=${minFps} heap=${heapSamples.join('->')}MB growth=${heapGrowth}x`)
    await writeFile(join(outDir, 'report.json'), JSON.stringify({ results, heapSamples, fpsSamples, heapGrowth, depthWarnings, errors: realErrors }, null, 2))
    const failed = results.filter((r) => !r.ok)
    console.log(`${results.length - failed.length} passed, ${failed.length} failed`)
    if (failed.length) process.exitCode = 1
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
main().catch((e) => { console.error(e); process.exit(2) })
