import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  TIMING_SOURCE_KIND,
  classifyTimingSourceKind,
  describeLayoutHints,
  inferMutopiaBaseUrl,
  resolveMutopiaTimingUrls,
} from '../src/features/score-follow/benchmarkTimingSource.js'
import { assessSourceAlignment } from '../src/features/score-follow/calibrationWorkflow.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'
import { resolveRemoteTiming } from '../scripts/lib/benchmarkCorpusRunners.mjs'

describe('benchmarkTimingSource', () => {
  it('infers Mutopia base URL from PDF path', () => {
    const pdf =
      'https://www.mutopiaproject.org/ftp/BeethovenLv/FurElise/FurElise-a4.pdf'
    expect(inferMutopiaBaseUrl(pdf)).toBe(
      'https://www.mutopiaproject.org/ftp/BeethovenLv/FurElise/FurElise',
    )
  })

  it('prefers manifest MusicXML/MXL URLs over probe paths', () => {
    const entry = {
      mutopia: {
        pdfUrl: 'https://example.org/piece/Piece-a4.pdf',
        midiUrl: 'https://example.org/piece/Piece.mid',
        mxlUrl: 'https://example.org/piece/Piece.mxl',
      },
      timing: { musicxmlUrl: 'https://example.org/piece/Piece.musicxml' },
    }
    const urls = resolveMutopiaTimingUrls(entry)
    expect(urls.mxlUrl).toBe('https://example.org/piece/Piece.mxl')
    expect(urls.musicxmlUrl).toBe('https://example.org/piece/Piece.musicxml')
    expect(urls.probeUrls).toEqual([])
  })

  it('classifies timing source kinds', () => {
    expect(classifyTimingSourceKind({ runner: 'synthetic' })).toBe(
      TIMING_SOURCE_KIND.SYNTHETIC,
    )
    expect(
      classifyTimingSourceKind({
        runner: 'local',
        timingPath: '/fixtures/demo.musicxml',
        timingMeta: { derivedFrom: 'explicit' },
      }),
    ).toBe(TIMING_SOURCE_KIND.REAL_MUSICXML)
    expect(
      classifyTimingSourceKind({
        runner: 'remote',
        timingPath: '/cache/score.mxl',
        timingMeta: { kind: TIMING_SOURCE_KIND.REAL_MXL },
      }),
    ).toBe(TIMING_SOURCE_KIND.REAL_MXL)
    expect(
      classifyTimingSourceKind({
        runner: 'remote',
        timingPath: '/cache/score.musicxml',
        timingMeta: { derivedFrom: 'midi' },
      }),
    ).toBe(TIMING_SOURCE_KIND.MIDI_DERIVED_MUSICXML)
  })

  it('describes layout hints from parsed timing map', () => {
    let xml = ''
    for (let m = 1; m <= 8; m += 1) {
      xml += `<measure number="${m}">`
      if (m === 1) {
        xml += F.attributes() + F.soundTempo(120)
      }
      if (m === 5) {
        xml += '<print new-system="yes"/>'
      }
      xml += F.fourQuarters()
      xml += '</measure>'
    }
    const timingMap = parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
    const hints = describeLayoutHints(timingMap)
    expect(hints.systemBreaks).toBe(1)
    expect(hints.hasLayoutHints).toBe(true)
  })

  it('does not flag midi-derived layout missing for declared real MusicXML', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(`<part id="P1">${Array.from({ length: 12 }, (_, i) => {
        const m = i + 1
        return `<measure number="${m}">${m === 1 ? F.attributes() + F.soundTempo(120) : ''}${F.fourQuarters()}</measure>`
      }).join('')}</part>`),
    )
    const entries = Array.from({ length: 3 }, (_, systemIndex) => ({
      system: { measureEstimate: 4 },
    }))

    const inferred = assessSourceAlignment({ timingMap, systemEntries: entries, pdfPageCount: 1 })
    expect(inferred.midiDerivedLayoutMissing).toBe(true)

    const declared = assessSourceAlignment({
      timingMap,
      systemEntries: entries,
      pdfPageCount: 1,
      timingSourceKind: TIMING_SOURCE_KIND.REAL_MUSICXML,
      layoutHints: describeLayoutHints(timingMap),
    })
    expect(declared.midiDerivedLayoutMissing).toBe(false)
    expect(declared.indicators).not.toContain('midi-derived-layout-missing')
  })
})

describe('benchmarkCorpusRunners remote timing preference', () => {
  let cacheDir

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'sf-bench-'))
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'score.mid'), 'MThd')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads manifest MXL before falling back to MIDI conversion', async () => {
    const mxlXml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${F.fourQuarters()}</measure></part>`,
    )
    const fetchMock = vi.fn(async (url, init) => {
      if (init?.method === 'HEAD') {
        return { ok: url.endsWith('.mxl') }
      }
      if (url.endsWith('.mxl')) {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        zip.file('score.xml', mxlXml)
        const buffer = await zip.generateAsync({ type: 'nodebuffer' })
        return { ok: true, arrayBuffer: async () => buffer }
      }
      return { ok: false, status: 404 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const entry = {
      id: 'test-mxl',
      mutopia: {
        pdfUrl: 'https://example.org/piece/Piece-a4.pdf',
        midiUrl: 'https://example.org/piece/Piece.mid',
        mxlUrl: 'https://example.org/piece/Piece.mxl',
      },
    }

    const result = await resolveRemoteTiming(entry, cacheDir)
    expect(result.timingMeta.kind).toBe(TIMING_SOURCE_KIND.REAL_MXL)
    expect(result.timingMeta.derivedFrom).toBe('explicit')
    expect(fetchMock).toHaveBeenCalledWith('https://example.org/piece/Piece.mxl')
  })

  it('falls back to MIDI-derived MusicXML when no MXL/MusicXML exists', async () => {
    vi.stubGlobal('fetch', async (url, init) => {
      if (init?.method === 'HEAD') {
        return { ok: false, status: 404 }
      }
      return { ok: false, status: 404 }
    })

    const entry = {
      id: 'test-midi',
      mutopia: {
        pdfUrl: 'https://example.org/piece/Piece-a4.pdf',
        midiUrl: 'https://example.org/piece/Piece.mid',
      },
    }

    const converted = await resolveRemoteTiming(entry, cacheDir)
    if (converted.ok === false) {
      expect(converted.detail).toMatch(/venv-fixtures|music21/)
      return
    }
    expect(converted.timingMeta.kind).toBe(TIMING_SOURCE_KIND.MIDI_DERIVED_MUSICXML)
    expect(converted.timingMeta.derivedFrom).toBe('midi')
  })
})
