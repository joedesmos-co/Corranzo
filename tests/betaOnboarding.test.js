import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FEEDBACK_EMAIL,
  FEEDBACK_MAILTO,
} from '../src/features/beta/betaInfo.js'
import { CONTACT_EMAIL } from '../src/features/legal/legalInfo.js'
import { pathnameForView } from '../src/features/legal/legalRoutes.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('beta onboarding', () => {
  it('uses the correct feedback and contact email everywhere', () => {
    expect(FEEDBACK_EMAIL).toBe('joedesmos.co@gmail.com')
    expect(CONTACT_EMAIL).toBe('joedesmos.co@gmail.com')
    expect(FEEDBACK_MAILTO).toContain('joedesmos.co@gmail.com')
    expect(readSrc('components', 'AppFooter.jsx')).toContain('FEEDBACK_MAILTO')
    expect(readSrc('components', 'AppFooter.jsx')).not.toContain('CorranzoLogo')
    expect(readSrc('components', 'legal', 'ContactPage.jsx')).toContain('CONTACT_EMAIL')
    expect(readSrc('components', 'legal', 'PrivacyPolicyPage.jsx')).toContain('CONTACT_EMAIL')
  })

  it('homepage explains what Corranzo is and how to use it', () => {
    const welcome = readSrc('components', 'LibraryWelcomeCard.jsx')
    expect(welcome).toContain('Practice with a score that follows you')
    expect(welcome).toContain('PDF score')
    expect(welcome).toContain('MusicXML/MXL')
    expect(welcome).toContain('MIDI is optional')
    expect(welcome).toMatch(/Try the[\s\S]*demo first/)
    expect(welcome).toContain('library-welcome__summary')
    expect(welcome).toContain('CorranzoLogo')
    expect(welcome).toContain('library-welcome__logo')
  })

  it('uses minimalist surface hooks on home and demo surfaces', () => {
    const css = readFileSync(join(root, 'src', 'App.css'), 'utf8')
    const tokens = readFileSync(join(root, 'src', 'styles', 'tokens.css'), 'utf8')
    expect(readSrc('components', 'TopBar.jsx')).toContain('CorranzoLogo')
    expect(readSrc('components', 'DemoPieceCard.jsx')).not.toContain('CorranzoLogo')
    expect(readSrc('features', 'brand', 'corranzoBrand.js')).toContain('corranzo-logo.png')
    expect(readSrc('features', 'brand', 'corranzoBrand.js')).toContain('site.webmanifest')
    expect(tokens).toContain('--sf-bg-app: #000000')
    expect(tokens).toContain('--sf-font-mono')
    expect(css).toMatch(/\.library-welcome__logo/)
    expect(css).toMatch(/grid-template-columns: repeat\(12/)
  })

  it('logo/title navigates home from app and legal pages', () => {
    const topbar = readSrc('components', 'TopBar.jsx')
    const app = readSrc('App.jsx')
    expect(topbar).toMatch(/href="\/"/)
    expect(topbar).toMatch(/onGoHome/)
    expect(topbar).toMatch(/topbar__brand-btn/)
    expect(topbar).toMatch(/aria-label="Corranzo home"/)
    expect(app).toMatch(/onGoHome=\{goHome\}/)
    expect(app).toContain('getHomeNavigationTarget')
  })

  it('goHome clears legal pathname back to library home', () => {
    expect(pathnameForView('library')).toBe('/')
    expect(pathnameForView('privacy')).toBe('/privacy')
  })
})
