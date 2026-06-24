/**
 * Asset resolution for alignment corpus benchmark runners.
 * Script-only — imports test helpers for synthetic fixtures.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
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

export function resolveSyntheticEntry(entry) {
  const pages = buildSyntheticPages(entry.synthetic.pages)
  const timingMap = buildSyntheticTiming(entry.synthetic.timing)
  return {
    ok: true,
    timingMap,
    numPages: pages.length,
    renderPage: renderPagesFromArray(pages),
    pdfPath: null,
    musicxmlPath: 'synthetic',
  }
}

export function resolveLocalEntry(entry, rootDir) {
  const pdfPath = join(rootDir, entry.assets.pdf)
  const musicxmlPath = join(rootDir, entry.assets.musicxml)
  const skipIfMissing = entry.skipIfMissing ?? []

  for (const key of skipIfMissing) {
    const path = key === 'pdf' ? pdfPath : key === 'musicxml' ? musicxmlPath : null
    if (path && !existsSync(path)) {
      return { ok: false, skipReason: 'missing-assets', detail: `Missing ${key}: ${path}` }
    }
  }

  if (!existsSync(musicxmlPath)) {
    return { ok: false, skipReason: 'missing-assets', detail: `Missing musicxml: ${musicxmlPath}` }
  }

  if (!existsSync(pdfPath)) {
    return { ok: false, skipReason: 'missing-assets', detail: `Missing pdf: ${pdfPath}` }
  }

  const timingMap = parseMusicXml(readFileSync(musicxmlPath, 'utf8'), musicxmlPath)

  return {
    ok: true,
    timingMap,
    pdfPath,
    musicxmlPath,
    async loadRenderPage() {
      const { numPages, pages } = await renderPdfToPages(pdfPath, { rootDir })
      return { numPages, renderPage: makeRenderPageCallback(pages) }
    },
  }
}

export function cacheDirForEntry(entry, rootDir) {
  return join(rootDir, 'benchmarks', 'cache', entry.id)
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

export async function resolveRemoteEntry(entry, rootDir, { download = false } = {}) {
  const cacheDir = cacheDirForEntry(entry, rootDir)
  const pdfPath = join(cacheDir, 'score.pdf')
  const musicxmlPath = join(cacheDir, 'score.musicxml')

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

  if (existsSync(musicxmlPath)) {
    const timingMap = parseMusicXml(readFileSync(musicxmlPath, 'utf8'), musicxmlPath)
    return {
      ok: true,
      timingMap,
      pdfPath,
      musicxmlPath,
      async loadRenderPage() {
        const { numPages, pages } = await renderPdfToPages(pdfPath, { rootDir })
        return { numPages, renderPage: makeRenderPageCallback(pages) }
      },
    }
  }

  return {
    ok: false,
    skipReason: 'missing-assets',
    detail: 'Cached PDF without MusicXML — convert MIDI to MusicXML offline before benchmarking',
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
      numPages: loaded.numPages,
      renderPage: loaded.renderPage,
    }
  }
  return { ok: false, skipReason: 'missing-assets', detail: `Unknown runner: ${entry.runner}` }
}
