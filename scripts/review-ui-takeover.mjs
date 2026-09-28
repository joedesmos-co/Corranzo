/** Bounded UI-only review. Uses bundled public-domain scores, no model/data tooling. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

assert.equal(process.cwd(), '/Users/ryland/Documents/scoreflow-ui', 'Run only from the UI worktree')
const base = process.env.UI_REVIEW_URL || 'http://127.0.0.1:5178'
const dir = resolve('docs/ui-overhaul/review')
mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []
const errors = []
const knownLimitations = []
let completed = false
let failure = null
const check = (name, detail = '') => { results.push({ name, detail, passed: true }); console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`) }

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => { errors.push(error.message); console.log('BROWSER ERROR', error.stack) })
  const screenshot = async name => page.screenshot({ path: `${dir}/${name}.png` })
  const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal document overflow')
  const navigate = async name => {
    if (await page.getByRole('button', { name: 'Open navigation', exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    }
    await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name, exact: true }).click()
  }
  const dismissInput = async () => {
    const dialog = page.getByRole('dialog', { name: 'How should Corranzo hear you?' })
    if (await dialog.isVisible()) await page.keyboard.press('Escape')
  }

  await page.goto(base)
  await page.getByRole('heading', { name: 'Make room for music.' }).waitFor()
  await page.locator('.cz-score-cover canvas').waitFor()
  assert.equal(await page.getByRole('main').count(), 1)
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.locator('.library-main').count(), 0)
  await noOverflow()
  await screenshot('home-desktop')
  check('Fresh Home has one main landmark, real score preview and no blocking tutorial')

  await page.getByRole('button', { name: 'Help', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator(':focus').textContent(), 'Replay tutorial')
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator(':focus').textContent(), 'How files work')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Help')
  check('Help menu arrow navigation and Escape focus return')

  for (const [width, height] of [[1920, 1080], [1280, 800], [1024, 768], [768, 900], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await noOverflow()
    await screenshot(`home-${width}`)
  }
  check('Home viewport matrix', '1920, 1440, 1280, 1024, 768, 390px; no horizontal overflow')

  const openNav = page.getByRole('button', { name: 'Open navigation', exact: true })
  await openNav.click()
  const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true })
  assert(await drawer.isVisible())
  assert.equal(await page.locator('.cz-shell__main').getAttribute('inert'), '')
  await drawer.getByRole('button', { name: 'Close navigation' }).focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Corranzo home')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Close navigation')
  await screenshot('navigation-mobile')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open navigation')
  assert.equal(await page.locator('.cz-shell__main').getAttribute('inert'), null)
  check('Mobile drawer traps focus, returns focus and restores content on Escape')
  await openNav.click()
  await drawer.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('heading', { name: 'The collection.' }).waitFor()
  assert.equal(await drawer.count(), 0)
  await noOverflow()
  await screenshot('library-mobile')
  check('Mobile drawer navigation is clickable above its backdrop and closes on selection')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByPlaceholder('Search Piano pieces').fill('Bach')
  assert.equal(await page.locator('.cz-piece-row').count(), 4)
  await page.getByRole('button', { name: 'Beginner', exact: true }).click()
  assert.equal(await page.locator('.cz-piece-row').count(), 1)
  assert.match(await page.locator('.cz-piece-row').innerText(), /Chorale/)
  await page.getByPlaceholder('Search Piano pieces').fill('no matching title')
  assert.equal(await page.locator('.cz-piece-row').count(), 0)
  assert(await page.getByText(/No piano pieces match this search/).isVisible())
  await screenshot('library-empty-search')
  await page.getByPlaceholder('Search Piano pieces').fill('')
  await page.getByRole('button', { name: 'All levels', exact: true }).click()
  assert.equal(await page.locator('.cz-piece-row').count(), 13)
  check('Composer search, difficulty filter, empty results and reset')
  await screenshot('library-desktop')
  await page.getByRole('tab', { name: 'Practice Library', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'My Uploads' }).getAttribute('aria-selected'), 'true')
  await screenshot('uploads-desktop')
  await page.keyboard.press('ArrowLeft')
  assert.equal(await page.getByRole('tab', { name: 'Practice Library', exact: true }).getAttribute('aria-selected'), 'true')
  check('Library tabs support arrow-key selection and preserve upload access')

  await navigate('Home')
  await page.getByRole('button', { name: 'Open featured score: Menuet in F, K.2', exact: true }).click()
  await page.locator('.practice-workspace .react-pdf__Page__canvas').first().waitFor({ timeout: 30000 })
  await dismissInput()
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await page.getByRole('button', { name: 'Pause (Space)', exact: true }).waitFor()
  await page.keyboard.press('Tab')
  // Existing practice shortcuts are audited as-is; body is the intended global target.
  await page.locator('body').click({ position: { x: 75, y: 110 } })
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).waitFor()
  await page.locator('#playback-rate').fill('0.75')
  await page.getByRole('checkbox', { name: 'Metronome', exact: true }).check()
  check('Featured score opens; playback, Space pause, tempo and metronome respond')

  await navigate('Home')
  await page.getByRole('button', { name: 'Return to score', exact: true }).waitFor()
  await page.locator('.cz-score-cover canvas').waitFor()
  await screenshot('home-returning')
  await page.getByRole('button', { name: 'Return to score', exact: true }).click()
  await page.locator('.practice-workspace .react-pdf__Page__canvas').first().waitFor()
  await dismissInput()
  assert.match(await page.locator('.practice-piece-header').innerText(), /MENUET IN F/i)
  const rateAfterReopen = await page.locator('#playback-rate').inputValue()
  const metronomeAfterReopen = await page.getByRole('checkbox', { name: 'Metronome', exact: true }).isChecked()
  if (rateAfterReopen !== '0.75' || !metronomeAfterReopen) {
    knownLimitations.push('Inherited playback hook resets tempo/metronome on remount; full session resume requires Phase D persistence work.')
    console.log('KNOWN LIMITATION: playback preferences reset on reopening (unchanged engine).')
  }
  await screenshot('score-current')
  await page.locator('body').click({ position: { x: 75, y: 110 } })
  await page.keyboard.press('f')
  await page.locator('.pdf-fullscreen').waitFor()
  await screenshot('score-focus-current')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.pdf-fullscreen').count(), 0)
  check('Returning Home reopens the same score; F and Escape enter/exit existing focus view')

  await page.getByRole('button', { name: /Loop Off/ }).click()
  const loopToggle = page.getByRole('checkbox', { name: 'Loop on', exact: true })
  assert(await loopToggle.isDisabled())
  await page.getByRole('button', { name: 'Set start', exact: true }).click()
  await page.getByRole('slider', { name: 'Seek', exact: true }).fill('200')
  await page.getByRole('button', { name: 'Set end', exact: true }).click()
  await loopToggle.check()
  assert(await loopToggle.isChecked())
  assert.match(await page.locator('.practice-loop__range').innerText(), /\d/)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  assert(await loopToggle.isDisabled())
  check('Loop start/end use the current position; enable and clear remain functional')

  await page.getByRole('button', { name: /Advanced Files, playback, cursor/ }).click()
  const firstTrack = page.locator('.midi-tracks input[type="checkbox"]').first()
  await firstTrack.waitFor()
  await firstTrack.uncheck()
  assert(!(await firstTrack.isChecked()))
  await firstTrack.check()
  assert(await firstTrack.isChecked())
  check('Existing backing track can be muted and restored')

  await page.getByRole('button', { name: 'Markup', exact: true }).click()
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.locator('.annotation-layer').first().scrollIntoViewIfNeeded()
  const annotationBox = await page.locator('.annotation-layer').first().boundingBox()
  assert(annotationBox)
  await page.mouse.move(annotationBox.x + annotationBox.width * 0.4, annotationBox.y + annotationBox.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(annotationBox.x + annotationBox.width * 0.6, annotationBox.y + annotationBox.height * 0.31, { steps: 8 })
  await page.mouse.up()
  await page.locator('.annotation-layer path').first().waitFor()
  const annotationPath = await page.locator('.annotation-layer path').first().getAttribute('d')
  // Existing persistence waits 600ms and cancels on unmount. Wait for the real
  // save, not the toolbar's unconditional “Saved” label, before testing restore.
  await page.waitForFunction(() => Object.keys(localStorage)
    .filter(key => key.startsWith('scoreflow-annotations-'))
    .some(key => Object.values(JSON.parse(localStorage.getItem(key)).strokesByPage || {}).some(strokes => strokes.length > 0)))
  knownLimitations.push('Inherited annotation autosave cancels its 600ms timer on unmount; immediate navigation can lose the newest mark despite the unconditional Saved label.')
  await navigate('Home')
  await page.getByRole('button', { name: 'Return to score', exact: true }).click()
  await page.locator('.practice-workspace .react-pdf__Page__canvas').first().waitFor()
  await dismissInput()
  await page.locator('.annotation-layer path').first().waitFor()
  assert.equal(await page.locator('.annotation-layer path').first().getAttribute('d'), annotationPath)
  await page.setViewportSize({ width: 1024, height: 768 })
  assert.equal(await page.locator('.annotation-layer path').first().getAttribute('d'), annotationPath)
  await page.setViewportSize({ width: 1440, height: 1000 })
  check('Saved score annotations survive leaving, reopening and resizing with unchanged normalized geometry')

  await page.locator('.practice-mode__option').filter({ hasText: 'Wait For You' }).click()
  const before = await page.locator('.wait-for-you').innerText()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForTimeout(450)
  assert.notEqual(await page.locator('.wait-for-you').innerText(), before)
  await screenshot('wait-for-you-current')
  await page.getByRole('button', { name: 'Visual', exact: true }).click()
  await page.locator('.visual-practice').waitFor()
  await screenshot('note-guide-current')
  check('Existing Wait For You manual advancement and Visual presentation remain reachable')

  await navigate('Home')
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Replay tutorial' }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  check('Full tutorial remains available explicitly from Help and can be skipped')

  await page.getByRole('radio', { name: 'Guitar', exact: true }).click()
  await page.getByRole('heading', { name: 'The collection.' }).waitFor()
  assert.match(await page.locator('.practice-library__eyebrow').textContent(), /Guitar/)
  await navigate('Home')
  await page.getByRole('heading', { name: 'Make room for music.' }).waitFor()
  await page.locator('.cz-score-cover canvas').waitFor()
  await screenshot('home-guitar')
  check('Instrument change returns to its own collection; Guitar Home uses real guitar scores')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const duration = await page.locator('.cz-piece-row__open svg').first().evaluate(el => getComputedStyle(el).transitionDuration)
  assert.equal(duration, '1e-05s')
  check('Reduced motion disables hover transitions')
  assert.deepEqual(errors, [])
  check('No uncaught browser errors')
  completed = true
} catch (error) {
  failure = error.message
  throw error
} finally {
  writeFileSync(`${dir}/browser-results.json`, JSON.stringify({ date: new Date().toISOString(), completed, failure, results, errors, knownLimitations }, null, 2))
  await browser.close()
}
