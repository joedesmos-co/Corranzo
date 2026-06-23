/**
 * Regression tests for the post-demo Library layout polish.
 *
 * UI/CSS-only fixes — none of these touch score-follow, PDF alignment, the
 * cursor, MIDI/playback, mic detection, upload parsing, or practice stats.
 *
 *  1. Clicking "Try demo" collapses the Library sidebar (the upload/demo panel
 *     is no longer useful once a piece is loaded).
 *  2/3/4. With the sidebar closed, the score column fills the available width so
 *     the PDF preview and its toolbar center, instead of being pushed off to one
 *     side by a reserved empty column (which read as "half black / half blue").
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

function readSrc(...parts) {
  return readFileSync(join(__dir, '..', 'src', ...parts), 'utf8')
}

describe('Fix 1: Try demo collapses the Library sidebar', () => {
  const appSrc = readSrc('App.jsx')

  it('App.jsx pulls setSidebarOpen out of useWorkspacePreferences', () => {
    expect(appSrc).toMatch(/setSidebarOpen/)
    // It must be exposed by the workspace-preferences hook.
    const hookSrc = readSrc('hooks', 'useWorkspacePreferences.js')
    expect(hookSrc).toMatch(/setSidebarOpen/)
  })

  it('the demo loader collapses the sidebar via setSidebarOpen(false)', () => {
    const loader = appSrc.match(
      /handleLoadSampleFixtures\s*=\s*useCallback\(([\s\S]*?)\n {2}\}, \[/,
    )?.[1]
    expect(loader, 'handleLoadSampleFixtures callback body').toBeTruthy()
    expect(loader).toMatch(/setSidebarOpen\(\s*false\s*\)/)
  })
})

describe('Fix 2-4: closed-sidebar layout centers the PDF preview', () => {
  const css = readFileSync(join(__dir, '..', 'src', 'App.css'), 'utf8')

  it('no longer reserves a fixed 300px right-hand column when the sidebar is hidden', () => {
    // The old ::after reserve is what pushed the preview off-center and left the
    // empty two-tone strip. It must be gone.
    expect(css).not.toMatch(/\.main-layout--sidebar-hidden::after\s*\{/)
    const hiddenBlocks = css.match(/\.main-layout--sidebar-hidden[^{]*\{[^}]*\}/g) ?? []
    for (const block of hiddenBlocks) {
      expect(block).not.toMatch(/300px/)
    }
  })

  it('still collapses the panel to width:0 so it stays reopenable via the toggle', () => {
    const panelBlock = css.match(
      /\.main-layout--sidebar-hidden \.library-panel\s*\{([^}]*)\}/,
    )?.[1]
    expect(panelBlock).toBeTruthy()
    expect(panelBlock).toMatch(/width\s*:\s*0/)
  })

  it('keeps the PDF page centered inside the canvas', () => {
    const canvasBlock = css.match(/^\.pdf-canvas\s*\{([^}]*)\}/m)?.[1] ?? ''
    expect(canvasBlock).toMatch(/justify-content\s*:\s*center/)
  })
})
