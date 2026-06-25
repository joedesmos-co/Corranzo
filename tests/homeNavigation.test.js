import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getHomeNavigationTarget } from '../src/features/navigation/goHome.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('logo home navigation', () => {
  it('targets library landing with welcome visible and / pathname', () => {
    expect(getHomeNavigationTarget()).toEqual({
      view: 'library',
      pathname: '/',
      showWelcome: true,
    })
  })

  it('TopBar logo is a home anchor with click handler', () => {
    const topbar = readSrc('components', 'TopBar.jsx')
    const css = readFileSync(join(root, 'src', 'App.css'), 'utf8')
    expect(topbar).toMatch(/href="\/"/)
    expect(topbar).toMatch(/topbar__brand-btn/)
    expect(topbar).toMatch(/handleGoHome/)
    expect(topbar).toMatch(/onGoHome\?\.\(\)/)
    expect(css).toMatch(/\.topbar__brand-btn[\s\S]*cursor: pointer/)
  })

  it('App goHome uses getHomeNavigationTarget and scrolls to top', () => {
    const app = readSrc('App.jsx')
    expect(app).toContain('getHomeNavigationTarget')
    expect(app).toContain('setShowWelcome(home.showWelcome)')
    expect(app).toContain('window.scrollTo(0, 0)')
    expect(app).toMatch(/onGoHome=\{goHome\}/)
  })

  it('simulates home navigation from legal and app views', () => {
    const navigateToView = vi.fn()
    const setShowWelcome = vi.fn()
    const home = getHomeNavigationTarget()

    for (const fromView of ['privacy', 'terms', 'contact', 'practice', 'library', 'profile']) {
      navigateToView.mockClear()
      setShowWelcome.mockClear()

      setShowWelcome(home.showWelcome)
      navigateToView(home.view)

      expect(setShowWelcome).toHaveBeenCalledWith(true)
      expect(navigateToView).toHaveBeenCalledWith('library')
    }
  })
})
