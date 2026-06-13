import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

/**
 * Regression guard for runtime ReferenceErrors caused by missing imports.
 *
 * Background: commit 2576e2a removed the `filterTrustedAnchors` import from
 * useScoreFollow.js while keeping the call site. Unit tests and `vite build`
 * both passed (free identifiers are assumed to be runtime globals), but the
 * app crashed blank in the browser with:
 *   ReferenceError: Can't find variable: filterTrustedAnchors
 *
 * ESLint's `no-undef` catches this class statically. This test pins src/ at
 * zero `no-undef` errors so a missing identifier can never again hide inside
 * general lint debt.
 */
describe('static integrity', () => {
  it('src/ has no undefined identifiers (would be runtime ReferenceErrors)', async () => {
    const eslint = new ESLint({})
    const results = await eslint.lintFiles(['src/**/*.{js,jsx}'])

    const undefinedIdentifiers = []
    for (const result of results) {
      for (const message of result.messages) {
        if (message.ruleId === 'no-undef') {
          undefinedIdentifiers.push(
            `${result.filePath}:${message.line}:${message.column} ${message.message}`,
          )
        }
      }
    }

    expect(undefinedIdentifiers).toEqual([])
  }, 120_000)
})
