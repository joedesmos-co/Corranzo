import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('Corranzo UX polish sprint', () => {
  it('opens a real empty Practice state when Practice is selected without files', () => {
    const app = readSrc('App.jsx')

    expect(app).toMatch(/setSidebarOpen\(true\)[\s\S]*navigateToView\(home\.view\)/)
    expect(app).toMatch(/meta\?\.emptyPractice[\s\S]*setSidebarOpen\(false\)[\s\S]*navigateToView\('practice'\)/)
    // The no-score Practice state is a real placeholder with a route back to Import.
    expect(app).toMatch(/!sessionFilesReady\) return <AppViewPlaceholder[\s\S]*actionLabel=\{pdfFile \? 'Continue import' : 'Import a score'\}/)
    expect(app).toMatch(/Your next piece starts here/)
  })

  it('offers a Demo Piece from the no-score Practice empty state', () => {
    const app = readSrc('App.jsx')
    const placeholder = readSrc('components', 'AppViewPlaceholder.jsx')
    const home = readSrc('components', 'home', 'Home.jsx')

    // The collection is reachable from the empty Practice state and from Home.
    expect(app).toContain('secondaryActionLabel="Explore library"')
    expect(app).toContain("onSecondaryAction={() => navigateToView('library')}")
    expect(app).toContain('handleLoadSampleFixtures')
    expect(home).toContain('onLoadPiece')
    expect(home).toContain('Start with something small.')
    expect(placeholder).toContain('secondaryActionLabel')
    expect(placeholder).toContain('app-view-placeholder__secondary')
  })

  it('uses beginner-friendly Library and upload language', () => {
    const library = readSrc('components', 'LibraryPanel.jsx')
    const upload = readSrc('components', 'MultiFileUpload.jsx')

    expect(library).toContain('Open score')
    expect(library).toContain('Import a score')
    expect(library).toContain('Public-domain scores')
    expect(upload).toContain('Import a score')
    expect(upload).toContain('Choose a PDF, or drop it here.')
    // The old "one file at a time" restriction no longer applies.
    expect(upload).not.toContain('Upload one file at a time')
  })

  it('keeps advanced Practice copy optional and success/loading states polished', () => {
    const tools = readSrc('components', 'practice', 'WorkspaceTools.jsx')
    const transport = readSrc('components', 'practice', 'WorkspaceTransport.jsx')
    const omrPanel = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')
    const importView = readSrc('components', 'library', 'ImportScoreView.jsx')
    const appCss = readSrc('App.css')

    // Advanced settings, shortcuts and reporting stay behind workspace tools.
    expect(tools).toContain('Advanced practice & score setup')
    expect(tools).toContain('Keyboard shortcuts')
    expect(tools).toContain('Report a score problem')
    expect(tools).not.toContain('aria-label="Practice setup"')
    expect(tools).not.toMatch(/Press Play \(Space\)/)
    expect(tools).toMatch(/<summary>Advanced practice & score setup<\/summary>/)
    expect(transport).toMatch(/setupStatus\?\.phase|workspaceStatus/)
    // Preparation is busy and announces progress honestly.
    expect(omrPanel).toContain('data-busy={showPreparing}')
    expect(omrPanel).toContain('aria-live="polite"')
    expect(omrPanel).toContain('Preparation stages')
    expect(importView).toContain('Your score is ready')
    expect(importView).toContain('role="radiogroup"')
    expect(appCss).toContain('.app-view-placeholder__secondary')
    expect(appCss).toMatch(/@media \(max-width: 900px\)[\s\S]*\.topbar__actions[\s\S]*min-width: 0/)
  })
})
