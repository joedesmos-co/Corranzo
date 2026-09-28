/** Phase G PDF teardown stress: only isolated browser jobs, never host training processes. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
assert.equal(process.cwd(), '/Users/ryland/Documents/scoreflow-ui')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = [], consoleErrors = [], cycles = []
page.on('pageerror', e => errors.push(e.stack))
page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()) })
const pdf = readFileSync('public/fixtures/practice-library/piano-mozart-menuet-k2/piano-mozart-menuet-k2.pdf')
const pick = name => page.getByLabel('Choose score PDF', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: pdf })
let failure
try {
  await page.goto(process.env.UI_REVIEW_URL || 'http://127.0.0.1:5178/')
  await page.getByRole('button', { name: 'Bring your own score', exact: true }).click()
  for (let i = 0; i < 15; i++) {
    const name = `Cancellation review ${i}.pdf`
    await pick(name)
    await page.locator('.score-import-processing[data-busy="true"]').waitFor()
    if (i % 3 === 0) {
      await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click()
      await page.getByRole('heading', { name: 'Preparation paused', exact: true }).waitFor()
      cycles.push({ i, action: 'cancel with preview mounting' })
    } else if (i % 3 === 1) {
      await page.waitForTimeout(70)
      await pick(`Replacement ${i}.pdf`)
      await page.locator('.score-import-processing[data-busy="true"]').waitFor()
      await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click()
      assert.equal(await page.locator('.score-import-file h2').innerText(), `Replacement ${i}.pdf`)
      cycles.push({ i, action: 'rapid replacement retains new source' })
    } else {
      await page.locator('.score-import-preview canvas').waitFor()
      await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Home', exact: true }).click()
      await page.getByRole('button', { name: 'Continue import', exact: true }).click()
      await page.getByRole('button', { name: 'Prepare score', exact: true }).waitFor()
      cycles.push({ i, action: 'leave during processing and reopen retained PDF' })
    }
    console.log('PASS', i, cycles.at(-1).action)
  }
  await page.getByRole('button', { name: 'Prepare score', exact: true }).click()
  await page.locator('.score-import-ready').waitFor({ timeout: 120000 })
  assert.deepEqual(errors, [])
  assert(!consoleErrors.some(message => /Worker was terminated|Unhandled|Uncaught/.test(message)))
} catch (e) { failure = e.stack; console.error(e); process.exitCode = 1 }
finally { writeFileSync('docs/ui-overhaul/phase-g/cancellation-stress.json', JSON.stringify({ cycles, errors, consoleErrors, failure: failure ?? null }, null, 2)); await browser.close() }
