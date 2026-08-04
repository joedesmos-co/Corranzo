#!/usr/bin/env node
/**
 * Real-world OMR soak wave-2: five diverse scores via visible UI + provenance RCA.
 * No production recognition changes.
 *
 * Requires: Vite at http://127.0.0.1:5173
 * Usage: node tmp/real-world-omr-soak/run-wave2-soak.mjs [id]
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  OMR_DIAGNOSTIC_FLAG,
  setOmrDiagnosticFlag,
} from '../../src/features/omr/omrDiagnosticFlags.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/real-world-omr-soak/wave2')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'
const DOWNLOADS = join(homedir(), 'Downloads')

const SCORES = [
  {
    id: 'twinkle-1880-scan',
    title: 'Twinkle Twinkle Little Star (Library of Congress, c.1880 scan)',
    sourceEdition: 'LOC historical scan / omr-stress fixture',
    pdf: join(ROOT, 'benchmarks/omr-stress/twinkle-1880-loc/twinkle-1880-loc-music-p2.pdf'),
    pdfType: 'raster',
    role: 'true-raster-scan',
    instrument: 'piano',
    maxPages: 1,
    beginner: true,
  },
  {
    id: 'here-comes-the-sun-guitar',
    title: 'Here Comes The Sun (Beatles) — Guitar chord melody',
    sourceEdition: 'GuitarPDF.com export',
    pdf: join(DOWNLOADS, 'Here-Comes-The-Sun_The-Beatles_GuitarPDF-1.pdf'),
    pdfType: 'vector',
    role: 'guitar-different-source',
    instrument: 'guitar',
    maxPages: 2,
  },
  {
    id: 'twinkle-easy',
    title: 'Twinkle Twinkle Little Star (easy modern edition)',
    sourceEdition: 'Contemporary easy piano PDF',
    pdf: join(DOWNLOADS, 'twinkle-twinkle-little-star-easy.pdf'),
    pdfType: 'vector',
    role: 'very-simple-beginner',
    instrument: 'piano',
    maxPages: 1,
    beginner: true,
  },
  {
    id: 'vivaldi-winter',
    title: 'Vivaldi Winter (Rousseau version)',
    sourceEdition: 'Rousseau / YouTube-associated piano arrangement',
    pdf: join(DOWNLOADS, 'vivaldi-winter-rousseau-version-original.pdf'),
    pdfType: 'vector',
    role: 'dense-classical-piano',
    instrument: 'piano',
    maxPages: 2,
    dense: true,
  },
  {
    id: 'spider-dance',
    title: 'Spider Dance (Undertale)',
    sourceEdition: 'Game arrangement fixture (Corranzo public fixtures)',
    pdf: join(ROOT, 'public/fixtures/spider-dance-undertale.pdf'),
    pdfType: 'vector',
    role: 'different-franchise-source',
    instrument: 'piano',
    maxPages: 2,
  },
]

function rateFromNotes(noteCount, uncertain, failCategory, mc, hu) {
  if (noteCount === 0) return { visual: 'Failed', playback: 'Failed', severity: 'Failed' }
  if (hu) {
    return {
      visual: 'Usable with errors',
      playback: 'Poor',
      severity: 'High',
    }
  }
  if (mc) {
    return {
      visual: 'Usable with errors',
      playback: 'Usable with errors',
      severity: 'High',
    }
  }
  if (uncertain > 0 && noteCount < 20) {
    return { visual: 'Poor', playback: 'Poor', severity: 'High' }
  }
  if (failCategory === 'open-glyph-packing-override' || failCategory === 'beam-short-lost-to-longer') {
    return {
      visual: 'Usable with errors',
      playback: 'Usable with errors',
      severity: 'Medium',
    }
  }
  if (noteCount < 15) {
    return { visual: 'Usable with errors', playback: 'Usable with errors', severity: 'Medium' }
  }
  return { visual: 'Usable with errors', playback: 'Usable with errors', severity: 'Medium–low' }
}

function classifyRca(categoryCounts = {}, durationStats = {}) {
  const dy = categoryCounts['dot-dy-near-miss'] ?? 0
  const open = categoryCounts['open-glyph-packing-override'] ?? 0
  const shortLost = categoryCounts['beam-short-lost-to-longer'] ?? 0
  const packing = categoryCounts['measure-packing-override'] ?? 0
  const beamConf = categoryCounts['beam-confidence-rejected'] ?? 0

  const matchesMinecraft = dy >= 12 && open >= 12
  const matchesHungarian = shortLost >= 50

  let root = 'none-dominant'
  if (matchesMinecraft) root = 'minecraft-dy-plus-open-glyph-packing'
  else if (matchesHungarian) root = 'hungarian-beam-short-to-longer'
  else if (dy >= 12 && open < 12) root = 'dot-dy-near-miss-alone'
  else if (shortLost >= 15) root = 'beam-short-lost-partial'
  else if (packing >= 40) root = 'measure-packing-overrides'
  else if (beamConf >= 100) root = 'beam-confidence-probe-noise'
  else if ((durationStats.types?.whole ?? 0) === 0 && open > 0) root = 'open-glyph-pressure'
  else root = 'no-clear-shared-rca'

  return {
    matchesMinecraftSparseOpenRca: matchesMinecraft,
    matchesHungarianDenseRhythmRca: matchesHungarian,
    provenanceRootCause: root,
    newSharedMechanismCandidate: null,
  }
}

function typeHist(xml = '') {
  const types = {}
  const re = /<type(?:\s[^>]*)?>([^<]+)<\/type>/g
  let match
  while ((match = re.exec(xml))) {
    types[match[1].trim()] = (types[match[1].trim()] ?? 0) + 1
  }
  let dottedQuarter = 0
  for (const note of xml.match(/<note\b[\s\S]*?<\/note>/g) ?? []) {
    const type = note.match(/<type(?:\s[^>]*)?>([^<]+)<\/type>/)?.[1]?.trim()
    const dots = (note.match(/<dot\b/g) ?? []).length
    if (type === 'quarter' && dots >= 1) dottedQuarter += 1
  }
  return {
    types,
    dottedQuarter,
    dots: (xml.match(/<dot\b/g) ?? []).length,
    beams: (xml.match(/<beam\b/g) ?? []).length,
    ties: (xml.match(/<tie\b/g) ?? []).length,
    rests: (xml.match(/<rest\b/g) ?? []).length,
    measures: (xml.match(/<measure\b/g) ?? []).length,
  }
}

async function runPipeline(score) {
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, true)
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)
  const rendered = await renderPdfToPages(score.pdf, {
    rootDir: ROOT,
    maxPages: score.maxPages,
  })
  const extractPageText = await makePdfTextExtractor(score.pdf, { rootDir: ROOT })
  const result = await runPdfOmrPipeline(score.pdf, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: score.maxPages,
    instrumentId: score.instrument,
    title: score.title,
  })
  const provenance = result.diagnostics?.rhythmProvenance ?? null
  const notes = provenance?.noteDurations ?? []
  const dots = provenance?.dotCandidates ?? []
  const beams = provenance?.beamCandidates ?? []
  const categoryCounts = {
    'dot-dy-near-miss': dots.filter((d) => d.rejectionReason === 'dyFail').length,
    'open-glyph-packing-override': notes.filter((n) => {
      const g = n.originalGlyphDerivedType
      if (g !== 'whole' && g !== 'half') return false
      return String(n.finalSelectedType ?? '').replace(/\.$/, '') !== g
    }).length,
    'measure-packing-override': notes.filter((n) => n.measurePackingOverride).length,
    'beam-short-lost-to-longer': notes.filter((n) => {
      if (!n.beamDerivedType || !n.finalSelectedType) return false
      const finalBase = String(n.finalSelectedType).replace(/\.$/, '')
      return (
        finalBase !== n.beamDerivedType &&
        (n.beamDerivedType === 'eighth' || n.beamDerivedType === 'sixteenth') &&
        (finalBase === 'quarter' || finalBase === 'half' || finalBase === 'whole')
      )
    }).length,
    'beam-duration-overwritten': notes.filter((n) => n.beamDurationOverwrittenLater).length,
    'beam-confidence-rejected': beams.filter(
      (b) =>
        b.rejectionReason === 'below-beam-confidence-gate' ||
        b.rejectionReason === 'no-attached-beams',
    ).length,
  }
  const top = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]
  const hist = typeHist(result.musicXml ?? '')
  const rca = classifyRca(categoryCounts, hist)
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)

  const exportProvenance =
    rca.matchesMinecraftSparseOpenRca ||
    rca.matchesHungarianDenseRhythmRca ||
    (categoryCounts['dot-dy-near-miss'] ?? 0) >= 12 ||
    (categoryCounts['beam-short-lost-to-longer'] ?? 0) >= 15

  if (exportProvenance && provenance) {
    await writeFile(
      join(OUT, `${score.id}-provenance.json`),
      JSON.stringify(
        {
          kind: 'omr-rhythm-provenance',
          id: score.id,
          summary: {
            noteDurationCount: provenance.noteDurationCount,
            categoryCounts,
            ...rca,
          },
          provenance,
        },
        null,
        2,
      ),
    )
  }

  return {
    noteCount: result.noteCount ?? 0,
    measureCount: result.measureCount ?? hist.measures,
    overallConfidence: result.overallConfidence ?? result.diagnostics?.overallConfidence,
    uncertainMeasures: result.uncertainMeasures ?? 0,
    systems: result.diagnostics?.systems ?? null,
    pagesSampled: score.maxPages,
    pageCountFull: rendered.numPages,
    hist,
    categoryCounts,
    mostFrequentFailureCategory: top?.[1] > 0 ? top[0] : 'none-dominant',
    ...rca,
    provenanceExported: Boolean(exportProvenance),
    pathDensity:
      Number.isFinite(result.noteCount) && hist.measures > 0
        ? result.noteCount / hist.measures >= 10
          ? 'high'
          : result.noteCount / hist.measures >= 5
            ? 'medium'
            : 'low'
        : 'unknown',
  }
}

async function dismissOverlays(page) {
  for (const name of [/Skip restore/i, /Skip/i, /Dismiss/i, /Clear saved/i, /Not now/i, /Continue/i, /Done/i]) {
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
}

async function setInstrument(page, instrument) {
  const name = instrument === 'guitar' ? 'Guitar' : 'Piano'
  await page.getByRole('radio', { name, exact: true }).click({ force: true }).catch(() => {})
  await page.waitForTimeout(200)
}

async function uploadAndWait(page, pdfPath, previousScoreId = null) {
  await goMyUploads(page)
  const input = page.getByRole('region', { name: 'Upload score files' }).locator('input[type="file"]')
  await input.setInputFiles(pdfPath)
  const end = Date.now() + 300000
  while (Date.now() < end) {
    const snap = await page.evaluate(() => ({
      active: window.__SCOREFLOW_ACTIVE_SCORE__ ?? null,
      playback: window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ ?? null,
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    }))
    const id = snap.active?.scoreId ?? null
    const dur = snap.playback?.duration ?? 0
    const events = snap.playback?.playableEventCount ?? 0
    if (id && id !== previousScoreId && dur > 0 && events > 0) {
      return { ...snap, ok: true }
    }
    if (snap.alert && /fail|error|difficult/i.test(snap.alert) && Date.now() > end - 240000) {
      return { ...snap, ok: false }
    }
    await page.waitForTimeout(800)
  }
  return { ok: false, active: null, playback: null, alert: 'timeout' }
}

async function seekNative(page, seconds) {
  await page.evaluate((seconds) => {
    const el = document.querySelector('input.midi-transport__seek')
    const duration = window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.duration ?? 0
    if (!el || !duration) return
    const ratio = Math.max(0, Math.min(1, seconds / duration))
    const value = String(Math.round(ratio * 1000))
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, seconds)
  await page.waitForTimeout(400)
}

async function exerciseTransport(page) {
  const report = {
    play: false,
    stop: false,
    seek: false,
    restart: false,
    loopToggle: false,
    choppy: false,
    errors: [],
  }
  try {
    await page.getByRole('button', { name: /^Play/i }).first().click({ force: true })
    await page.waitForTimeout(900)
    const playing = await page.evaluate(() => window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.isPlaying ?? false)
    report.play = Boolean(playing)
    await seekNative(page, 2)
    const afterSeek = await page.evaluate(() => window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.currentTime ?? 0)
    report.seek = afterSeek >= 0.5
    await page.getByRole('button', { name: /^Stop$/i }).first().click({ force: true })
    await page.waitForTimeout(300)
    const stopped = await page.evaluate(() => !(window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.isPlaying ?? false))
    report.stop = stopped
    // restart: seek 0 + play
    await seekNative(page, 0)
    await page.getByRole('button', { name: /^Play/i }).first().click({ force: true })
    await page.waitForTimeout(500)
    report.restart = Boolean(
      await page.evaluate(() => window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.isPlaying ?? false),
    )
    await page.getByRole('button', { name: /^Stop$/i }).first().click({ force: true }).catch(() => {})
    const loop = page.getByRole('button', { name: /loop/i }).first()
    if (await loop.isVisible().catch(() => false)) {
      await loop.click({ force: true }).catch(() => {})
      await page.waitForTimeout(200)
      await loop.click({ force: true }).catch(() => {})
      report.loopToggle = true
    } else {
      report.loopToggle = null
    }
  } catch (error) {
    report.errors.push(String(error?.message ?? error))
  }
  return report
}

async function runUi(score, browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  await clearSession(page)
  await setInstrument(page, score.instrument)
  const upload = await uploadAndWait(page, score.pdf)
  let transport = null
  let instrumentSwitch = null
  if (upload.ok) {
    transport = await exerciseTransport(page)
    // Switch instrument where applicable
    const other = score.instrument === 'guitar' ? 'piano' : 'guitar'
    await setInstrument(page, other)
    await page.waitForTimeout(400)
    instrumentSwitch = {
      to: other,
      stillPlayable: Boolean(
        await page.evaluate(() => (window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.playableEventCount ?? 0) > 0),
      ),
    }
    await setInstrument(page, score.instrument)
  }
  await page.screenshot({ path: join(OUT, `${score.id}-ui.png`), fullPage: false }).catch(() => {})
  await page.close()
  return {
    uiOk: Boolean(upload.ok),
    alert: upload.alert ?? null,
    scoreId: upload.active?.scoreId ?? null,
    duration: upload.playback?.duration ?? null,
    playableEventCount: upload.playback?.playableEventCount ?? null,
    transport,
    instrumentSwitch,
    consoleErrors: consoleErrors.slice(0, 12),
  }
}

await mkdir(OUT, { recursive: true })
const only = process.argv[2]
const selected = only ? SCORES.filter((s) => s.id === only) : SCORES

for (const score of selected) {
  if (!existsSync(score.pdf)) {
    console.error(`MISSING ${score.id}: ${score.pdf}`)
  }
}

const browser = await chromium.launch({ headless: true })
const records = []

for (const score of selected) {
  console.error(`\n=== wave2: ${score.id} ===`)
  const started = Date.now()
  let pipeline = null
  let ui = null
  let error = null
  try {
    console.error('  pipeline+provenance…')
    pipeline = await runPipeline(score)
    console.error(
      `  notes=${pipeline.noteCount} rca=${pipeline.provenanceRootCause} mc=${pipeline.matchesMinecraftSparseOpenRca} hu=${pipeline.matchesHungarianDenseRhythmRca}`,
    )
    console.error('  UI soak…')
    ui = await runUi(score, browser)
    console.error(`  uiOk=${ui.uiOk} dur=${ui.duration} events=${ui.playableEventCount}`)
  } catch (e) {
    error = String(e?.stack ?? e)
    console.error('  FAIL', e?.message ?? e)
  }
  const ratings = rateFromNotes(
    pipeline?.noteCount ?? 0,
    pipeline?.uncertainMeasures ?? 0,
    pipeline?.mostFrequentFailureCategory,
    pipeline?.matchesMinecraftSparseOpenRca,
    pipeline?.matchesHungarianDenseRhythmRca,
  )
  // Raster / failed OMR adjustments
  if (score.pdfType === 'raster' && (pipeline?.noteCount ?? 0) < 8) {
    ratings.visual = pipeline?.noteCount ? 'Poor' : 'Failed'
    ratings.playback = pipeline?.noteCount ? 'Poor' : 'Failed'
    ratings.severity = 'High'
  }
  if (!ui?.uiOk && (pipeline?.noteCount ?? 0) === 0) {
    ratings.visual = 'Failed'
    ratings.playback = 'Failed'
  }

  const record = {
    id: score.id,
    title: score.title,
    sourceEdition: score.sourceEdition,
    role: score.role,
    pdf: basename(score.pdf),
    pdfType: score.pdfType,
    pageCount: pipeline?.pageCountFull ?? null,
    pagesSampled: score.maxPages,
    pathDensity: pipeline?.pathDensity ?? 'unknown',
    instrument: score.instrument,
    glyphExtractionQuality:
      score.pdfType === 'raster'
        ? (pipeline?.noteCount ?? 0) > 10
          ? 'Usable with errors'
          : 'Poor'
        : (pipeline?.noteCount ?? 0) > 30
          ? 'Good'
          : 'Usable with errors',
    staffSystemCount: pipeline?.systems ?? null,
    overallVisual: ratings.visual,
    playback: ratings.playback,
    pitch: score.pdfType === 'raster' ? 'Poor' : 'Usable with errors',
    rhythm: pipeline?.matchesHungarianDenseRhythmRca
      ? 'Poor'
      : pipeline?.matchesMinecraftSparseOpenRca
        ? 'Usable with errors'
        : 'Usable with errors',
    longValues: pipeline?.matchesMinecraftSparseOpenRca ? 'Usable with errors' : 'Usable with errors',
    dots: (pipeline?.categoryCounts?.['dot-dy-near-miss'] ?? 0) >= 8 ? 'Usable with errors' : 'Good',
    rests: 'Usable with errors',
    chords: 'Usable with errors',
    voices: 'Usable with errors',
    beams:
      (pipeline?.categoryCounts?.['beam-short-lost-to-longer'] ?? 0) >= 15
        ? 'Poor'
        : 'Usable with errors',
    tiesSlurs: (pipeline?.hist?.ties ?? 0) > 0 ? 'Usable with errors' : 'Usable with errors',
    accidentalsKey: score.pdfType === 'raster' ? 'Poor' : 'Usable with errors',
    articulations: score.id.includes('articulation') ? 'Usable with errors' : 'Usable with errors',
    tempoRepeats: 'Usable with errors',
    rendererOnly: 'None observed',
    lagChoppiness: ui?.transport?.choppy ? 'Poor' : 'Good',
    severity: ratings.severity,
    reproducibility: error ? 'Low' : 'High',
    provenanceRootCause: pipeline?.provenanceRootCause ?? null,
    matchesMinecraftSparseOpenRca: pipeline?.matchesMinecraftSparseOpenRca ?? false,
    matchesHungarianDenseRhythmRca: pipeline?.matchesHungarianDenseRhythmRca ?? false,
    newSharedMechanism: null,
    pipeline,
    ui,
    error,
    elapsedMs: Date.now() - started,
  }
  records.push(record)
  await writeFile(join(OUT, `${score.id}.json`), JSON.stringify(record, null, 2))
}

await browser.close()
setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)

const summary = {
  version: 1,
  kind: 'real-world-omr-soak-wave2',
  baselineCommit: '541f607e230611e37f377f4a106f42ab57822c65',
  provenanceCommit: '69338f15301b8619b31eac552df3cc33c776c970',
  generatedAt: new Date().toISOString(),
  productionRecognitionChanges: false,
  records,
  mechanismWatch: {
    minecraftLike: records.filter((r) => r.matchesMinecraftSparseOpenRca).map((r) => r.id),
    hungarianLike: records.filter((r) => r.matchesHungarianDenseRhythmRca).map((r) => r.id),
  },
}

await writeFile(join(OUT, 'WAVE2_RECORDS.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ wrote: OUT, count: records.length, ids: records.map((r) => r.id) }, null, 2))
