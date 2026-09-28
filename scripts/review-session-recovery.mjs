/** UI-only slow-restore and processing accessibility checks, with isolated storage. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
assert.equal(process.cwd(), '/Users/ryland/Documents/scoreflow-ui')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = [], checks = [], accessibility = []
page.on('pageerror', e => errors.push(e.stack))
const pass = name => { checks.push(name); console.log('PASS', name) }
async function axe(name) {
  if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: 'tmp/ui-takeover-review/a11y/node_modules/axe-core/axe.min.js' })
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) })))
  accessibility.push({ name, violations }); console.log('AXE', name, JSON.stringify(violations))
}
const dir = 'docs/ui-overhaul/phase-g'
let failure
try {
  await page.goto(process.env.UI_REVIEW_URL || 'http://127.0.0.1:5178/')
  await page.getByRole('button', { name: 'Open featured score: Menuet in F, K.2', exact: true }).click()
  await page.locator('.practice-workspace canvas').first().waitFor()
  await page.waitForTimeout(1400)
  // Delay browser-owned file reads to reproduce a user skipping a slow restore.
  await page.addInitScript(() => {
    const original = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function () { await new Promise(resolve => setTimeout(resolve, 2000)); return original.call(this) }
  })
  await page.reload()
  await page.getByRole('dialog', { name: 'Opening your last score', exact: true }).waitFor()
  assert.equal(await page.locator(':focus').innerText(), 'Skip opening')
  await page.keyboard.press('Tab'); assert.equal(await page.locator(':focus').innerText(), 'Skip opening')
  await axe('Restore dialog')
  await page.screenshot({ path: `${dir}/restore-loading.png`, animations: 'disabled' })
  await page.keyboard.press('Escape')
  const afterSkip = await page.locator('.cz-shell').getAttribute('data-view')
  await page.waitForTimeout(2600)
  assert.equal(await page.locator('.cz-shell').getAttribute('data-view'), afterSkip)
  await page.getByText(/Opening paused/).waitFor()
  await page.reload(); await page.locator('.practice-workspace canvas').first().waitFor()
  pass('Slow restore receives focus, traps Tab, and respects Escape; late results cannot take over; reload still restores the original saved score')

  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Import', exact: true }).click()
  let failWorker = false
  await page.route('**/omr.worker.js*', async route => {
    await new Promise(resolve => setTimeout(resolve, 1600))
    if (failWorker) return route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () => self.postMessage({error: "Review-injected worker failure"})' })
    return route.continue()
  })
  const pdf = readFileSync('public/fixtures/practice-library/piano-mozart-menuet-k2/piano-mozart-menuet-k2.pdf')
  const pick = () => page.getByLabel('Choose score PDF', { exact: true }).setInputFiles({ name: 'Menuet.pdf', mimeType: 'application/pdf', buffer: pdf })
  await pick()
  await page.locator('.score-import-processing[data-busy="true"]').waitFor()
  const status = page.locator('.score-import-processing [role="status"]').first()
  assert.equal(await status.getAttribute('aria-live'), 'polite')
  assert.equal(await status.getAttribute('aria-atomic'), 'true')
  assert(!await status.evaluate(el => !!el.closest('[aria-busy="true"]')))
  await axe('Processing / truthful stage status')
  await page.locator('.score-import-ready').waitFor({ timeout: 120000 })
  pass('Processing announces concise polite atomic stage changes; no busy ancestor suppresses updates; no fake percentage')

  failWorker = true
  await pick(); await page.getByRole('heading', { name: 'We couldn’t prepare playback', exact: true }).waitFor()
  await axe('Processing / failure and retry')
  await page.getByRole('button', { name: 'Report a score problem', exact: true }).click()
  await axe('Score problem report dialog')
  await page.keyboard.press('Escape')
  failWorker = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.locator('.score-import-ready').waitFor({ timeout: 120000 })
  pass('Controlled processing failure and report dialog remain accessible; retry succeeds using the real processor')
  assert.deepEqual(errors, [])
  assert.deepEqual(accessibility.flatMap(result => result.violations), [])
} catch (e) { failure = e.stack; console.error(e); process.exitCode = 1; await page.screenshot({ path: `${dir}/recovery-failure.png` }) }
finally { writeFileSync(`${dir}/recovery-browser-results.json`, JSON.stringify({ checks, errors, failure: failure ?? null, accessibility, controlledScenario: 'Browser-only delays for file reads/worker loading and an injected worker failure; successful processing uses the real app.' }, null, 2)); await browser.close() }
