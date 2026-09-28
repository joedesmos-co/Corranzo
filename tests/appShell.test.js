import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SIDEBAR_DRAWER_MAX_WIDTH,
  SIDEBAR_MODE,
  SIDEBAR_RAIL_MAX_WIDTH,
  normalizeSidebarExpanded,
  resolveSidebarMode,
} from '../src/features/navigation/sidebarLayout.js'
import { APP_SHELL_VIEWS, normalizeAppView } from '../src/features/navigation/appViewDebug.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

describe('sidebar layout resolution', () => {
  it('honors the persisted preference on wide screens', () => {
    expect(resolveSidebarMode({ width: 1440, expanded: true })).toBe(SIDEBAR_MODE.EXPANDED)
    expect(resolveSidebarMode({ width: 1440, expanded: false })).toBe(SIDEBAR_MODE.RAIL)
    expect(resolveSidebarMode({ width: 1920, expanded: true })).toBe(SIDEBAR_MODE.EXPANDED)
  })

  it('forces the rail at medium widths without consuming the preference', () => {
    expect(resolveSidebarMode({ width: SIDEBAR_RAIL_MAX_WIDTH, expanded: true })).toBe(
      SIDEBAR_MODE.RAIL,
    )
    expect(resolveSidebarMode({ width: 900, expanded: true })).toBe(SIDEBAR_MODE.RAIL)
    expect(resolveSidebarMode({ width: SIDEBAR_RAIL_MAX_WIDTH + 1, expanded: true })).toBe(
      SIDEBAR_MODE.EXPANDED,
    )
  })

  it('uses an ephemeral drawer on narrow screens', () => {
    expect(resolveSidebarMode({ width: SIDEBAR_DRAWER_MAX_WIDTH, expanded: true })).toBe(
      SIDEBAR_MODE.DRAWER,
    )
    expect(resolveSidebarMode({ width: 700, expanded: false })).toBe(SIDEBAR_MODE.DRAWER)
    expect(resolveSidebarMode({ width: SIDEBAR_DRAWER_MAX_WIDTH + 1, expanded: true })).toBe(
      SIDEBAR_MODE.RAIL,
    )
  })

  it('defaults safely on unexpected input', () => {
    expect(resolveSidebarMode({ width: NaN, expanded: true })).toBe(SIDEBAR_MODE.EXPANDED)
    expect(resolveSidebarMode({ width: undefined, expanded: false })).toBe(SIDEBAR_MODE.RAIL)
    expect(normalizeSidebarExpanded(undefined)).toBe(true)
    expect(normalizeSidebarExpanded(false)).toBe(false)
  })
})

describe('shell navigation model', () => {
  it('registers the Phase B views while preserving legacy ones', () => {
    for (const view of ['home', 'library', 'import', 'practice', 'profile', 'settings']) {
      expect(APP_SHELL_VIEWS.has(view), view).toBe(true)
    }
    expect(normalizeAppView('home')).toBe('home')
    expect(normalizeAppView('import')).toBe('import')
    expect(normalizeAppView('settings')).toBe('settings')
    expect(normalizeAppView('not-a-view')).toBe('library')
  })

  it('sidebar exposes exactly the five primary destinations plus real history', () => {
    const sidebar = stripComments(readSrc('components', 'shell', 'Sidebar.jsx'))
    for (const label of ['Home', 'Library', 'Import', 'Practice', 'Settings']) {
      expect(sidebar).toContain(`label: '${label}'`)
    }
    expect(sidebar).toContain("label: 'History'")
    expect(sidebar).toContain('aria-current')
    // Future areas stay unexposed — never fake navigation.
    expect(sidebar).not.toMatch(/label: 'Learn'/)
    expect(sidebar).not.toMatch(/transcri/i)
    // Tour + QA compatibility: Practice keeps its exact name and legacy anchor.
    expect(sidebar).toContain("label: 'Practice'")
    expect(sidebar).toContain('topbar-practice')
    // Collapsed rail stays labeled via tooltip hooks.
    expect(sidebar).toContain('data-label')
    // Preference-owned collapse, not local state.
    expect(sidebar).toContain('onToggleExpanded')
  })

  it('header stays quiet: no score or playback controls in global chrome', () => {
    const header = stripComments(readSrc('components', 'shell', 'ShellHeader.jsx'))
    expect(header).not.toMatch(/tempo/i)
    expect(header).not.toMatch(/metronome/i)
    expect(header).not.toMatch(/playback/i)
    expect(header).not.toMatch(/loop/i)
    expect(header).toContain('aria-expanded')
    expect(header).toContain('aria-controls')
    expect(header).toContain('onGoHome')
    expect(header).toContain('Import')
    expect(header).toContain('InstrumentSelector')
    expect(header).toContain('Replay tutorial')
    expect(header).toContain('How files work')
  })

  it('settings surfaces existing preferences only — no invented features', () => {
    const settings = readSrc('components', 'shell', 'SettingsView.jsx')
    expect(settings).toContain('SegmentedControl')
    expect(settings).toContain('onPaperThemeChange')
    expect(settings).toContain('onSidebarExpandedChange')
    expect(settings).toContain('onClearSavedSession')
    expect(settings).toContain("onNavigate('profile')")
    expect(settings).not.toMatch(/\bLearn\b/)
    expect(settings).not.toMatch(/transcri/i)
  })

  it('App mounts the shell with compatibility mappings, TopBar retired', () => {
    const app = readSrc('App.jsx')
    expect(app).toContain('<AppShell')
    expect(app).toContain('<SettingsView')
    expect(app).not.toContain('<TopBar')
    // Preserved contracts: logo-home flow keeps its exact shape.
    expect(app).toContain('getHomeNavigationTarget')
    expect(app).toMatch(/onGoHome=\{goHome\}/)
    expect(app).toContain('toggleSidebar')
    // Home/Import reuse the library workspace until Phase C.
    expect(app).toContain("activeView === 'home'")
    expect(app).toContain("activeView === 'import'")
  })
})

describe('shell styling contract', () => {
  it('encodes rail, drawer, scrim, active signal, and reduced motion', () => {
    const css = readSrc('components', 'shell', 'shell.css')
    const layout = readSrc('features', 'navigation', 'sidebarLayout.js')
    expect(layout).toContain(`${SIDEBAR_RAIL_MAX_WIDTH}`)
    expect(layout).toContain(`${SIDEBAR_DRAWER_MAX_WIDTH}`)
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)/)
    expect(css).toContain('cz-shell__scrim')
    expect(css).toMatch(/navbtn--active[^}]+var\(--cz-signal\)/)
    expect(css).toContain('prefers-reduced-motion')
    // Compact rows, not oversized cards.
    expect(css).toMatch(/min-height:\s*40px/)
    expect(css).not.toContain('linear-gradient')
  })
})
