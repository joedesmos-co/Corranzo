import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEMO_UNAVAILABLE_MESSAGE,
  formatDemoLoadError,
  isDemoChunkLoadFailure,
} from '../src/features/demo/formatDemoLoadError.js'
import {
  applyDeployCacheHeaders,
  handleSpaAssetRequest,
} from '../src/platform/cloudflareSpaFallback.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('formatDemoLoadError', () => {
  it('hides dynamic import chunk URLs from users', () => {
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://corranzo.com/assets/loadSampleFixtures-D0vtGmbo.js',
    )
    expect(formatDemoLoadError(error)).toBe(DEMO_UNAVAILABLE_MESSAGE)
    expect(formatDemoLoadError(error)).not.toMatch(/loadSampleFixtures|https:\/\//)
  })

  it('detects chunk load failures', () => {
    expect(
      isDemoChunkLoadFailure(
        new Error('Failed to fetch dynamically imported module: https://example.com/assets/foo.js'),
      ),
    ).toBe(true)
    expect(isDemoChunkLoadFailure(new Error('Demo file not found: x.mxl (404)'))).toBe(false)
  })

  it('maps missing fixture files to the friendly message', () => {
    expect(formatDemoLoadError(new Error('Demo file not found: demo.mxl (404)'))).toBe(
      DEMO_UNAVAILABLE_MESSAGE,
    )
  })
})

describe('demo fixture loading — build integration', () => {
  it('loads demo fixtures via static import (no lazy chunk)', () => {
    const app = readFileSync(join(root, 'src', 'App.jsx'), 'utf8')
    expect(app).toMatch(/import\s*\{[^}]*fetchSampleFixtureFiles[^}]*\}\s*from\s*['"]\.\/dev\/loadSampleFixtures\.js['"]/)
    expect(app).not.toMatch(/import\(\s*['"]\.\/dev\/loadSampleFixtures\.js['"]\s*\)/)
  })

  it('does not emit a separate loadSampleFixtures chunk after production build', () => {
    let indexHtml = ''
    let assetNames = []
    try {
      indexHtml = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
      assetNames = readdirSync(join(root, 'dist', 'assets'))
    } catch {
      return
    }
    expect(indexHtml).not.toMatch(/loadSampleFixtures-[\w-]+\.js/)
    expect(assetNames.some((name) => name.startsWith('loadSampleFixtures-'))).toBe(false)
  })
})

describe('DemoPieceCard retry UI', () => {
  it('exposes a retry action when demo load fails', () => {
    const card = readFileSync(join(root, 'src', 'components', 'DemoPieceCard.jsx'), 'utf8')
    expect(card).toMatch(/onRetry/)
    expect(card).toMatch(/Retry/)
    expect(card).toMatch(/demo-piece__retry/)
  })
})

describe('deploy cache headers', () => {
  it('marks index.html as no-cache and hashed assets as immutable', () => {
    const index = new Response('<html></html>', { status: 200 })
    const cached = applyDeployCacheHeaders(index, '/index.html')
    expect(cached.headers.get('Cache-Control')).toMatch(/no-cache/)

    const asset = new Response('chunk', { status: 200 })
    const assetCached = applyDeployCacheHeaders(asset, '/assets/index-abc.js')
    expect(assetCached.headers.get('Cache-Control')).toMatch(/immutable/)
  })

  it('applies cache headers from the worker asset handler', async () => {
    const assets = {
      fetch(request) {
        const pathname = new URL(request.url).pathname
        if (pathname === '/index.html') {
          return new Response('<!doctype html>', { status: 200 })
        }
        if (pathname === '/assets/index-abc.js') {
          return new Response('console.log(1)', { status: 200 })
        }
        return new Response('missing', { status: 404 })
      },
    }

    const indexResponse = await handleSpaAssetRequest(
      new Request('https://corranzo.com/index.html'),
      assets,
    )
    expect(indexResponse.headers.get('Cache-Control')).toMatch(/no-cache/)

    const assetResponse = await handleSpaAssetRequest(
      new Request('https://corranzo.com/assets/index-abc.js'),
      assets,
    )
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('Cache-Control')).toMatch(/immutable/)
  })
})
