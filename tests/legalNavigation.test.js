import { describe, expect, it } from 'vitest'
import {
  getViewFromPathname,
  isLegalPathname,
  pathnameForView,
} from '../src/features/legal/legalRoutes.js'
import { resolveRestoredActiveView } from '../src/features/session/sessionRestoreRouting.js'

describe('legal route navigation', () => {
  it('direct /privacy resolves to privacy view', () => {
    expect(getViewFromPathname('/privacy')).toBe('privacy')
    expect(isLegalPathname('/privacy')).toBe(true)
  })

  it('direct /terms and /contact resolve to legal views', () => {
    expect(getViewFromPathname('/terms')).toBe('terms')
    expect(getViewFromPathname('/contact')).toBe('contact')
  })

  it('app navigation leaves legal pathname for Library, Practice, and Profile', () => {
    for (const view of ['library', 'practice', 'profile']) {
      expect(pathnameForView(view)).toBe('/')
      expect(pathnameForView(view)).not.toBe('/privacy')
    }
  })

  it('footer legal links navigate to dedicated legal pathnames', () => {
    expect(pathnameForView('privacy')).toBe('/privacy')
    expect(pathnameForView('terms')).toBe('/terms')
    expect(pathnameForView('contact')).toBe('/contact')
  })

  it('session restore still does not override direct legal route', () => {
    expect(
      resolveRestoredActiveView({
        pathname: '/privacy',
        savedActiveView: 'practice',
        hasMusicXml: true,
      }),
    ).toBe('privacy')
  })
})
