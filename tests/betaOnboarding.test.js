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
    expect(readSrc('components', 'legal', 'ContactPage.jsx')).toContain('CONTACT_EMAIL')
    expect(readSrc('components', 'legal', 'PrivacyPolicyPage.jsx')).toContain('CONTACT_EMAIL')
  })

  it('homepage explains what Corranzo is and how to use it', () => {
    const welcome = readSrc('components', 'LibraryWelcomeCard.jsx')
    expect(welcome).toContain('sheet music practice app')
    expect(welcome).toContain('PDF sheet music')
    expect(welcome).toContain('MIDI and MusicXML')
    expect(welcome).toContain('synchronized playback')
    expect(welcome).toContain('score-follow cursor')
    expect(welcome).toContain('library-welcome__summary')
  })

  it('logo/title navigates home from app and legal pages', () => {
    const topbar = readSrc('components', 'TopBar.jsx')
    const app = readSrc('App.jsx')
    expect(topbar).toMatch(/onGoHome/)
    expect(topbar).toMatch(/topbar__brand-btn/)
    expect(topbar).toMatch(/aria-label="Corranzo home"/)
    expect(app).toMatch(/onGoHome=\{goHome\}/)
    expect(app).toMatch(/navigateToView\('library'\)/)
  })

  it('goHome clears legal pathname back to library home', () => {
    expect(pathnameForView('library')).toBe('/')
    expect(pathnameForView('privacy')).toBe('/privacy')
  })
})
