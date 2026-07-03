/**
 * Mobile layout regressions — safe areas, viewport height, touch targets, scroll.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

const indexHtml = readFileSync(join(root, 'index.html'), 'utf8')
const indexCss = readFileSync(join(root, 'src', 'index.css'), 'utf8')
const tokensCss = readFileSync(join(root, 'src', 'styles', 'tokens.css'), 'utf8')
const appCss = readFileSync(join(root, 'src', 'App.css'), 'utf8')
const practiceCss = readFileSync(join(root, 'src', 'styles', 'practice.css'), 'utf8')
const profileCss = readFileSync(join(root, 'src', 'styles', 'profile.css'), 'utf8')

describe('mobile viewport and safe areas', () => {
  it('enables viewport-fit=cover for notch safe-area insets', () => {
    expect(indexHtml).toMatch(/viewport-fit=cover/)
  })

  it('defines a shared viewport height token with dvh upgrade', () => {
    expect(tokensCss).toMatch(/--sf-viewport-height:\s*100vh/)
    expect(indexCss).toMatch(/@supports \(height: 100dvh\)[\s\S]*--sf-viewport-height:\s*100dvh/)
  })

  it('pads the top bar and footer clear of device safe areas', () => {
    expect(appCss).toMatch(/\.topbar\s*\{[^}]*env\(safe-area-inset-top/)
    expect(appCss).toMatch(/\.app-footer\s*\{[^}]*env\(safe-area-inset-bottom/)
  })

  it('keeps PDF fullscreen chrome inside safe areas', () => {
    expect(appCss).toMatch(/\.pdf-fullscreen \.viewer-float-toolbar[\s\S]*safe-area-inset-top/)
    expect(appCss).toMatch(/\.pdf-fullscreen__hint[\s\S]*safe-area-inset-bottom/)
    expect(appCss).toMatch(/\.pdf-fullscreen__chrome-zone--bottom[\s\S]*safe-area-inset-bottom/)
  })
})

describe('mobile practice layout', () => {
  it('sizes the workspace from the viewport token instead of raw 100vh', () => {
    expect(practiceCss).toMatch(/\.practice-workspace\s*\{[^}]*max-height:\s*calc\(var\(--sf-viewport-height\)/)
  })

  it('reduces stacked panel height in phone landscape', () => {
    expect(practiceCss).toMatch(
      /@media \(max-width: 1100px\) and \(max-height: 500px\) and \(orientation: landscape\)/,
    )
    expect(practiceCss).toMatch(
      /@media \(max-width: 1100px\) and \(max-height: 500px\) and \(orientation: landscape\)[\s\S]*\.practice-workspace__score[\s\S]*min-height:\s*34vh/,
    )
  })

  it('uses a taller effective top bar height on narrow phones', () => {
    expect(appCss).toMatch(/@media \(max-width: 640px\)[\s\S]*:root[\s\S]*--sf-topbar-height:\s*136px/)
  })
})

describe('mobile overlays and controls', () => {
  it('anchors the session restore banner below the fold on phones', () => {
    const mobileBlock = appCss.match(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const bannerBlock = mobileBlock.match(/\.session-restore-banner\s*\{[^}]*\}/)?.[0] ?? ''
    expect(bannerBlock).toMatch(/bottom:\s*max\(/)
    expect(bannerBlock).toMatch(/top:\s*auto/)
    expect(bannerBlock).not.toMatch(/top:\s*10px/)
  })

  it('pads the restore overlay card away from screen edges', () => {
    expect(appCss).toMatch(/\.session-restore-overlay\s*\{[^}]*env\(safe-area-inset-top/)
  })

  it('uses touch-sized instrument and profile scope controls on mobile', () => {
    expect(appCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*\.instrument-selector__option[\s\S]*min-height:\s*44px/,
    )
    expect(profileCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.profile-scope__option[\s\S]*min-height:\s*44px/,
    )
    expect(profileCss).toMatch(/@media \(max-width: 760px\)[\s\S]*\.profile-scope[\s\S]*flex-wrap:\s*wrap/)
  })
})
