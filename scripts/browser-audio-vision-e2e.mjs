/**
 * Browser-path Audio Vision acceptance (real Chromium, real app modules).
 *
 * Verifies the production browser path that Node cannot exercise:
 *  Web Audio decode (OfflineAudioContext) → TF.js Basic Pitch inference
 *  (real weights, browser backend) → analysis → solo arrangement → MusicXML.
 * No ground-truth injection: the page synthesizes an original guitar figure
 * with OfflineAudioContext and must recover it. Asserts melody recall,
 * tempo, TAB string/fret presence and MusicXML parseability.
 *
 * Usage: E2E_PORT=5499 node scripts/browser-audio-vision-e2e.mjs
 * Output: tmp/audio-vision-browser/{report.json}
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-browser')
const PORT = Number(process.env.E2E_PORT ?? 5499)

const report = { pass: [], fail: [], skipped: [], startedAt: new Date().toISOString() }
function pass(name, detail = '') {
  report.pass.push({ name, detail })
  console.log(`PASS ${name} ${detail}`)
}
function fail(name, detail = '') {
  report.fail.push({ name, detail })
  console.log(`FAIL ${name} ${detail}`)
}

await mkdir(outDir, { recursive: true })
const vite = await createServer({ root, server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'silent' })
await vite.listen()
await new Promise((r) => setTimeout(r, 800))
const baseUrl = `http://127.0.0.1:${PORT}/`

let browser = null
try {
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (/error|fail/i.test(text) && !/favicon/i.test(text)) console.log(`[browser] ${text.slice(0, 200)}`)
  })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // App modules run through Vite dev transform (bare specifiers resolve via
  // pre-bundling); the probe synthesizes audio with Web Audio in-page.
  const result = await page.evaluate(async () => {
    try {
      const { runBrowserProbe } = await import('/src/dev/audioVisionBrowserProbe.js')
      return await runBrowserProbe()
    } catch (error) {
      return { errors: [String(error?.message ?? error) + ' | ' + String(error?.stack ?? '').slice(0, 400)] }
    }
  })

  await writeFile(join(outDir, 'report.json'), JSON.stringify({ ...report, browser: result }, null, 2))
  report.browser = result
  if (result.errors?.length) fail('browser pipeline ran without errors', result.errors.join('; '))
  else pass('browser pipeline ran without errors')
  if (result.renderedSeconds === 4) pass('web audio rendered 4 s fixture')
  else fail('web audio fixture render', JSON.stringify(result.renderedSeconds))
  if (result.capability) pass('basic pitch capability probe', JSON.stringify(result.capability))
  else fail('basic pitch capability probe', 'no result')
  if ((result.bpNotes ?? []).length >= 6) pass('browser basic pitch detected notes', `${result.bpNotes.length} notes in ${result.bpMs}ms`)
  else fail('browser basic pitch detected notes', JSON.stringify(result.bpNotes)?.slice(0, 300))
  if (result.pitchSource === 'basic-pitch') pass('analysis used browser model notes')
  else fail('analysis pitch source', String(result.pitchSource))
  if (Math.abs((result.tempoBpm ?? 0) - 120) <= 8) pass('browser tempo estimate', `${result.tempoBpm} BPM`)
  else fail('browser tempo estimate', `${result.tempoBpm} BPM`)
  if ((result.melodyRecallPc ?? 0) >= 0.6) pass('browser arrangement melody recall', String(result.melodyRecallPc))
  else fail('browser arrangement melody recall', String(result.melodyRecallPc))
  if (result.hasTab && (result.xmlNotes ?? 0) > 0) pass('browser guitar MusicXML + TAB', `${result.xmlNotes} notes`)
  else fail('browser guitar MusicXML + TAB', `tab=${result.hasTab} notes=${result.xmlNotes}`)
} catch (error) {
  fail('browser e2e harness', String(error?.message ?? error).slice(0, 300))
} finally {
  try { await browser?.close() } catch { /* noop */ }
  try { await vite.close() } catch { /* noop */ }
}

report.finishedAt = new Date().toISOString()
await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\npass=${report.pass.length} fail=${report.fail.length}`)
process.exit(report.fail.length ? 1 : 0)
