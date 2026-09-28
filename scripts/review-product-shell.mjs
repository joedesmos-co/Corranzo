/** Phase G release QA. Isolated browser storage, real shipped score files, no model changes. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
assert.equal(process.cwd(), '/Users/ryland/Documents/scoreflow-ui')
const dir = 'docs/ui-overhaul/phase-g'
mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(20000)
const errors = [], checks = [], accessibility = [], widths = [1920, 1440, 1280, 1024, 768, 430, 390]
page.on('pageerror', error => { errors.push(error.stack); console.error(error.stack) })
const pass = name => { checks.push(name); console.log('PASS', name) }
const base = process.env.UI_REVIEW_URL || 'http://127.0.0.1:5178/'
const piece = 'public/fixtures/practice-library/piano-mozart-menuet-k2/piano-mozart-menuet-k2'
const pdf = { name: 'Mozart — Menuet in F.pdf', mimeType: 'application/pdf', buffer: readFileSync(`${piece}.pdf`) }
const xml = { name: 'Menuet.musicxml', mimeType: 'application/xml', buffer: readFileSync(`${piece}.musicxml`) }
const pick = (file = pdf) => page.getByLabel('Choose score PDF', { exact: true }).setInputFiles(file)
async function navigate(name) {
  const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
  if (!await nav.isVisible()) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await nav.getByRole('button', { name, exact: true }).click()
}
const shot = async name => { await page.mouse.move(0, 0); await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' }) }
async function axe(name) {
  if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: 'tmp/ui-takeover-review/a11y/node_modules/axe-core/axe.min.js' })
  const result = await page.evaluate(async () => {
    const data = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })
    return { violations: data.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) })), passes: data.passes.length, incomplete: data.incomplete.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })) }
  })
  accessibility.push({ name, ...result }); console.log('AXE', name, JSON.stringify(result.violations))
}
async function responsive(name, selector) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 430 ? 932 : 1000 })
    await page.waitForTimeout(160)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: overflow at ${width}`)
    if (selector) assert(await page.locator(selector).first().isVisible(), `${name}: primary action visible at ${width}`)
    await shot(`${name}-${width}`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(160)
}
async function ready() { await page.locator('.score-import-ready').waitFor({ timeout: 120000 }) }
async function workspace() { await page.locator('.practice-workspace canvas').first().waitFor(); await page.waitForFunction(() => !document.querySelector('.workspace-play')?.disabled) }
let failure
try {
  await page.goto(base)
  await page.locator('.cz-home canvas').waitFor()
  await page.keyboard.press('Tab')
  assert.equal(await page.locator(':focus').innerText(), 'Skip to content')
  await page.keyboard.press('Enter')
  assert.equal(await page.locator(':focus').getAttribute('id'), 'corranzo-content')
  await shot('home-desktop'); await axe('Home / first launch')
  await responsive('home', '.cz-collection-button')
  await navigate('Library')
  await page.waitForTimeout(50)
  assert.equal(await page.locator(':focus').getAttribute('id'), 'corranzo-content')
  assert.equal(await page.getByRole('button', { name: 'Library', exact: true }).getAttribute('aria-current'), 'page')
  await shot('library-populated'); await axe('Library / collection')
  assert(await page.locator('.cz-piece-row').count() >= 6, 'Multiple scores available')
  await responsive('library', '.library-search__input')
  await page.getByRole('searchbox').fill('No score has this exact title')
  await page.getByText(/No piano pieces match this search/).waitFor()
  await shot('library-no-results')
  await page.getByRole('searchbox').fill('K.2')
  assert.equal(await page.locator('.cz-piece-row').count(), 1)
  await page.getByRole('searchbox').fill('')
  await page.getByRole('tab', { name: 'Practice Library', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'My Uploads', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByText('No scores here yet. Import a score to begin.').waitFor()
  await shot('library-empty'); await axe('Library / empty uploads')
  pass('First launch, skip link, route focus, active navigation, collection, search/one result, keyboard tabs, empty uploads')

  await page.getByRole('button', { name: 'Import a score', exact: true }).click()
  await axe('Import / empty')
  await responsive('import-start', '.score-import-drop')
  await pick()
  await page.locator('.score-import-processing[data-busy="true"]').waitFor()
  await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click()
  await navigate('Home')
  await page.getByText('Your score needs preparation.').waitFor()
  assert(!(await page.locator('.cz-home').innerText()).includes('still being prepared'))
  await navigate('Library'); await page.getByRole('tab', { name: 'My Uploads', exact: true }).click()
  await page.getByRole('button', { name: /^Continue import:/ }).click()
  assert.equal(await page.locator('.cz-shell').getAttribute('data-view'), 'import')
  await page.getByRole('button', { name: 'Prepare score', exact: true }).click(); await ready()
  await axe('Import / ready and first-use modes'); await responsive('ready', '.score-import-open')
  pass('Cancellation has truthful Home state; unfinished Library score returns to import; ready and onboarding fit all seven widths')

  await page.locator('.score-import-advanced summary').click()
  await page.getByLabel('Choose optional files', { exact: true }).setInputFiles({ name: 'Damaged.mid', mimeType: 'audio/midi', buffer: Buffer.from('bad midi') })
  await page.getByText('The optional accompaniment couldn’t be read.', { exact: true }).waitFor()
  await navigate('Home')
  assert.equal(await page.getByRole('button', { name: 'Return to score', exact: true }).count(), 0)
  await navigate('Library'); await page.getByRole('tab', { name: 'My Uploads', exact: true }).click()
  await page.getByRole('button', { name: /^Open score:/ }).click()
  await page.getByRole('heading', { name: 'This score needs attention', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Continue import', exact: true }).click()
  await page.locator('.score-import-warning').getByRole('button', { name: 'Remove MIDI', exact: true }).click(); await ready()
  await page.locator('.score-import-advanced summary').click()
  await page.getByLabel('Choose optional files', { exact: true }).setInputFiles({ name: 'Damaged.musicxml', mimeType: 'application/xml', buffer: Buffer.from('<garbage/>') })
  await page.getByRole('heading', { name: 'This score isn’t ready to open', exact: true }).waitFor()
  await navigate('Home')
  assert.equal(await page.getByRole('button', { name: 'Return to score', exact: true }).count(), 0)
  await navigate('Library'); await page.getByRole('tab', { name: 'My Uploads', exact: true }).click()
  await page.getByRole('button', { name: /^Open score:/ }).click()
  await page.getByRole('heading', { name: 'This score needs attention', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Continue import', exact: true }).click()
  await page.locator('.score-import-advanced summary').click()
  await page.getByLabel('Choose optional files', { exact: true }).setInputFiles(xml); await ready()
  pass('Corrupt notation cannot bypass readiness through Home or Library; recovery returns to the saved PDF')

  const longName = 'Menuet in F — Study edition with a very long score title and collection details — ' + 'UnbrokenTitle'.repeat(12) + '.pdf'
  await pick({ ...pdf, name: longName })
  await page.locator('.score-import-processing[data-busy="true"]').waitFor()
  await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click()
  await page.locator('.score-import-advanced summary').click()
  await page.getByLabel('Choose optional files', { exact: true }).setInputFiles(xml); await ready()
  await navigate('Library'); await page.getByRole('tab', { name: 'My Uploads', exact: true }).click()
  await responsive('library-long-title', '.practice-piece-card__button')
  await axe('Library / one upload with long title and no composer metadata')
  await page.getByRole('button', { name: /^Open score:/ }).click(); await workspace()
  await page.getByRole('region', { name: 'Score pages', exact: true }).focus()
  await page.keyboard.press('PageDown')
  await page.waitForFunction(() => document.querySelector('.pdf-canvas').scrollTop > 0)
  await page.keyboard.press('Home')
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true })
  await page.getByText('Keyboard shortcuts', { exact: true }).click()
  await axe('Workspace settings / keyboard help')
  const last = dialog.getByRole('button', { name: 'Report a score problem', exact: true })
  await last.focus(); await page.keyboard.press('Tab')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Close tools')
  await page.keyboard.press('Shift+Tab'); assert.equal(await page.locator(':focus').innerText(), 'Report a score problem')
  await page.keyboard.press('Shift+Tab'); assert.equal(await page.locator(':focus').innerText(), 'Keyboard shortcuts')
  await page.keyboard.press('Escape'); assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Workspace settings')
  await responsive('workspace-long-title', '.workspace-play')
  pass('Long upload titles wrap; missing metadata remains useful; dialog focus includes native disclosure summaries and returns correctly')

  // Use the supplied original title for final mode captures and accessibility audits.
  await navigate('Home')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Open score: Menuet in F, K.2', exact: true }).click()
  assert.equal(await page.locator('.cz-shell').getAttribute('data-view'), 'home')
  await page.getByRole('button', { name: 'Return to score', exact: true }).click(); await workspace()
  assert.match(await page.locator('.workspace-header h1').innerText(), /Study edition/)
  await navigate('Home')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Open score: Menuet in F, K.2', exact: true }).click(); await workspace()
  pass('Collection replacement is explicit; cancelling preserves the imported score')
  for (const [mode, name] of [['Preview', 'workspace-preview'], ['Play Along', 'workspace-play-along'], ['Wait For You', 'workspace-wait-for-you']]) {
    await page.getByRole('radio', { name: mode, exact: true }).click()
    await shot(name); await axe(mode)
  }
  await page.getByRole('button', { name: 'Practice input', exact: true }).click(); await axe('Wait For You / input'); await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'Preview', exact: true }).click()
  await page.getByRole('button', { name: 'Note guide', exact: true }).click(); await page.locator('.visual-practice').waitFor()
  await shot('note-guide'); await axe('Note guide')
  await page.getByRole('button', { name: 'Score', exact: true }).click(); await workspace()
  await page.getByRole('button', { name: 'Focus score (F)', exact: true }).click(); await shot('focus'); await axe('Focus')
  await page.getByRole('button', { name: 'Exit focus (F)', exact: true }).click()
  for (const name of ['Tempo', 'Loop', 'Sound & accompaniment']) { await page.getByRole('button', { name, exact: true }).click(); await axe(`${name} dialog`); await page.keyboard.press('Escape') }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click(); await axe('Mobile navigation drawer')
  const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true })
  await drawer.getByRole('button', { name: 'Close navigation', exact: true }).focus(); await page.keyboard.press('Tab')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Corranzo home')
  await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open navigation')
  await shot('mobile-workspace')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('.score-workspace').evaluate(el => getComputedStyle(el).animationName), 'none')
  pass('All modes, Note guide, focus and tools audited with axe; mobile drawer keyboard trap and reduced motion verified')

  await page.setViewportSize({ width: 1440, height: 1000 })
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true }).first()
  if (await collapse.isVisible()) await collapse.click()
  await navigate('Library')
  assert.equal(await page.locator('.cz-shell').getAttribute('data-sidebar'), 'rail')
  await page.reload(); await page.locator('.library-panel').waitFor()
  assert.equal(await page.locator('.cz-shell').getAttribute('data-sidebar'), 'rail')
  pass('Collapsed navigation preference survives Library return and browser reload')
  assert.deepEqual(errors, [])
  assert.deepEqual(accessibility.flatMap(result => result.violations.map(violation => `${result.name}: ${violation.id}`)), [], 'No automated accessibility violations')
} catch (e) { failure = e.stack; console.error(e); await shot('shell-failure'); process.exitCode = 1 }
finally { writeFileSync(`${dir}/shell-browser-results.json`, JSON.stringify({ checks, errors, failure: failure ?? null, accessibility, widths }, null, 2)); await browser.close() }
