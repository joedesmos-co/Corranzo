import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CORRANZO_LOGO_SRC,
  CORRANZO_MANIFEST_SRC,
  CORRANZO_OG_IMAGE,
  CORRANZO_THEME_COLOR,
} from '../src/features/brand/corranzoBrand.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readPublic(file) {
  return readFileSync(join(root, 'public', file), 'utf8')
}

describe('Corranzo brand assets', () => {
  it('uses one canonical logo in public/', () => {
    expect(existsSync(join(root, 'public', 'corranzo-logo.png'))).toBe(true)
    expect(existsSync(join(root, 'public', 'favicon.svg'))).toBe(false)
    expect(existsSync(join(root, 'public', 'favicon.ico'))).toBe(false)
    expect(existsSync(join(root, 'public', 'icons.svg'))).toBe(false)
  })

  it('wires index.html icons and social metadata to the logo', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    // Favicon may carry a cache-busting ?v= query, so match the logo href
    // without requiring the closing quote immediately after.
    expect(html).toContain(`href="${CORRANZO_LOGO_SRC}`)
    expect(html).toContain(`href="${CORRANZO_MANIFEST_SRC}"`)
    expect(html).toContain(`content="${CORRANZO_OG_IMAGE}"`)
    expect(html).toContain(`content="${CORRANZO_THEME_COLOR}"`)
    expect(html).not.toContain('favicon.svg')
    expect(html).not.toContain('863bff')
  })

  it('manifest icons reference the canonical logo', () => {
    const manifest = JSON.parse(readPublic('site.webmanifest'))
    expect(manifest.theme_color).toBe(CORRANZO_THEME_COLOR)
    expect(manifest.icons.every((icon) => icon.src === CORRANZO_LOGO_SRC)).toBe(true)
  })

  it('cloudflare static allowlist serves brand assets without SPA fallback', () => {
    const source = readFileSync(join(root, 'src', 'platform', 'cloudflareSpaFallback.js'), 'utf8')
    expect(source).toContain("'/corranzo-logo.png'")
    expect(source).toContain("'/site.webmanifest'")
    expect(source).not.toContain('favicon.svg')
    expect(source).not.toContain('icons.svg')
  })
})
