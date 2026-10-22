#!/usr/bin/env node
// Phase 3: real audio->arrangement->practice flow in the staging app.
// Uploads a real WAV, runs REAL in-browser transcription+arrangement,
// opens the generated score, and exercises Preview/WFY/PlayAlong with
// real MIDI injection. No evaluator shortcuts.
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-staging')
const PORT = Number(process.env.E2E_PORT ?? 5605)
const TARGET = process.env.AV_TARGET ?? 'piano' // piano | guitar
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const pass = (n, d = '') => { results.push({ n, ok: true, d }); console.log(`PASS  ${n}${d ? ' — ' + d : ''}`) }
const fail = (n, d = '') => { results.push({ n, ok: false, d }); console.log(`FAIL  ${n}${d ? ' — ' + d : ''}`) }

async function main() {
  await mkdir(outDir, { recursive: true })
  const server = await createServer({ root, configFile: join(root, 'vite.config.js'), logLevel: 'silent', server: { host: '127.0.0.1', port: PORT, strictPort: true } })
  await server.listen()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] })
  const errors = []
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 140)))
    // google-analytics is unreachable headless; unrelated to product behavior.
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|DevTools|AudioContext|google-analytics/i.test(m.text())) errors.push(m.text().slice(0, 300)) })
    // google-analytics is unreachable headless; aborted thumbnail fetches
    // are fast-navigation artifacts, not product failures.
    page.on('requestfailed', (r) => {
      const reason = r.failure()?.errorText ?? ''
      if (/google-analytics/i.test(r.url()) || /abort/i.test(reason)) return
      errors.push('reqfail: ' + r.url().slice(0, 120))
    })
    await page.goto(`http://127.0.0.1:${PORT}/?e2e-midi=1`, { waitUntil: 'networkidle' })
    await sleep(1500)
    // Library -> uploads collection (Create from audio lives there)
    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(1000)
    const avSection = page.getByRole('region', { name: 'Create from audio' })
    if (!(await avSection.count())) {
      // try uploads tab
      const uploads = page.getByRole('tab', { name: /upload/i })
      if (await uploads.count()) { await uploads.click(); await sleep(800) }
    }
    await page.getByRole('region', { name: 'Create from audio' }).waitFor({ state: 'visible', timeout: 15000 })
    pass('audio-vision surface present')
    // Upload the scale WAV through the hidden file input
    const wavPath = join(root, 'tmp', 'audio-vision-staging', 'scale-input.wav')
    await page.locator('.audio-vision-drop input[type=file]').setInputFiles(wavPath)
    await sleep(2000)
    if (TARGET === 'guitar') {
      await page.locator('.audio-vision-radio input[type=radio][value=solo-guitar]').click({ force: true }).catch(() => {})
      await sleep(600)
    }
    await page.screenshot({ path: join(outDir, 'av-uploaded.png') })
    // Arrange (default target piano)
    const arrangeBtn = page.getByRole('button', { name: /arrange/i })
    await arrangeBtn.click()
    // Wait for ready (real model inference; generous budget)
    const readyLabel = page.getByText(/arrangement is ready/i)
    let ready = false
    for (let i = 0; i < 60; i += 1) {
      await sleep(10000)
      if (await readyLabel.count()) { ready = true; break }
    }
    await page.screenshot({ path: join(outDir, 'av-ready.png') })
    if (!ready) {
      const alert = await page.getByRole('alert').last().textContent().catch(() => null)
      fail('arrangement completes', alert ?? 'timeout 10 min')
      await writeFile(join(outDir, 'flow-report.json'), JSON.stringify({ results, errors }, null, 2))
      process.exitCode = 1
      return
    }
    pass('arrangement completes on real audio')
    // "Open in Corranzo Practice" -> import begin view -> Preview -> open.
    const toImport = page.getByRole('button', { name: /open in corranzo practice/i })
    if (await toImport.count()) { await toImport.click().catch(() => {}) ; await sleep(4000) }
    await page.screenshot({ path: join(outDir, 'av-import.png') })
    const previewOpt = page.getByRole('radio', { name: /preview/i }).first()
    if (await previewOpt.count()) { await previewOpt.click().catch(() => {}) ; await sleep(1500) }
    const beginBtn = page.getByRole('button', { name: /open score/i }).first()
    if (await beginBtn.count()) { await beginBtn.scrollIntoViewIfNeeded().catch(() => {}) ; await beginBtn.click().catch(() => {}) }
    await sleep(9000)
    await page.screenshot({ path: join(outDir, 'av-practice.png') })
    const surface = await page.evaluate(() => {
      const root = document.querySelector('[aria-label="Arrangement practice"]')
      const allTargets = [...(root?.querySelectorAll('summary') ?? [])].map((s) => s.textContent.trim()).join(' | ')
      return {
        arrangement: Boolean(root),
        title: document.querySelector('.arrangement-practice__header h2')?.textContent.trim() ?? null,
        allTargets,
        target: document.querySelector('.arrangement-practice__target')?.textContent.slice(0, 120).replace(/\s+/g, ' ') ?? null,
        transport: [...(root?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 6),
      }
    })
    console.log('surface: ' + JSON.stringify(surface))
    if (surface.arrangement) pass('arrangement practice surface opens', surface.title)
    else fail('arrangement practice surface opens', JSON.stringify(surface))
    if (/all targets \((\d+)\)/i.test(surface.allTargets) && Number(/all targets \((\d+)\)/i.exec(surface.allTargets)[1]) > 0) pass('generated checkpoints listed', surface.allTargets)
    else fail('generated checkpoints listed', surface.allTargets || 'none found')
    // Preview playback on the arrangement
    const playBtn = page.getByRole('button', { name: /^play$/i }).first()
    if (await playBtn.count()) {
      await playBtn.click().catch(() => {})
      await sleep(4000)
      const paused = await page.getByRole('button', { name: /^pause$/i }).count()
      if (paused) pass('arrangement preview plays')
      else fail('arrangement preview plays', 'no pause state')
      await page.getByRole('button', { name: /^pause$/i }).first().click().catch(() => {})
      await sleep(800)
    } else fail('arrangement preview plays', 'no play button')
    await page.screenshot({ path: join(outDir, 'av-playing.png') })
    // Connect MIDI input on the arrangement surface, enter WFY, play the scale
    const inputSummary = page.locator('.wfy-input-source__summary').first()
    if (await inputSummary.count()) {
      await inputSummary.click().catch(() => {})
      await sleep(600)
      // Click (not check): confirming the already-selected MIDI option must
      // fire the session readiness handler; check() no-ops when checked.
      await page.locator('.wfy-input-source input[type=radio][value=midi]').click({ force: true }).catch(() => {})
      await sleep(1200)
      pass('arrangement input selector present')
    } else fail('arrangement input selector present', 'missing')
    const wfyRadio = page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Wait For You', exact: true })
    const wfyDisabled = await wfyRadio.isDisabled().catch(() => true)
    if (!wfyDisabled) {
      await wfyRadio.click()
      await sleep(1500)
      pass('arrangement WFY enables after MIDI connect')
      const targets = await page.evaluate(() => [...document.querySelectorAll('.arrangement-practice__list li')].map((li) => li.textContent))
      const labelToMidi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
      // Inject the CURRENT target, not the first: Preview playback may have
      // already advanced the session through earlier checkpoints.
      const currentTarget = await page.evaluate(() => document.querySelector('.arrangement-practice__target')?.textContent ?? '')
      const m = /([A-G])(#|b)?(\d)/.exec(currentTarget)
      let midi = m ? 12 * (Number(m[3]) + 1) + labelToMidi[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null
      const before = await page.evaluate(() => document.querySelector('.arrangement-practice__target')?.textContent.replace(/\s+/g, ' ') ?? '')
      if (midi != null) {
        await page.evaluate((v) => window.__SCOREFLOW_MIDI_INJECT__?.(v), midi)
        await sleep(1500)
      }
      const after = await page.evaluate(() => document.querySelector('.arrangement-practice__target')?.textContent.replace(/\s+/g, ' ') ?? '')
      if (midi != null && after !== before) pass('arrangement WFY advances on correct note', `${before.slice(0, 60)} -> ${after.slice(0, 60)}`)
      else fail('arrangement WFY advances on correct note', `midi=${midi} before=${before.slice(0, 80)} after=${after.slice(0, 80)}`)
      await page.screenshot({ path: join(outDir, 'av-wfy.png') })
    } else fail('arrangement WFY enables after MIDI connect', 'still disabled')
    // Play Along burst on the arrangement (close the input disclosure first
    // so it cannot cover the transport buttons; restart so the 4 s piece
    // plays from the top regardless of earlier Preview playback offset).
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(300)
    const paRadio = page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Play Along', exact: true })
    await paRadio.click().catch(() => {})
    await sleep(1200)
    await page.getByRole('button', { name: /^restart/i }).first().click().catch(() => {})
    await sleep(800)
    console.log('pa modes: ' + await page.evaluate(() => [...document.querySelectorAll('.arrangement-practice__modes [role=radio]')].map((r) => r.textContent.trim() + ':' + r.getAttribute('aria-checked')).join(' | ')))
    console.log('pa transport: ' + await page.evaluate(() => [...document.querySelectorAll('.arrangement-practice__transport button')].map((b) => b.textContent.trim() + (b.disabled ? ':disabled' : '')).join(' | ')))
    const paPlay = page.getByRole('button', { name: /^play$/i }).first()
    if (await paPlay.count()) {
      await paPlay.click().catch(() => {})
      await sleep(2000)
      const running = await page.getByRole('button', { name: /^pause$/i }).count()
      if (running) pass('arrangement playalong runs')
      else fail('arrangement playalong runs', 'transport did not start')
      await page.screenshot({ path: join(outDir, 'av-playalong.png') })
    }
    await writeFile(join(outDir, 'flow-report.json'), JSON.stringify({ results, errors, surface }, null, 2))
    const failed = results.filter((r) => !r.ok)
    console.log(`${results.length - failed.length} passed, ${failed.length} failed; console/page errors: ${errors.length}`)
    if (failed.length || errors.length) process.exitCode = 1
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
main().catch((e) => { console.error(e); process.exit(2) })
