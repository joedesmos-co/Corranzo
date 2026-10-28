// Guitar import lifecycle regression (real app, real PDF.js).
//
// Usage:
//   npx vite --config vite.config.js --port 5200 --strictPort   # or npm run dev
//   node scripts/guitar-import-lifecycle-e2e.mjs <pdf> [maxMs] [baseUrl]
//
// Verifies the import screen always reaches an actionable outcome:
//   READY | ERROR_BANNER | PANEL_FAILED
// and never stays on "Checking your score". Exit code 1 when stuck.
import { chromium } from 'playwright'

const PDF = process.argv[2]
if (!PDF) { console.error('usage: node scripts/guitar-import-lifecycle-e2e.mjs <pdf> [maxMs] [baseUrl]'); process.exit(1) }
const MAX_MS = Number(process.argv[3] || 60000)
const BASE = process.argv[4] || process.env.CORRANZO_BASE_URL || 'http://localhost:5200'
const HARD_MS = MAX_MS + 45000
const hard = setTimeout(() => { console.log('HARD EXIT'); process.exit(3) }, HARD_MS)

const browser = await chromium.launch()
const page = await browser.newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error' || /omr|OMR|pdf|PDF/.test(m.text())) logs.push(`[${m.type()}] ${m.text().slice(0, 220)}`) })
page.on('pageerror', e => logs.push(`[pageerror] ${e.message.slice(0, 220)}`))

const t0 = Date.now()
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(1200)
const acoustic = page.getByRole('button', { name: 'Acoustic Guitar' })
if (await acoustic.count()) await acoustic.first().click()
const importBtn = page.getByRole('button', { name: /^Import$/ }).first()
if (await importBtn.count()) await importBtn.click()
await page.waitForTimeout(600)
await page.locator('input[type=file]').first().setInputFiles(PDF)
console.log('uploaded', PDF)

const start = Date.now()
let last = '', final = '', tick = 0
while (Date.now() - start < MAX_MS) {
  const text = await page.locator('body').innerText().catch(() => '')
  const state = /Your score is ready/.test(text) ? 'READY'
    : /isn.t ready to open/.test(text) ? 'ERROR_BANNER'
    : /Checking your score/.test(text) ? 'CHECKING'
    : /couldn.t prepare|needs another try|Let.s try a different approach|couldn.t read enough/.test(text) ? 'PANEL_FAILED'
    : 'OTHER'
  if (state !== last) { console.log(`[${Date.now()-t0}ms] ${state}`); last = state }
  final = state
  if (state === 'READY' || state === 'ERROR_BANNER' || state === 'PANEL_FAILED') break
  if (tick % 10 === 0) console.log(`[${Date.now()-t0}ms] still ${state}`)
  tick += 1
  await page.waitForTimeout(1000)
}
console.log('FINAL', final, 'elapsed', Date.now()-t0, 'ms')
if (final === 'CHECKING') { console.error('FAIL: import stayed on Checking your score'); process.exitCode = 1 }
const body = await page.locator('body').innerText().catch(()=> '')
const at = Math.max(body.indexOf('Checking your score'), body.indexOf('ready to open'), body.indexOf('different approach'), body.indexOf('Your score is ready'))
console.log('SNIPPET:', body.slice(Math.max(0, at-100), at+380).replace(/\s+/g, ' '))
console.log('BUTTONS:', (await page.locator('button').allInnerTexts().catch(()=>[])).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join(' | ').slice(0,600))
console.log('LOGS:')
for (const l of logs.slice(-20)) console.log('  ', l)
clearTimeout(hard)
await browser.close()
