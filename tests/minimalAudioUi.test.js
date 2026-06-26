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
const editorial = readFileSync(join(root, 'src', 'styles', 'editorial-polish.css'), 'utf8')

describe('minimal audio transport styling', () => {
  it('uses monochromatic design tokens', () => {
    expect(tokens).toContain('--sf-bg-app: #000000')
    expect(tokens).toContain('--sf-bg-panel: #121212')
    expect(tokens).toContain('--sf-radius-sm: 4px')
    expect(tokens).toContain('--sf-shadow-soft: none')
    expect(tokens).toContain('--sf-font-micro')
    expect(tokens).toContain('--sf-copy-max: min(36rem, 100%)')
    expect(tokens).toContain('--sf-panel-padding-y')
    expect(tokens).toContain('--sf-font-sidebar-min: 0.6875rem')
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

  it('upload and practice CTAs are flat without purple gradients', () => {
    const appCss = readFileSync(join(root, 'src', 'App.css'), 'utf8')
    const uploadBlock = appCss.slice(appCss.indexOf('.upload-btn {'), appCss.indexOf('.upload-btn--midi'))
    const practiceBlock = appCss.slice(
      appCss.indexOf('.upload-btn--practice {'),
      appCss.indexOf('.library-panel__workflow-next'),
    )
    const ctaBlock = appCss.slice(appCss.indexOf('.multi-upload__cta {'), appCss.indexOf('.multi-upload__status'))
    expect(uploadBlock).not.toMatch(/gradient/)
    expect(practiceBlock).not.toMatch(/gradient/)
    expect(ctaBlock).not.toMatch(/gradient/)
    expect(practiceBlock).toMatch(/border-radius:\s*var\(--sf-radius-md\)/)
    expect(ctaBlock).toMatch(/background:\s*var\(--sf-text-primary\)/)
  })

  it('accuracy guide and pdf canvas use flat monochrome surfaces', () => {
    const appCss = readFileSync(join(root, 'src', 'App.css'), 'utf8')
    const guide = appCss.slice(
      appCss.indexOf('.library-accuracy-guide {'),
      appCss.indexOf('.library-accuracy-guide__status'),
    )
    const canvas = appCss.slice(appCss.indexOf('.pdf-canvas {'), appCss.indexOf('.pdf-canvas--paper-light'))
    expect(guide).toMatch(/background:\s*var\(--sf-bg-panel\)/)
    expect(guide).toMatch(/border-radius:\s*var\(--sf-radius-md\)/)
    expect(canvas).toMatch(/background:\s*var\(--sf-bg-app\)/)
    expect(canvas).toMatch(/padding:\s*var\(--sf-space-sm\)/)
    expect(appCss).toMatch(/\.main-layout__score\s*\{[^}]*background:\s*var\(--sf-bg-app\)/)
  })

  it('library rail and pdf workstation surfaces are flat and aligned', () => {
    const appCss = readFileSync(join(root, 'src', 'App.css'), 'utf8')
    expect(appCss).toMatch(/\.library-panel\s*\{[^}]*flex-direction:\s*column/)
    expect(appCss).toMatch(/\.multi-upload__status\s*\{[^}]*display:\s*flex/)
    expect(appCss).toMatch(/\.multi-upload__status\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(appCss).toMatch(/\.multi-upload__cta\s*\{[^}]*width:\s*100%/)
    expect(appCss).toMatch(/\.viewer-float-toolbar__bar\s*\{[^}]*rgba\(18,\s*18,\s*18,\s*0\.8\)/)
    expect(appCss).toMatch(/\.viewer-float-toolbar__bar\s*\{[^}]*border-radius:\s*var\(--sf-radius-md\)/)
    expect(appCss).toMatch(/\.pdf-canvas\s*\{[^}]*border:\s*none/)
    expect(appCss).toMatch(/\.pdf-canvas \.react-pdf__Page\s*\{[^}]*box-shadow:\s*none/)
    expect(appCss).toMatch(/\.library-welcome \.demo-piece\s*\{[^}]*grid-column:\s*6\s*\/\s*-1/)
  })

  it('track list uses compact hand rows with readable note counts', () => {
    expect(practiceCss).toMatch(
      /\.midi-tracks__label\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/,
    )
    expect(practiceCss).toMatch(/\.midi-tracks__meta\s*\{[^}]*font-size:\s*var\(--sf-font-sidebar-min\)/)
    expect(practiceCss).not.toMatch(/\.midi-tracks__meta,\s*\n/)
    expect(editorial).not.toContain('.midi-tracks__meta,')
  })

  it('tracklist hover uses subtle flat feedback', () => {
    expect(practiceCss).toMatch(/\.midi-tracks__label:hover\s*\{[^}]*var\(--sf-interactive-surface\)/)
    expect(practiceCss).toMatch(/\.midi-tracks__label:hover \.midi-tracks__name\s*\{[^}]*color:\s*var\(--sf-text-secondary\)/)
  })

  it('cursorrules guardrails protect the minimalist UI', () => {
    const rules = readFileSync(join(root, '.cursorrules'), 'utf8')
    expect(rules).toContain('NEVER use border-radius or gradients in new CSS rules')
    expect(rules).toContain('src/styles/tokens.css')
    expect(rules).toContain('tracked-out uppercase layouts for headers')
    expect(editorial).toContain('max-width: var(--sf-copy-max)')
    expect(editorial).toContain('--sf-font-micro')
    expect(editorial).toContain('--sf-text-micro-opacity')
  })
})
