/**
 * iPad / tablet layout — split view, orientation, touch, spacing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

const appCss = readFileSync(join(root, 'src', 'App.css'), 'utf8')
const practiceCss = readFileSync(join(root, 'src', 'styles', 'practice.css'), 'utf8')
const profileCss = readFileSync(join(root, 'src', 'styles', 'profile.css'), 'utf8')

describe('iPad split view library layout', () => {
  it('stacks the library rail before phone width so narrow split views get full-width panels', () => {
    expect(appCss).toMatch(/@media \(max-width: 800px\)[\s\S]*\.main-layout[\s\S]*display:\s*block/)
    expect(appCss).toMatch(/@media \(max-width: 800px\)[\s\S]*\.library-panel[\s\S]*width:\s*100%/)
  })

  it('keeps a shorter stacked score preview on tablet split than on phones', () => {
    const tabletBlock = appCss.match(/@media \(max-width: 800px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const phoneBlock = appCss.match(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(tabletBlock).toMatch(/\.main-layout__score[\s\S]*clamp\(380px,\s*62vh,\s*520px\)/)
    expect(phoneBlock).toMatch(/\.main-layout__score[\s\S]*clamp\(420px,\s*68vh,\s*560px\)/)
  })
})

describe('iPad practice orientation', () => {
  it('stacks practice only in portrait or below 900px, not on landscape tablets', () => {
    expect(practiceCss).toMatch(
      /@media \(max-width: 1100px\) and \(orientation: portrait\),\s*\n\s*\(max-width: 900px\)/,
    )
    expect(practiceCss).toMatch(
      /@media \(max-width: 1100px\) and \(orientation: landscape\) and \(min-width: 901px\)[\s\S]*\.practice-control-panel/,
    )
  })

  it('balances stacked panel height on tablet landscape', () => {
    expect(practiceCss).toMatch(
      /@media \(max-width: 900px\) and \(orientation: landscape\) and \(min-height: 501px\)[\s\S]*min-height:\s*42vh/,
    )
  })
})

describe('iPad touch and spacing', () => {
  it('uses 44px toolbar icons and top-bar controls on tablets', () => {
    expect(appCss).toMatch(/@media \(max-width: 1100px\)[\s\S]*\.tb-icon[\s\S]*44px/)
    expect(appCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.topbar__nav-btn[\s\S]*min-height:\s*44px/,
    )
    expect(appCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.instrument-selector__option[\s\S]*min-height:\s*44px/,
    )
  })

  it('tightens profile padding on tablet widths before the phone layout', () => {
    expect(profileCss).toMatch(/@media \(max-width: 900px\)[\s\S]*\.profile-view/)
  })
})
