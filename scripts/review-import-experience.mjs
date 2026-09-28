/** Phase F browser review. Only the UI worktree and isolated browser storage are used. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import JSZip from 'jszip'
assert.equal(process.cwd(), '/Users/ryland/Documents/scoreflow-ui')
const phase = process.env.UI_REVIEW_PHASE || 'phase-f'
assert(['phase-f', 'phase-g'].includes(phase))
const dir = `docs/ui-overhaul/${phase}`
mkdirSync(dir, { recursive: true })
const base = process.env.UI_REVIEW_URL || 'http://127.0.0.1:5178/'
const piece = 'public/fixtures/practice-library/piano-mozart-menuet-k2/piano-mozart-menuet-k2'
const pdf = { name: 'Mozart — Menuet in F.pdf', mimeType: 'application/pdf', buffer: readFileSync(`${piece}.pdf`) }
const xml = { name: 'Menuet.musicxml', mimeType: 'application/xml', buffer: readFileSync(`${piece}.musicxml`) }
const midi = { name: 'Menuet.mid', mimeType: 'audio/midi', buffer: readFileSync(`${piece}.mid`) }
const browser = await chromium.launch({ headless: true })
const checks = [], errors = []
const pass = name => { checks.push(name); console.log('PASS', name) }
const pages = []
async function fresh() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(20000)
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.stack) })
  pages.push(page)
  return page
}
async function start(page) {
  await page.goto(base)
  await page.getByRole('button', { name: 'Bring your own score', exact: true }).click()
  await page.locator('.score-import').waitFor()
}
const pick = (page, file = pdf) => page.getByLabel('Choose score PDF', { exact: true }).setInputFiles(file)
const ready = page => page.locator('.score-import-ready').waitFor({ timeout: 120000 })
const shot = async (page, name) => { await page.mouse.move(0, 0); return page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' }) }
async function noOverflow(page) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow') }
async function enterImport(page) { await page.getByRole('button', { name: 'Import', exact: true }).first().click(); await ready(page) }
async function openMode(page, name) {
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
  await page.getByRole('button', { name: 'Open score', exact: true }).click()
  await page.locator('.practice-workspace canvas').first().waitFor()
  await page.waitForFunction(() => !document.querySelector('.workspace-play')?.disabled)
  assert.equal(await page.getByRole('radio', { name, exact: true }).getAttribute('aria-checked'), 'true')
}
function blankPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream']
  let text = '%PDF-1.4\n', offsets = [0]
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n` }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return { name: 'Incomplete scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(text) }
}
let failure
try {
  const page = await fresh()
  await start(page)
  await page.mouse.move(0, 0)
  await shot(page, 'import-start')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert(!(await page.locator('.score-import-advanced').getAttribute('open')))
  const chooserPromise = page.waitForEvent('filechooser')
  await page.locator('.score-import-source .score-import-drop').focus()
  await page.keyboard.press('Enter')
  await (await chooserPromise).setFiles({ name: 'Score photo.png', mimeType: 'image/png', buffer: Buffer.from('not-a-pdf') })
  await page.getByText(/image files can’t be opened directly/).waitFor()
  await shot(page, 'unsupported-image')
  pass('PDF-first entry; optional files collapsed; unsupported photos explain PDF conversion; no tutorial modal')

  await pick(page)
  await page.locator('.score-import-processing[data-busy="true"]').waitFor()
  await page.locator('.score-import-preview canvas').waitFor()
  await shot(page, 'processing')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert(await page.locator('.score-import-stages [data-state="current"] > span').evaluate(el => getComputedStyle(el).animationName === 'none'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  assert(!/%/.test(await page.locator('.score-import-stages').innerText()))
  await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click()
  await page.getByRole('heading', { name: 'Preparation paused', exact: true }).waitFor()
  await shot(page, 'file-selected')
  assert.equal(await page.getByRole('button', { name: 'Open score', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Prepare score', exact: true }).click()
  await ready(page)
  assert.equal(await page.locator('.cz-shell').getAttribute('data-view'), 'import')
  await shot(page, 'ready')
  await page.locator('.score-import-outcome').screenshot({ path: `${dir}/first-use-modes.png`, animations: 'disabled' })
  assert.equal(await page.locator('.score-import-modes').getByRole('radio').count(), 3)
  pass('Real PDF worker: truthful progress, cancel, resume, validated ready state, explicit entry, first-use mode introduction')

  await page.getByRole('radio', { name: /^Preview/ }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('radio', { name: /^Play Along/ }).getAttribute('aria-checked'), 'true')
  await page.getByRole('button', { name: 'Open score', exact: true }).click()
  await page.locator('.practice-workspace canvas').first().waitFor()
  assert.equal(await page.getByRole('radio', { name: 'Play Along', exact: true }).getAttribute('aria-checked'), 'true')
  await enterImport(page)
  await page.getByRole('heading', { name: 'Choose your starting mode.', exact: true }).waitFor()
  await openMode(page, 'Preview')
  await enterImport(page)
  await openMode(page, 'Wait For You')
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
  await enterImport(page)
  pass('Keyboard mode selection and all three workspace entry modes; first-use introduction becomes concise on return')

  await page.getByRole('radio', { name: /^Preview/ }).click()
  await page.setViewportSize({ width: 1280, height: 800 }); await noOverflow(page); await shot(page, 'laptop-ready')
  await page.setViewportSize({ width: 768, height: 1024 }); await noOverflow(page); await shot(page, 'narrow-ready')
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page); await shot(page, 'phone-ready')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert(await page.locator('.score-import-modes button').first().evaluate(el => getComputedStyle(el).transitionDuration === '0s'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload(); await ready(page)
  assert.equal(await page.locator('.cz-shell').getAttribute('data-view'), 'import')
  pass('1440, 1280, 768 and 390 layouts; reduced motion; reload restores ready step and score')

  await page.locator('.score-import-advanced summary').click()
  await page.getByLabel('Choose optional files', { exact: true }).setInputFiles([xml, midi])
  await ready(page)
  await page.waitForFunction(() => !document.querySelector('.score-import-open')?.disabled)
  await shot(page, 'optional-files')
  const mxl = new JSZip()
  mxl.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>')
  mxl.file('score.musicxml', xml.buffer)
  await page.getByLabel('Choose optional files', { exact: true }).setInputFiles({ name: 'Menuet.mxl', mimeType: 'application/zip', buffer: await mxl.generateAsync({ type: 'nodebuffer' }) })
  await ready(page)
  await page.getByText('Menuet.mxl', { exact: true }).waitFor()
  await page.getByLabel('Choose optional files', { exact: true }).setInputFiles({ name: 'Broken accompaniment.mid', mimeType: 'audio/midi', buffer: Buffer.from('invalid midi') })
  await page.getByText('The optional accompaniment couldn’t be read.', { exact: true }).waitFor()
  assert(await page.getByRole('button', { name: 'Open score', exact: true }).isDisabled())
  await shot(page, 'optional-file-recovery')
  await page.locator('.score-import-warning').getByRole('button', { name: 'Remove MIDI', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.score-import-open')?.disabled)
  await page.getByLabel('Choose optional files', { exact: true }).setInputFiles({ name: 'Broken notes.musicxml', mimeType: 'application/xml', buffer: Buffer.from('<garbage/>') })
  await page.getByRole('heading', { name: 'This score isn’t ready to open', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Open score', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Remove notation file', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare score', exact: true }).click()
  await ready(page)
  pass('Optional MusicXML/MXL/MIDI accepted; damaged companions do not claim readiness; removal recovers PDF preparation')

  const poor = await fresh(); await start(poor); await pick(poor, blankPdf())
  await poor.locator('.score-import-processing[data-state="failed"]').waitFor({ timeout: 120000 })
  await poor.getByRole('heading', { name: 'We couldn’t read enough of the score', exact: true }).waitFor()
  await shot(poor, 'poor-quality')
  assert.equal(await poor.getByRole('button', { name: 'Open score', exact: true }).count(), 0)
  await pick(poor); await ready(poor)
  pass('Real blank-PDF quality rejection; practical rescan guidance; replacement PDF recovers')

  const broken = await fresh()
  let injectFailure = true
  await broken.route('**/omr.worker.js*', async route => {
    if (!injectFailure) return route.continue()
    return route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () => self.postMessage({error: "Review-injected worker failure"})' })
  })
  await start(broken); await pick(broken)
  await broken.getByRole('heading', { name: 'We couldn’t prepare playback', exact: true }).waitFor()
  await shot(broken, 'processing-failure')
  assert.equal(await broken.getByRole('button', { name: 'Open score', exact: true }).count(), 0)
  injectFailure = false
  await broken.getByRole('button', { name: 'Try again', exact: true }).click(); await ready(broken)
  pass('Controlled worker failure uses real recovery UI; retry returns to real successful processing')

  const leaving = await fresh(); await start(leaving); await pick(leaving)
  await leaving.locator('.score-import-processing[data-busy="true"]').waitFor()
  await leaving.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Home', exact: true }).click()
  await leaving.waitForTimeout(500)
  assert.equal(await leaving.locator('.cz-shell').getAttribute('data-view'), 'home')
  await leaving.getByRole('button', { name: 'Import', exact: true }).first().click()
  await leaving.getByRole('button', { name: 'Prepare score', exact: true }).click()
  await leaving.locator('.score-import-processing[data-busy="true"]').waitFor()
  await pick(leaving, { ...pdf, name: 'Replacement Menuet.pdf' })
  await ready(leaving)
  assert.equal(await leaving.locator('.score-import-file h2').innerText(), 'Replacement Menuet.pdf')
  assert.equal(await leaving.locator('.cz-shell').getAttribute('data-view'), 'import')
  pass('Navigation during preparation stays where requested; interrupted import resumes; rapid replacement retains the new owner')

  const unreadable = await fresh(); await start(unreadable)
  await pick(unreadable, { name: 'Damaged.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 broken') })
  await unreadable.getByRole('heading', { name: 'We couldn’t open this PDF', exact: true }).waitFor()
  await shot(unreadable, 'unreadable-pdf')
  pass('Unreadable PDF has actionable failure and no Open score action')
  assert.deepEqual(errors, [])
} catch (error) {
  failure = error.stack
  console.error(error)
  for (const [i, page] of pages.entries()) await page.screenshot({ path: `${dir}/debug-${i}.png` }).catch(() => {})
  process.exitCode = 1
} finally {
  writeFileSync(`${dir}/browser-checks.json`, JSON.stringify({ checks, errors, failure: failure ?? null, controlledScenario: 'processing-failure injects a worker error through a browser-only route; all successful recognition and blank-PDF rejection use the real worker.' }, null, 2))
  await browser.close()
}
