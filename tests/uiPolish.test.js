/**
 * UI polish regressions — fullscreen chrome, sidebar toggle, PDF navigation.
 * CSS/structure only; no score-follow, playback, or practice logic.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('fullscreen chrome auto-hide', () => {
  const fullscreen = readSrc('components', 'pdf', 'PdfFullscreen.jsx')

  it('does not reveal chrome on every pointer move over the score', () => {
    expect(fullscreen).not.toMatch(/onPointerMove=\{handleActivity\}/)
    expect(fullscreen).not.toMatch(/onPointerDown=\{handleActivity\}/)
  })

  it('reveals chrome only from targeted edge zones when hidden', () => {
    expect(fullscreen).toMatch(/pdf-fullscreen__chrome-zone--top/)
    expect(fullscreen).toMatch(/pdf-fullscreen__chrome-zone--bottom/)
    expect(fullscreen).toMatch(/!chromeVisible/)
  })

  it('keeps keyboard page navigation without calling notifyActivity on keydown', () => {
    expect(fullscreen).toMatch(/ArrowLeft/)
    expect(fullscreen).not.toMatch(/notifyActivity\(\)\s*\n\s*if \(!allowNavigationZones\)/)
  })
})

describe('library sidebar reopen toggle', () => {
  const viewer = readSrc('components', 'PdfViewer.jsx')
  const css = readFileSync(join(root, 'src', 'App.css'), 'utf8')

  it('adds a stronger expand state when the sidebar is collapsed', () => {
    expect(viewer).toMatch(/sidebar-toggle--expand/)
    expect(css).toMatch(/\.sidebar-toggle--expand\s*\{/)
  })
})

describe('PDF page navigation responsiveness', () => {
  const viewer = readSrc('components', 'PdfViewer.jsx')
  const css = readFileSync(join(root, 'src', 'App.css'), 'utf8')
  const pageWindow = readSrc('components', 'pdf', 'PdfPageWindow.jsx')

  it('virtualizes previous, current, and next pages inside the Document', () => {
    expect(viewer).toMatch(/PdfPageWindow/)
    expect(pageWindow).toMatch(/pageNumber - 1/)
    expect(pageWindow).toMatch(/pageNumber \+ 1/)
    expect(pageWindow).toMatch(/pdf-slot-\$\{slotPage\}/)
  })

  it('keeps stable per-page slot keys instead of remounting on every page change', () => {
    expect(pageWindow).toMatch(/key=\{`pdf-slot-\$\{slotPage\}`\}/)
    expect(viewer).not.toMatch(/key=\{`\$\{file\}-\$\{pageNumber\}`\}/)
  })

  it('instruments page switch and rasterization timing', () => {
    expect(viewer).toMatch(/pdfPagePerf/)
    const perf = readSrc('features', 'pdf', 'pdfPagePerf.js')
    expect(perf).toMatch(/completePageSwitch/)
    expect(perf).toMatch(/notePageRender/)
  })

  it('drops the page-turn animation that delayed perceived navigation', () => {
    expect(viewer).not.toMatch(/pageTurnActive/)
    expect(css).not.toMatch(/pdf-page-turn-in/)
    expect(css).not.toMatch(/pdf-canvas--page-turn/)
  })
})

describe('demo card persistence', () => {
  const app = readSrc('App.jsx')
  const storage = readSrc('features', 'session', 'practicePrefsStorage.js')

  it('persists demo-card hide in localStorage', () => {
    expect(storage).toMatch(/isDemoCardHidden/)
    expect(storage).toMatch(/hideDemoCard/)
    expect(storage).toMatch(/DEMO_CARD_KEY/)
  })

  it('hides the library demo card after Try demo or user uploads', () => {
    expect(app).toMatch(/markDemoCardHidden/)
    expect(app).toMatch(/showDemo=\{!demoCardHidden/)
    expect(app).not.toMatch(/showDemo=\{!showWelcome\}/)
    expect(app).toMatch(/handleLoadSampleFixtures[\s\S]*markDemoCardHidden\(\)/)
    expect(app).toMatch(/handleFileSelect[\s\S]*markDemoCardHidden\(\)/)
  })
})
