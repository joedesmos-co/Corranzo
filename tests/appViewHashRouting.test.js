import { describe, expect, it } from 'vitest'
import {
  APP_VIEWS,
  currentViewPath,
  getViewFromLocation,
  isAppView,
  pathnameForView,
} from '../src/features/legal/legalRoutes.js'

/**
 * Regression cover for browser history navigation.
 *
 * Every app view used to share the bare "/" path, so `navigateToView` never
 * pushed a history entry and the browser Back button dropped the user off the
 * app (onto about:blank). App views now live in the URL hash, which is never
 * sent to the worker/CDN, so the server contract is unchanged while each view
 * change becomes a real history entry.
 */
describe('app-view hash routing', () => {
  it('keeps legal views on real paths', () => {
    expect(pathnameForView('privacy')).toBe('/privacy')
    expect(pathnameForView('terms')).toBe('/terms')
    expect(pathnameForView('contact')).toBe('/contact')
  })

  it('encodes app views in the hash, not the path', () => {
    for (const view of ['home', 'library', 'import', 'practice', 'profile', 'settings']) {
      expect(pathnameForView(view)).toBe(`/#${view}`)
      expect(isAppView(view)).toBe(true)
    }
  })

  it('resolves a legal path before the hash', () => {
    expect(getViewFromLocation({ pathname: '/privacy', hash: '#/library' })).toBe('privacy')
    expect(getViewFromLocation({ pathname: '/terms', hash: '' })).toBe('terms')
    expect(getViewFromLocation({ pathname: '/contact', hash: '#/practice' })).toBe('contact')
  })

  it('resolves an app-view hash', () => {
    expect(getViewFromLocation({ pathname: '/', hash: '#/library' })).toBe('library')
    expect(getViewFromLocation({ pathname: '/', hash: '#/practice' })).toBe('practice')
    expect(getViewFromLocation({ pathname: '/', hash: '#/import' })).toBe('import')
  })

  it('tolerates a hash with no leading slash and ignores unknown hashes', () => {
    expect(getViewFromLocation({ pathname: '/', hash: '#library' })).toBe('library')
    expect(getViewFromLocation({ pathname: '/', hash: '#/unknown' })).toBe('home')
    expect(getViewFromLocation({ pathname: '/', hash: '' })).toBe('home')
  })

  it('defaults to home for a bare path', () => {
    expect(getViewFromLocation({ pathname: '/', hash: '' })).toBe('home')
    expect(getViewFromLocation({ pathname: '/#home', hash: '' })).toBe('home')
  })

  it('exposes the full in-app path for pushState change detection', () => {
    expect(currentViewPath({ pathname: '/', hash: '' })).toBe('/')
    expect(currentViewPath({ pathname: '/', hash: '#/library' })).toBe('/#/library')
    expect(currentViewPath({ pathname: '/privacy', hash: '' })).toBe('/privacy')
  })

  it('never routes an unknown view through the hash', () => {
    expect(isAppView('unknown')).toBe(false)
    expect(isAppView('history')).toBe(false)
    expect(getViewFromLocation({ pathname: '/', hash: '#/history' })).toBe('home')
  })
})
