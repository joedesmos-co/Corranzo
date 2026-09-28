/** Verify that the production build loads workspace chunks only on entry. */
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
assert.equal(process.cwd(), '/Users/ryland/Documents/scoreflow-ui')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], requests = [], checks = []
page.on('pageerror', error => errors.push(error.stack))
page.on('request', request => { if (/\.js(?:\?|$)/.test(request.url())) requests.push(request.url().split('/').at(-1)) })
const origin = process.env.UI_PRODUCTION_URL || 'http://127.0.0.1:5193/'
let initial, workspaceRequests, failure
try {
  await page.goto(origin); await page.locator('.cz-home canvas').waitFor()
  initial = [...requests]
  assert(!initial.some(name => /PracticeView-|PracticeSessionContext-/.test(name)))
  assert(!readdirSync('dist/assets').some(name => /DesignSandbox/.test(name)))
  checks.push('Production Home renders the real score preview without the practice route or design sandbox')
  await page.getByRole('button', { name: 'Open featured score: Menuet in F, K.2', exact: true }).click()
  await page.locator('.practice-workspace canvas').first().waitFor()
  await page.waitForFunction(() => !document.querySelector('.workspace-play')?.disabled)
  workspaceRequests = requests.filter(name => !initial.includes(name))
  assert(workspaceRequests.some(name => /PracticeView-/.test(name)))
  assert(workspaceRequests.some(name => /PracticeSessionContext-/.test(name)))
  checks.push('Practice provider and view chunks load together on entry')
  for (const name of ['Preview', 'Play Along', 'Wait For You']) {
    await page.getByRole('radio', { name, exact: true }).click()
    assert.equal(await page.getByRole('radio', { name, exact: true }).getAttribute('aria-checked'), 'true')
  }
  await page.getByRole('radio', { name: 'Preview', exact: true }).click()
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await page.getByRole('button', { name: 'Pause (Space)', exact: true }).click()
  await page.getByRole('button', { name: 'Note guide', exact: true }).click(); await page.locator('.visual-practice').waitFor()
  await page.getByRole('button', { name: 'Score', exact: true }).click()
  await page.getByRole('button', { name: 'Focus score (F)', exact: true }).click()
  await page.getByRole('button', { name: 'Exit focus (F)', exact: true }).click()
  checks.push('All three modes, playback, Note guide and focus work from production chunks')
  await page.reload(); await page.locator('.practice-workspace canvas').first().waitFor()
  const failPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  let blockChunk = true
  await failPage.route('**/PracticeView-*.js', route => blockChunk ? route.abort() : route.continue())
  await failPage.goto(origin)
  await failPage.getByRole('button', { name: 'Open featured score: Menuet in F, K.2', exact: true }).click()
  await failPage.getByRole('heading', { name: 'Your score couldn’t be opened', exact: true }).waitFor()
  await failPage.getByRole('button', { name: 'Return to Library', exact: true }).click()
  await failPage.locator('.library-panel').waitFor()
  blockChunk = false
  await failPage.waitForFunction(() => JSON.parse(localStorage.getItem('scoreflow-session-meta-v1') || 'null')?.activeView === 'library')
  await failPage.waitForTimeout(150)
  await failPage.reload(); await failPage.locator('.library-panel').waitFor()
  await failPage.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Practice', exact: true }).click()
  await failPage.locator('.practice-workspace canvas').first().waitFor()
  checks.push('Controlled route-chunk failure offers Library recovery; reload restores the saved score after the chunk is available')
  await failPage.close()
  assert.deepEqual(errors, [])
} catch (e) { failure = e.stack; console.error(e); process.exitCode = 1 }
finally { writeFileSync('docs/ui-overhaul/phase-g/production-browser-results.json', JSON.stringify({ origin, initial, workspaceRequests, checks, errors, failure: failure ?? null }, null, 2)); await browser.close() }
