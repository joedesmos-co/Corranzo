/**
 * Minimal audio UI — razor-thin controls and editorial section labels.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const practiceCss = readFileSync(join(root, 'src', 'styles', 'practice.css'), 'utf8')
const tokens = readFileSync(join(root, 'src', 'styles', 'tokens.css'), 'utf8')

describe('minimal audio transport styling', () => {
  it('uses monochromatic design tokens', () => {
    expect(tokens).toContain('--sf-bg-app: #000000')
    expect(tokens).toContain('--sf-bg-panel: #121212')
    expect(tokens).toContain('--sf-radius-sm: 0')
    expect(tokens).toContain('--sf-shadow-soft: none')
    expect(tokens).toContain('--sf-font-micro')
    expect(tokens).toContain('--sf-copy-max: 60%')
    expect(tokens).toContain('--sf-panel-padding-y')
  })

  it('playback section uses editorial heading class', () => {
    const transport = readFileSync(
      join(root, 'src', 'components', 'practice', 'PracticeTransportSection.jsx'),
      'utf8',
    )
    expect(transport).toContain('practice-section__title--editorial')
  })

  it('track and library sections propagate editorial headings', () => {
    const tracks = readFileSync(
      join(root, 'src', 'components', 'practice', 'PracticeTracksSection.jsx'),
      'utf8',
    )
    const library = readFileSync(join(root, 'src', 'components', 'LibraryPanel.jsx'), 'utf8')
    const welcome = readFileSync(join(root, 'src', 'components', 'LibraryWelcomeCard.jsx'), 'utf8')
    expect(tracks).toContain('practice-section__title--editorial')
    expect(library).toContain('panel__title practice-section__title--editorial')
    expect(welcome).toContain('library-welcome__section-title practice-section__title--editorial')
  })

  it('seek bars and progress tracks are razor-thin', () => {
    expect(practiceCss).toMatch(/\.midi-transport__seek\s*\{[^}]*height:\s*1px/)
    expect(practiceCss).toMatch(/\.practice-progress__track\s*\{[^}]*height:\s*1px/)
    expect(practiceCss).toMatch(/\.wait-for-you__progress-track\s*\{[^}]*height:\s*1px/)
  })

  it('transport buttons use sharp flat edges', () => {
    expect(practiceCss).toMatch(/\.midi-transport__btn\s*\{[^}]*border-radius:\s*0/)
  })

  it('slider thumbs stay hidden until interaction', () => {
    expect(practiceCss).toMatch(/\.midi-transport__seek::-webkit-slider-thumb\s*\{[^}]*opacity:\s*0/)
    expect(practiceCss).toContain('.practice-playback-settings__row input[type=\'range\']:hover::-webkit-slider-thumb')
    expect(practiceCss).toContain('opacity: 1')
  })

  it('tracklist hover uses subtle flat feedback', () => {
    expect(practiceCss).toMatch(/\.midi-tracks__label:hover\s*\{[^}]*rgba\(255,\s*255,\s*255,\s*0\.03\)/)
    expect(practiceCss).toMatch(/\.midi-tracks__label:hover \.midi-tracks__name\s*\{[^}]*color:\s*var\(--sf-text-primary\)/)
  })

  it('cursorrules guardrails protect the minimalist UI', () => {
    const rules = readFileSync(join(root, '.cursorrules'), 'utf8')
    const editorial = readFileSync(join(root, 'src', 'styles', 'editorial-polish.css'), 'utf8')
    expect(rules).toContain('NEVER use border-radius or gradients in new CSS rules')
    expect(rules).toContain('src/styles/tokens.css')
    expect(rules).toContain('tracked-out uppercase layouts for headers')
    expect(editorial).toContain('max-width: var(--sf-copy-max)')
    expect(editorial).toContain('--sf-font-micro')
    expect(editorial).toContain('--sf-text-micro-opacity')
  })
})
