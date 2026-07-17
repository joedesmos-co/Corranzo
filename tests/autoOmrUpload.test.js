import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('auto OMR on PDF upload', () => {
  const app = readSrc('App.jsx')
  const library = readSrc('components', 'LibraryPanel.jsx')
  const omrPanel = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')

  it('queues local OMR automatically for PDF-only uploads', () => {
    expect(app).toContain('function buildAutoOmrRequest(file, instrumentId)')
    expect(app).toMatch(
      /handleFileSelect[\s\S]*setAutoOmrRequest\(buildAutoOmrRequest\(file, activeInstrumentRef\.current\)\)/,
    )
    expect(app).toContain('Setting up your music...')
    expect(app).not.toContain('Getting your music ready...')
  })

  it('skips auto OMR when uploaded MusicXML timing is present or later replaces generated timing', () => {
    expect(app).toMatch(
      /handleMusicXmlSelect[\s\S]*source: 'upload'[\s\S]*setAutoOmrRequest\(null\)/,
    )
    expect(app).toMatch(
      /if \(classified\.pdf\[0\]\) \{[\s\S]*if \(loadedXml\?\.data\) \{[\s\S]*setAutoOmrRequest\(null\)[\s\S]*\} else \{[\s\S]*setAutoOmrRequest\(buildAutoOmrRequest\(classified\.pdf\[0\], activeInstrumentRef\.current\)\)/,
    )
  })

  it('keeps stale OMR worker results from applying to the wrong PDF or instrument', () => {
    expect(app).toContain('sourcePdfFileName = null')
    expect(app).toContain('sourcePdfFileUrl = null')
    expect(app).toContain('sourceInstrumentId = null')
    expect(app).toContain('const currentBundle = liveBundleRef.current ?? {}')
    expect(app).toMatch(/generatedInstrument !== currentInstrument[\s\S]*return \{ ok: false, message \}/)
    expect(app).toMatch(/sourcePdfFileUrl && currentBundle\.pdfFile && sourcePdfFileUrl !== currentBundle\.pdfFile/)
    expect(app).toMatch(/sourcePdfFileName && currentBundle\.pdfMeta\?\.fileName && sourcePdfFileName !== currentBundle\.pdfMeta\.fileName/)
  })

  it('opens Practice only after App accepts the generated MusicXML', () => {
    expect(app).toMatch(
      /setMusicXmlSource\(nextMusicXmlSource\)[\s\S]*setAutoOmrRequest\(null\)[\s\S]*navigateToView\('practice'\)/,
    )
    expect(app).toContain("activeView: 'practice'")
    expect(app).toContain('Ready to practice')
  })

  it('lets the OMR panel consume one auto-start request while preserving manual retry', () => {
    expect(omrPanel).toContain('autoStartKey = null')
    expect(omrPanel).toContain('autoStartedKeyRef')
    expect(omrPanel).toMatch(/onAutoStartConsumed\?\.\(autoStartKey\)[\s\S]*handleGenerate\(\)/)
    expect(omrPanel).toMatch(/disabled=\{disabled \|\| isGenerating \|\| !pdfBytesAvailable\}/)
    expect(omrPanel).toContain('Try again')
  })

  it('scopes auto-start requests to the visible PDF and active instrument', () => {
    expect(library).toMatch(/autoOmrRequest\?\.instrumentId === instrumentId/)
    expect(library).toMatch(/autoOmrRequest\?\.pdfFileName === fileName/)
    expect(library).toMatch(/autoStartKey=\{autoOmrRequestForCurrentPdf\?\.key \?\? null\}/)
    expect(app).toContain('autoOmrRequest={autoOmrRequest}')
    expect(app).toContain('onAutoOmrRequestConsumed={() => setAutoOmrRequest(null)}')
  })
})
