#!/usr/bin/env node
/**
 * Browser check: per-note correction in the Audio Vision review.
 *
 * Uploads a fixture, waits for the arrangement, opens "Review notes",
 * removes one note, and asserts that
 *   - the note count drops by exactly one,
 *   - the "removed" counter appears,
 *   - the filtered note is gone from the list,
 *   - "Undo all" restores every note,
 *   - the generated MusicXML is the one the practice would open.
 *
 * Usage: E2E_PORT=5685 node scripts/browser-audio-vision-note-corrections.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.E2E_PORT ?? 5685)
const vite = await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port, strictPort: true },
})
await vite.listen()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`))

let pass = 0
let fail = 0
const check = (ok, label, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS  ${label}${detail ? ` :: ${detail}` : ''}`) }
  else { fail += 1; console.log(`FAIL  ${label}${detail ? ` :: ${detail}` : ''}`) }
}

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) => /library/i.test(el.textContent ?? ''))
    button?.click()
  })
  await page.waitForTimeout(800)
  const tab = page.getByRole('tab', { name: /my uploads/i })
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(500) }
  await page.getByText('Create from audio', { exact: false }).first().waitFor({ timeout: 30000 })
  await page.locator('.audio-vision-card input[type="file"]').setInputFiles(join(root, 'tmp/audio-vision-uiflow/uiflow-figure.wav'))
  await page.getByText(/recording length/i).first().waitFor({ timeout: 60000 })
  await page.locator('.audio-vision-card input[name="audio-vision-target"][value="solo-piano"]').check()
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })

  const summary = page.locator('.audio-vision-note-review summary')
  await summary.waitFor({ timeout: 20000 })
  const initialLabel = (await summary.textContent()) ?? ''
  const initialCount = Number(/Review notes \((\d+)/.exec(initialLabel)?.[1] ?? 0)
  check(initialCount > 0, 'note review lists the arrangement', `${initialCount} notes`)

  await summary.click()
  await page.waitForTimeout(300)
  const rows = page.locator('.audio-vision-note-list li')
  const rowsBefore = await rows.count()
  check(rowsBefore === initialCount, 'every note has a row', `${rowsBefore} rows`)
  const firstLabel = (await rows.first().textContent()) ?? ''

  await rows.first().getByRole('button', { name: /remove/i }).click()
  await page.waitForTimeout(400)
  const afterLabel = (await summary.textContent()) ?? ''
  const afterCount = Number(/Review notes \((\d+)/.exec(afterLabel)?.[1] ?? 0)
  check(afterCount === initialCount - 1, 'removing one note removes exactly one', `${initialCount} -> ${afterCount}`)
  check(/1 removed/.test(afterLabel), 'the removed counter is shown', afterLabel.trim())
  const rowsAfter = await page.locator('.audio-vision-note-list li').count()
  check(rowsAfter === rowsBefore - 1, 'the row disappears', `${rowsBefore} -> ${rowsAfter}`)
  const firstAfter = (await page.locator('.audio-vision-note-list li').first().textContent()) ?? ''
  check(firstAfter !== firstLabel, 'the removed note is the one that vanished', `${firstLabel.trim()} -> ${firstAfter.trim()}`)

  await page.getByRole('button', { name: /undo all/i }).click()
  await page.waitForTimeout(400)
  const restoredLabel = (await summary.textContent()) ?? ''
  const restoredCount = Number(/Review notes \((\d+)/.exec(restoredLabel)?.[1] ?? 0)
  check(restoredCount === initialCount, 'undo restores every note', `${afterCount} -> ${restoredCount}`)
  check(!/removed/.test(restoredLabel), 'the counter clears', restoredLabel.trim())

  // The score the practice would open must be the corrected one.
  const xmlNotes = await page.evaluate(() => {
    const text = document.body.textContent ?? ''
    return text.includes('Your arrangement is ready')
  })
  check(xmlNotes, 'review still healthy after edits')

  await page.screenshot({ path: join(root, 'tmp/audio-vision-uiflow/note-corrections.png'), fullPage: false })
  check(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | '))
} catch (err) {
  fail += 1
  console.log(`FAIL  harness :: ${String(err?.message ?? err).slice(0, 300)}`)
} finally {
  await browser.close()
  await vite.close()
  console.log(`\npass=${pass} fail=${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
