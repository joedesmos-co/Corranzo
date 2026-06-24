import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getViewFromPathname,
  isLegalView,
  LEGAL_PATHS,
} from '../src/features/legal/legalRoutes.js'
import { CONTACT_EMAIL } from '../src/features/legal/legalInfo.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('AdSense site preparation', () => {
  it('serves ads.txt with the Google publisher line', () => {
    const adsTxt = readFileSync(join(root, 'public', 'ads.txt'), 'utf8').trim()
    expect(adsTxt).toBe('google.com, pub-8017727208750483, DIRECT, f08c47fec0942fa0')
  })

  it('maps legal paths to views for client routing', () => {
    expect(getViewFromPathname('/privacy')).toBe('privacy')
    expect(getViewFromPathname('/terms')).toBe('terms')
    expect(getViewFromPathname('/contact')).toBe('contact')
    expect(isLegalView('privacy')).toBe(true)
    expect(LEGAL_PATHS.contact).toBe('/contact')
  })

  it('lists legal pages in sitemap.xml', () => {
    const sitemap = readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8')
    expect(sitemap).toContain('https://corranzo.com/privacy')
    expect(sitemap).toContain('https://corranzo.com/terms')
    expect(sitemap).toContain('https://corranzo.com/contact')
  })

  it('keeps Google Analytics in index.html', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    expect(html).toContain('G-PRT6SWTWK1')
    expect(html).toContain('googletagmanager.com/gtag/js')
    expect(html).toContain('https://corranzo.com/')
  })

  it('documents contact email for privacy inquiries', () => {
    expect(CONTACT_EMAIL).toBe('joedesmos.co@gmail.com')
  })

  it('uses Wrangler SPA fallback instead of Netlify _redirects', () => {
    expect(() => readFileSync(join(root, 'public', '_redirects'), 'utf8')).toThrow()
    const wrangler = readFileSync(join(root, 'wrangler.toml'), 'utf8')
    expect(wrangler).toContain('not_found_handling = "single-page-application"')
    expect(wrangler).toContain('directory = "./dist"')
  })

  it('keeps static SEO files in public/', () => {
    for (const file of ['ads.txt', 'robots.txt', 'sitemap.xml']) {
      expect(readFileSync(join(root, 'public', file), 'utf8').length).toBeGreaterThan(0)
    }
  })
})
