/**
 * Real-PDF OMR regression after the analysis-cache / pin fix.
 *
 * Confirms Minecraft + A Cruel Angel's Thesis complete automatic OMR again,
 * and that PDF CACHE never destroys while an active run is pinned.
 *
 * Usage: node scripts/omr-real-pdf-cache-regression.mjs
 * Requires: npm run dev on http://127.0.0.1:5173
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'

const PDFS = [
  {
    id: 'minecraft',
    path: '/Users/ryland/Downloads/beginner-minecraft-piano-themes-in-c-minecraft.pdf',
  },
  {
    id: 'evangelion',
    path: path.join(
      root,
      'tmp/sprint1/a-cruel-angels-thesis-neon-genesis-evangelion.pdf',
    ),
  },
]

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

async function uploadViaUi(page, pdfPath) {
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
  await input.setInputFiles(pdfPath)
  await page.waitForTimeout(600)
}

async function waitForOmrOutcome(page, label, { timeoutMs = 180_000 } = {}) {
  const end = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < end) {
    await dismissOverlays(page)
    const state = await page.evaluate(() => {
      const text = document.body.innerText
      return {
        job: window.__SCOREFLOW_OMR_JOB__ ?? null,
        failure: window.__SCOREFLOW_OMR_FAILURE__ ?? null,
        cache: window.__SCOREFLOW_PDF_CACHE_LOG__ ?? null,
        active: window.__SCOREFLOW_ACTIVE_SCORE__ ?? null,
        hasPlayback: Boolean(
          document.querySelector('[aria-label="Playback"], [aria-label*="Playback"]'),
        ),
        tryAgain: [...document.querySelectorAll('button')].some((b) =>
          /Try again/i.test(b.textContent ?? ''),
        ),
        cancel: [...document.querySelectorAll('button')].some((b) =>
          /^Cancel$/i.test((b.textContent ?? '').trim()),
        ),
        panelSnippet: (document.querySelector('.library-omr-panel')?.innerText ?? '').slice(0, 400),
        bodyHasReady: /notes\s*·|Ready|OMR ready/i.test(text),
        bodyHasFail: /could not read enough|Something went wrong|too difficult/i.test(text),
      }
    })

    const status = `${label} phase=${state.job?.phase ?? '-'} pages=${state.job?.pageCount ?? '-'} fail=${Boolean(state.failure)} playback=${state.hasPlayback} tryAgain=${state.tryAgain} cancel=${state.cancel}`
    if (status !== last) {
      console.log(status)
      last = status
    }

    if (state.failure) {
      return { ok: false, reason: 'omr-failure', state }
    }
    if (state.tryAgain || state.bodyHasFail) {
      return { ok: false, reason: 'ui-failure', state }
    }
    if (state.hasPlayback || (state.job?.phase === 'progress' && !state.cancel && state.bodyHasReady)) {
      // Prefer explicit success: MusicXML applied → practice/playback, or OMR panel ready.
      if (state.hasPlayback) {
        return { ok: true, reason: 'playback', state }
      }
    }
    // Success when OMR job finished without FAILURE and Cancel is gone + READY-ish UI
    if (
      state.job &&
      state.job.phase !== 'failure' &&
      !state.cancel &&
      !state.tryAgain &&
      (state.hasPlayback || /notes/i.test(state.panelSnippet) || state.active?.musicXml)
    ) {
      return { ok: true, reason: 'job-complete', state }
    }

    await page.waitForTimeout(800)
  }
  const state = await page.evaluate(() => ({
    job: window.__SCOREFLOW_OMR_JOB__ ?? null,
    failure: window.__SCOREFLOW_OMR_FAILURE__ ?? null,
    cache: window.__SCOREFLOW_PDF_CACHE_LOG__ ?? null,
    active: window.__SCOREFLOW_ACTIVE_SCORE__ ?? null,
    panelSnippet: (document.querySelector('.library-omr-panel')?.innerText ?? '').slice(0, 600),
  }))
  return { ok: false, reason: 'timeout', state }
}

function assertNoMidRunDestroy(cacheLog, runId) {
  const entries = cacheLog?.entries ?? []
  if (!runId) return []
  const pinIdx = entries.findIndex((e) => e.action === 'pin' && e.runId === runId)
  const unpinIdx = entries.findIndex((e) => e.action === 'unpin' && e.runId === runId)
  if (pinIdx < 0) return [`missing pin for runId=${runId}`]
  const windowEnd = unpinIdx >= 0 ? unpinIdx : entries.length
  const bad = []
  for (let i = pinIdx; i < windowEnd; i += 1) {
    const e = entries[i]
    if (e.action === 'destroy' || (e.action === 'clear' && e.cleared !== false)) {
      // clear while pinned should be clear-skipped-pinned, not clear
      if (e.action === 'destroy' || e.action === 'clear') {
        bad.push(`${e.action} at ${e.at} while pinned (runId=${runId}) key=${e.cacheKey}`)
      }
    }
  }
  return bad
}

async function main() {
  for (const pdf of PDFS) {
    if (!fs.existsSync(pdf.path)) throw new Error(`Missing ${pdf.path}`)
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const failures = []
  const report = { runs: [] }

  for (const pdf of PDFS) {
    console.log(`\n=== Upload ${pdf.id} ===`)
    await clearSession(page)
    await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
    await uploadViaUi(page, pdf.path)
    const outcome = await waitForOmrOutcome(page, pdf.id)
    const destroyViolations = assertNoMidRunDestroy(
      outcome.state?.cache,
      outcome.state?.job?.runId ?? outcome.state?.failure?.runId,
    )
    const entry = {
      id: pdf.id,
      ok: outcome.ok,
      reason: outcome.reason,
      scoreId: outcome.state?.active?.scoreId ?? outcome.state?.job?.scoreId,
      pdfHash: outcome.state?.job?.pdfHash ?? outcome.state?.active?.pdfHash,
      pageCount: outcome.state?.job?.pageCount,
      runId: outcome.state?.job?.runId,
      failure: outcome.state?.failure ?? null,
      destroyViolations,
      panelSnippet: outcome.state?.panelSnippet ?? null,
      cacheActions: (outcome.state?.cache?.entries ?? []).map((e) => e.action).slice(-20),
    }
    report.runs.push(entry)
    console.log(JSON.stringify(entry, null, 2))

    if (!outcome.ok) {
      failures.push(
        `${pdf.id}: OMR did not complete (${outcome.reason})` +
          (outcome.state?.failure
            ? ` — ${outcome.state.failure.errorName}: ${outcome.state.failure.errorMessage}`
            : ''),
      )
    }
    if (destroyViolations.length) {
      failures.push(`${pdf.id}: mid-run cache destroy: ${destroyViolations.join('; ')}`)
    }
  }

  const outDir = path.join(root, 'tmp/omr-real-pdf-cache')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ report, failures }, null, 2))
  await browser.close()

  console.log('\n=== ASSERTIONS ===')
  if (failures.length) {
    console.error('FAIL', failures)
    process.exit(1)
  }
  console.log('PASS: Minecraft + Evangelion auto-OMR completed; no mid-run PDF destroy')
  console.log(`Report: ${path.join(outDir, 'report.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
