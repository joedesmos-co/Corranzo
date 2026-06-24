import { describe, expect, it } from 'vitest'
import {
  handleSpaAssetRequest,
  shouldFallbackToSpa,
} from '../src/platform/cloudflareSpaFallback.js'

function mockAssets(fileMap) {
  return {
    fetch(request) {
      const pathname = new URL(request.url).pathname
      const body = fileMap[pathname]
      if (body == null) {
        return new Response('Not Found', { status: 404 })
      }
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    },
  }
}

describe('shouldFallbackToSpa', () => {
  it('never falls back for SEO/static files', () => {
    expect(shouldFallbackToSpa('/ads.txt')).toBe(false)
    expect(shouldFallbackToSpa('/robots.txt')).toBe(false)
    expect(shouldFallbackToSpa('/sitemap.xml')).toBe(false)
    expect(shouldFallbackToSpa('/assets/index-abc.js')).toBe(false)
    expect(shouldFallbackToSpa('/fixtures/demo-minuet-in-g.musicxml')).toBe(false)
  })

  it('falls back for legal client routes', () => {
    expect(shouldFallbackToSpa('/privacy')).toBe(true)
    expect(shouldFallbackToSpa('/terms')).toBe(true)
    expect(shouldFallbackToSpa('/contact')).toBe(true)
  })
})

describe('handleSpaAssetRequest', () => {
  const assets = mockAssets({
    '/ads.txt': 'google.com, pub-8017727208750483, DIRECT, f08c47fec0942fa0',
    '/index.html': '<!doctype html><html><body>app</body></html>',
  })

  it('serves ads.txt as plain text without SPA fallback', async () => {
    const response = await handleSpaAssetRequest(
      new Request('https://corranzo.com/ads.txt'),
      assets,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('pub-8017727208750483')
  })

  it('serves index.html for /privacy when no static file exists', async () => {
    const response = await handleSpaAssetRequest(
      new Request('https://corranzo.com/privacy'),
      assets,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<!doctype html>')
  })

  it('serves index.html for /terms and /contact', async () => {
    for (const path of ['/terms', '/contact']) {
      const response = await handleSpaAssetRequest(
        new Request(`https://corranzo.com${path}`),
        assets,
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('app')
    }
  })
})
