import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('Corranzo UX polish sprint', () => {
  it('reopens the Library setup rail when users navigate back to Library', () => {
    const app = readSrc('App.jsx')

    expect(app).toMatch(/setSidebarOpen\(true\)[\s\S]*navigateToView\(home\.view\)/)
    expect(app).toMatch(/meta\?\.blocked[\s\S]*setSidebarOpen\(true\)[\s\S]*navigateToView\('library'\)/)
    expect(app).toMatch(/if \(view === 'library'\) \{[\s\S]*setSidebarOpen\(true\)/)
  })

  it('offers a Demo Piece from the no-score Practice empty state', () => {
    const app = readSrc('App.jsx')
    const placeholder = readSrc('components', 'AppViewPlaceholder.jsx')

    expect(app).toContain('Start with the demo piece')
    expect(app).toContain("secondaryActionLabel=")
    expect(app).toContain('Try Demo Piece')
    expect(app).toContain('handleLoadSampleFixtures')
    expect(placeholder).toContain('secondaryActionLabel')
    expect(placeholder).toContain('app-view-placeholder__secondary')
  })

  it('uses beginner-friendly Library and upload language', () => {
    const welcome = readSrc('components', 'LibraryWelcomeCard.jsx')
    const library = readSrc('components', 'LibraryPanel.jsx')
    const upload = readSrc('components', 'MultiFileUpload.jsx')
    const demo = readSrc('components', 'DemoPieceCard.jsx')

    expect(welcome).toMatch(/Try the[\s\S]*demo first/)
    expect(welcome).toContain('PDF + MusicXML/MXL')
    expect(library).toContain('Start practicing')
    expect(library).toContain('Upload one file at a time')
    expect(upload).toContain('Add your files')
    expect(upload).toContain('Timing:')
    expect(demo).toContain('No files needed')
    expect(demo).toContain('Try Demo Piece')
  })

  it('keeps advanced Practice copy optional and success/loading states polished', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    const omrPanel = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')
    const appCss = readSrc('App.css')

    expect(panel).toContain('summary="Optional settings"')
    expect(omrPanel).toContain('aria-busy={isGenerating}')
    expect(omrPanel).toContain('PDF playback ready')
    expect(appCss).toContain('.library-omr-panel__progress-bar')
    expect(appCss).toContain('.app-view-placeholder__secondary')
    expect(appCss).toMatch(/@media \(max-width: 900px\)[\s\S]*\.topbar__feedback[\s\S]*display: none/)
  })
})
