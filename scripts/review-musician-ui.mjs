/** Visual and interaction review. Runs only against this isolated redesign checkout. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
assert.equal(process.cwd(), '/Users/ryland/Documents/scoreflow-ui-redesign')
const dir = 'docs/musician-ui/after'
mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(15000)
const errors = [], checks = [], accessibility = []
page.on('pageerror', e => errors.push(e.message))
const nav = async name => {
  const n = page.getByRole('navigation', { name: 'Primary', exact: true })
  if (!await n.isVisible()) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await n.getByRole('button', { name, exact: true }).click()
}
const shot = async name => { await page.mouse.move(0,0); await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, animations: 'disabled' }) }
async function axe(name) {
  if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','best-practice'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })))
  accessibility.push({ name, violations }); console.log('AXE', name, JSON.stringify(violations))
}
async function responsive(name) {
  for(const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({width,height:width < 500 ? 844 : 1000}); await page.waitForTimeout(120)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), `${name}: overflow ${width}`)
    await shot(`${name}-${width}`)
    if(width===390) await axe(`${name}-mobile`)
  }
  await page.setViewportSize({width:1440,height:1000}); await page.waitForFunction(()=>document.querySelector('.cz-shell')?.dataset.sidebar !== 'drawer')
}
let failure
try {
  await page.goto(process.env.UI_REVIEW_URL || 'http://127.0.0.1:5197')
  await page.locator('.cz-home canvas').waitFor(); await page.keyboard.press('Tab'); assert.equal(await page.locator(':focus').innerText(),'Skip to content'); await page.keyboard.press('Enter')
  await axe('home'); await responsive('home')
  for(const [name,selector] of [['Library','.library-panel'],['Import','.score-import'],['History','.profile-view'],['Settings','.cz-settings']]) {
    await nav(name); await page.locator(selector).waitFor(); await axe(name); await responsive(name.toLowerCase())
  }
  await nav('Home'); await page.getByRole('button',{name:'Open featured score: Menuet in F, K.2',exact:true}).click()
  await page.locator('.practice-workspace canvas').first().waitFor(); await page.waitForFunction(()=>!document.querySelector('.workspace-play')?.disabled)
  for(const mode of ['Preview','Play Along','Wait For You']) { await page.getByRole('radio',{name:mode,exact:true}).click(); await shot(mode.toLowerCase().replaceAll(' ','-')); await axe(mode) }
  await page.getByRole('radio',{name:'Preview',exact:true}).click(); await page.getByRole('button',{name:'Play (Space)',exact:true}).click(); await page.getByRole('button',{name:'Pause (Space)',exact:true}).click(); checks.push('Playback starts and pauses; three practice modes selectable')
  await responsive('practice')
  for(const name of ['Tempo','Loop','Sound & accompaniment','Workspace settings']) {
    await page.getByRole('button',{name,exact:true}).click(); await shot(name.toLowerCase().replaceAll(/[^a-z]+/g,'-')); await axe(name); await page.keyboard.press('Escape')
    assert.equal(await page.locator(':focus').getAttribute('aria-label'),name)
  }
  await page.getByRole('button',{name:'Note guide',exact:true}).click(); await page.locator('.visual-practice').waitFor(); await shot('note-guide'); await axe('note-guide'); await page.getByRole('button',{name:'Score',exact:true}).click()
  await page.getByRole('button',{name:'Focus score (F)',exact:true}).click(); await shot('focus'); await page.getByRole('button',{name:'Exit focus (F)',exact:true}).click()
  await page.emulateMedia({reducedMotion:'reduce'}); assert.equal(await page.locator('.score-workspace').evaluate(e=>getComputedStyle(e).animationName),'none'); checks.push('Dialogs restore focus; score/guide, focus mode and reduced motion work')
  await nav('Home'); await page.locator('.cz-home canvas').waitFor(); await shot('home-returning'); await axe('home-returning')
  await nav('History'); await page.locator('.profile-view').waitFor(); await page.getByRole('button',{name:'Start timer',exact:true}).click(); await page.getByRole('button',{name:'Pause',exact:true}).click(); await shot('journal-paused'); checks.push('Practice journal timer starts and pauses')
  await nav('Library'); await page.getByRole('searchbox').fill('No such work'); await shot('library-no-results'); await page.getByRole('tab',{name:'My Uploads',exact:true}).click(); await shot('uploads'); await axe('uploads')
  assert.deepEqual(errors,[])
  assert.deepEqual(accessibility.flatMap(result => result.violations), [], 'No automated accessibility violations')
} catch(e) { failure=e.stack; console.error(e); process.exitCode=1 }
finally { writeFileSync('docs/musician-ui/review.json', JSON.stringify({checks,errors,accessibility,failure:failure??null},null,2));await browser.close() }
