/**
 * Real-UI regression: multi-page PDF A must not leak pageCount into PDF B's OMR.
 *
 * Root cause was pdfPageAnalysis cache keying `{ data: Uint8Array }` as `'buffer'`,
 * so B reused A's PDFDocumentProxy (progress showed 1/N from A).
 *
 * Usage: node scripts/omr-pagecount-replacement-regression.mjs
 * Requires: npm run dev on http://127.0.0.1:5173
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'
const PDF_A = path.join(root, 'public/fixtures/hungarian-dance-no5/hungarian-dance-no5.pdf')
const PDF_B = path.join(
  root,
  'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.pdf',
)
const EXPECTED_A_PAGES = 4
const EXPECTED_B_PAGES = 1

async function dismissOverlays(page) {
  for (const name of [/Skip restore/i, /Skip/i, /Dismiss/i, /Clear saved/i, /Not now/i, /Continue/i]) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) {
      const disabled = await btn.isDisabled().catch(() => true)
      if (!disabled) await btn.click({ force: true }).catch(() => {})
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
  await dismissOverlays(page)
}

async function goMyUploads(page) {
  await dismissOverlays(page)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav[aria-label="Main"] button')].find(
      (el) => el.textContent?.trim() === 'Library',
    )
    if (!btn) throw new Error('Library nav not found')
    btn.click()
  })
  await page.waitForTimeout(400)
  await dismissOverlays(page)
  await page.getByRole('tab', { name: /My Uploads/i }).click({ force: true })
  await page.waitForTimeout(300)
  const input = page
    .getByRole('region', { name: 'Upload score files' })
    .locator('input[type="file"]')
  await input.waitFor({ state: 'attached', timeout: 10000 })
  return input
}

async function uploadViaUi(page, pdfPath) {
  const input = await goMyUploads(page)
  await input.setInputFiles(pdfPath)
  await page.waitForTimeout(600)
}

async function readOmrJob(page) {
  return page.evaluate(() => ({
    job: window.__SCOREFLOW_OMR_JOB__ ?? null,
    progress: window.__SCOREFLOW_OMR_PROGRESS__ ?? [],
    active: window.__SCOREFLOW_ACTIVE_SCORE__ ?? null,
    label: document.body.innerText.match(/page\s+(\d+)\s+of\s+(\d+)/i)?.slice(0, 3) ?? null,
  }))
}

async function waitForOmrPageCount(page, expectedPages, label, { timeoutMs = 120_000 } = {}) {
  const end = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < end) {
    await dismissOverlays(page)
    const state = await readOmrJob(page)
    const status = `${label} jobPages=${state.job?.pageCount ?? '-'} progressTotal=${state.progress.at(-1)?.totalPages ?? '-'} ui=${state.label?.join('/') ?? '-'} score=${state.active?.scoreId ?? '-'}`
    if (status !== last) {
      console.log(status)
      last = status
    }
    if (state.job?.pageCount === expectedPages) {
      return state
    }
    // Also accept progress updates that already advertise the total.
    const lastProgress = state.progress.at(-1)
    if (lastProgress?.totalPages === expectedPages) {
      return state
    }
    if (await page.getByRole('button', { name: /Try again/i }).count()) {
      throw new Error(`${label}: OMR failed before pageCount observed`)
    }
    await page.waitForTimeout(400)
  }
  throw new Error(`${label}: timed out waiting for OMR pageCount=${expectedPages}`)
}

async function main() {
  for (const pdf of [PDF_A, PDF_B]) {
    if (!fs.existsSync(pdf)) throw new Error(`Missing ${pdf}`)
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const failures = []
  const report = {}

  console.log('\n=== Upload multi-page PDF A ===')
  await clearSession(page)
  await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
  await uploadViaUi(page, PDF_A)
  const a = await waitForOmrPageCount(page, EXPECTED_A_PAGES, 'A')
  report.A = {
    scoreId: a.active?.scoreId,
    pdfHash: a.active?.pdfHash,
    pageCount: a.job?.pageCount,
    runId: a.job?.runId,
  }
  if (a.job?.pageCount !== EXPECTED_A_PAGES) {
    failures.push(`A: expected pageCount ${EXPECTED_A_PAGES}, got ${a.job?.pageCount}`)
  }

  console.log('\n=== Replace with 1-page PDF B (no refresh) ===')
  const scoreIdA = a.active?.scoreId
  await uploadViaUi(page, PDF_B)
  const b = await waitForOmrPageCount(page, EXPECTED_B_PAGES, 'B')
  report.B = {
    scoreId: b.active?.scoreId,
    pdfHash: b.active?.pdfHash,
    pageCount: b.job?.pageCount,
    runId: b.job?.runId,
    progressTotals: [...new Set((b.progress ?? []).map((p) => p.totalPages))],
  }

  if (b.active?.scoreId === scoreIdA) {
    failures.push('B: scoreId did not change after replacement')
  }
  if (b.job?.pageCount !== EXPECTED_B_PAGES) {
    failures.push(`B: OMR job pageCount is ${b.job?.pageCount}, expected ${EXPECTED_B_PAGES}`)
  }
  if (b.progress?.some((p) => p.totalPages === EXPECTED_A_PAGES)) {
    failures.push(`B: progress still reported totalPages=${EXPECTED_A_PAGES} from A`)
  }
  if (b.job?.pdfHash && a.job?.pdfHash && b.job.pdfHash === a.active?.pdfHash) {
    failures.push('B: OMR job pdfHash still matches A')
  }
  // UI label check when visible
  if (b.label && Number(b.label[2]) === EXPECTED_A_PAGES) {
    failures.push(`B: UI still shows page x of ${EXPECTED_A_PAGES}`)
  }

  const outDir = path.join(root, 'tmp/omr-pagecount-replacement')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ report, failures }, null, 2))
  await browser.close()

  console.log('\n=== ASSERTIONS ===')
  if (failures.length) {
    console.error('FAIL', failures)
    process.exit(1)
  }
  console.log('PASS: OMR pageCount resets on PDF replacement (A multi-page → B 1-page)')
  console.log(`Report: ${path.join(outDir, 'report.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
