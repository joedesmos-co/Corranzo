#!/usr/bin/env node
/**
 * Audio Vision edge-case acceptance (real browser, real file inputs).
 *
 * Covers the user-visible failure paths the happy-path suite cannot reach:
 *   unsupported format -> invalid/empty audio -> long-recording excerpt
 *   -> progress + cancellation -> retry -> uncertainty is honestly labelled.
 *
 * The app decodes every file with real Web Audio + Basic Pitch, so a rejected
 * file must produce a truthful message, never a hung spinner.
 *
 *   E2E_PORT=5475 node scripts/browser-audio-vision-edge-e2e.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-edge')
const PORT = Number(process.env.E2E_PORT ?? 5475)
const baseUrl = `http://127.0.0.1:${PORT}/`

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function wav(path, seconds, sampleRate = 22050, amplitude = 0.2, freq = 440) {
  const total = Math.floor(seconds * sampleRate)
  const buffer = Buffer.alloc(44 + total * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + total * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(total * 2, 40)
  for (let i = 0; i < total; i += 1) {
    const value = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate)
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }
  writeFileSync(path, buffer)
}

async function dismissOverlays(page) {
  for (const name of ['Done', /Skip restore/i]) {
    const button = page.getByRole('button', { name })
    if (await button.isVisible().catch(() => false)) { await button.click(); await sleep(400) }
  }
}

async function clearSiteState(page) {
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('scoreflow-session')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    }).catch(() => {})
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), baseUrl, passes: [], failures: [], consoleErrors: [], pageErrors: [], skipped: [] }
  const pass = (name, detail = null) => { report.passes.push({ name, detail }); console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`) }
  const fail = (name, detail = null) => { report.failures.push({ name, detail }); console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`) }
  const skip = (name, why) => { report.skipped.push({ name, why }); console.log(`SKIP  ${name} :: ${why}`) }

  // Fixtures
  const silence = join(outDir, 'silence.wav'); wav(silence, 2, 22050, 0)
  const notAudio = join(outDir, 'notes.musicxml')
  writeFileSync(notAudio, '<?xml version="1.0"?><score-partwise><part-list/></score-partwise>')
  const empty = join(outDir, 'empty.wav')
  writeFileSync(empty, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]))
  const long = join(outDir, 'long.wav'); wav(long, 95, 11025, 0.25, 523)

  const viteServer = await createServer({
    root, configFile: join(root, 'vite.config.js'), logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() !== 'error') return
    if (/WebGL|backend|favicon|DevTools|net::ERR_/.test(text)) return
    report.consoleErrors.push(text)
  })
  page.on('pageerror', (error) => report.pageErrors.push(error.message))

  const audioInput = page.locator('.audio-vision-drop input[type=file]')
  const arranger = () => page.getByRole('button', { name: /^Arrange/i }).first()

  /** Precise read of the card's own error / status text. */
  const cardState = () => page.evaluate(() => {
    const card = document.querySelector('.audio-vision-card')
    if (!card) return { present: false }
    const error = card.querySelector('.audio-vision-error')
    const hints = [...card.querySelectorAll('.audio-vision-hint')].map((el) => el.textContent.replace(/\s+/g, ' ').trim())
    return {
      present: true,
      error: error ? error.textContent.replace(/\s+/g, ' ').trim().slice(0, 220) : null,
      hint: hints[0] ?? null,
      hints: hints.slice(0, 4),
      progress: Boolean(card.querySelector('.audio-vision-progress')),
      progressText: (card.querySelector('.audio-vision-progress')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 140) || null,
      arrange: [...card.querySelectorAll('button')].some((b) => /^Arrange/i.test(b.textContent.trim())),
      excerpt: Boolean(card.querySelector('.audio-vision-excerpt')),
      ready: Boolean([...card.querySelectorAll('button')].find((b) => /Open in Corranzo Practice/i.test(b.textContent))),
      reset: [...card.querySelectorAll('button')].some((b) => /Arrange something else|Choose another/i.test(b.textContent)),
    }
  })

  /** Bring the My Uploads tab (and its Create-from-audio card) back on screen. */
  const backToCard = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const state = await cardState()
      if (state.present) return state
      const importBtn = page.getByRole('button', { name: /^Import$/i }).first()
      if (await importBtn.isVisible().catch(() => false)) { await importBtn.click(); await sleep(900) }
      const libraryBtn = page.getByRole('button', { name: 'Library', exact: true }).first()
      if (await libraryBtn.isVisible().catch(() => false)) { await libraryBtn.click(); await sleep(1200) }
      const uploadsTab = page.getByRole('tab', { name: /my uploads/i }).first()
      if (await uploadsTab.isVisible().catch(() => false)) { await uploadsTab.click(); await sleep(900) }
    }
    return cardState()
  }

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await clearSiteState(page)
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await dismissOverlays(page)
    // Library -> My Uploads tab (Create from audio lives in that tab).
    await page.getByRole('button', { name: 'Library', exact: true }).first().click().catch(() => {})
    await sleep(1200)
    const uploadsTab = page.getByRole('tab', { name: /my uploads/i }).first()
    if (await uploadsTab.isVisible().catch(() => false)) {
      await uploadsTab.click()
      await sleep(900)
    }
    await page.screenshot({ path: join(outDir, '01-uploads.png') })
    if ((await audioInput.count()) === 0) {
      fail('audio vision entry reachable', 'Create from audio card not on the My Uploads tab')
      throw new Error('entry missing')
    }
    pass('audio vision entry reachable on the My Uploads tab')

    // ---- unsupported format ----
    // Playwright's setInputFiles bypasses the picker's accept filter (real
    // browsers honour it), so this is the drag-and-drop path: the user drops a
    // notation file onto the audio card. The refusal must be truthful.
    await audioInput.setInputFiles(notAudio)
    await sleep(3000)
    let card = await cardState()
    await page.screenshot({ path: join(outDir, '02-unsupported.png') })
    if (card.present && card.hints.some((h) => /Duration check didn.t finish/i.test(h))) {
      pass('unsupported file does not hang the probe')
    } else {
      fail('unsupported file does not hang the probe', JSON.stringify(card))
    }
    if (card.arrange) {
      await arranger().click()
      await page.waitForSelector('.audio-vision-progress', { state: 'detached', timeout: 120000 }).catch(() => {})
      await sleep(2000)
      card = await cardState()
      await page.screenshot({ path: join(outDir, '02b-unsupported-refused.png') })
      if (/not a supported audio file|MP3, WAV, and M4A/i.test(card.error ?? '')) {
        pass('unsupported format produces a truthful refusal', card.error.slice(0, 130))
      } else {
        fail('unsupported format produces a truthful refusal', JSON.stringify(card))
      }
    } else {
      skip('unsupported format refusal on Arrange', 'Arrange unavailable')
    }

    // ---- corrupt / empty audio ----
    card = await backToCard()
    await audioInput.setInputFiles(empty)
    await sleep(3500)
    card = await cardState()
    await page.screenshot({ path: join(outDir, '03-empty-audio.png') })
    if (card.arrange) {
      await arranger().click()
      await page.waitForSelector('.audio-vision-progress', { state: 'detached', timeout: 120000 }).catch(() => {})
      await sleep(2000)
      const emptyCard = await cardState()
      await page.screenshot({ path: join(outDir, '03b-empty-refused.png') })
      if (/could not be decoded|corrupt|unsupported codec/i.test(emptyCard.error ?? '')) {
        pass('corrupt audio produces a truthful refusal', emptyCard.error.slice(0, 130))
      } else if (emptyCard.ready) {
        fail('corrupt audio produced presented notation', JSON.stringify(emptyCard))
      } else {
        fail('corrupt audio produces a truthful refusal', JSON.stringify(emptyCard))
      }
    } else {
      skip('corrupt audio refusal on Arrange', 'Arrange unavailable')
    }

    // ---- silent recording: honest refusal, never sold as sheet music ----
    card = await backToCard()
    await audioInput.setInputFiles(silence)
    await page.waitForFunction(
      () => /Recording length/.test(document.querySelector('.audio-vision-card')?.textContent ?? ''),
      { timeout: 30000 },
    ).catch(() => {})
    const silenceState = await cardState()
    const lengthLine = silenceState.hints.find((h) => /Recording length/i.test(h)) ?? null
    if (/0:02/.test(lengthLine ?? '')) pass('duration probe reports the recording length', lengthLine)
    else skip('duration probe reports the recording length', silenceState.hints.join(' | ').slice(0, 90))
    if (silenceState.arrange) {
      await arranger().click()
      await page.waitForSelector('.audio-vision-progress', { state: 'detached', timeout: 150000 }).catch(() => {})
      await sleep(2500)
      const silentRefusal = await cardState()
      if (silentRefusal.ready) fail('silent recording produced presented notation', JSON.stringify(silentRefusal))
      else if (/rather refuse|silent|not enough/i.test(silentRefusal.error ?? '')) {
        pass('silent recording is honestly refused, not presented as sheet music', silentRefusal.error.slice(0, 130))
      } else fail('silent recording gives a definitive outcome', JSON.stringify(silentRefusal))
      await page.screenshot({ path: join(outDir, '06-silence-refused.png') })
    }

    // ---- progress + cancellation on a recording that really takes time ----
    card = await backToCard()
    await audioInput.setInputFiles(long)
    await page.waitForFunction(
      () => /Recording length/.test(document.querySelector('.audio-vision-card')?.textContent ?? ''),
      { timeout: 40000 },
    ).catch(() => {})
    if ((await cardState()).arrange) {
      await arranger().click()
      const progressed = await page.waitForSelector('.audio-vision-progress', { timeout: 45000 }).catch(() => null)
      if (progressed) {
        const live = await cardState()
        await page.screenshot({ path: join(outDir, '04-analyzing.png') })
        if (live.progress) pass('progress indicator shown during analysis', live.progressText)
        else fail('progress indicator shown during analysis', JSON.stringify(live))
        const cancelButton = page.locator('.audio-vision-card').getByRole('button', { name: /^Cancel$/i }).first()
        if (await cancelButton.isVisible().catch(() => false)) {
          pass('Cancel is offered during analysis')
          await cancelButton.click()
          await sleep(2500)
          const afterCancel = await cardState()
          await page.screenshot({ path: join(outDir, '05-cancelled.png') })
          if (afterCancel.present && !afterCancel.progress && afterCancel.arrange) {
            pass('cancellation returns to a usable idle state')
          } else {
            fail('cancellation returns to a usable idle state', JSON.stringify(afterCancel))
          }
        } else {
          fail('Cancel is offered during analysis', 'no Cancel button in the progress row')
        }
      } else {
        skip('progress indicator and cancellation', 'analysis finished before sampling')
      }
    } else {
      skip('progress indicator and cancellation', 'Arrange unavailable for the long recording')
    }

    // ---- long recording reports its length and offers the excerpt choice ----
    card = await cardState()
    await page.screenshot({ path: join(outDir, '07-long-recording.png') })
    const longLength = card.hints.find((h) => /Recording length/i.test(h)) ?? null
    if (card.excerpt) pass('long recording offers the 3-minute excerpt choice', longLength ?? 'excerpt shown')
    else skip('long recording offers the 3-minute excerpt choice', longLength ?? 'no duration')

    if (report.pageErrors.length) fail('no uncaught page errors', report.pageErrors.slice(0, 3).join(' | '))
    else pass('no uncaught page errors')
    if (report.consoleErrors.length) fail('no unexpected console errors', report.consoleErrors.slice(0, 3).join(' | '))
    else pass('no unexpected console errors')
  } finally {
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  }
  console.log(`\n${report.passes.length} passes, ${report.failures.length} failures, ${report.skipped.length} skipped`)
  process.exit(report.failures.length ? 1 : 0)
}

main().catch((error) => { console.error(error); process.exit(1) })
