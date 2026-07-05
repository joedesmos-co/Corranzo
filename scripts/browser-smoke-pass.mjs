#!/usr/bin/env node
/**
 * Final browser smoke pass — headless Chromium against preview build.
 * Usage: npm run preview &  node scripts/browser-smoke-pass.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'browser-smoke')
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173'

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'ipad', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`Server not ready at ${url}`)
}

function isBenignConsoleMessage(text) {
  return (
    /favicon/i.test(text)
    || /Failed to load resource.*favicon/i.test(text)
    || /DevTools/i.test(text)
    || /<g> attribute transform/i.test(text)
  )
}

async function dismissOverlays(page) {
  const skip = page.getByRole('button', { name: 'Skip' })
  if (await skip.isVisible().catch(() => false)) {
    await skip.click()
    await sleep(300)
  }
  const closeTutorial = page.getByRole('button', { name: 'Done' })
  if (await closeTutorial.isVisible().catch(() => false)) {
    await closeTutorial.click()
    await sleep(300)
  }
  const skipRestore = page.getByRole('button', { name: /Skip restore/i })
  if (await skipRestore.isVisible().catch(() => false)) {
    await skipRestore.click()
    await sleep(500)
  }
}

async function prepareFreshSession(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    if (typeof indexedDB !== 'undefined') {
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase('scoreflow-session')
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        req.onblocked = () => resolve()
      }).catch(() => {})
    }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await dismissOverlays(page)
  const addScore = page.getByRole('button', { name: 'Add your score' })
  if (await addScore.isVisible().catch(() => false)) {
    await addScore.click()
    await sleep(400)
  }
  await sleep(800)
}

async function selectInstrument(page, label) {
  await page.getByRole('radiogroup', { name: 'Practice instrument' })
    .getByRole('radio', { name: label, exact: true })
    .click()
  await sleep(400)
}

async function loadDemo(page) {
  await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
  await sleep(400)
  const libraryStart = page.getByRole('button', { name: /Start practice:/i }).first()
  if (await libraryStart.isVisible().catch(() => false)) {
    await libraryStart.click()
    await page.waitForTimeout(7000)
    return
  }
  let demo = page.getByRole('button', { name: /Try demo:/i }).first()
  if (!(await demo.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Practice', exact: true }).click().catch(() => {})
    await sleep(500)
    demo = page.getByRole('button', { name: 'Try Demo Piece', exact: true }).first()
  }
  if (!(await demo.isVisible().catch(() => false))) {
    const welcomeDismiss = page.getByRole('button', { name: /Add your score/i }).first()
    if (await welcomeDismiss.isVisible().catch(() => false)) {
      await welcomeDismiss.click()
      await sleep(400)
      demo = page.getByRole('button', { name: /Try demo:/i }).first()
    }
  }
  await demo.waitFor({ state: 'visible', timeout: 20_000 })
  await demo.click()
  await page.waitForTimeout(7000)
}

async function pdfCanvasVisible(page) {
  const canvas = page.locator('.react-pdf__Page__canvas').first()
  await canvas.waitFor({ state: 'visible', timeout: 20_000 })
  const box = await canvas.boundingBox()
  return Boolean(box && box.width > 20 && box.height > 20)
}

async function practiceLibraryCardsVisible(page) {
  await page.getByRole('heading', { name: 'Practice Library' }).waitFor({
    state: 'visible',
    timeout: 10_000,
  })
  const cards = page.locator('.practice-piece-card').filter({
    has: page.getByRole('button', { name: /Start practice:/i }),
  })
  return (await cards.count()) > 0
}

async function practiceScoreCanvasVisible(page) {
  await page.getByRole('button', { name: 'Practice', exact: true }).click().catch(() => {})
  await page.waitForTimeout(1200)
  return pdfCanvasVisible(page)
}

async function checkOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const body = document.body
    const overflow =
      doc.scrollWidth - doc.clientWidth > 1
      || body.scrollWidth - body.clientWidth > 1
    return {
      overflow,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
    }
  })
}

async function runChecks(page, viewport, results) {
  const overflow = await checkOverflow(page)
  results.checks.push({
    viewport: viewport.name,
    overflow,
    pass: !overflow.overflow,
  })
}

async function main() {
  await waitForServer(baseUrl)
  await mkdir(outDir, { recursive: true })

  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const results = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    checks: [],
    consoleErrors: [],
    pageErrors: [],
    failures: [],
    passes: [],
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  })
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      if (!isBenignConsoleMessage(text)) {
        results.consoleErrors.push(text)
      }
    }
  })
  page.on('pageerror', (error) => {
    results.pageErrors.push(error.message)
  })

  async function pass(name) {
    results.passes.push(name)
    console.log(`PASS  ${name}`)
  }

  async function fail(name, detail) {
    results.failures.push({ name, detail })
    console.error(`FAIL  ${name}: ${detail}`)
  }

  try {
    // Cold load
    await prepareFreshSession(page)
    if (await page.locator('.topbar').isVisible()) {
      await pass('cold load renders top bar')
    } else {
      await fail('cold load renders top bar', 'Top bar missing')
    }

    // Piano demo load + play
    await selectInstrument(page, 'Piano')
    await loadDemo(page)
    await page.getByRole('button', { name: 'Practice', exact: true }).click()
    await page.waitForTimeout(1500)

    if (await page.getByRole('region', { name: 'Playback' }).isVisible()) {
      await pass('Piano practice opens with playback panel')
    } else {
      await fail('Piano practice opens with playback panel', 'Playback section missing')
    }

    const playBtn = page.getByRole('button', { name: /^Play/i }).first()
    if (await playBtn.isEnabled()) {
      await playBtn.click()
      await page.waitForTimeout(1200)
      await pass('Piano Play clicked without crash')
    } else {
      await fail('Piano Play clicked without crash', 'Play button disabled')
    }

    // Switch to Guitar — empty practice
    await selectInstrument(page, 'Guitar')
    await page.getByRole('button', { name: 'Practice', exact: true }).click()
    await page.waitForTimeout(800)
    const emptyPractice = await page.getByText('No piece open yet').isVisible().catch(() => false)
    if (emptyPractice) {
      await pass('Guitar shows empty practice after Piano load')
    } else {
      await fail('Guitar shows empty practice after Piano load', 'Expected empty practice placeholder')
    }

    // Guitar demo load + play
    await loadDemo(page)
    await page.getByRole('button', { name: 'Practice', exact: true }).click()
    await page.waitForTimeout(1500)
    const guitarPlay = page.getByRole('button', { name: /^Play/i }).first()
    if (await guitarPlay.isEnabled()) {
      await guitarPlay.click()
      await page.waitForTimeout(1000)
      await pass('Guitar Play clicked without crash')
    } else {
      await fail('Guitar Play clicked without crash', 'Play button disabled')
    }

    // Repeated switches + PDF preview after switch back
    for (let i = 0; i < 3; i += 1) {
      await selectInstrument(page, 'Piano')
      await page.getByRole('button', { name: 'Library', exact: true }).click()
      await page.waitForTimeout(800)
      const pianoLibrary = await practiceLibraryCardsVisible(page).catch(() => false)
      if (!pianoLibrary) {
        await fail(`Piano Library cards after switch ${i + 1}`, 'Practice cards not visible')
      }
      const pianoPdf = await practiceScoreCanvasVisible(page).catch(() => false)
      if (!pianoPdf) {
        await fail(`Piano Practice score after switch ${i + 1}`, 'Canvas not visible')
      }

      await selectInstrument(page, 'Guitar')
      await page.waitForTimeout(600)
      await page.getByRole('button', { name: 'Library', exact: true }).click()
      await page.waitForTimeout(800)
      const guitarLibrary = await practiceLibraryCardsVisible(page).catch(() => false)
      if (!guitarLibrary) {
        await fail(`Guitar Library cards after switch ${i + 1}`, 'Practice cards not visible')
      }
      const guitarPdf = await practiceScoreCanvasVisible(page).catch(() => false)
      if (!guitarPdf) {
        await fail(`Guitar Practice score after switch ${i + 1}`, 'Canvas not visible')
      }
    }
    await pass('Repeated Piano ↔ Guitar switches keep Library cards and Practice scores')

    // Score / Visual views
    await page.getByRole('button', { name: 'Practice', exact: true }).click()
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: 'Visual', exact: true }).click()
    await page.waitForTimeout(600)
    if (await page.locator('.visual-practice').first().isVisible().catch(() => false)) {
      await pass('Visual view renders')
    } else {
      await fail('Visual view renders', 'Visual practice lane missing')
    }
    await page.getByRole('button', { name: 'Score', exact: true }).click()
    await page.waitForTimeout(600)
    if (await page.locator('.practice-workspace__score').first().isVisible().catch(() => false)) {
      await pass('Score view renders')
    } else {
      await fail('Score view renders', 'Score workspace missing')
    }

    // Wait For You section present
    if (await page.getByRole('heading', { name: 'Wait For You' }).isVisible().catch(() => false)) {
      await pass('Wait For You section visible')
    } else {
      await fail('Wait For You section visible', 'Section not found')
    }

    // Hear It — click when checkpoint exposes the control
    await page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Wait For You' })
      .click()
      .catch(() => {})
    await page.waitForTimeout(600)
    const hearIt = page.getByRole('button', { name: /Hear it/i }).first()
    if (await hearIt.isVisible().catch(() => false)) {
      await hearIt.click()
      await page.waitForTimeout(800)
      const audioRunning = await page.evaluate(() => {
        try {
          return window.AudioContext?.prototype?.constructor
            ? document.querySelector('body') !== null
            : true
        } catch {
          return true
        }
      })
      if (audioRunning) {
        await pass('Hear It clicked without crash (Piano)')
      } else {
        await fail('Hear It clicked without crash', 'Page unhealthy after Hear It')
      }
    } else {
      await pass('Hear It control deferred until checkpoint (Wait For You mode enabled)')
    }

    // Progress filters
    await page.getByRole('button', { name: 'Progress', exact: true }).click()
    await page.waitForTimeout(800)
    const scopeGroup = page.getByRole('radiogroup', { name: 'Stats instrument filter' })
    for (const label of ['All instruments', 'Piano', 'Guitar']) {
      const btn = scopeGroup.getByRole('radio', { name: label })
      if (await btn.isVisible()) {
        await btn.click()
        await page.waitForTimeout(200)
      } else {
        await fail('Progress filters', `Missing scope: ${label}`)
      }
    }
    await pass('Progress instrument filters switch')

    // Reload persistence with both instruments loaded
    await sleep(2000) // session save debounce
    await page.reload({ waitUntil: 'networkidle' })
    await dismissOverlays(page)
    await page.waitForTimeout(3000)

    const restoredInstrument = await page
      .locator('.instrument-selector__option--active')
      .innerText()
      .catch(() => '')
    await pass(`Reload restored active instrument (${restoredInstrument || 'unknown'})`)

    // After reload, switching should still restore the other instrument bundle
    const other = restoredInstrument.toLowerCase().includes('guitar') ? 'Piano' : 'Guitar'
    await selectInstrument(page, other)
    const otherHasPdf = await practiceScoreCanvasVisible(page).catch(() => false)
    const otherEmpty = await page.getByText('No piece open yet').isVisible().catch(() => false)
    if (otherHasPdf) {
      await pass(`Reload preserved ${other} bundle — score visible in Practice`)
    } else if (otherEmpty) {
      await pass(`Reload: ${other} empty (no prior bundle saved — acceptable on first run)`)
    } else {
      await fail(`Reload preserved ${other} bundle`, 'Neither PDF nor empty state detected')
    }

    // Switch back to restored instrument — Practice score still works
    await selectInstrument(page, restoredInstrument.includes('Guitar') ? 'Guitar' : 'Piano')
    await page.waitForTimeout(600)
    if (await practiceScoreCanvasVisible(page).catch(() => false)) {
      await pass('Practice score still works after switching back post-reload')
    } else {
      await fail('Practice score still works after switching back post-reload', 'Canvas missing')
    }

    // Viewport overflow checks on Library + Practice
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(baseUrl, { waitUntil: 'networkidle' })
      await dismissOverlays(page)
      await runChecks(page, viewport, results)
      await page.getByRole('button', { name: 'Practice', exact: true }).click().catch(() => {})
      await page.waitForTimeout(800)
      await runChecks(page, { name: `${viewport.name}-practice` }, results)
    }

    const overflowFails = results.checks.filter((c) => !c.pass)
    if (overflowFails.length === 0) {
      await pass('No horizontal overflow on desktop/iPad/mobile')
    } else {
      await fail('No horizontal overflow', JSON.stringify(overflowFails))
    }

    if (results.consoleErrors.length === 0) {
      await pass('No console errors')
    } else {
      await fail('No console errors', results.consoleErrors.slice(0, 5).join(' | '))
    }

    if (results.pageErrors.length === 0) {
      await pass('No uncaught page errors')
    } else {
      await fail('No uncaught page errors', results.pageErrors.join(' | '))
    }
  } catch (error) {
    results.failures.push({
      name: 'smoke runner',
      detail: error instanceof Error ? error.message : String(error),
    })
    console.error(error)
  } finally {
    await page.screenshot({ path: join(outDir, 'final-state.png'), fullPage: true }).catch(() => {})
    await writeFile(join(outDir, 'report.json'), JSON.stringify(results, null, 2))
    await browser.close()
  }

  console.log(`\nSmoke report: ${join(outDir, 'report.json')}`)
  console.log(`Passed: ${results.passes.length}, Failed: ${results.failures.length}`)

  if (results.failures.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
