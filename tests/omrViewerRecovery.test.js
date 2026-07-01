import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('OMR viewer recovery', () => {
  const app = readSrc('App.jsx')
  const viewer = readSrc('components', 'PdfViewer.jsx')
  const libraryPanel = readSrc('components', 'LibraryPanel.jsx')
  const omrPanel = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')
  const scoreFollowControls = readSrc('components', 'pdf', 'ScoreFollowControls.jsx')

  it('clears generated OMR playback when a PDF replacement enters the library', () => {
    expect(app).toMatch(/clearOmrGeneratedPlaybackSource\(musicXmlSource\)/)
    expect(app).toMatch(/clearOmrGeneratedPlaybackSource\(loadedXml\)/)
    expect(app).toMatch(/setMusicXmlSource\(\(source\) => clearOmrGeneratedPlaybackSource\(source\)\)/)
  })

  it('waits for App validation before marking generated playback ready', () => {
    expect(app).toMatch(/return \{ ok: false, message: playbackValidation\.message \}/)
    expect(app).toMatch(/return \{\s*ok: true,[\s\S]*durationSeconds: playbackValidation\.durationSeconds/)
    expect(omrPanel).toMatch(/const accepted = await onGenerated/)
    expect(omrPanel).toMatch(/accepted\?\.ok === false/)
  })

  it('remounts the library PDF viewer with a runtime revision after OMR cleanup', () => {
    expect(app).toMatch(/pdfViewerRevision/)
    expect(app).toMatch(/setPdfViewerRevision\(\(revision\) => revision \+ 1\)/)
    expect(app).toMatch(/key=\{`library-pdf-\$\{pdfViewerRevision\}-\$\{pdfFile \?\? 'empty'\}`\}/)
  })

  it('keeps App in charge of old PDF blob URL revocation during refreshes', () => {
    expect(app).toMatch(/refreshOwnedPdfFromBlobUrl\(pdfFile, \{ revokePrevious: false \}\)/)
  })

  it('shows and logs PDF load failures instead of leaving a blank viewer', () => {
    expect(viewer).toMatch(/documentError/)
    expect(viewer).toMatch(/pdf-document-load-error/)
    expect(viewer).toMatch(/role="alert"/)
    expect(viewer).toMatch(/key=\{documentKey\}/)
  })

  it('resets stale OMR panel state when a different PDF source is loaded', () => {
    expect(libraryPanel).toMatch(
      /key=\{`omr-panel-\$\{fileName \?\? 'score'\}-\$\{pdfFileUrl \?\? 'no-url'\}`\}/,
    )
    expect(libraryPanel).toMatch(/shouldShowLibraryOmrPanel/)
    expect(libraryPanel).toMatch(/isLibraryScoreTimingReady\(musicXmlSource\)/)
  })

  it('keeps non-abort OMR panel failures visible', () => {
    expect(omrPanel).toMatch(/let resetInFinally = true/)
    expect(omrPanel).toMatch(/resetInFinally = false[\s\S]*setStatus\(OMR_STATUS\.FAILED\)/)
    expect(omrPanel).toMatch(/resetInFinally && activeRunRef\.current === runId/)
  })

  it('labels generated PDF playback as experimental and exposes cursor retry', () => {
    expect(omrPanel).toContain(
      'Experimental PDF playback may be inaccurate. For accurate playback, upload a timing file.',
    )
    expect(scoreFollowControls).toContain(
      'Experimental PDF playback may be inaccurate. For accurate playback, upload a timing file.',
    )
    expect(scoreFollowControls).toMatch(/omrScoreFollowUnavailable/)
    expect(scoreFollowControls).toMatch(/Retry cursor setup/)
    expect(scoreFollowControls).not.toMatch(/OMR is accurate/i)
  })
})
