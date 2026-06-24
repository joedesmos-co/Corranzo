import { describe, expect, it } from 'vitest'
import { isLegalPathname } from '../src/features/legal/legalRoutes.js'
import {
  resolveRestoredActiveView,
  shouldDeferSessionRestore,
} from '../src/features/session/sessionRestoreRouting.js'

describe('session restore routing', () => {
  it('defers session restore on legal pathnames', () => {
    expect(shouldDeferSessionRestore('/privacy')).toBe(true)
    expect(shouldDeferSessionRestore('/terms')).toBe(true)
    expect(shouldDeferSessionRestore('/contact')).toBe(true)
    expect(shouldDeferSessionRestore('/')).toBe(false)
    expect(shouldDeferSessionRestore('/practice')).toBe(false)
  })

  it('keeps Privacy page when restore would open Practice', () => {
    expect(
      resolveRestoredActiveView({
        pathname: '/privacy',
        savedActiveView: 'practice',
        hasMusicXml: true,
      }),
    ).toBe('privacy')
  })

  it('keeps Terms and Contact pages over saved session view', () => {
    expect(
      resolveRestoredActiveView({
        pathname: '/terms',
        savedActiveView: 'practice',
        hasMusicXml: true,
      }),
    ).toBe('terms')
    expect(
      resolveRestoredActiveView({
        pathname: '/contact',
        savedActiveView: 'library',
        hasMusicXml: true,
      }),
    ).toBe('contact')
  })

  it('still restores practice on app routes when timing file exists', () => {
    expect(
      resolveRestoredActiveView({
        pathname: '/',
        savedActiveView: 'practice',
        hasMusicXml: true,
      }),
    ).toBe('practice')
    expect(
      resolveRestoredActiveView({
        pathname: '/',
        savedActiveView: 'library',
        hasMusicXml: true,
      }),
    ).toBe('library')
  })

  it('falls back to library when timing file is missing', () => {
    expect(
      resolveRestoredActiveView({
        pathname: '/',
        savedActiveView: 'practice',
        hasMusicXml: false,
      }),
    ).toBe('library')
  })

  it('exposes legal pathname helper for App restore gating', () => {
    expect(isLegalPathname('/privacy')).toBe(true)
    expect(isLegalPathname('/')).toBe(false)
  })
})
