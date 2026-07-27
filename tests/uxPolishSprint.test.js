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
    expect(app).toMatch(/if \(view === 'library'\) \{[\s\S]*setSidebarOpen\(true\)/)
  })

  it('offers a Demo Piece from the no-score Practice empty state', () => {
    const app = readSrc('App.jsx')
    const placeholder = readSrc('components', 'AppViewPlaceholder.jsx')

    expect(app).toContain('Open the demo piece to start now, or add your own sheet music and timing file in Library.')
    expect(app).toContain('No piece open yet')
    expect(app).toContain("secondaryActionLabel=")
    expect(app).toContain('Add My Sheet Music')
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
    expect(welcome).toContain('sheet music and timing file')
    expect(library).toContain('Start practicing')
    expect(library).toContain('Upload one file at a time')
    expect(upload).toContain('Add your files')
    expect(upload).toContain('Corranzo sets it up automatically; timing and MIDI are optional.')
    expect(demo).toContain('No files needed')
    expect(demo).toContain('Try Demo Piece')
  })

  it('keeps advanced Practice copy optional and success/loading states polished', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    const omrPanel = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')
    const appCss = readSrc('App.css')

    expect(panel).toContain('summary="Files, playback, cursor"')
    expect(panel).toContain('aria-label="Files"')
    expect(panel).toContain('aria-label="Playback options"')
    expect(panel).toContain('aria-label="Score cursor"')
    expect(panel).toContain('aria-label="Help"')
    expect(panel).toContain('Keyboard shortcuts')
    expect(panel).toContain('practice-shortcuts__summary')
    expect(panel).not.toContain('aria-label="Practice setup"')
    expect(panel).not.toMatch(/Press Play \(Space\)/)
    expect(panel).toMatch(/title="Diagnostics"[\s\S]*defaultOpen=\{false\}/)
    expect(panel).toMatch(/setupStatus\?\.phase === 'failed'/)
    expect(panel).not.toMatch(/openSetupByDefault = needsScoreFollowSetup/)
    expect(omrPanel).toContain('aria-busy={isGenerating}')
    expect(omrPanel).toContain('Ready to practice')
    expect(appCss).toContain('.library-omr-panel__progress-bar')
    expect(appCss).toContain('.app-view-placeholder__secondary')
    expect(appCss).toMatch(/@media \(max-width: 900px\)[\s\S]*\.topbar__actions[\s\S]*min-width: 0/)
  })
})
