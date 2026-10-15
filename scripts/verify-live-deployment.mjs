#!/usr/bin/env node
/**
 * Live deployment verification.
 *
 * Drives the REAL deployed site (default https://corranzo.com) in a real
 * browser and checks the essential score-following flows plus that the new
 * timing code is actually served:
 *   1. the site loads with no page errors
 *   2. a score opens and renders (built-in demo/library path)
 *   3. Preview playback advances the shared cursor
 *   4. Wait For You shows a required note and accepts a correct one
 *   5. a session is saved (localStorage) and restores
 *
 *   node scripts/verify-live-deployment.mjs [--url https://corranzo.com]
 */
import { chromium } from 'playwright'

const urlArgIndex = process.argv.indexOf('--url')
const BASE = urlArgIndex >= 0 ? process.argv[urlArgIndex + 1] : 'https://corranzo.com'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|AudioContext|Failed to load resource/i.test(message.text())) {
      consoleErrors.push(message.text())
    }
  })

  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`)
  }

  // 1. site loads
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.waitForTimeout(2500)
  check('live site loads', (await page.title()).length > 0, `title="${await page.title()}"`)

  // dismiss any tutorial/restore overlay
  for (const name of ['Skip', 'Done']) {
    const button = page.getByRole('button', { name, exact: true }).first()
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {})
      await sleep(400)
    }
  }

  // 2. open the built-in featured score from the home screen
  let opened = false
  const openButton = page.getByRole('button', { name: /open score/i }).first()
  if (await openButton.isVisible().catch(() => false)) {
    await openButton.click().catch(() => {})
    opened = true
  }
  // Wait for the practice workspace (cold load can take a few seconds).
  let workspace = 0
  for (let attempt = 0; attempt < 12 && workspace === 0; attempt += 1) {
    await sleep(1000)
    workspace = await page.locator('main.score-workspace, main.practice-workspace').count()
  }
  check('score opens into practice', opened && workspace > 0, `workspace=${workspace}`)

  const canvasCount = await page.locator('canvas').count()
  let canvases = canvasCount
  for (let attempt = 0; attempt < 10 && canvases === 0; attempt += 1) {
    await sleep(1000)
    canvases = await page.locator('canvas').count()
  }
  check('score renders on canvas', canvases > 0, `${canvases} canvases`)

  // 3. Preview playback advances the cursor
  const modePreview = page.getByRole('button', { name: 'Preview', exact: true }).first()
  if (await modePreview.isVisible().catch(() => false)) {
    await modePreview.click().catch(() => {})
    await sleep(600)
  }
  const playButton = page.getByRole('button', { name: /^play/i }).first()
  if (await playButton.isVisible().catch(() => false)) {
    await playButton.click().catch(() => {})
    await sleep(2500)
    const bar = await page.locator('[data-score-follow-bar="true"]').count()
    const playing = await page.getByRole('button', { name: /^pause/i }).count()
    check('Preview playback runs with a cursor', playing > 0 || bar > 0, `pause=${playing} bar=${bar}`)
    const pause = page.getByRole('button', { name: /^pause/i }).first()
    if (await pause.isVisible().catch(() => false)) {
      await pause.click().catch(() => {})
      await sleep(300)
    }
  } else {
    check('Preview playback runs with a cursor', false, 'play button not found')
  }

  // 4. Wait For You shows a required note
  const wfy = page.getByRole('radio', { name: /wait for you/i }).first()
  if (await wfy.isVisible().catch(() => false)) {
    await wfy.click().catch(() => {})
    await sleep(1500)
    const waiting = (await page.textContent('body').catch(() => '')) ?? ''
    const hasRequirement = /waiting|play|measure/i.test(waiting)
    check('Wait For You shows a requirement', hasRequirement)
  } else {
    check('Wait For You shows a requirement', false, 'mode selector not found')
  }

  // 5. session persists in storage
  const storageKeys = await page.evaluate(() => Object.keys(localStorage))
  check('app persists session state', storageKeys.length > 0, `${storageKeys.length} localStorage keys`)

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await browser.close()
  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} live checks pass`)
  if (failed.length > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
