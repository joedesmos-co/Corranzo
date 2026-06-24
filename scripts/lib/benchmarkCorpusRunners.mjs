/**
 * Asset resolution for alignment corpus benchmark runners.
 * Script-only — imports test helpers for synthetic fixtures.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import {
  TIMING_SOURCE_KIND,
  classifyTimingSourceKind,
  describeLayoutHints,
  resolveMutopiaTimingUrls,
} from '../../src/features/score-follow/benchmarkTimingSource.js'
import { renderPdfToPages, makeRenderPageCallback } from './renderPdfPages.mjs'
import {
  cleanPianoPage,
  densePianoPage,
  lightClassicalPage,
  multiPageScore,
  unevenMeasurePage,
  renderPagesFromArray,
} from '../../tests/helpers/syntheticScore.js'
import * as F from '../../tests/helpers/buildXml.js'

const rootDir = join(fileURLToPath(import.meta.url), '..', '..')
const venvPython = join(rootDir, '.venv-fixtures', 'bin', 'python3')

const SYNTHETIC_PAGE_BUILDERS = {
  cleanPianoPage,
  densePianoPage,
  lightClassicalPage,
  multiPageScore,
  unevenMeasurePage,
}

function buildPianoTimingMap({ measures, breakEvery = null, staves = 2 }) {
  const stavesAttr =
    staves === 2
      ? '<attributes><divisions>1</divisions><staves>2</staves>' +
        '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
      : F.attributes()
  let xml = ''
  for (let m = 1; m <= measures; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) {
      xml += stavesAttr + F.soundTempo(120)
    }
    if (breakEvery && m > 1 && (m - 1) % breakEvery === 0) {
      xml += '<print new-system="yes"/>'
    }
    xml += F.fourQuarters()
    xml += '</measure>'
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

function buildSyntheticTiming(spec) {
  if (spec.kind === 'repeats-voltas') {
    const xml = F.secondSectionVoltas().replace(
      '<measure number="3">',
      '<measure number="3"><print new-system="yes"/>',
    )
    return parseMusicXml(xml, 'repeats-voltas')
  }
  return buildPianoTimingMap(spec)
}

function buildSyntheticPages(pageSpecs) {
  const pages = []
  for (const spec of pageSpecs) {
    const builder = SYNTHETIC_PAGE_BUILDERS[spec.kind]
    if (!builder) {
      throw new Error(`Unknown synthetic page kind: ${spec.kind}`)
    }
    const { kind, ...options } = spec
    const result = builder(options)
    if (Array.isArray(result) && result[0]?.data) {
      pages.push(...result)
    } else {
      pages.push(result)
    }
  }
  return pages
}

function timingAssetFields(timingMap, timingPath, timingMeta) {
  const layoutHints = describeLayoutHints(timingMap)
  const timingSourceKind = classifyTimingSourceKind({
    runner: timingMeta.runner,
    timingPath,
    timingMeta,
  })
  return { timingSourceKind, layoutHints, timingMeta }
}

export function resolveSyntheticEntry(entry) {
  const pages = buildSyntheticPages(entry.synthetic.pages)
  const timingMap = buildSyntheticTiming(entry.synthetic.timing)
  const meta = { kind: TIMING_SOURCE_KIND.SYNTHETIC, runner: 'synthetic' }
  return {
    ok: true,
    timingMap,
    numPages: pages.length,
    renderPage: renderPagesFromArray(pages),
    pdfPath: null,
    musicxmlPath: 'synthetic',
    ...timingAssetFields(timingMap, 'synthetic', meta),
  }
}

export function resolveLocalEntry(entry, rootDir) {
  const pdfPath = join(rootDir, entry.assets.pdf)
  const musicxmlPath = join(rootDir, entry.assets.musicxml)
  const mxlPath = entry.assets.mxl ? join(rootDir, entry.assets.mxl) : null
  const skipIfMissing = entry.skipIfMissing ?? []

  for (const key of skipIfMissing) {
    const path =
      key === 'pdf' ? pdfPath : key === 'musicxml' ? musicxmlPath : key === 'mxl' ? mxlPath : null
    if (path && !existsSync(path)) {
      return { ok: false, skipReason: 'missing-assets', detail: `Missing ${key}: ${path}` }
    }
  }

  let timingPath = musicxmlPath
  let timingMeta = {
    kind: entry.timing?.kind ?? TIMING_SOURCE_KIND.REAL_MUSICXML,
    derivedFrom: 'explicit',
    runner: 'local',
    url: entry.timing?.musicxmlUrl ?? entry.assets.musicxml,
  }

  if (mxlPath && existsSync(mxlPath)) {
    timingPath = mxlPath
    timingMeta = {
      kind: TIMING_SOURCE_KIND.REAL_MXL,
      derivedFrom: 'explicit',
      runner: 'local',
      url: entry.timing?.mxlUrl ?? entry.assets.mxl,
    }
  } else if (!existsSync(musicxmlPath)) {
    return { ok: false, skipReason: 'missing-assets', detail: `Missing musicxml: ${musicxmlPath}` }
  }

  if (!existsSync(pdfPath)) {
    return { ok: false, skipReason: 'missing-assets', detail: `Missing pdf: ${pdfPath}` }
  }

  const timingMap = parseTimingFile(timingPath)

  return {
    ok: true,
    timingMap,
    pdfPath,
    musicxmlPath: timingPath,
    ...timingAssetFields(timingMap, timingPath, timingMeta),
    async loadRenderPage() {
      const { numPages, pages } = await renderPdfToPages(pdfPath, { rootDir })
      return { numPages, renderPage: makeRenderPageCallback(pages) }
    },
  }
}

export function cacheDirForEntry(entry, rootDir) {
  return join(rootDir, 'benchmarks', 'cache', entry.id)
}

async function downloadFile(url, destPath) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`)
  }
  writeFileSync(destPath, Buffer.from(await response.arrayBuffer()))
}

async function headOk(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

async function readMxlXmlFromPath(mxlPath) {
  const zip = await JSZip.loadAsync(readFileSync(mxlPath))
  const entries = Object.keys(zip.files).filter(
    (path) =>
      path.toLowerCase().endsWith('.xml') &&
      !path.startsWith('__MACOSX') &&
      !/META-INF\/container\.xml/i.test(path),
  )
  if (entries.length === 0) {
    throw new Error(`MXL archive has no MusicXML: ${mxlPath}`)
  }
  return zip.file(entries[0]).async('string')
}

function parseTimingFile(path) {
  if (path.toLowerCase().endsWith('.mxl')) {
    throw new Error('parseTimingFile: use parseTimingFileAsync for MXL')
  }
  return parseMusicXml(readFileSync(path, 'utf8'), path)
}

async function parseTimingFileAsync(path) {
  if (path.toLowerCase().endsWith('.mxl')) {
    const xml = await readMxlXmlFromPath(path)
    return parseMusicXml(xml, path)
  }
  return parseMusicXml(readFileSync(path, 'utf8'), path)
}

function writeTimingMeta(cacheDir, meta) {
  writeFileSync(join(cacheDir, 'timing-source.json'), `${JSON.stringify(meta, null, 2)}\n`)
}

function readTimingMeta(cacheDir) {
  const metaPath = join(cacheDir, 'timing-source.json')
  if (!existsSync(metaPath)) {
    return null
  }
  return JSON.parse(readFileSync(metaPath, 'utf8'))
}

export async function downloadMutopiaAssets(entry, rootDir) {
  const cacheDir = cacheDirForEntry(entry, rootDir)
  mkdirSync(cacheDir, { recursive: true })
  const pdfPath = join(cacheDir, 'score.pdf')
  const midiPath = join(cacheDir, 'score.mid')

  if (!existsSync(pdfPath)) {
    const response = await fetch(entry.mutopia.pdfUrl)
    if (!response.ok) {
      throw new Error(`PDF download failed (${response.status}): ${entry.mutopia.pdfUrl}`)
    }
    writeFileSync(pdfPath, Buffer.from(await response.arrayBuffer()))
  }

  if (entry.mutopia.midiUrl && !existsSync(midiPath)) {
    const response = await fetch(entry.mutopia.midiUrl)
    if (!response.ok) {
      throw new Error(`MIDI download failed (${response.status}): ${entry.mutopia.midiUrl}`)
    }
    writeFileSync(midiPath, Buffer.from(await response.arrayBuffer()))
  }

  return { pdfPath, midiPath, cacheDir }
}

function ensureMusicXmlFromMidi(midiPath, musicxmlPath) {
  if (!existsSync(venvPython)) {
    return {
      ok: false,
      detail:
        'Missing .venv-fixtures — run: python3 -m venv .venv-fixtures && .venv-fixtures/bin/pip install music21',
    }
  }

  const script = `
from music21 import converter
s = converter.parse(${JSON.stringify(midiPath)})
s.write('musicxml', ${JSON.stringify(musicxmlPath)})
`
  const result = spawnSync(venvPython, ['-c', script], { encoding: 'utf8' })
  if (result.status !== 0) {
    return {
      ok: false,
      detail: result.stderr?.trim() || result.stdout?.trim() || 'music21 MIDI conversion failed',
    }
  }
  if (!existsSync(musicxmlPath)) {
    return { ok: false, detail: `music21 did not write ${musicxmlPath}` }
  }
  return { ok: true }
}

/**
 * Resolve timing file: MXL / MusicXML URLs (manifest or Mutopia probe) before MIDI conversion.
 */
export async function resolveRemoteTiming(entry, cacheDir) {
  const urls = resolveMutopiaTimingUrls(entry)
  const mxlPath = join(cacheDir, 'score.mxl')
  const musicxmlPath = join(cacheDir, 'score.musicxml')
  const midiPath = join(cacheDir, 'score.mid')
  const existingMeta = readTimingMeta(cacheDir)

  const tryMxl = async (url, label) => {
    if (!existsSync(mxlPath)) {
      await downloadFile(url, mxlPath)
    }
    const timingMap = await parseTimingFileAsync(mxlPath)
    const meta = {
      kind: TIMING_SOURCE_KIND.REAL_MXL,
      derivedFrom: 'explicit',
      runner: 'remote',
      url,
      label,
      resolvedAt: new Date().toISOString(),
    }
    writeTimingMeta(cacheDir, meta)
    return { timingMap, timingPath: mxlPath, timingMeta: meta }
  }

  const tryMusicXml = async (url, label) => {
    if (!existsSync(musicxmlPath)) {
      await downloadFile(url, musicxmlPath)
    }
    const timingMap = await parseTimingFileAsync(musicxmlPath)
    const meta = {
      kind: TIMING_SOURCE_KIND.REAL_MUSICXML,
      derivedFrom: 'explicit',
      runner: 'remote',
      url,
      label,
      resolvedAt: new Date().toISOString(),
    }
    writeTimingMeta(cacheDir, meta)
    return { timingMap, timingPath: musicxmlPath, timingMeta: meta }
  }

  if (urls.mxlUrl) {
    return tryMxl(urls.mxlUrl, 'manifest-mxl')
  }
  if (urls.musicxmlUrl) {
    return tryMusicXml(urls.musicxmlUrl, 'manifest-musicxml')
  }

  for (const probeUrl of urls.probeUrls) {
    if (await headOk(probeUrl)) {
      if (probeUrl.endsWith('.mxl')) {
        return tryMxl(probeUrl, 'mutopia-probe-mxl')
      }
      return tryMusicXml(probeUrl, 'mutopia-probe-musicxml')
    }
  }

  if (existsSync(mxlPath) && existingMeta?.kind === TIMING_SOURCE_KIND.REAL_MXL) {
    const timingMap = await parseTimingFileAsync(mxlPath)
    return { timingMap, timingPath: mxlPath, timingMeta: existingMeta }
  }

  if (existsSync(musicxmlPath) && existingMeta?.derivedFrom === 'explicit') {
    const timingMap = await parseTimingFileAsync(musicxmlPath)
    return { timingMap, timingPath: musicxmlPath, timingMeta: existingMeta }
  }

  if (!existsSync(midiPath)) {
    return {
      ok: false,
      detail: 'Cached PDF without MIDI — cannot derive MusicXML timing',
    }
  }

  if (!existsSync(musicxmlPath)) {
    const converted = ensureMusicXmlFromMidi(midiPath, musicxmlPath)
    if (!converted.ok) {
      return { ok: false, detail: converted.detail }
    }
  }

  const timingMap = await parseTimingFileAsync(musicxmlPath)
  const meta = {
    kind: TIMING_SOURCE_KIND.MIDI_DERIVED_MUSICXML,
    derivedFrom: 'midi',
    runner: 'remote',
    url: urls.midiUrl,
    label: 'music21-midi-conversion',
    resolvedAt: new Date().toISOString(),
  }
  writeTimingMeta(cacheDir, meta)
  return { timingMap, timingPath: musicxmlPath, timingMeta: meta }
}

export async function resolveRemoteEntry(entry, rootDir, { download = false } = {}) {
  const cacheDir = cacheDirForEntry(entry, rootDir)
  const pdfPath = join(cacheDir, 'score.pdf')

  if (!existsSync(pdfPath)) {
    if (!download) {
      return {
        ok: false,
        skipReason: 'missing-assets',
        detail: `Remote assets not cached — run with --download (expected ${pdfPath})`,
      }
    }
    await downloadMutopiaAssets(entry, rootDir)
  }

  const timing = await resolveRemoteTiming(entry, cacheDir)
  if (timing.ok === false) {
    return { ok: false, skipReason: 'missing-assets', detail: timing.detail }
  }

  return {
    ok: true,
    timingMap: timing.timingMap,
    pdfPath,
    musicxmlPath: timing.timingPath,
    ...timingAssetFields(timing.timingMap, timing.timingPath, timing.timingMeta),
    async loadRenderPage() {
      const { numPages, pages } = await renderPdfToPages(pdfPath, { rootDir })
      return { numPages, renderPage: makeRenderPageCallback(pages) }
    },
  }
}

export async function resolveEntryAssets(entry, rootDir, options = {}) {
  if (entry.runner === 'synthetic') {
    return resolveSyntheticEntry(entry)
  }
  if (entry.runner === 'local') {
    const local = resolveLocalEntry(entry, rootDir)
    if (!local.ok) {
      return local
    }
    const loaded = await local.loadRenderPage()
    return {
      ok: true,
      timingMap: local.timingMap,
      pdfPath: local.pdfPath,
      musicxmlPath: local.musicxmlPath,
      timingSourceKind: local.timingSourceKind,
      layoutHints: local.layoutHints,
      timingMeta: local.timingMeta,
      numPages: loaded.numPages,
      renderPage: loaded.renderPage,
    }
  }
  if (entry.runner === 'remote') {
    const remote = await resolveRemoteEntry(entry, rootDir, options)
    if (!remote.ok) {
      return remote
    }
    const loaded = await remote.loadRenderPage()
    return {
      ok: true,
      timingMap: remote.timingMap,
      pdfPath: remote.pdfPath,
      musicxmlPath: remote.musicxmlPath,
      timingSourceKind: remote.timingSourceKind,
      layoutHints: remote.layoutHints,
      timingMeta: remote.timingMeta,
      numPages: loaded.numPages,
      renderPage: loaded.renderPage,
    }
  }
  return { ok: false, skipReason: 'missing-assets', detail: `Unknown runner: ${entry.runner}` }
}

export { TIMING_SOURCE_KIND, classifyTimingSourceKind, describeLayoutHints, resolveMutopiaTimingUrls }
