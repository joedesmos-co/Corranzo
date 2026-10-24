// Headless browser evidence: upload a PDF, run the JS pipeline, engrave the
// emitted MusicXML with OSMD, and capture the result.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const PORT = 5199
const URL = `http://127.0.0.1:${PORT}/`
const PDF = resolve(ROOT, 'benchmarks/omr-fixtures/guitar-paired-chords-vector/guitar-paired-chords-vector.pdf')

const BROWSER_DIR = resolve(ROOT, 'tools/guitar-vision/browser')
const server = spawn('npx', ['vite', '.', '--config', 'vite.config.mjs', '--port', String(PORT),
  '--strictPort', '--host', '127.0.0.1'], { cwd: BROWSER_DIR, stdio: 'ignore' })

async function waitServer() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(URL); if (r.ok) return } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('vite did not start')
}

try {
  await waitServer()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  page.on('console', m => { if (m.type() === 'error') console.error('PAGE', m.text()) })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.setInputFiles('#pdf', PDF)
  await page.click('#run')
  await page.waitForFunction(() => window.__done === true, null, { timeout: 90000 })
  const info = await page.evaluate(() => ({
    summary: window.__gv && window.__gv.summary,
    engraved: !!window.__engraved,
    xmlLen: window.__gv ? window.__gv.xml.length : 0,
    status: document.getElementById('status').textContent,
    body: document.body.innerText.slice(0, 400),
  }))
  await page.screenshot({ path: '/tmp/proof/browser-evidence.png', fullPage: true })
  console.log(JSON.stringify({
    events: info.summary?.events,
    tab_staves: info.summary?.tab_staves?.length,
    rhythm_recovered: info.summary?.rhythm_recovered,
    playable: info.summary?.playable,
    onsets: info.summary?.rhythm?.onsets,
    onsets_confident: info.summary?.rhythm?.onsets_confident,
    measures_complete: info.summary?.rhythm?.measures_complete,
    measures_total: info.summary?.rhythm?.measures_total,
    runtime_ms: info.summary?.runtime_ms,
    engraved: info.engraved,
    xml_bytes: info.xmlLen,
    status: info.status,
    body: info.body,
  }, null, 1))
  await browser.close()
} finally {
  server.kill('SIGTERM')
}
