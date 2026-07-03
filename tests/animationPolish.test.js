/**
 * Animation polish — motion tokens, subtle fades, reduced-motion, no layout jank.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

const tokensCss = readFileSync(join(root, 'src', 'styles', 'tokens.css'), 'utf8')
const indexCss = readFileSync(join(root, 'src', 'index.css'), 'utf8')
const appCss = readFileSync(join(root, 'src', 'App.css'), 'utf8')
const practiceCss = readFileSync(join(root, 'src', 'styles', 'practice.css'), 'utf8')
const uiSharedCss = readFileSync(join(root, 'src', 'styles', 'ui-shared.css'), 'utf8')

describe('motion tokens', () => {
  it('defines shared easing and duration tokens', () => {
    expect(tokensCss).toMatch(/--sf-ease-out:/)
    expect(tokensCss).toMatch(/--sf-duration-fade:/)
    expect(tokensCss).toMatch(/--sf-duration-press:\s*170ms/)
  })

  it('honors prefers-reduced-motion globally', () => {
    expect(indexCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})

describe('navigation and reveal fades', () => {
  it('uses short ease-out fades for floating toolbars and fullscreen chrome', () => {
    expect(appCss).toMatch(/\.viewer-float-toolbar__bar[\s\S]*opacity var\(--sf-duration\)/)
    expect(appCss).toMatch(/\.pdf-fullscreen__hint[\s\S]*var\(--sf-ease-out\)/)
    expect(practiceCss).toMatch(/\.practice-fullscreen-hud[\s\S]*var\(--sf-duration\)/)
  })

  it('does not animate library rail width (layout jank)', () => {
    const panelStart = appCss.indexOf('\n.library-panel {')
    const panel = appCss.slice(panelStart, appCss.indexOf('}', panelStart) + 1)
    expect(panel).toMatch(/transition:\s*opacity/)
    expect(panel).not.toMatch(/width\s+0\.\d+s/)
  })

  it('snaps guided-tour highlights instead of animating layout properties', () => {
    const highlight = appCss.match(/\.guided-tour__highlight\s*\{[^}]*\}/)?.[0] ?? ''
    expect(highlight).toMatch(/transition:\s*opacity/)
    expect(highlight).not.toMatch(/transition:[^;]*\bleft\b/)
  })
})

describe('loading and status motion', () => {
  it('keeps OMR progress on transform with a compositor hint', () => {
    expect(appCss).toMatch(/\.library-omr-panel__progress-bar::before[\s\S]*will-change:\s*transform/)
    expect(appCss).toMatch(/@keyframes omr-progress-slide/)
  })

  it('uses a gentler loading pulse and faster setup spinner', () => {
    expect(practiceCss).toMatch(/practice-status-pulse 2s/)
    expect(practiceCss).toMatch(/score-follow-setup-spin 0\.65s/)
  })

  it('fades approximate-cursor hints without a sluggish 600ms ease', () => {
    expect(practiceCss).toMatch(/\.score-follow-approximate-hint\s*\{[^}]*--sf-duration-fade/)
    expect(practiceCss).not.toMatch(/score-follow-approximate-hint[^}]*0\.6s/)
  })
})

describe('hover and press feedback', () => {
  it('adds subtle active opacity on primary buttons', () => {
    expect(uiSharedCss).toMatch(/\.topbar__nav-btn:active:not\(:disabled\)[\s\S]*opacity:\s*0\.9/)
    expect(uiSharedCss).toMatch(/\.upload-btn:active:not\(:disabled\)/)
  })

  it('does not animate collapsible grid rows', () => {
    expect(practiceCss).toMatch(/\.practice-section__collapse\s*\{/)
    expect(practiceCss).not.toMatch(/grid-template-rows\s+0\.\d+s/)
  })
})
