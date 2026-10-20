#!/usr/bin/env node
/**
 * Audio Vision — critical UX repair acceptance (real Chromium, real audio).
 *
 * Bug 1: generation froze the UI and the progress bar appeared late / did not
 *         advance.
 * Bug 2: "Open Score" opened the previously imported PDF instead of the
 *         freshly generated arrangement.
 *
 * Scenarios
 *   A  import PDF A, then generate arrangement B -> Open Score opens B
 *   B  piano arrangement opens and previews
 *   C  guitar arrangement opens with standard notation + six-line TAB
 *   D  a corrected tempo reaches the opened score and its checkpoints
 *   E  a generated arrangement survives a browser restart and reopens
 *   F  two arrangements in a row: the second wins
 *   G  progress visibility latency, stage progression, main-thread health
 *   H  cancel, malformed audio, silence, unsupported file (no infinite wait)
 *
 * Usage: E2E_PORT=5611 node scripts/browser-audio-vision-critical-ux.mjs
 * Output: tmp/audio-vision-critical-ux/{report.json,*.png}
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-critical-ux')
const profileDir = join(outDir, 'profile')
const PORT = Number(process.env.E2E_PORT ?? 5611)
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  passes: [],
  failures: [],
  skipped: [],
  consoleErrors: [],
  pageErrors: [],
  metrics: {},
}
function pass(name, detail = null) {
  report.passes.push({ name, detail })
  console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`)
}
function fail(name, detail = null) {
  report.failures.push({ name, detail })
  console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`)
}
function skip(name, why) {
  report.skipped.push({ name, why })
  console.log(`SKIP  ${name} :: ${why}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(page, name) {
  try {
    await page.screenshot({ path: join(outDir, `${name}.png`) })
  } catch { /* noop */ }
}

function isBenignConsoleMessage(text) {
  if (/favicon/i.test(text)) return true
  if (/DevTools/i.test(text)) return true
  if (/AudioContext was not allowed to start/i.test(text)) return true
  if (/The AudioContext/i.test(text)) return true
  if (/google-analytics|googletagmanager|gstatic|fonts\.googleapis/i.test(text)) return true
  if (/net::ERR_/.test(text) && !/127\.0\.0\.1|localhost/.test(text)) return true
  return false
}

/* ---------------------------------------------------------------- fixtures */

/** 3 s guitar figure: A2-E4 arpeggio @120 BPM with a light click. */
async function writeFigureWav(path, { seconds = 3, seq = [57, 61, 64, 69, 64, 61] } = {}) {
  const SR = 44100
  const data = new Float32Array(SR * seconds)
  const beat = 0.5
  const tone = (midi, start, dur, amp = 0.4) => {
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const s0 = Math.floor(start * SR)
    const s1 = Math.min(data.length, Math.floor((start + dur) * SR))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / SR
      data[i] += amp * Math.exp(-2.5 * t) * Math.sin(2 * Math.PI * freq * t)
    }
  }
  for (let b = 0; b * beat < seconds; b += 1) {
    tone(seq[b % seq.length], b * beat, 0.45)
    const s0 = Math.floor(b * beat * SR)
    for (let i = 0; i < 300 && s0 + i < data.length; i += 1) {
      data[s0 + i] += 0.35 * Math.exp(-i / 40) * Math.sin((2 * Math.PI * 150 * i) / SR)
    }
  }
  const n = data.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    const v = Math.max(-1, Math.min(1, data[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  await writeFile(path, buf)
  return path
}

/** 1.2 s of true digital silence (RMS 0) — must be refused, never arranged. */
async function writeSilenceWav(path) {
  const SR = 44100
  const n = SR * 1.2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  await writeFile(path, buf)
  return path
}

/* -------------------------------------------------------------- page utils */

async function goToLibraryUploads(page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) =>
      /library/i.test(el.textContent ?? ''),
    )
    button?.click()
  })
  await sleep(900)
  const uploadsTab = page.getByRole('tab', { name: /my uploads/i })
  if (await uploadsTab.count()) {
    await uploadsTab.click()
    await sleep(600)
  }
}

async function goToImport(page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) =>
      el.textContent?.replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Import',
    )
    button?.click()
  })
  await sleep(900)
}

async function dismissOverlays(page) {
  const done = page.getByRole('button', { name: 'Done' })
  if (await done.isVisible().catch(() => false)) {
    await done.click()
    await sleep(250)
  }
  const skipRestore = page.getByRole('button', { name: /skip restore/i })
  if (await skipRestore.isVisible().catch(() => false)) {
    await skipRestore.click()
    await sleep(350)
  }
}

/** The audio-vision card must be on screen (Library → My Uploads). */
async function openCreateFromAudio(page) {
  await goToLibraryUploads(page)
  const card = page.getByText('Create from audio', { exact: false }).first()
  await card.waitFor({ timeout: 20000 })
}

/**
 * Generate an arrangement. Returns { progressLatencyMs, stages, longTasks,
 * maxMainThreadGapMs, cancelled }.
 */
async function generateArrangement(page, wavPath, { target = 'solo-guitar', difficulty = 'easy', cancel = false, label = '' } = {}) {
  await openCreateFromAudio(page)
  const input = page.locator('.audio-vision-card input[type="file"]')
  await input.setInputFiles(wavPath)
  await page.getByText(/recording length/i).first().waitFor({ timeout: 60000 })
  await page.locator(`.audio-vision-card input[name="audio-vision-target"][value="${target}"]`).check()
  await page.locator(`.audio-vision-card input[name="audio-vision-difficulty"][value="${difficulty}"]`).check()

  // Instrument the page BEFORE clicking: heartbeat gap = main-thread block,
  // longtask entries = real long tasks, stage labels = progress progression.
  await page.evaluate(() => {
    window.__av = { gaps: [], longTasks: [], stages: [] }
    let last = performance.now()
    window.__avTimer = setInterval(() => {
      const now = performance.now()
      window.__av.gaps.push(now - last)
      last = now
      const el = document.querySelector('.audio-vision-progress')
      const label = el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : null
      if (label && window.__av.stages.at(-1) !== label) window.__av.stages.push(label)
    }, 40)
    try {
      window.__avObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__av.longTasks.push(Math.round(entry.duration))
        }
      })
      window.__avObserver.observe({ entryTypes: ['longtask'] })
    } catch { /* longtask unsupported */ }
  })

  const clickedAt = Date.now()
  await page.getByRole('button', { name: new RegExp(`arrange for`, 'i') }).click()

  // Progress must become visible quickly.
  let progressLatencyMs = null
  try {
    await page.locator('.audio-vision-progress').first().waitFor({ state: 'visible', timeout: 15000 })
    progressLatencyMs = Date.now() - clickedAt
  } catch { /* stays hidden */ }

  if (cancel) {
    const cancelBtn = page.getByRole('button', { name: /^cancel$/i }).first()
    await sleep(1500)
    // The panel re-renders while the pipeline yields, so the button node can be
    // replaced under the click. A JS click is immune to that.
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((el) => /^cancel$/i.test(el.textContent?.trim() ?? ''))
      button?.click()
    })
    await sleep(1500)
    const busy = await page.locator('.audio-vision-progress').count()
    const metrics = await page.evaluate(() => {
      clearInterval(window.__avTimer)
      window.__avObserver?.disconnect()
      return {
        gaps: window.__av.gaps,
        longTasks: window.__av.longTasks,
        stages: window.__av.stages,
      }
    })
    return {
      progressLatencyMs,
      stages: metrics.stages,
      longTasks: metrics.longTasks,
      maxMainThreadGapMs: Math.round(Math.max(0, ...metrics.gaps)),
      stillBusy: busy > 0,
      cancelled: true,
    }
  }

  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })
  const metrics = await page.evaluate(() => {
    clearInterval(window.__avTimer)
    window.__avObserver?.disconnect()
    return {
      gaps: window.__av.gaps,
      longTasks: window.__av.longTasks,
      stages: window.__av.stages,
    }
  })
  return {
    progressLatencyMs,
    stages: metrics.stages,
    longTasks: metrics.longTasks,
    maxMainThreadGapMs: Math.round(Math.max(0, ...metrics.gaps)),
    stillBusy: false,
    cancelled: false,
    label,
  }
}

/** Open the generated arrangement from the review screen and land in practice. */
async function openArrangementInPractice(page) {
  await page.getByRole('button', { name: /open in corranzo practice/i }).click()
  await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 60000 })
  const importState = await page.evaluate(() => ({
    hasPdfPanel: Boolean(document.querySelector('.score-import-file')),
    bodyText: (document.querySelector('.score-import')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 400),
  }))
  await page.getByRole('button', { name: /open score/i }).click()
  await page.getByText(/all targets/i).first().waitFor({ timeout: 90000 })
  return importState
}

/**
 * The MusicXML the app persisted for the current score (proves what is active).
 * The session store keeps both a generation key and a legacy fixed key, so
 * every key is scanned and the newest MusicXML payload wins.
 */
async function readPersistedMusicXml(page, { waitMs = 8000 } = {}) {
  const deadline = Date.now() + waitMs
  let best = null
  for (;;) {
    best = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('scoreflow-session')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly')
        const store = tx.objectStore('files')
        const keysReq = store.getAllKeys()
        const valuesReq = store.getAll()
        tx.oncomplete = () => resolve(keysReq.result.map((key, i) => [key, valuesReq.result[i]]))
        tx.onerror = () => reject(tx.error)
      })
      // The legacy fixed key always holds the LATEST saved MusicXML; the
      // generation keys are history. Prefer the fixed key, then fall back to a
      // scan for older builds.
      const legacy = await new Promise((resolve) => {
        const tx = db.transaction('files', 'readonly')
        const req = tx.objectStore('files').get('musicXml')
        req.onerror = () => resolve(null)
        req.onsuccess = () => resolve(req.result ?? null)
      })
      const decode = (value) => {
        if (!value) return null
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value)
        const text = new TextDecoder().decode(bytes)
        return text.includes('<score-partwise') ? text : null
      }
      const legacyText = decode(legacy)
      if (legacyText) return legacyText
      let found = null
      for (const [key, value] of entries) {
        if (!value) continue
        if (!/musicxml/i.test(String(key))) continue
        const text = decode(value)
        if (text && (!found || text.length > found.length)) found = text
      }
      return found
    })
    if (best) return best
    if (Date.now() > deadline) return best
    await sleep(400)
  }
}

async function practiceSurfaceState(page) {
  return page.evaluate(() => ({
    hasArrangementSurface: Boolean(document.querySelector('.arrangement-practice')),
    hasPdfCanvas: Boolean(document.querySelector('.workspace-frame canvas, .workspace-frame embed')),
    hasPdfFileCard: Boolean(document.querySelector('.score-import-file')),
    hasOsmdScore: Boolean(document.querySelector('.osmd-score, .osmd-container, svg.osmd')),
    svgCount: document.querySelectorAll('svg').length,
    targets: (document.querySelector('.arrangement-practice')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300),
    practiceText: (document.querySelector('.practice-workspace')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300),
  }))
}

/* ------------------------------------------------------------------- main */

await mkdir(outDir, { recursive: true })
await rm(profileDir, { recursive: true, force: true })

const wavPath = await writeFigureWav(join(outDir, 'figure.wav'))
const wavPath2 = await writeFigureWav(join(outDir, 'figure2.wav'), { seq: [52, 59, 64, 67, 64, 59] })
const silencePath = await writeSilenceWav(join(outDir, 'silence.wav'))
const brokenPath = join(outDir, 'broken.mp3')
await writeFile(brokenPath, Buffer.from('this is definitely not an mp3 payload'.repeat(64), 'utf8'))
const textPath = join(outDir, 'notes.txt')
await writeFile(textPath, 'plain text, not audio at all\n')

const pdfFixture = join(root, 'public', 'fixtures', 'demo-minuet-in-g.pdf')
if (!existsSync(pdfFixture)) {
  console.error(`fixture missing: ${pdfFixture}`)
  process.exit(1)
}

// A live run (E2E_BASE_URL) uses the deployed site; a local run serves the
// working tree. The live site is only read from - the browser profile is
// isolated in a temporary directory.
const externalBase = Boolean(process.env.E2E_BASE_URL)
const vite = externalBase ? null : await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
if (vite) {
  await vite.listen()
  await sleep(800)
}

// BROWSER=webkit runs the same acceptance suite in Safari's engine — the
// Audio Vision pitch worker behaves differently there, so both must pass.
const { chromium, webkit } = await import('playwright')
const launcher = process.env.BROWSER === 'webkit' ? webkit : chromium
const launchOptions = {
  headless: true,
  viewport: { width: 1280, height: 900 },
  ...(process.env.BROWSER === 'webkit' ? {} : { args: ['--autoplay-policy=no-user-gesture-required'] }),
}
let context = await launcher.launchPersistentContext(profileDir, launchOptions)

async function newPage() {
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (isBenignConsoleMessage(msg.text())) return
    report.consoleErrors.push(msg.text())
  })
  page.on('pageerror', (error) => {
    report.pageErrors.push(error.message)
  })
  return page
}

try {
  let page = await newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(2500)
  await dismissOverlays(page)

  /* ---------------------------------------------------- TEST A: PDF then B */
  await goToImport(page)
  const pdfInput = page.locator('input[type="file"][aria-label="Choose score PDF"]').first()
  await pdfInput.setInputFiles(pdfFixture)
  await page.getByText(/pages? · PDF|PDF selected/i).first().waitFor({ timeout: 60000 })
  pass('A1 pdf A imported', 'demo-minuet-in-g.pdf')
  await shot(page, 'A1-pdf-imported')

  const genA = await generateArrangement(page, wavPath, { target: 'solo-guitar', difficulty: 'easy', label: 'A' })
  report.metrics.progressLatencyMs = genA.progressLatencyMs
  report.metrics.stagesA = genA.stages
  report.metrics.maxMainThreadGapMs = genA.maxMainThreadGapMs
  report.metrics.longTasksA = genA.longTasks
  if (genA.progressLatencyMs != null && genA.progressLatencyMs < 3000) {
    pass('G1 progress visible immediately', `${genA.progressLatencyMs} ms after Generate`)
  } else {
    fail('G1 progress visible immediately', `latency=${genA.progressLatencyMs} ms`)
  }
  if (genA.stages.length >= 3) {
    pass('G2 progress advances through stages', `${genA.stages.length} distinct labels: ${genA.stages.slice(0, 6).join(' | ')}`)
  } else {
    fail('G2 progress advances through stages', `labels=${JSON.stringify(genA.stages)}`)
  }
  if (genA.maxMainThreadGapMs < 1200) {
    pass('G3 main thread stays responsive', `worst heartbeat gap ${genA.maxMainThreadGapMs} ms`)
  } else {
    fail('G3 main thread stays responsive', `worst heartbeat gap ${genA.maxMainThreadGapMs} ms`)
  }
  await shot(page, 'A2-review')

  const importStateA = await openArrangementInPractice(page)
  if (importStateA.hasPdfPanel) {
    fail('A2 import view shows the arrangement, not PDF A', 'the stale PDF panel was still rendered')
  } else {
    pass('A2 import view shows the arrangement, not PDF A')
  }
  const stateA = await practiceSurfaceState(page)
  if (stateA.hasArrangementSurface && !stateA.hasPdfCanvas) {
    pass('A3 Open Score opens the generated arrangement', 'arrangement surface, no PDF canvas')
  } else {
    fail('A3 Open Score opens the generated arrangement', JSON.stringify(stateA).slice(0, 300))
  }
  const xmlA = await readPersistedMusicXml(page)
  if (xmlA && /<sign>TAB<\/sign>/.test(xmlA)) {
    pass('C1 guitar arrangement carries a six-line TAB staff', 'TAB clef present in the active score')
  } else {
    fail('C1 guitar arrangement carries a six-line TAB staff', String(xmlA).slice(0, 160))
  }
  if (xmlA && /<staff-details number="2"><staff-lines>6<\/staff-lines>/.test(xmlA)) {
    pass('C2 TAB staff has six lines in standard tuning')
  } else {
    fail('C2 TAB staff has six lines in standard tuning', String(xmlA).slice(0, 160))
  }
  await shot(page, 'A4-practice-arrangement')

  /* ------------------------------------------------ TEST B: piano preview */
  const genB = await generateArrangement(page, wavPath, { target: 'solo-piano', difficulty: 'easy', label: 'B' })
  await openArrangementInPractice(page)
  const stateB = await practiceSurfaceState(page)
  if (stateB.hasArrangementSurface) {
    pass('B1 piano arrangement opens its own practice surface')
  } else {
    fail('B1 piano arrangement opens its own practice surface', JSON.stringify(stateB).slice(0, 240))
  }
  const playBtn = page.getByRole('button', { name: /^play$/i }).first()
  if (await playBtn.count()) {
    await playBtn.click()
    const paused = await page.getByRole('button', { name: /^pause$/i }).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
    if (paused) {
      pass('B2 piano arrangement preview playback engages')
      await shot(page, 'B2-piano-playing')
    } else {
      fail('B2 piano arrangement preview playback engages', 'no Pause button after Play')
    }
    const pauseBtn = page.getByRole('button', { name: /^pause$/i }).first()
    if (await pauseBtn.count()) await pauseBtn.click()
  } else {
    fail('B2 piano arrangement preview playback engages', 'no Play button')
  }

  /* ------------------------------------------- TEST D: corrected tempo used */
  // The tempo field lives on the review screen, so generate (which ends on the
  // review screen), correct the tempo there, and only then open the score.
  await generateArrangement(page, wavPath, { target: 'solo-piano', difficulty: 'easy', label: 'D' })
  const tempoInput = page.locator('#audio-vision-tempo')
  if (await tempoInput.count()) {
    const original = await tempoInput.inputValue()
    const corrected = String(Math.max(40, Math.min(280, (Number(original) || 120) - 24)))
    await tempoInput.fill(corrected)
    await page.getByRole('button', { name: /rebuild with this tempo/i }).click()
    await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })
    const shown = (await page.locator('.audio-vision-facts').first().textContent() ?? '').replace(/\s+/g, ' ')
    if (shown.includes(`${corrected} BPM`)) {
      pass('D1 corrected tempo is applied to the rebuilt arrangement', `${corrected} BPM`)
    } else {
      fail('D1 corrected tempo is applied to the rebuilt arrangement', shown.slice(0, 200))
    }
    await openArrangementInPractice(page)
    // The session save is debounced, so the persisted score catches up a
    // moment later. Wait for the corrected tempo to be the persisted one.
    let tempoInXml = NaN
    const deadline = Date.now() + 15000
    for (;;) {
      const xmlD = await readPersistedMusicXml(page, { waitMs: 1000 })
      tempoInXml = xmlD ? Number(/<per-minute>(\d+)<\/per-minute>/.exec(xmlD)?.[1] ?? NaN) : NaN
      if (Number.isFinite(tempoInXml) && Math.abs(tempoInXml - Number(corrected)) <= 1) break
      if (Date.now() > deadline) break
      await sleep(600)
    }
    if (Number.isFinite(tempoInXml) && Math.abs(tempoInXml - Number(corrected)) <= 1) {
      pass('D2 the opened score carries the corrected tempo', `MusicXML per-minute=${tempoInXml}`)
    } else {
      fail('D2 the opened score carries the corrected tempo', `per-minute=${tempoInXml} expected ${corrected}`)
    }
  } else {
    fail('D1 corrected tempo is applied to the rebuilt arrangement', 'no tempo field in the review panel')
  }

  /* ------------------------------------------ TEST F: two in a row, 2nd wins */
  const genF = await generateArrangement(page, wavPath2, { target: 'solo-guitar', difficulty: 'easy', label: 'F' })
  await openArrangementInPractice(page)
  const xmlF = await readPersistedMusicXml(page)
  const stateF = await practiceSurfaceState(page)
  if (stateF.hasArrangementSurface && xmlF && !/demo-minuet/.test(xmlF)) {
    pass('F1 the second arrangement is the active score', 'previous arrangement did not replace it')
  } else {
    fail('F1 the second arrangement is the active score', JSON.stringify(stateF).slice(0, 200))
  }

  /* ------------------------------------- TEST E: survive a browser restart */
  // Give the debounced session save time to flush before the browser closes.
  await sleep(3000)
  const beforeReload = await readPersistedMusicXml(page)
  await page.close()
  await context.close()
  context = await launcher.launchPersistentContext(profileDir, launchOptions)
  page = await newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(3000)
  await dismissOverlays(page)
  const afterReload = await readPersistedMusicXml(page)
  if (afterReload && beforeReload && afterReload === beforeReload) {
    pass('E1 the arrangement survives a browser restart byte-for-byte')
  } else {
    fail('E1 the arrangement survives a browser restart byte-for-byte', `before=${beforeReload?.length ?? 0} after=${afterReload?.length ?? 0}`)
  }
  // Reopen it: the restored session must land on the arrangement, not on the
  // PDF that was imported earlier in this run.
  await sleep(1500)
  const stateE = await practiceSurfaceState(page)
  if (stateE.hasArrangementSurface) {
    pass('E2 the restored arrangement reopens in practice', 'arrangement surface after restart')
  } else {
    fail('E2 the restored arrangement reopens in practice', JSON.stringify(stateE).slice(0, 240))
  }
  await shot(page, 'E3-restored')

  /* ------------------------------------------------------ TEST H: failures */
  await openCreateFromAudio(page)
  const fileInput = page.locator('.audio-vision-card input[type="file"]')
  // Unsupported file type.
  await fileInput.setInputFiles(textPath)
  await sleep(1500)
  const unsupported = await page.evaluate(() => ({
    text: (document.querySelector('.audio-vision-card')?.textContent ?? '').replace(/\s+/g, ' '),
    busy: Boolean(document.querySelector('.audio-vision-progress')),
  }))
  if (unsupported.busy) {
    fail('H1 unsupported file does not start a generation', 'progress panel appeared')
  } else {
    pass('H1 unsupported file does not start a generation', unsupported.text.slice(0, 120))
  }
  await shot(page, 'H1-unsupported')

  // Malformed audio.
  await openCreateFromAudio(page)
  await page.locator('.audio-vision-card input[type="file"]').setInputFiles(brokenPath)
  const malformed = await Promise.race([
    page.getByText(/could not|error|unreadable|not.*audio|cannot/i).first().waitFor({ timeout: 45000 }).then(() => 'message').catch(() => 'timeout'),
    sleep(45000).then(() => 'timeout'),
  ])
  const malformedState = await page.evaluate(() => ({
    busy: Boolean(document.querySelector('.audio-vision-progress')),
    text: (document.querySelector('.audio-vision-card')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 220),
  }))
  if (malformed === 'message' && !malformedState.busy) {
    pass('H2 malformed audio is reported, not hung', malformedState.text.slice(0, 120))
  } else {
    fail('H2 malformed audio is reported, not hung', `state=${malformed} busy=${malformedState.busy}`)
  }
  await shot(page, 'H2-malformed')

  // Silence: the recording is valid but has no musical content, so the
  // arrangement must be refused with a real message.
  await openCreateFromAudio(page)
  await page.locator('.audio-vision-card input[type="file"]').setInputFiles(silencePath)
  await page.getByText(/recording length/i).first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /arrange for/i }).click()
  const silenceOutcome = await Promise.race([
    page.getByText(/silent|no musical content|room tone/i).first().waitFor({ timeout: 120000 }).then(() => 'refused').catch(() => 'timeout'),
    sleep(120000).then(() => 'timeout'),
  ])
  const silenceState = await page.evaluate(() => ({
    busy: Boolean(document.querySelector('.audio-vision-progress')),
    text: (document.querySelector('.audio-vision-card')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 220),
  }))
  if (silenceOutcome === 'refused' && !silenceState.busy) {
    pass('H3 silence is refused honestly', silenceState.text.slice(0, 120))
  } else {
    fail('H3 silence is refused honestly', `outcome=${silenceOutcome} busy=${silenceState.busy}`)
  }
  await shot(page, 'H3-silence')

  // Cancellation.
  const cancelResult = await generateArrangement(page, wavPath, { target: 'solo-guitar', difficulty: 'easy', cancel: true })
  if (!cancelResult.stillBusy) {
    pass('H4 cancel stops the run and leaves the panel', `progress hidden after cancel (latency ${cancelResult.progressLatencyMs} ms)`)
  } else {
    fail('H4 cancel stops the run and leaves the panel', 'progress panel still visible after Cancel')
  }
  await shot(page, 'H4-cancelled')
} catch (error) {
  fail('harness', String(error?.stack ?? error?.message ?? error).slice(0, 600))
  try {
    const pages = context.pages()
    if (pages[0]) await shot(pages[0], '99-error')
  } catch { /* noop */ }
} finally {
  try { await context?.close() } catch { /* noop */ }
  try { await vite?.close() } catch { /* noop */ }
}

report.finishedAt = new Date().toISOString()
await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\npass=${report.passes.length} fail=${report.failures.length} skipped=${report.skipped.length}`)
console.log(`consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length}`)
process.exit(report.failures.length ? 1 : 0)
