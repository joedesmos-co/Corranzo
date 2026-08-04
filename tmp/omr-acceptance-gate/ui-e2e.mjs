#!/usr/bin/env node
/**
 * Visible UI E2E for acceptance-gate outcomes.
 * Requires Vite at SCOREFLOW_BASE_URL (default http://127.0.0.1:5173).
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/omr-acceptance-gate/ui')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'

const CASES = [
  {
    id: 'mutopia-false-reject-bach',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-bach-chorale-bwv259/piano-bach-chorale-bwv259.pdf',
    ),
    expectAcceptance: 'warning',
  },
  {
    id: 'passing-brahms',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-brahms-lullaby/piano-brahms-lullaby.pdf',
    ),
    expectAcceptance: 'accepted',
  },
  {
    id: 'true-reject-twinkle',
    pdf: join(ROOT, 'benchmarks/omr-stress/twinkle-1880-loc/twinkle-1880-loc-music-p2.pdf'),
    expectAcceptance: 'rejected',
  },
]

async function dismiss(page) {
  for (const name of [/Skip restore/i, /Skip/i, /Dismiss/i, /Not now/i, /Done/i, /Continue/i]) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true }).catch(() => {})
    }
  }
}

async function clearSession(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('scoreflow-session')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })
  await page.reload({ waitUntil: 'networkidle' })
  await dismiss(page)
}

async function goUploads(page) {
  await dismiss(page)
  await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true }).catch(() => {})
  await page.evaluate(() => {
    ;[...document.querySelectorAll('nav[aria-label="Main"] button')]
      .find((el) => el.textContent?.trim() === 'Library')
      ?.click()
  })
  await page.waitForTimeout(350)
  await page.getByRole('tab', { name: /My Uploads/i }).click({ force: true })
  await page.waitForTimeout(250)
}

async function uploadPdf(page, pdfPath) {
  await goUploads(page)
  const input = page.getByRole('region', { name: 'Upload score files' }).locator('input[type="file"]')
  await input.setInputFiles(pdfPath)
}

async function waitForOmrOutcome(page, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let body = ''
  while (Date.now() < deadline) {
    body = await page.locator('body').innerText()
    if (
      /too difficult/i.test(body) ||
      /\d+\s+notes\s+·/i.test(body) ||
      /lower confidence/i.test(body) ||
      /recognition confidence was lower than usual/i.test(body)
    ) {
      break
    }
    await page.waitForTimeout(500)
  }
  return body
}

function classifyBody(body) {
  return {
    hasWarningCopy: /recognition confidence was lower than usual|lower confidence/i.test(body),
    hasTooDifficult: /too difficult/i.test(body),
    hasReadyNotes: /\d+\s+notes\s+·/i.test(body),
    inPractice: /VIEW|Wait For You|SESSION STATS/i.test(body) && /Play/i.test(body),
    preparationFailed: /Preparation failed/i.test(body),
  }
}

async function runCase(browser, entry) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const result = { id: entry.id, expectAcceptance: entry.expectAcceptance }
  try {
    await clearSession(page)
    await uploadPdf(page, entry.pdf)
    const body = await waitForOmrOutcome(page)
    // Success paths often auto-navigate to Practice; wait briefly for that.
    if (!/too difficult/i.test(body)) {
      await page.waitForTimeout(1200)
    }
    const finalBody = await page.locator('body').innerText()
    const shot = join(OUT, `${entry.id}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    result.screenshot = shot
    result.bodySnippet = finalBody.slice(0, 1500)
    Object.assign(result, classifyBody(finalBody))

    if (entry.expectAcceptance === 'warning') {
      result.ok =
        !result.hasTooDifficult &&
        !result.preparationFailed &&
        result.hasWarningCopy &&
        (result.inPractice || result.hasReadyNotes)
    } else if (entry.expectAcceptance === 'accepted') {
      result.ok =
        !result.hasTooDifficult &&
        !result.preparationFailed &&
        !result.hasWarningCopy &&
        (result.inPractice || result.hasReadyNotes)
    } else {
      result.ok = result.hasTooDifficult && !result.inPractice
    }

    if (entry.id === 'mutopia-false-reject-bach') {
      await uploadPdf(page, CASES[1].pdf)
      await waitForOmrOutcome(page)
      await page.waitForTimeout(1200)
      const replaceBody = await page.locator('body').innerText()
      await page.screenshot({ path: join(OUT, 'replace-warning-to-accepted.png'), fullPage: true })
      const classified = classifyBody(replaceBody)
      result.replacementWarningToAccepted = {
        ...classified,
        ok:
          !classified.hasTooDifficult &&
          !classified.preparationFailed &&
          !classified.hasWarningCopy &&
          (classified.inPractice || classified.hasReadyNotes),
      }
      result.ok = result.ok && result.replacementWarningToAccepted.ok
    }

    if (entry.id === 'passing-brahms') {
      await uploadPdf(page, CASES[0].pdf)
      await waitForOmrOutcome(page)
      await page.waitForTimeout(1200)
      const replaceBody = await page.locator('body').innerText()
      await page.screenshot({ path: join(OUT, 'replace-accepted-to-warning.png'), fullPage: true })
      const classified = classifyBody(replaceBody)
      result.replacementAcceptedToWarning = {
        ...classified,
        ok:
          !classified.hasTooDifficult &&
          !classified.preparationFailed &&
          classified.hasWarningCopy &&
          (classified.inPractice || classified.hasReadyNotes),
      }
      result.ok = result.ok && result.replacementAcceptedToWarning.ok
    }
  } catch (error) {
    result.error = String(error?.message ?? error)
    result.ok = false
  } finally {
    await page.close()
  }
  return result
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true })
const rows = []
try {
  for (const entry of CASES) {
    process.stderr.write(`ui ${entry.id}...\n`)
    const row = await runCase(browser, entry)
    rows.push(row)
    process.stderr.write(`  → ok=${row.ok} error=${row.error ?? ''}\n`)
  }
} finally {
  await browser.close()
}

const report = { generatedAt: new Date().toISOString(), base: BASE, rows }
await writeFile(join(OUT, 'UI_E2E.json'), JSON.stringify(report, null, 2))
const failed = rows.filter((r) => !r.ok)
console.log(JSON.stringify({ failed: failed.map((f) => f.id), rows }, null, 2))
process.exit(failed.length ? 1 : 0)
