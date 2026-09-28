/** Workspace UI review; never invokes training, evaluation or model tools. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
assert.equal(process.cwd(), '/Users/ryland/Documents/scoreflow-ui')
const phase = process.env.UI_REVIEW_PHASE || 'phase-d'
assert(['phase-d', 'phase-e', 'phase-f', 'phase-g'].includes(phase))
const dir = `docs/ui-overhaul/${phase}${['phase-f', 'phase-g'].includes(phase) ? '/workspace-regression' : ''}`
mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], checks = []
let completed = false, failure = null
page.on('pageerror', e => { errors.push(e.message); console.log('ERROR', e.message) })
const pass = name => { checks.push(name); console.log('PASS', name) }
const shot = async name => {
  if (await page.locator('.practice-workspace .pdf-canvas').count()) {
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.pdf-page-window__slot--active .react-pdf__Page__canvas')
      if (!canvas?.width || !canvas.height) return false
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let ink = 0
      for (let i = 0; i < pixels.length; i += 32) {
        if (pixels[i + 3] > 200 && pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) ink++
        if (ink > 100) return true
      }
      return false
    })
  }
  return page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' })
}
const ready = async () => { await page.locator('.practice-workspace canvas').first().waitFor(); await page.waitForFunction(() => !document.querySelector('.workspace-play')?.disabled) }
const closeTools = async () => page.getByRole('button', { name: 'Close tools', exact: true }).click()
const choose = async name => page.getByRole('radio', { name, exact: true }).click()
const openTool = async name => page.getByRole('button', { name, exact: true }).click()
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
try {
  await page.goto(process.env.UI_REVIEW_URL || 'http://127.0.0.1:5178/')
  await page.getByRole('button', { name: 'Open featured score: Menuet in F, K.2', exact: true }).click()
  await ready()
  assert.equal(await page.getByRole('radio', { name: 'Preview', exact: true }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.locator('.practice-control-panel').count(), 0)
  assert.equal(await page.locator('.workspace-dock').count(), 1)
  await page.waitForTimeout(700)
  await shot('preview')
  const canvas = await page.locator('.pdf-canvas').boundingBox()
  assert(canvas.width * canvas.height > 1440 * 1000 * .70, 'Score canvas must occupy >70% of wide viewport')
  const paper = await page.locator('.pdf-page-window__slot--active .react-pdf__Page__canvas').boundingBox()
  assert(paper.width > canvas.width * .9, 'Reading width should use available score space')
  assert(paper.y >= canvas.y - 2, 'Reading width must start at the top, not cut off the page')
  await page.getByRole('button', { name: 'Fit mode', exact: true }).click()
  await page.getByRole('button', { name: 'Fit page', exact: true }).click(); await page.keyboard.press('Escape')
  await shot('page-overview')
  await page.getByRole('button', { name: 'Fit mode', exact: true }).click()
  await page.getByRole('button', { name: 'Fit width', exact: true }).click(); await page.keyboard.press('Escape')
  pass('Preview opens without input prompt; one dock, >70% score canvas, reading width and page overview')

  await openTool('Tempo')
  await page.getByRole('slider', { name: 'Playback speed' }).fill('0.75')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Tempo')
  await openTool('Metronome')
  await openTool('Sound & accompaniment')
  await page.getByLabel('Count-in', { exact: true }).selectOption('1')
  const track = page.locator('.midi-tracks input').first()
  await track.uncheck(); assert(!(await track.isChecked())); await track.check()
  await closeTools()
  await choose('Play Along')
  assert.match(await page.getByRole('button', { name: 'Tempo', exact: true }).innerText(), /45/)
  assert.equal(await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('aria-pressed'), 'true')
  await shot('play-along')
  await openTool('Play (Space)'); await page.getByRole('button', { name: 'Pause (Space)', exact: true }).waitFor()
  await choose('Preview'); await page.getByRole('button', { name: 'Play (Space)', exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Preview', exact: true }).focus()
  await page.keyboard.press('ArrowRight'); assert.equal(await page.getByRole('radio', { name: 'Play Along', exact: true }).getAttribute('aria-checked'), 'true')
  await page.keyboard.press('Home'); assert.equal(await page.getByRole('radio', { name: 'Preview', exact: true }).getAttribute('aria-checked'), 'true')
  await openTool('Tempo'); await page.getByRole('slider', { name: 'Playback speed' }).focus(); await page.keyboard.press('3')
  assert.equal(await page.getByRole('radio', { name: 'Preview', exact: true, includeHidden: true }).getAttribute('aria-checked'), 'true')
  await closeTools()
  pass('Shared tempo/click survive mode changes; switching pauses playback; accompaniment mutes; controls own their keys')

  await openTool('Loop')
  await page.getByRole('spinbutton', { name: 'Loop start bar' }).fill('2')
  await page.getByRole('spinbutton', { name: 'Loop end bar' }).fill('4')
  await page.getByRole('checkbox', { name: 'Repeat passage' }).check()
  await shot('loop-tools')
  await closeTools()
  assert.equal(await page.locator('.workspace-loop-range--on').count(), 1)
  await choose('Wait For You')
  await page.getByRole('button', { name: 'Continue (Enter)', exact: true }).waitFor()
  await shot('wait-for-you')
  const before = await page.locator('.workspace-your-turn').innerText()
  await openTool('Continue (Enter)')
  await page.waitForFunction(text => document.querySelector('.workspace-your-turn')?.innerText !== text, before)
  await openTool('Practice input')
  assert(await page.getByRole('button', { name: 'Use Continue', exact: true }).isVisible())
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.__reviewMicCalls = 0
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.__reviewMicCalls += 1; throw new DOMException('Review: permission denied', 'NotAllowedError') } })
  })
  await openTool('Practice input')
  await page.getByRole('button', { name: 'Microphone', exact: true }).click()
  await page.waitForFunction(() => window.__reviewMicCalls > 0)
  await closeTools()
  await page.waitForFunction(() => document.querySelector('.workspace-status').textContent.includes('Microphone unavailable'))
  await shot('input-denied')
  const captureRequests = await page.evaluate(() => window.__reviewMicCalls)
  await choose('Preview'); await openTool('Play (Space)'); await openTool('Pause (Space)')
  assert.equal(await page.evaluate(() => window.__reviewMicCalls), captureRequests)
  await choose('Wait For You'); await openTool('Practice input')
  await page.getByRole('button', { name: 'Use Continue', exact: true }).click(); await closeTools()
  pass('Denied microphone retains Continue; Preview playback never requests capture')
  await page.getByRole('slider', { name: 'Score position', exact: true }).fill('9')
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByRole('button', { name: 'Return to score', exact: true }).click(); await ready()
  assert.equal(await page.getByRole('radio', { name: 'Wait For You', exact: true }).getAttribute('aria-checked'), 'true')
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Score position"]').value) >= 8.5)
  assert.match(await page.locator('.workspace-target-detail').innerText(), /Bar 4/)
  pass('Loop range visible; WFY manual input and reopening preserve the existing position and mode')

  await choose('Preview')
  await page.getByRole('button', { name: 'Markup', exact: true }).click()
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await page.keyboard.press('Escape')
  const box = await page.locator('.annotation-layer').first().boundingBox()
  await page.mouse.move(box.x + box.width * .38, box.y + box.height * .30)
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .58, box.y + box.height * .31, { steps: 5 }); await page.mouse.up()
  const mark = await page.locator('.annotation-layer path').first().getAttribute('d')
  // Deliberately no autosave wait: immediately navigate, then reopen.
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByRole('button', { name: 'Return to score', exact: true }).click()
  await ready()
  assert.equal(await page.locator('.annotation-layer path').first().getAttribute('d'), mark)
  assert.match(await page.getByRole('button', { name: 'Tempo', exact: true }).innerText(), /45/)
  assert.equal(await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.workspace-loop-range--on').count(), 1)
  pass('Immediate navigation preserves newest annotation; reopen restores tempo/click/loop')

  await page.locator('.workspace-header h1').click()
  await page.keyboard.press('2')
  assert.equal(await page.getByRole('radio', { name: 'Play Along', exact: true }).getAttribute('aria-checked'), 'true')
  await page.keyboard.press('1'); await page.keyboard.press('-')
  assert.match(await page.getByRole('button', { name: 'Tempo', exact: true }).innerText(), /42/)
  await page.keyboard.press('+')
  await page.keyboard.press('l'); assert.equal(await page.getByRole('dialog', { name: 'Work a passage' }).count(), 1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('f'); assert.equal(await page.locator('.score-workspace--focus').count(), 1)
  await shot('focus')
  await openTool('Tempo'); await page.keyboard.press('Escape')
  assert.equal(await page.locator('.score-workspace--focus').count(), 1)
  await page.getByRole('button', { name: 'Markup', exact: true }).click()
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.score-workspace--focus').count(), 1)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.score-workspace--focus').count(), 1)
  assert.equal(await page.locator('.annotation-layer-root').first().evaluate(el => el.style.pointerEvents), 'none')
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.score-workspace--focus').count(), 0)
  pass('Keyboard modes, tempo, loop and focus; Escape closes nested tools first')

  await page.getByRole('button', { name: 'Note guide', exact: true }).click()
  await page.locator('.visual-practice').waitFor(); await shot('note-guide')
  await openTool('Focus score (F)'); assert.equal(await page.locator('.score-workspace--focus').count(), 1)
  await openTool('Exit focus (F)')
  await page.getByRole('button', { name: 'Score', exact: true }).click()
  await ready()
  assert.equal(await page.locator('.annotation-layer path').first().getAttribute('d'), mark)
  pass('Note guide shares modes and focus; Score returns with annotations intact')

  await openTool('Tempo'); await page.getByRole('slider', { name: 'Playback speed' }).fill('0.65'); await closeTools()
  await page.reload(); await ready()
  assert.match(await page.getByRole('button', { name: 'Tempo', exact: true }).innerText(), /39/)
  assert.equal(await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.annotation-layer path').first().getAttribute('d'), mark)
  await openTool('Sound & accompaniment'); assert.equal(await page.getByLabel('Count-in', { exact: true }).inputValue(), '1'); await closeTools()
  const restoreDismiss = page.locator('.session-restore-banner').getByRole('button', { name: 'Dismiss', exact: true })
  if (await restoreDismiss.isVisible()) await restoreDismiss.click()
  await openTool('Tempo'); await page.getByRole('slider', { name: 'Playback speed' }).fill('0.75'); await closeTools()
  pass('Immediate browser reload restores the latest tempo, metronome, count-in and annotations')

  if (['phase-e', 'phase-f', 'phase-g'].includes(phase)) {
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(500)
    const review = await page.evaluate(() => {
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const luminance = value => rgb(value).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
      const effectiveBackground = el => {
        const background = getComputedStyle(el).backgroundColor
        return background !== 'rgba(0, 0, 0, 0)' ? background : effectiveBackground(el.parentElement)
      }
      const inspect = selector => [...document.querySelectorAll(selector)].map(el => {
        const style = getComputedStyle(el), box = el.getBoundingClientRect()
        const light = luminance(style.color), dark = luminance(effectiveBackground(el))
        return { label: el.getAttribute('aria-label') || el.textContent.trim(), font: parseFloat(style.fontSize), contrast: (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05), width: box.width, height: box.height }
      })
      return { text: inspect('.workspace-play, .workspace-modes button, .workspace-tool-button, .workspace-status, .workspace-header h1, .viewer-float-toolbar__page, .viewer-float-toolbar__hint'), targets: inspect('.workspace-dock button, .workspace-header button, .viewer-float-toolbar__bar > button, .viewer-float-toolbar__bar > .tb-popover > button') }
    })
    for (const item of review.text) assert(item.contrast >= 4.5, `${item.label}: text contrast ${item.contrast}`)
    for (const item of review.targets) assert(item.height >= 44 && item.width >= 44, `${item.label}: hit target ${item.width}×${item.height}`)
    assert(review.text.find(item => item.label === 'Play (Space)').font >= 15)
    assert(review.text.find(item => item.label === 'Tempo').font >= 13)
    writeFileSync(`${dir}/legibility-results.json`, JSON.stringify(review, null, 2))
    await shot('preview-laptop')
    await page.locator('.workspace-header h1').click(); await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Pause (Space)', exact: true }).waitFor()
    await page.mouse.move(400, 100); await page.waitForTimeout(160)
    assert(await page.locator('.workspace-play').evaluate(el => getComputedStyle(el).backgroundColor.match(/[\d.]+/g).slice(0, 3).every(channel => Number(channel) > 215)), 'Pause must retain the light primary treatment')
    await shot('pause-laptop'); await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Play (Space)', exact: true }).waitFor()
    await page.keyboard.press('2'); assert.equal(await page.getByRole('radio', { name: 'Play Along', exact: true }).getAttribute('aria-checked'), 'true'); await shot('play-along-laptop')
    await page.keyboard.press('3'); assert.equal(await page.getByRole('radio', { name: 'Wait For You', exact: true }).getAttribute('aria-checked'), 'true'); await shot('wait-for-you-laptop')
    const targetBeforeEnter = await page.locator('.workspace-target-detail').innerText()
    await page.keyboard.press('Enter')
    await page.waitForFunction(before => document.querySelector('.workspace-target-detail').innerText !== before, targetBeforeEnter)
    await page.keyboard.press('1'); assert.equal(await page.getByRole('radio', { name: 'Preview', exact: true }).getAttribute('aria-checked'), 'true')
    await openTool('Loop'); await shot('loop-laptop'); await closeTools()
    await openTool('Focus score (F)'); await shot('focus-laptop')
    const guide = page.getByRole('button', { name: 'Note guide', exact: true })
    await guide.focus(); assert(await page.getByRole('tooltip').isVisible())
    assert.match(await guide.getAttribute('aria-describedby'), /.+/)
    await page.keyboard.press('Escape')
    assert(!(await page.getByRole('tooltip').isVisible()))
    assert.equal(await page.locator('.score-workspace--focus').count(), 1)
    await openTool('Exit focus (F)'); await page.waitForTimeout(250)
    assert((await page.locator('.workspace-header').boundingBox()).y >= 0)
    await guide.hover(); assert(await page.getByRole('tooltip').isVisible()); await shot('note-guide-help')
    await page.mouse.move(300, 400); assert(!(await page.getByRole('tooltip').isVisible()))
    await guide.click(); await page.locator('.visual-practice').waitFor(); await shot('note-guide-laptop')
    await page.getByRole('button', { name: 'Score', exact: true }).click(); await ready()
    pass('Laptop hierarchy, text contrast, 44px control targets and hover/keyboard Note guide help')
  }

  for (const [width, height] of [[1920,1080],[1440,1000],[1280,800],[1024,768],[768,900],[430,932],[390,844]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(500); await noOverflow()
    await shot(`workspace-${width}`)
    assert(await page.getByRole('button', { name: 'Play (Space)', exact: true }).isVisible())
    if (['phase-e', 'phase-g'].includes(phase) && width === 768) {
      const position = page.locator('.workspace-position > div').first()
      assert(await position.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Position labels should fit without clipping')
      const rightmost = await page.getByRole('button', { name: 'Workspace settings', exact: true }).boundingBox()
      assert(rightmost.x + rightmost.width <= width, 'Secondary controls must remain in the viewport')
      await choose('Play Along'); await noOverflow(); await shot('play-along-narrow')
      await choose('Wait For You'); await noOverflow(); await shot('wait-for-you-768')
      await openTool('Loop'); await shot('loop-narrow'); await page.keyboard.press('Escape')
      await choose('Preview'); await openTool('Focus score (F)'); await shot('focus-narrow'); await openTool('Exit focus (F)')
    }
  }
  await openTool('Tempo'); await shot('tools-narrow'); await closeTools()
  await choose('Wait For You'); await noOverflow(); await shot('wait-for-you-narrow')
  assert(await page.getByRole('button', { name: 'Continue (Enter)' }).isVisible())
  await choose('Preview')
  await openTool('Open navigation'); await page.keyboard.press('Escape')
  pass('Wide/laptop/narrow/phone layouts retain transport, tools and drawer without horizontal overflow')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('.score-workspace').evaluate(el => getComputedStyle(el).animationName), 'none')
  assert.deepEqual(errors, [])
  pass('Reduced motion respected; no uncaught browser errors')
  completed = true
} catch(e) { failure = e.stack; await page.screenshot({ path: `${dir}/failure.png` }); throw e }
finally { writeFileSync(`${dir}/browser-results.json`, JSON.stringify({ completed, failure, checks, errors, date: new Date().toISOString() }, null, 2)); await browser.close() }
