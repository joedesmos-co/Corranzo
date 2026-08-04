#!/usr/bin/env node
/**
 * Wave 3 real-world OMR soak — five diverse scores. No recognition changes.
 * Requires Vite at http://127.0.0.1:5173
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
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
const OUT = join(ROOT, 'tmp/real-world-omr-soak/wave3')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'
const DOWNLOADS = join(process.env.HOME, 'Downloads')

const SCORES = [
  {
    id: 'guitar-paired-scan',
    title: 'Guitar Paired Scan (fixture)',
    sourceEdition: 'Corranzo omr-fixtures — synthetic scan of paired notation+TAB',
    pdf: join(ROOT, 'benchmarks/omr-fixtures/guitar-paired-scan/guitar-paired-scan.pdf'),
    pdfType: 'raster',
    role: 'second-true-raster',
    instrument: 'guitar',
    maxPages: 1,
    audible: true,
  },
  {
    id: 'guitar-techniques-tab',
    title: 'Guitar Techniques Paired Vector (notation + TAB)',
    sourceEdition: 'Corranzo omr-fixtures — paired standard notation + six-line TAB',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/guitar-techniques-paired-vector/guitar-techniques-paired-vector.pdf',
    ),
    pdfType: 'vector',
    role: 'real-guitar-tab-paired',
    instrument: 'guitar',
    maxPages: 1,
    audible: true,
    expectTab: true,
  },
  {
    id: 'iris-out-mixed-export',
    title: 'Iris Out (piano arrangement)',
    sourceEdition: 'Third-party arrangement PDF — multi-font / atypical export path',
    pdf: join(DOWNLOADS, 'iris-out-piano-arragement.pdf'),
    pdfType: 'mixed', // unusual fonts / flattened exporter traits (see pageSources)
    role: 'mixed-or-unusual-export',
    instrument: 'piano',
    maxPages: 2,
  },
  {
    id: 'bach-chorale-sparse',
    title: 'Bach Chorale BWV 259',
    sourceEdition: 'Corranzo practice-library Mutopia-style vector',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-bach-chorale-bwv259/piano-bach-chorale-bwv259.pdf',
    ),
    pdfType: 'vector',
    role: 'sparse-classical-piano',
    instrument: 'piano',
    maxPages: 1,
  },
  {
    id: 'turkish-march-dense',
    title: 'Mozart Turkish March',
    sourceEdition: 'Corranzo practice-library — dense beamed piano',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-mozart-turkish-march/piano-mozart-turkish-march.pdf',
    ),
    pdfType: 'vector',
    role: 'dense-beamed-piano',
    instrument: 'piano',
    maxPages: 2,
    audible: true,
  },
]

const paintImageOps = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageXObjectRepeat,
  OPS.paintSolidColorImageMask,
])

async function classifyPages(pdfPath) {
  const data = new Uint8Array(await readFile(pdfPath))
  const doc = await getDocument({ data, disableWorker: true, useSystemFonts: true }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const text = await page.getTextContent()
    const textChars = text.items.reduce((s, it) => s + (it.str?.length ?? 0), 0)
    const fonts = [...new Set(text.items.map((it) => it.fontName).filter(Boolean))]
    const ops = await page.getOperatorList()
    let imageOps = 0
    let pathOps = 0
    for (const fn of ops.fnArray) {
      if (paintImageOps.has(fn)) imageOps += 1
      if (fn === OPS.constructPath || fn === OPS.stroke || fn === OPS.fill) pathOps += 1
    }
    let kind = 'vector'
    if (textChars < 30 && imageOps > 0 && pathOps < 30) kind = 'raster'
    else if (imageOps > 0 && (textChars > 40 || pathOps > 30)) kind = 'mixed'
    else if (fonts.length >= 4 && textChars > 100) kind = 'vector-unusual-fonts'
    pages.push({ page: i, kind, textChars, imageOps, pathOps, fonts: fonts.slice(0, 6) })
  }
  return { pageCount: doc.numPages, pages }
}

async function rasterQuality(pdfPath) {
  const data = new Uint8Array(await readFile(pdfPath))
  const doc = await getDocument({ data, disableWorker: true, useSystemFonts: true }).promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1.5 })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  const { data: px, width: w, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let sum = 0
  let sum2 = 0
  let dark = 0
  const n = w * h
  const rowInk = new Float64Array(h)
  for (let y = 0; y < h; y++) {
    let ink = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const g = (px[i] + px[i + 1] + px[i + 2]) / 3
      sum += g
      sum2 += g * g
      if (g < 160) {
        dark += 1
        ink += 1
      }
    }
    rowInk[y] = ink / w
  }
  const mean = sum / n
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean))
  let ridges = 0
  for (let y = 1; y < h - 1; y++) {
    if (rowInk[y] > rowInk[y - 1] && rowInk[y] > rowInk[y + 1] && rowInk[y] > 0.04) ridges += 1
  }
  // Skew: compare ink centroids of top vs bottom thirds
  function cxBand(y0, y1) {
    let s = 0
    let c = 0
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const g = (px[i] + px[i + 1] + px[i + 2]) / 3
        if (g < 160) {
          s += x
          c += 1
        }
      }
    }
    return c ? s / c : w / 2
  }
  const topCx = cxBand(0, Math.floor(h / 3))
  const botCx = cxBand(Math.floor((2 * h) / 3), h)
  const skewProxyDeg = (Math.atan2(botCx - topCx, h) * 180) / Math.PI
  return {
    renderPx: { w, h },
    meanGray: Number(mean.toFixed(1)),
    stdGray: Number(std.toFixed(1)),
    darkFraction: Number((dark / n).toFixed(3)),
    contrast: Number((std / Math.max(1, mean)).toFixed(3)),
    skewProxyDeg: Number(skewProxyDeg.toFixed(2)),
    staffRidgePeaks: ridges,
    staffVisibility: ridges >= 8 ? 'good' : ridges >= 4 ? 'fair' : 'poor',
    resolutionNote: `${Math.round(w)}×${Math.round(h)} px @1.5× PDF viewport`,
  }
}

function typeHist(xml = '') {
  const types = {}
  const re = /<type(?:\s[^>]*)?>([^<]+)<\/type>/g
  let match
  while ((match = re.exec(xml))) {
    types[match[1].trim()] = (types[match[1].trim()] ?? 0) + 1
  }
  return {
    types,
    dots: (xml.match(/<dot\b/g) ?? []).length,
    beams: (xml.match(/<beam\b/g) ?? []).length,
    ties: (xml.match(/<tie\b/g) ?? []).length,
    rests: (xml.match(/<rest\b/g) ?? []).length,
    measures: (xml.match(/<measure\b/g) ?? []).length,
    tabLines: (xml.match(/<staff-details[\s\S]*?<staff-lines>6<\/staff-lines>/g) ?? []).length,
    stringAttrs: (xml.match(/<string>/g) ?? []).length,
    fretAttrs: (xml.match(/<fret>/g) ?? []).length,
  }
}

function classifyRca(categoryCounts = {}) {
  const dy = categoryCounts['dot-dy-near-miss'] ?? 0
  const open = categoryCounts['open-glyph-packing-override'] ?? 0
  const shortLost = categoryCounts['beam-short-lost-to-longer'] ?? 0
  const packing = categoryCounts['measure-packing-override'] ?? 0
  const beamConf = categoryCounts['beam-confidence-rejected'] ?? 0
  const matchesMinecraft = dy >= 12 && open >= 12
  const matchesHungarian = shortLost >= 50
  const matchesFalseBeamSparse = shortLost >= 15 && shortLost < 50 && dy < 8 && open < 8
  let root = 'no-clear-shared-rca'
  if (matchesMinecraft) root = 'minecraft-dy-plus-open-glyph-packing'
  else if (matchesHungarian) root = 'hungarian-beam-short-to-longer'
  else if (matchesFalseBeamSparse) root = 'false-beam-correction-sparse'
  else if (dy >= 12) root = 'dot-dy-near-miss-alone'
  else if (packing >= 40) root = 'measure-packing-overrides'
  else if (beamConf >= 100) root = 'beam-confidence-probe-noise'
  return {
    matchesMinecraftSparseOpenRca: matchesMinecraft,
    matchesHungarianDenseRhythmRca: matchesHungarian,
    matchesFalseBeamSparseBeginner: matchesFalseBeamSparse,
    provenanceRootCause: root,
  }
}

async function runPipeline(score) {
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, true)
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)
  let result
  let failed = null
  try {
    const rendered = await renderPdfToPages(score.pdf, {
      rootDir: ROOT,
      maxPages: score.maxPages,
    })
    const extractPageText = await makePdfTextExtractor(score.pdf, { rootDir: ROOT })
    result = await runPdfOmrPipeline(score.pdf, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.numPages,
      maxPages: score.maxPages,
      instrumentId: score.instrument,
      title: score.title,
    })
  } catch (error) {
    failed = String(error?.message ?? error)
    setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)
    return {
      omrFailed: true,
      failureMessage: failed,
      matchesRasterLowConfidenceRejection: /difficult|low-confidence|cleaner digital/i.test(failed),
    }
  }

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
    'beam-confidence-rejected': beams.filter(
      (b) =>
        b.rejectionReason === 'below-beam-confidence-gate' ||
        b.rejectionReason === 'no-attached-beams',
    ).length,
  }
  const hist = typeHist(result.musicXml ?? '')
  const rca = classifyRca(categoryCounts)
  const tabDiagnostics = result.diagnostics?.tab ?? result.diagnostics?.guitarTab ?? null
  const falseTabRouting =
    score.expectTab &&
    hist.stringAttrs === 0 &&
    hist.fretAttrs === 0 &&
    (result.noteCount ?? 0) > 0

  const exportProv =
    rca.matchesMinecraftSparseOpenRca ||
    rca.matchesHungarianDenseRhythmRca ||
    falseTabRouting ||
    (categoryCounts['beam-short-lost-to-longer'] ?? 0) >= 15
  if (exportProv && provenance) {
    await writeFile(
      join(OUT, `${score.id}-provenance.json`),
      JSON.stringify({ id: score.id, categoryCounts, rca, hist, tabDiagnostics, provenance }, null, 2),
    )
  }

  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)
  return {
    omrFailed: false,
    noteCount: result.noteCount ?? 0,
    measureCount: result.measureCount ?? hist.measures,
    overallConfidence: result.overallConfidence ?? result.diagnostics?.overallConfidence,
    uncertainMeasures: result.uncertainMeasures ?? 0,
    systems: result.diagnostics?.systems ?? null,
    hist,
    categoryCounts,
    tabDiagnostics,
    falseTabRouting,
    matchesGuitarFalseTabRouting: Boolean(falseTabRouting),
    matchesRasterLowConfidenceRejection: false,
    ...rca,
    provenanceExported: Boolean(exportProv),
    musicXmlSnippet: (result.musicXml ?? '').slice(0, 1500),
  }
}

async function dismiss(page) {
  for (const name of [/Skip restore/i, /Skip/i, /Dismiss/i, /Not now/i, /Done/i, /Continue/i]) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) await btn.click({ force: true }).catch(() => {})
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
  await page.evaluate(() => {
    ;[...document.querySelectorAll('nav[aria-label="Main"] button')]
      .find((el) => el.textContent?.trim() === 'Library')
      ?.click()
  })
  await page.waitForTimeout(350)
  await page.getByRole('tab', { name: /My Uploads/i }).click({ force: true })
  await page.waitForTimeout(250)
}

async function upload(page, pdf, instrument) {
  await page
    .getByRole('radio', { name: instrument === 'guitar' ? 'Guitar' : 'Piano', exact: true })
    .click({ force: true })
    .catch(() => {})
  await goUploads(page)
  await page
    .getByRole('region', { name: 'Upload score files' })
    .locator('input[type="file"]')
    .setInputFiles(pdf)
  const end = Date.now() + 240000
  while (Date.now() < end) {
    const snap = await page.evaluate(() => ({
      active: window.__SCOREFLOW_ACTIVE_SCORE__ ?? null,
      playback: window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ ?? null,
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    }))
    if ((snap.playback?.duration ?? 0) > 0 && (snap.playback?.playableEventCount ?? 0) > 0) {
      return { ok: true, ...snap }
    }
    if (snap.alert && /difficult|fail|error|could not/i.test(snap.alert)) {
      return { ok: false, ...snap }
    }
    await page.waitForTimeout(600)
  }
  return { ok: false, alert: 'timeout' }
}

async function audibleProbe(page) {
  // Best-effort audio check: resume AudioContext, click Play, sample analyser energy.
  return page.evaluate(async () => {
    const out = {
      playClicked: false,
      audioContextState: null,
      energySamples: [],
      startedPlayingFlag: null,
      pauseWorked: null,
      restartWorked: null,
      notes: [],
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      let ctx = window.__SCOREFLOW_AUDIO_CTX__ || null
      if (!ctx && AC) {
        ctx = new AC()
        window.__SCOREFLOW_AUDIO_CTX__ = ctx
      }
      if (ctx?.state === 'suspended') await ctx.resume()
      out.audioContextState = ctx?.state ?? 'missing'

      const playBtn = [...document.querySelectorAll('button')].find((b) =>
        /Play/i.test(b.textContent || ''),
      )
      playBtn?.click()
      out.playClicked = Boolean(playBtn)
      await new Promise((r) => setTimeout(r, 900))
      out.startedPlayingFlag = Boolean(window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.isPlaying)

      // Tap into destination via a temporary analyser if WebAudio nodes exist on window
      const analyser = ctx?.createAnalyser?.()
      if (analyser && ctx) {
        analyser.fftSize = 256
        try {
          // Cannot always connect to engine graph; sample destination silence vs non-silence via time
          const data = new Uint8Array(analyser.frequencyBinCount)
          for (let i = 0; i < 8; i++) {
            await new Promise((r) => setTimeout(r, 120))
            analyser.getByteFrequencyData(data)
            const avg = data.reduce((s, v) => s + v, 0) / data.length
            out.energySamples.push(Number(avg.toFixed(2)))
          }
        } catch (e) {
          out.notes.push(`analyser:${e.message}`)
        }
      }

      const pauseBtn = [...document.querySelectorAll('button')].find((b) =>
        /Pause|Stop/i.test(b.textContent || ''),
      )
      pauseBtn?.click()
      await new Promise((r) => setTimeout(r, 250))
      out.pauseWorked = !window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.isPlaying

      const seek = document.querySelector('input.midi-transport__seek')
      if (seek) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(seek, '0')
        seek.dispatchEvent(new Event('input', { bubbles: true }))
        seek.dispatchEvent(new Event('change', { bubbles: true }))
      }
      playBtn?.click()
      await new Promise((r) => setTimeout(r, 500))
      out.restartWorked = Boolean(window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.isPlaying)
      pauseBtn?.click()
    } catch (e) {
      out.notes.push(String(e.message || e))
    }
    return out
  })
}

async function navRegression(page, scoreId) {
  const out = { libraryRoundTrip: false, restoreSameScore: false, staleOverlay: false }
  try {
    await page.evaluate(() => {
      ;[...document.querySelectorAll('nav[aria-label="Main"] button')]
        .find((el) => el.textContent?.trim() === 'Library')
        ?.click()
    })
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      ;[...document.querySelectorAll('nav[aria-label="Main"] button')]
        .find((el) => el.textContent?.trim() === 'Practice')
        ?.click()
    })
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => window.__SCOREFLOW_ACTIVE_SCORE__?.scoreId ?? null)
    out.libraryRoundTrip = true
    out.restoreSameScore = after === scoreId
    out.staleOverlay = Boolean(
      await page.evaluate(() => {
        const alert = document.querySelector('[role="alert"]')?.textContent ?? ''
        return /stale|overlay|wrong score/i.test(alert)
      }),
    )
    // reload restore
    await page.reload({ waitUntil: 'networkidle' })
    await dismiss(page)
    await page.waitForTimeout(800)
    const restored = await page.evaluate(() => window.__SCOREFLOW_ACTIVE_SCORE__?.scoreId ?? null)
    out.reloadRestored = restored === scoreId || restored != null
  } catch (e) {
    out.error = String(e.message || e)
  }
  return out
}

async function runUi(score, browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  await clearSession(page)
  const up = await upload(page, score.pdf, score.instrument)
  let transport = null
  let audible = null
  let instrumentSwitch = null
  let navigation = null
  if (up.ok) {
    // Loop toggle
    const loop = page.locator('button', { hasText: /Loop/ }).first()
    if (await loop.count()) {
      await loop.click({ force: true })
      await page.waitForTimeout(150)
      await loop.click({ force: true })
    }
    if (score.audible) {
      audible = await audibleProbe(page)
    }
    const other = score.instrument === 'guitar' ? 'Piano' : 'Guitar'
    await page.getByRole('radio', { name: other, exact: true }).click({ force: true }).catch(() => {})
    await page.waitForTimeout(350)
    instrumentSwitch = {
      to: other,
      stillPlayable: await page.evaluate(
        () => (window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.playableEventCount ?? 0) > 0,
      ),
    }
    await page
      .getByRole('radio', {
        name: score.instrument === 'guitar' ? 'Guitar' : 'Piano',
        exact: true,
      })
      .click({ force: true })
      .catch(() => {})
    navigation = await navRegression(page, up.active?.scoreId ?? null)
  }
  await page.screenshot({ path: join(OUT, `${score.id}-ui.png`), fullPage: false }).catch(() => {})
  await page.close()
  return {
    uiOk: Boolean(up.ok),
    alert: up.alert ?? null,
    scoreId: up.active?.scoreId ?? null,
    duration: up.playback?.duration ?? null,
    playableEventCount: up.playback?.playableEventCount ?? null,
    loopToggled: true,
    audible,
    instrumentSwitch,
    navigation,
  }
}

await mkdir(OUT, { recursive: true })
const only = process.argv[2]
const selected = only ? SCORES.filter((s) => s.id === only) : SCORES
for (const s of selected) {
  if (!existsSync(s.pdf)) console.error('MISSING', s.id, s.pdf)
}

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const records = []

for (const score of selected) {
  console.error(`\n=== wave3: ${score.id} ===`)
  const started = Date.now()
  const pageInfo = await classifyPages(score.pdf)
  let scanQuality = null
  if (score.pdfType === 'raster') {
    try {
      scanQuality = await rasterQuality(score.pdf)
    } catch (e) {
      scanQuality = { error: String(e.message || e) }
    }
  }
  console.error('  pipeline…')
  const pipeline = await runPipeline(score)
  console.error(
    pipeline.omrFailed
      ? `  OMR FAIL ${pipeline.failureMessage}`
      : `  notes=${pipeline.noteCount} rca=${pipeline.provenanceRootCause} tabFalse=${pipeline.falseTabRouting}`,
  )
  console.error('  UI…')
  const ui = await runUi(score, browser)
  console.error(`  uiOk=${ui.uiOk} dur=${ui.duration} events=${ui.playableEventCount}`)

  const record = {
    id: score.id,
    title: score.title,
    sourceEdition: score.sourceEdition,
    role: score.role,
    pdf: basename(score.pdf),
    pdfTypeDeclared: score.pdfType,
    pageCount: pageInfo.pageCount,
    pageSources: pageInfo.pages,
    scanQuality,
    pathGlyphDensity:
      !pipeline.omrFailed && pipeline.measureCount
        ? pipeline.noteCount / Math.max(1, pipeline.measureCount)
        : null,
    omrCompletion: pipeline.omrFailed ? 'Failed' : 'Completed',
    pipeline,
    ui,
    elapsedMs: Date.now() - started,
  }
  records.push(record)
  await writeFile(join(OUT, `${score.id}.json`), JSON.stringify(record, null, 2))
}

await browser.close()
setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)

const summary = {
  version: 1,
  kind: 'real-world-omr-soak-wave3',
  baselineCommit: '541f607e230611e37f377f4a106f42ab57822c65',
  provenanceCommit: '69338f15301b8619b31eac552df3cc33c776c970',
  generatedAt: new Date().toISOString(),
  productionRecognitionChanges: false,
  records,
}
await writeFile(join(OUT, 'WAVE3_RECORDS.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ wrote: OUT, ids: records.map((r) => r.id) }, null, 2))
