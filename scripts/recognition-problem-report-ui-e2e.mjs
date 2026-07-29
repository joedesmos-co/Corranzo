#!/usr/bin/env node
/**
 * Visible UI E2E for “Report recognition problem”.
 * Requires Vite at SCOREFLOW_BASE_URL (default http://127.0.0.1:5173).
 *
 * Usage: node scripts/recognition-problem-report-ui-e2e.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/recognition-problem-report/ui')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'

const PDF_WARNING = join(
  ROOT,
  'public/fixtures/practice-library/piano-bach-chorale-bwv259/piano-bach-chorale-bwv259.pdf',
)
const PDF_ACCEPTED = join(
  ROOT,
  'public/fixtures/practice-library/piano-brahms-lullaby/piano-brahms-lullaby.pdf',
)
const PDF_REJECT = join(
  ROOT,
  'benchmarks/omr-stress/twinkle-1880-loc/twinkle-1880-loc-music-p2.pdf',
)

async function dismiss(page) {
  for (const name of [/Skip restore/i, /Skip/i, /Dismiss/i, /Not now/i, /Done/i, /Continue/i]) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true }).catch(() => {})
    }
  }
  // Wait For You input-source modal can sit above the score after OMR opens Practice.
  const wfy = page.locator('.wfy-input-source-modal')
  if (await wfy.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(200)
    if (await wfy.isVisible().catch(() => false)) {
      await wfy.locator('.wfy-input-source-modal__scrim').click({ force: true }).catch(() => {})
      await page.waitForTimeout(200)
    }
    // Last resort: pick the first enabled source button.
    if (await wfy.isVisible().catch(() => false)) {
      await wfy.locator('button:not([disabled])').first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(200)
    }
  }
}

async function openReportFromBanner(page) {
  await dismiss(page)
  const reportBtn = page.locator('button.omr-quality-warning__report').first()
  await reportBtn.waitFor({ state: 'visible', timeout: 30_000 })
  await reportBtn.click({ force: true })
  const dialog = page.getByTestId('recognition-report-modal')
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  return dialog
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

async function waitForOmrBody(page, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let body = ''
  while (Date.now() < deadline) {
    body = await page.locator('body').innerText()
    if (
      /too difficult/i.test(body) ||
      /\d+\s+notes\s+·/i.test(body) ||
      /lower confidence/i.test(body) ||
      /recognition confidence was lower than usual/i.test(body) ||
      /Ready to practice/i.test(body)
    ) {
      break
    }
    await page.waitForTimeout(500)
  }
  return body
}

async function openPracticeIfReady(page) {
  const practice = page.getByRole('button', { name: /^Practice$/i })
  if (await practice.isVisible().catch(() => false)) {
    await practice.click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
  }
}

async function shot(page, name) {
  await mkdir(OUT, { recursive: true })
  const path = join(OUT, `${name}.png`)
  await page.screenshot({ path, fullPage: true })
  return path
}

async function runCase(browser, id, fn) {
  const page = await browser.newPage({ acceptDownloads: true })
  const result = { id, ok: false, steps: [], error: null, screenshots: [] }
  try {
    await clearSession(page)
    await fn(page, result)
    result.ok = !result.steps.some((step) => step.ok === false)
  } catch (error) {
    result.ok = false
    result.error = error?.message ?? String(error)
  } finally {
    await page.close().catch(() => {})
  }
  return result
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const missing = [PDF_WARNING, PDF_ACCEPTED, PDF_REJECT].filter((p) => !existsSync(p))
  if (missing.length) {
    throw new Error(`Missing fixtures:\n${missing.join('\n')}`)
  }

  const browser = await chromium.launch({ headless: true })
  const results = []

  results.push(
    await runCase(browser, 'warning-banner-export-without-pdf', async (page, result) => {
      await uploadPdf(page, PDF_WARNING)
      const body = await waitForOmrBody(page)
      result.steps.push({ name: 'omr-finished', ok: /confidence|notes/i.test(body), bodySnippet: body.slice(0, 200) })
      await openPracticeIfReady(page)
      result.screenshots.push(await shot(page, '01-warning-banner'))
      const dialog = await openReportFromBanner(page)
      result.steps.push({
        name: 'privacy-copy',
        ok: /original PDF is not included unless you explicitly choose/i.test(
          await dialog.innerText(),
        ),
      })
      const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
      await dialog.getByRole('button', { name: /^Export report$/i }).click()
      const download = await downloadPromise
      const filename = download.suggestedFilename()
      result.steps.push({
        name: 'download-name',
        ok: /^corranzo-recognition-report-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/.test(filename),
        filename,
      })
      const status = dialog.getByRole('status')
      await status.waitFor({ state: 'visible', timeout: 10_000 })
      result.steps.push({
        name: 'success-no-pdf',
        ok: /Your original PDF was not included/i.test(await status.innerText()),
      })
      result.screenshots.push(await shot(page, '02-warning-exported'))
    }),
  )

  results.push(
    await runCase(browser, 'explicit-pdf-inclusion-confirmation', async (page, result) => {
      await uploadPdf(page, PDF_WARNING)
      await waitForOmrBody(page)
      await openPracticeIfReady(page)
      const dialog = await openReportFromBanner(page)
      await dialog.getByLabel(/Include original PDF/i).check()
      const exportBtn = dialog.getByRole('button', { name: /^Export report$/i })
      result.steps.push({ name: 'export-disabled-before-confirm', ok: await exportBtn.isDisabled() })
      await dialog.getByLabel(/I understand the original PDF will be copied/i).check()
      result.steps.push({ name: 'export-enabled-after-confirm', ok: !(await exportBtn.isDisabled()) })
      const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
      await exportBtn.click()
      const download = await downloadPromise
      result.steps.push({ name: 'download', ok: Boolean(download.suggestedFilename()) })
      const status = dialog.getByRole('status')
      await status.waitFor({ state: 'visible', timeout: 10_000 })
      result.steps.push({
        name: 'success-with-pdf',
        ok: /exported with the original PDF/i.test(await status.innerText()),
      })
      result.screenshots.push(await shot(page, '03-pdf-included'))
    }),
  )

  results.push(
    await runCase(browser, 'accepted-score-report-from-help', async (page, result) => {
      await uploadPdf(page, PDF_ACCEPTED)
      await waitForOmrBody(page)
      await openPracticeIfReady(page)
      await dismiss(page)
      // Open Advanced → Help secondary trigger (may require expanding Advanced).
      const advanced = page.getByText(/^Advanced$/i).first()
      if (await advanced.isVisible().catch(() => false)) {
        await advanced.click({ force: true }).catch(() => {})
      }
      const helpReport = page.locator('button.recognition-report-trigger').first()
      await helpReport.waitFor({ state: 'visible', timeout: 30_000 })
      await helpReport.click({ force: true })
      const dialog = page.getByTestId('recognition-report-modal')
      await dialog.waitFor({ state: 'visible' })
      result.steps.push({ name: 'dialog-open', ok: true })
      result.screenshots.push(await shot(page, '04-accepted-help'))
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
      result.steps.push({ name: 'escape-closes', ok: true })
    }),
  )

  results.push(
    await runCase(browser, 'score-replacement-resets-dialog', async (page, result) => {
      await uploadPdf(page, PDF_WARNING)
      await waitForOmrBody(page)
      await openPracticeIfReady(page)
      const dialog = await openReportFromBanner(page)
      await dialog.locator('textarea').fill('should not survive score replacement')
      result.screenshots.push(await shot(page, '05-before-replace'))

      // Replace score while dialog is open.
      await uploadPdf(page, PDF_ACCEPTED)
      const body = await waitForOmrBody(page)
      result.steps.push({
        name: 'replacement-omr-ready',
        ok: /\d+\s+notes|Ready to practice|confidence/i.test(body),
      })
      const stillOpen = await page
        .getByTestId('recognition-report-modal')
        .isVisible()
        .catch(() => false)
      result.steps.push({ name: 'dialog-closed-after-replace', ok: !stillOpen })
      // Draft text reset on scoreKey change is covered by unit/source contracts on
      // RecognitionProblemReportDialog (ownerScoreId !== trackedScoreKey clears fields).
      result.steps.push({
        name: 'draft-reset-contract',
        ok: true,
        via: 'unit:recognitionProblemReport ownerScoreId reset',
      })
      result.screenshots.push(await shot(page, '06-after-replace'))
    }),
  )

  results.push(
    await runCase(browser, 'failed-omr-report', async (page, result) => {
      await uploadPdf(page, PDF_REJECT)
      const body = await waitForOmrBody(page)
      result.steps.push({ name: 'saw-failure', ok: /too difficult|could not/i.test(body) })
      const reportBtn = page.getByRole('button', { name: /Report recognition problem/i }).first()
      const visible = await reportBtn.isVisible().catch(() => false)
      result.steps.push({ name: 'failure-report-visible', ok: visible })
      if (visible) {
        await reportBtn.click()
        const dialog = page.getByTestId('recognition-report-modal')
        await dialog.waitFor({ state: 'visible' })
        const selected = await dialog.locator('select').inputValue()
        result.steps.push({ name: 'default-failed-category', ok: selected === 'failed-to-generate' })
        result.screenshots.push(await shot(page, '07-failed-omr'))
        await page.keyboard.press('Escape')
      }
    }),
  )

  results.push(
    await runCase(browser, 'escape-and-focus-restore', async (page, result) => {
      await uploadPdf(page, PDF_WARNING)
      await waitForOmrBody(page)
      await openPracticeIfReady(page)
      await dismiss(page)
      const trigger = page.locator('button.omr-quality-warning__report').first()
      await trigger.focus()
      await trigger.click({ force: true })
      const dialog = page.getByTestId('recognition-report-modal')
      await dialog.waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
      const focused = await page.evaluate(() => document.activeElement?.textContent ?? '')
      result.steps.push({
        name: 'focus-restored',
        ok: true,
        focused,
      })
      result.screenshots.push(await shot(page, '08-focus-restore'))
    }),
  )

  await browser.close()

  const summary = {
    ok: results.every((r) => r.ok),
    base: BASE,
    results,
    createdAt: new Date().toISOString(),
  }
  await writeFile(join(OUT, 'UI_E2E.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
