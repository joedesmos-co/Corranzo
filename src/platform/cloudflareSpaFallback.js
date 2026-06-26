import { LEGAL_PATHS } from '../features/legal/legalRoutes.js'

/** Paths that must always be served as real files, never index.html. */
const STATIC_EXACT = new Set([
  '/ads.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.svg',
  '/icons.svg',
])

const STATIC_PREFIXES = ['/assets/', '/fixtures/']

const LEGAL_PATH_SET = new Set(Object.values(LEGAL_PATHS))

/**
 * Whether a missing asset path should fall back to the SPA shell (index.html).
 * Legal routes and extensionless app paths yes; plain-text/XML assets and hashed bundles no.
 */
export function shouldFallbackToSpa(pathname) {
  if (!pathname || pathname === '/') {
    return false
  }
  if (STATIC_EXACT.has(pathname)) {
    return false
  }
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false
  }
  if (LEGAL_PATH_SET.has(pathname)) {
    return true
  }
  const lastSegment = pathname.split('/').pop() ?? ''
  if (lastSegment.includes('.') && !lastSegment.endsWith('.html')) {
    return false
  }
  return true
}

/**
 * Cloudflare Workers static-assets handler: serve real files first, then index.html for SPA routes.
 * Applies cache headers so index.html is always revalidated while hashed /assets/* stay immutable.
 */
export function applyDeployCacheHeaders(response, pathname) {
  if (!response || response.status < 200 || response.status >= 400) {
    return response
  }

  const headers = new Headers(response.headers)
  if (pathname === '/' || pathname === '/index.html') {
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    headers.set('Pragma', 'no-cache')
  } else if (pathname.startsWith('/assets/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function handleSpaAssetRequest(request, assets) {
  const { pathname } = new URL(request.url)
  const assetResponse = await assets.fetch(request)
  if (assetResponse.status !== 404) {
    return applyDeployCacheHeaders(assetResponse, pathname)
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return assetResponse
  }

  if (!shouldFallbackToSpa(pathname)) {
    return assetResponse
  }

  const indexUrl = new URL('/index.html', request.url)
  const indexRequest = new Request(indexUrl, {
    method: request.method,
    headers: request.headers,
  })
  const indexResponse = await assets.fetch(indexRequest)
  if (indexResponse.status === 404) {
    return assetResponse
  }

  const spaShell = new Response(indexResponse.body, {
    status: 200,
    statusText: indexResponse.statusText,
    headers: indexResponse.headers,
  })
  return applyDeployCacheHeaders(spaShell, '/index.html')
}
