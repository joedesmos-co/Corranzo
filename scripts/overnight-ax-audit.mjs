#!/usr/bin/env node
// P6 overnight audit: accessible names, touch targets, focus, mic states.
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'overnight-audit')
const PORT = Number(process.env.E2E_PORT ?? 5599)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await mkdir(outDir, { recursive: true })
  const server = await createServer({ root, configFile: join(root, 'vite.config.js'), logLevel: 'silent', server: { host: '127.0.0.1', port: PORT, strictPort: true } })
  await server.listen()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const report = {}
  try {
    // Desktop pass
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${PORT}/?e2e-midi=1`, { waitUntil: 'networkidle' })
    await sleep(1500)
    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(800)
    await page.locator('.cz-piece-row').first().waitFor({ state: 'visible', timeout: 20000 })
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const t = buttons.find((b) => {
        if (!/open score|start practice/i.test(b.textContent)) return false
        return (b.closest('.cz-piece-row')?.textContent ?? '').includes('Prelude')
      })
      t?.click()
    })
    await sleep(8000)
    const ax = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, input, [role=radio], [role=slider], a')]
      const visible = els.filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      const unnamed = visible.filter((el) => {
        const name = (el.getAttribute('aria-label') || el.textContent || el.value || '').trim()
        return !name
      }).map((el) => el.className?.toString?.().slice(0, 60) ?? el.tagName)
      const small = visible.filter((el) => {
        if (el.tagName === 'INPUT' && el.type === 'range') return false
        const r = el.getBoundingClientRect()
        return (r.width < 24 || r.height < 24) && el.getAttribute('aria-label') !== 'Dismiss tools'
      }).map((el) => `${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`)
      const radios = [...document.querySelectorAll('[role=radiogroup]')].map((g) => g.getAttribute('aria-label'))
      const tabbables = [...document.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]')].filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }).length
      return { total: visible.length, unnamed, small, radios, tabbables }
    })
    report.desktop = ax
    // Keyboard: mode radiogroup arrow nav
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Preview', exact: true }).click()
    await sleep(500)
    await page.keyboard.press('ArrowRight')
    await sleep(500)
    const modeAfterArrow = await page.evaluate(() => document.querySelector('[role=radiogroup][aria-label="Practice mode"] [role=radio][aria-checked="true"]')?.textContent.trim())
    report.arrowNav = modeAfterArrow
    // WFY mic-denied messaging is covered by mic e2e; check input status text here
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1500)
    report.wfyStatus = await page.evaluate(() => document.querySelector('.workspace-status')?.textContent.trim().slice(0, 80) ?? null)
    await ctx.close()
    // Mobile viewport pass
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const mp = await mctx.newPage()
    await mp.goto(`http://127.0.0.1:${PORT}/?e2e-midi=1`, { waitUntil: 'networkidle' })
    await sleep(2000)
    await mp.screenshot({ path: join(outDir, 'mobile-home.png') })
    const merrs = []
    mp.on('pageerror', (e) => merrs.push(e.message.slice(0, 100)))
    await mp.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(1000)
    await mp.screenshot({ path: join(outDir, 'mobile-library.png') })
    report.mobileErrors = merrs
    await mctx.close()
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
  await writeFile(join(outDir, 'ax-audit.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
main().catch((e) => { console.error(e); process.exit(2) })
