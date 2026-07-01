import { describe, expect, it } from 'vitest'
import {
  BETA_LABEL,
  BETA_VERSION,
  FEEDBACK_BODY,
  FEEDBACK_EMAIL,
  FEEDBACK_MAILTO,
  FEEDBACK_SUBJECT,
  LOCAL_ONLY_MESSAGE,
} from '../src/features/beta/betaInfo.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('public beta polish', () => {
  it('builds a prefilled email feedback link', () => {
    expect(BETA_LABEL).toBe('Public beta')
    expect(BETA_VERSION).toBe('0.2.0')
    expect(FEEDBACK_EMAIL).toBe('joedesmos.co@gmail.com')
    expect(FEEDBACK_SUBJECT).toBe('Corranzo beta feedback')
    expect(FEEDBACK_BODY).toContain('Device/browser:')
    expect(FEEDBACK_BODY).toContain('What broke or confused me:')
    expect(FEEDBACK_BODY).toContain('Score file type used:')
    expect(FEEDBACK_MAILTO).toBe(
      `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
        FEEDBACK_SUBJECT,
      )}&body=${encodeURIComponent(FEEDBACK_BODY)}`,
    )
  })

  it('keeps the local-only explanation short and explicit', () => {
    expect(LOCAL_ONLY_MESSAGE).toContain('stay in this browser')
    expect(LOCAL_ONLY_MESSAGE).toContain('No account or cloud sync')
  })

  it('keeps beta and restore notices subtle in the app chrome', () => {
    const topbar = readSrc('components', 'TopBar.jsx')
    const restoreBanner = readSrc('components', 'SessionRestoreBanner.jsx')
    const css = readSrc('App.css')

    expect(topbar).toContain('Progress')
    expect(topbar).not.toContain("label: 'Log'")
    expect(topbar).toContain('title={`${BETA_LABEL} v${BETA_VERSION}`}')
    expect(topbar).toContain('Beta')
    expect(topbar).not.toContain('{BETA_LABEL} <span aria-hidden="true">·</span> v{BETA_VERSION}')
    expect(restoreBanner).toMatch(/window\.setTimeout\(onDismiss, 5200\)/)
    expect(restoreBanner).toMatch(/tone === 'error'/)
    expect(css).toMatch(/\.session-restore-banner \{[\s\S]*position: fixed/)
    expect(css).toMatch(/\.session-restore-banner \{[\s\S]*width: min\(420px, calc\(100vw - 32px\)\)/)
    expect(css).not.toMatch(/session-restore-banner \+ \.main-layout/)
  })
})
