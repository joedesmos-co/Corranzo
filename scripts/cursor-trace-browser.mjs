#!/usr/bin/env node
/**
 * Browser cursor trace harness (Chromium / WebKit).
 *
 * Loads a real library score, runs Preview playback (no microphone), and
 * samples every animation frame:
 *   - audio-clock score time (Tone.now-derived, calibrated from the transport)
 *   - motion-timeline target from the live score-follow runtime snapshot
 *   - actual painted cursor DOM position (style % and getBoundingClientRect)
 *   - page / system / measure identity, fallback tier, segment type
 *   - scroll / viewport / page-frame layout
 *
 * Usage:
 *   node scripts/cursor-trace-browser.mjs --browser chromium --score "Hungarian Dance No. 5" --out tmp/cursor-trace/hungarian-chromium-after.json
 */
import { chromium, webkit } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
function arg(name, fallback = null) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const browserName = arg('browser', 'chromium')
const baseUrl = arg('base', 'http://localhost:5179')
const scoreTitle = arg('score', 'Hungarian Dance No. 5')
const instrument = arg('instrument', 'piano')
const outPath = arg('out', `tmp/cursor-trace/${scoreTitle.replace(/\W+/g, '-')}-${browserName}.json`)
const label = arg('label', 'run')
const profile = arg('profile', 'full')

const browserType = browserName === 'webkit' ? webkit : chromium
const browser = await browserType.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400))
})

await page.goto(`${baseUrl}/#library`, { waitUntil: 'networkidle' })
if (instrument === 'guitar') {
  await page.getByText('Acoustic Guitar', { exact: true }).first().click()
  await page.waitForTimeout(500)
}
await page.getByRole('button', { name: new RegExp(`Open score: ${scoreTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click()
await page.waitForTimeout(8000)

// Wait until the cursor element exists and the score is ready.
await page.waitForSelector('.score-follow-cursor', { timeout: 30_000, state: 'attached' })
await page.waitForFunction(() => {
  const el = [...document.querySelectorAll('.score-follow-cursor')].find((node) => node.style.display !== 'none')
  return Boolean(el)
}, { timeout: 30_000 })

await page.evaluate(async () => {
  const runtime = await import('/src/features/score-follow/scoreFollowCursorRuntime.js')
  const toneModule = await import('/node_modules/.vite/deps/tone.js')
  const toneNow = () => (typeof toneModule.now === 'function' ? toneModule.now() : toneModule.Transport?.context?.currentTime ?? 0)
  const seekElement = () => document.querySelector('input[aria-label="Score position"]')
  const playButton = () => document.querySelector('button.workspace-play')
  const isPlaying = () => /Pause/.test(playButton()?.getAttribute('aria-label') ?? '')
  const state = { playing: false, tone0: 0, seek0: 0 }
  const samples = []
  const markers = []
  const currentScoreTime = () => {
    if (!state.playing) return Number(seekElement()?.value ?? 0)
    return state.seek0 + (toneNow() - state.tone0)
  }
  window.__TRACE__ = { samples, markers }
  window.__TRACE_MARK__ = (name) => {
    markers.push({ name, wall: performance.now(), index: samples.length, scoreTime: currentScoreTime() })
  }
  window.__TRACE_RESET_CLOCK__ = () => {
    state.playing = isPlaying()
    state.tone0 = toneNow()
    state.seek0 = Number(seekElement()?.value ?? 0)
  }
  window.__TRACE_STOP__ = false
  const tick = () => {
    const playing = isPlaying()
    if (playing && !state.playing) {
      state.playing = true
      state.tone0 = toneNow()
      state.seek0 = Number(seekElement()?.value ?? 0)
    }
    if (!playing) state.playing = false
    const seek = Number(seekElement()?.value ?? 0)
    const scoreTime = playing ? state.seek0 + (toneNow() - state.tone0) : seek
    const snapshot = runtime.getScoreFollowCursorSnapshot()
    let dom = null
    for (const element of document.querySelectorAll('.score-follow-cursor')) {
      if (element.style.display === 'none') continue
      const overlay = element.parentElement
      const overlayRect = overlay?.getBoundingClientRect()
      const cursorRect = element.getBoundingClientRect()
      if (!overlayRect || overlayRect.width <= 0) continue
      const centerX = cursorRect.left + cursorRect.width / 2
      const centerY = cursorRect.top + cursorRect.height / 2
      dom = {
        styleX: Number.parseFloat(element.style.left) / 100,
        styleY: Number.parseFloat(element.style.top) / 100,
        x: (centerX - overlayRect.left) / overlayRect.width,
        y: (centerY - overlayRect.top) / overlayRect.height,
        pixelX: centerX - overlayRect.left,
        pixelY: centerY - overlayRect.top,
        overlayWidth: overlayRect.width,
        overlayHeight: overlayRect.height,
        cursorHeight: cursorRect.height,
      }
      break
    }
    const activeSlot = document.querySelector('.pdf-page-window__slot--active')
    const canvas = document.querySelector('.pdf-canvas')
    const pageFrame = document.querySelector('.pdf-page-window__slot--active .pdf-page-frame, .pdf-page-frame')
    const frameRect = pageFrame?.getBoundingClientRect()
    const fitLabel = document.querySelector('.tb-menu__item--active')?.textContent?.trim() ?? null
    samples.push({
      wall: performance.now(),
      scoreTime,
      seek,
      playing,
      bar: document.querySelector('.workspace-bar-reference strong')?.textContent ?? null,
      target: snapshot ? { ...snapshot } : null,
      dom,
      activePage: Number(activeSlot?.getAttribute('data-page')) || null,
      scroll: canvas
        ? { top: canvas.scrollTop, left: canvas.scrollLeft, width: canvas.scrollWidth, height: canvas.scrollHeight }
        : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageFrame: frameRect
        ? { width: frameRect.width, height: frameRect.height, left: frameRect.left, top: frameRect.top }
        : null,
      fitLabel,
    })
    if (!window.__TRACE_STOP__) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

async function mark(name) {
  await page.evaluate((value) => window.__TRACE_MARK__(value), name)
}
async function resetClock() {
  await page.evaluate(() => window.__TRACE_RESET_CLOCK__())
}
async function seekTo(seconds) {
  await page.locator('input[aria-label="Score position"]').evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(element, String(value))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, seconds)
  await page.waitForTimeout(450)
  await resetClock()
}
async function play() {
  await page.locator('button.workspace-play').click()
  await page.waitForTimeout(250)
  await resetClock()
}
async function pause() {
  if (await page.locator('button.workspace-play').evaluate((button) => /Pause/.test(button.getAttribute('aria-label') ?? ''))) {
    await page.locator('button.workspace-play').click()
    await page.waitForTimeout(250)
  }
}
async function wait(ms) {
  await page.waitForTimeout(ms)
}

async function phase(name, action) {
  await mark(`${name}:start`)
  await action()
  await mark(`${name}:end`)
}

if (profile === 'fugue') {
  await phase('play-from-start', async () => {
    await seekTo(0)
    await play()
    await wait(7000)
  })
  await phase('pause', async () => {
    await pause()
    await wait(1200)
  })
  await phase('resume', async () => {
    await play()
    await wait(2500)
  })
  await phase('page-two', async () => {
    await pause()
    await seekTo(58.0)
    await play()
    await wait(4500)
  })
  await phase('seek-during-play', async () => {
    await seekTo(20.0)
    await play()
    await wait(2500)
  })
} else if (profile === 'guitar') {
  await phase('play-from-start', async () => {
    await seekTo(0)
    await play()
    await wait(9000)
  })
  await phase('pause', async () => {
    await pause()
    await wait(1200)
  })
  await phase('resume', async () => {
    await play()
    await wait(2500)
  })
  await phase('rest-measures', async () => {
    await pause()
    await seekTo(15.0)
    await play()
    await wait(6500)
  })
  await phase('system-transition', async () => {
    await pause()
    await seekTo(26.0)
    await play()
    await wait(4500)
  })
  await phase('seek-during-play', async () => {
    await seekTo(40.0)
    await play()
    await wait(2500)
  })
} else {
  await phase('play-from-start', async () => {
    await seekTo(0)
    await play()
    await wait(11000)
  })
  await phase('pause', async () => {
    await pause()
    await wait(1200)
  })
  await phase('resume', async () => {
    await play()
    await wait(3500)
  })
  await phase('system-boundary', async () => {
    await pause()
    await seekTo(4.6)
    await play()
    await wait(2600)
  })
  await phase('page-two', async () => {
    await pause()
    await seekTo(25.6)
    await play()
    await wait(4200)
  })
  await phase('repeat-jump', async () => {
    await pause()
    await seekTo(46.4)
    await play()
    await wait(4200)
  })
  await phase('page-three', async () => {
    await pause()
    await seekTo(77.8)
    await play()
    await wait(4200)
  })
  await phase('page-four', async () => {
    await pause()
    await seekTo(109.8)
    await play()
    await wait(4200)
  })
  await phase('seek-during-play', async () => {
    await seekTo(19.0)
    await play()
    await wait(2500)
  })
}
await phase('fit-page', async () => {
  await pause()
  try {
    const fitButton = page.locator('button[aria-label="Fit mode"]')
    await fitButton.click()
    await page.locator('button.tb-menu__item:visible', { hasText: 'Fit page' }).first().click()
    await wait(1400)
    await mark('fit-page:page')
    await fitButton.click()
    await page.locator('button.tb-menu__item:visible', { hasText: 'Fit width' }).first().click()
    await wait(1400)
  } catch (error) {
    await mark(`fit-page:skipped:${String(error).slice(0, 80)}`)
  }
})
await phase('viewport-resize', async () => {
  await page.setViewportSize({ width: 1050, height: 720 })
  await wait(1400)
  await mark('viewport-resize:small')
  await page.setViewportSize({ width: 1440, height: 900 })
  await wait(1400)
})
await phase('scroll', async () => {
  await page.evaluate(() => {
    const canvas = document.querySelector('.pdf-canvas')
    if (canvas) canvas.scrollTop += 320
  })
  await wait(900)
  await mark('scroll:down')
  await page.evaluate(() => {
    const canvas = document.querySelector('.pdf-canvas')
    if (canvas) canvas.scrollTop -= 320
  })
  await wait(900)
})
await mark('trace:end')

await page.evaluate(() => {
  window.__TRACE_STOP__ = true
})
await wait(250)
const trace = await page.evaluate(() => ({
  samples: window.__TRACE__.samples,
  markers: window.__TRACE__.markers,
}))
await mkdir(dirname(outPath), { recursive: true })
await writeFile(
  outPath,
  JSON.stringify(
    {
      label,
      browser: browserName,
      scoreTitle,
      instrument,
      generatedAt: new Date().toISOString(),
      consoleErrors,
      ...trace,
    },
    null,
    2,
  ),
)
console.log(`wrote ${outPath} (${trace.samples.length} samples, ${trace.markers.length} markers)`)
if (consoleErrors.length) console.log('console errors:', consoleErrors.slice(0, 5))
await browser.close()
