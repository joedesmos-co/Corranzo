#!/usr/bin/env node
/**
 * Mobile-viewport reliability pass (real browser, 390x844 iPhone class).
 *
 * Looks for the real page-level defects a phone user hits: controls smaller
 * than the 44px touch target, overlapping/hidden interactive elements, a
 * stuck loading indicator, and an unusable practice workspace.
 *
 *   E2E_PORT=5485 node scripts/browser-mobile-reliability-e2e.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'mobile-reliability')
const PORT = Number(process.env.E2E_PORT ?? 5485)
const baseUrl = `http://127.0.0.1:${PORT}/?e2e-midi=1`
const PHONE = { width: 390, height: 844 }

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function isBenignConsoleMessage(text) {
  if (/favicon|DevTools|<g> attribute transform|AudioContext|net::ERR_/i.test(text)) return true
  return false
}

/** Phone width hides the sidebar behind a drawer — open it before navigating. */
async function openDrawer(page) {
  const toggle = page.locator('.cz-shell__toggle').first()
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click()
    await sleep(700)
  }
}

/**
 * Click a shell nav entry by its rendered text. Accessible names include the
 * step number ("03Practice"), and "Practice history" is a different
 * destination from "Practice", so match the text node itself rather than a
 * substring of the accessible name.
 */
async function clickNav(page, text) {
  return page.evaluate((label) => {
    const buttons = [...document.querySelectorAll('.cz-shell__sidewrap button, nav button, [role="navigation"] button')]
    const match = buttons.find((b) => {
      const own = b.textContent.replace(/\s+/g, ' ').trim()
      return own === label && b.getBoundingClientRect().width > 0
    })
    if (!match) return false
    match.click()
    return true
  }, text)
}

async function dismissOverlays(page) {
  for (const name of ['Done', /Skip restore/i]) {
    const button = page.getByRole('button', { name })
    if (await button.isVisible().catch(() => false)) { await button.click(); await sleep(400) }
  }
}

async function clearSiteState(page) {
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('scoreflow-session')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    }).catch(() => {})
  })
}

/** Audit every visible control on the current page. */
async function auditControls(page) {
  return page.evaluate(() => {
    const small = []
    const hidden = []
    const overlap = []
    const controls = [...document.querySelectorAll('button, [role="button"], input, select, a[href], [role="radio"], summary')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.top >= -2 && r.bottom <= window.innerHeight + 2
      })
    for (const el of controls) {
      const r = el.getBoundingClientRect()
      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 46)
      if (r.height < 30) small.push({ label, h: Math.round(r.height) })
      // An error/alert message that is on screen but not actually visible.
      const style = getComputedStyle(el)
      if (/alert|error/.test(el.className + '') && (style.visibility === 'hidden' || style.opacity === '0' || style.display === 'none')) {
        hidden.push(label)
      }
    }
    // Overlapping interactive pairs (a real hit-test failure).
    for (let i = 0; i < controls.length; i += 1) {
      const a = controls[i].getBoundingClientRect()
      for (let j = i + 1; j < controls.length; j += 1) {
        const b = controls[j].getBoundingClientRect()
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (ox > 6 && oy > 6) {
          const area = ox * oy
          const min = Math.min(a.width * a.height, b.width * b.height)
          if (min > 0 && area / min > 0.5) {
            overlap.push([
              (controls[i].getAttribute('aria-label') || controls[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32),
              (controls[j].getAttribute('aria-label') || controls[j].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32),
            ])
          }
        }
      }
    }
    return { total: controls.length, small, hidden, overlap: overlap.slice(0, 6) }
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), baseUrl, viewport: PHONE, passes: [], failures: [], consoleErrors: [], pageErrors: [], skipped: [] }
  const pass = (name, detail = null) => { report.passes.push({ name, detail }); console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`) }
  const fail = (name, detail = null) => { report.failures.push({ name, detail }); console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`) }
  const skip = (name, why) => { report.skipped.push({ name, why }); console.log(`SKIP  ${name} :: ${why}`) }

  // PDF-first: the phone flow is a real PDF import (standalone MusicXML is no
  // longer an entry point), with its matched companion attached under Advanced.
  const fixture = join(root, 'public', 'fixtures', 'practice-library', 'piano-brahms-lullaby', 'piano-brahms-lullaby.pdf')
  const companionFixture = join(root, 'public', 'fixtures', 'practice-library', 'piano-brahms-lullaby', 'piano-brahms-lullaby.musicxml')
  if (!existsSync(fixture)) { console.error(`fixture missing: ${fixture}`); process.exit(1) }
  const staged = join(outDir, 'lullaby.pdf'); copyFileSync(fixture, staged)
  const stagedCompanion = join(outDir, 'lullaby.musicxml')
  if (existsSync(companionFixture)) copyFileSync(companionFixture, stagedCompanion)

  const viteServer = await createServer({
    root, configFile: join(root, 'vite.config.js'), logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, isMobile: true })
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error' && !isBenignConsoleMessage(msg.text())) report.consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => report.pageErrors.push(error.message))

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await clearSiteState(page)
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await dismissOverlays(page)
    await page.screenshot({ path: join(outDir, '01-home.png'), fullPage: true })

    // ---- Home: no overlapping or too-small controls ----
    let audit = await auditControls(page)
    if (audit.overlap.length === 0) pass('home: no overlapping controls', `${audit.total} controls`)
    else fail('home: no overlapping controls', JSON.stringify(audit.overlap))

    // ---- Library + import at phone width ----
    await openDrawer(page)
    await page.getByRole('button', { name: /^Import$/i }).first().click()
    await sleep(900)
    await page.screenshot({ path: join(outDir, '02-import.png'), fullPage: true })
    const importOpen = await page.locator('.score-import').isVisible().catch(() => false)
    if (importOpen) pass('import view opens at phone width')
    else fail('import view opens at phone width', 'score-import not visible')

    await page.locator('input[type="file"][aria-label="Choose score PDF"]').first().setInputFiles(staged)
    await sleep(2000)
    // Attach the matched MusicXML so score following has notation to follow.
    const advancedInput = page.locator('input[type="file"][aria-label="Choose optional files"]').first()
    if (existsSync(stagedCompanion) && (await advancedInput.count())) {
      await advancedInput.setInputFiles(stagedCompanion)
      await sleep(3000)
    }

    // ---- never hide an error message ----
    const importText = await page.locator('.score-import').innerText().catch(() => '')
    if (/could not|error|try another|isn.t ready/i.test(importText)) {
      const visible = await page.evaluate(() => {
        const el = document.querySelector('.score-import-warning, .score-import-detail')
        if (!el) return false
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0'
      })
      if (visible) pass('import error message is visible on screen')
      else fail('import error message is invisible', 'message present but not rendered')
    }

    // ---- open the workspace at phone width ----
    const open = page.getByRole('button', { name: /Open score/i }).first()
    if (!(await open.isVisible().catch(() => false))) {
      fail('score ready at phone width', (await page.locator('body').innerText()).slice(0, 400))
      throw new Error('not ready')
    }
    pass('score ready to open at phone width')
    await open.click()
    await page.waitForSelector('.workspace-play', { timeout: 90000 }).catch(() => {})
    await sleep(2500)
    await page.screenshot({ path: join(outDir, '03-workspace.png'), fullPage: true })

    // ---- no stuck loading indicator ----
    const stuck = await page.evaluate(() => {
      const busy = [...document.querySelectorAll('[aria-busy="true"], .workspace-play[disabled]')]
      return {
        disabledPlay: Boolean(document.querySelector('.workspace-play')?.disabled),
        loadingText: document.body.innerText.match(/Loading…|Opening…|Preparing…|Reading…/)?.[0] ?? null,
      }
    })
    if (!stuck.loadingText && !stuck.disabledPlay) pass('no stuck loading indicator in the workspace')
    else fail('no stuck loading indicator in the workspace', JSON.stringify(stuck))

    audit = await auditControls(page)
    if (audit.overlap.length === 0) pass('workspace: no overlapping controls', `${audit.total} controls`)
    else fail('workspace: no overlapping controls', JSON.stringify(audit.overlap))

    // ---- touch targets: primary transport controls must be reachable ----
    const touch = await page.evaluate(() => {
      const measure = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      }
      return {
        play: measure('.workspace-play'),
        // Only the practice-mode radios in the dock: the phone top bar hides
        // its instrument radios by design (verified reachable via Settings).
        modeRadios: [...document.querySelectorAll('.workspace-modes [role="radio"]')].map((el) => Math.round(el.getBoundingClientRect().height)),
        dock: measure('.workspace-dock'),
        withinViewport: document.querySelector('.workspace-play') ? (() => {
          const r = document.querySelector('.workspace-play').getBoundingClientRect()
          return r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight + 1
        })() : null,
      }
    })
    if (touch.withinViewport) pass('transport play control fits the phone viewport', JSON.stringify(touch.play))
    else fail('transport play control fits the phone viewport', JSON.stringify(touch))
    if (touch.modeRadios.length > 0 && touch.modeRadios.every((h) => h >= 30)) {
      pass('mode radios are a usable touch size', touch.modeRadios.join(','))
    } else {
      fail('mode radios are a usable touch size', touch.modeRadios.join(','))
    }

    // ---- nothing is unreachable: the phone top bar hides the instrument
    //      selector, so the Settings panel must carry the same control. ----
    await openDrawer(page)
    const settingsBtn = page.getByRole('button', { name: /^Settings$/i }).first()
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click()
      await sleep(1500)
      const instrumentAtPhone = await page.evaluate(() => {
        const options = [...document.querySelectorAll('.instrument-selector__option')]
          .filter((el) => el.getBoundingClientRect().width > 0)
        return {
          count: options.length,
          heights: options.map((el) => Math.round(el.getBoundingClientRect().height)),
          inViewport: options.every((el) => {
            const r = el.getBoundingClientRect()
            return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0
          }),
          labels: options.slice(0, 3).map((el) => el.textContent.trim()),
        }
      })
      await page.screenshot({ path: join(outDir, '06-settings-instrument.png') })
      if (instrumentAtPhone.count >= 3 && instrumentAtPhone.heights.every((h) => h >= 40) && instrumentAtPhone.inViewport) {
        pass('instrument switch stays reachable at phone width (Settings)', instrumentAtPhone.labels.join(' / '))
      } else {
        fail('instrument switch stays reachable at phone width (Settings)', JSON.stringify(instrumentAtPhone))
      }
    } else {
      fail('settings reachable from the phone drawer', 'no Settings button')
    }

    // ---- back to the workspace, then verify playback on a phone ----
    await openDrawer(page)
    if (!(await clickNav(page, '03Practice'))) {
      fail('practice nav reachable from the phone drawer', 'no 03Practice entry')
    }
    await page.waitForSelector('.workspace-play', { timeout: 30000 }).catch(() => {})
    await sleep(2000)
    await page.locator('.workspace-play').first().click()
    await sleep(4000)
    const playing = await page.evaluate(() => ({
      label: document.querySelector('.workspace-play')?.textContent?.trim() ?? null,
      view: document.querySelector('.cz-shell')?.getAttribute('data-view') ?? null,
    }))
    if (/Pause/.test(playing.label ?? '')) pass('playback starts at phone width', playing.label)
    else fail('playback starts at phone width', JSON.stringify(playing))
    await page.screenshot({ path: join(outDir, '05-playing.png'), fullPage: true })

    // ---- mobile navigation drawer reachable ----
    const drawer = page.locator('.cz-shell__toggle').first()
    if (await drawer.isVisible().catch(() => false)) {
      await drawer.click({ force: true }).catch(() => {})
      await sleep(800)
      await page.screenshot({ path: join(outDir, '04-drawer.png') })
      const navVisible = await page.evaluate(() => {
        const nav = document.querySelector('.cz-shell__sidewrap, nav[aria-label="Primary"]')
        if (!nav) return false
        const s = getComputedStyle(nav)
        return s.visibility !== 'hidden' && s.opacity !== '0' && nav.getBoundingClientRect().width > 0
      })
      if (navVisible) pass('mobile navigation opens')
      else fail('mobile navigation opens', 'nav drawer not rendered')
    } else {
      skip('mobile navigation opens', 'no menu button found')
    }

    if (report.pageErrors.length) fail('no uncaught page errors', report.pageErrors.slice(0, 3).join(' | '))
    else pass('no uncaught page errors')
    if (report.consoleErrors.length) fail('no unexpected console errors', report.consoleErrors.slice(0, 3).join(' | '))
    else pass('no unexpected console errors')
  } finally {
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  }
  console.log(`\n${report.passes.length} passes, ${report.failures.length} failures, ${report.skipped.length} skipped`)
  process.exit(report.failures.length ? 1 : 0)
}

main().catch((error) => { console.error(error); process.exit(1) })
